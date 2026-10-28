import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('voice_tool_aggregate', Path(__file__).parents[1] / 'scripts/research/voice-tool-aggregate.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AggregateTest(unittest.TestCase):
    def run_rows(self, rows, start=0, end=10000):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'fixture.jsonl'
            path.write_text('\n'.join(json.dumps(row) for row in rows))
            return audit.aggregate([path],start,end)

    def row(self,event,at,**extra):
        return {'type':event,'at':at,'provider':'seeduplex','captureId':'private-capture','voiceSessionId':'private-session','callId':'private-call',**extra}

    def test_privacy_and_transport_status(self):
        result=self.run_rows([
            self.row('call.created',10),
            self.row('transcript',11,text='PRIVATE TRANSCRIPT SENTINEL'),
            self.row('tool.call',20,name='web_search',arguments={'secret':'PRIVATE ARG SENTINEL'}),
            self.row('tool.delivered',120,name='web_search',status='ok',result='PRIVATE RESULT SENTINEL'),
        ])
        encoded=json.dumps(result)
        for secret in ['PRIVATE','private-capture','private-session','private-call','secret']:
            self.assertNotIn(secret,encoded)
        self.assertEqual(result['callsByProvider'],{'seeduplex':1})
        self.assertEqual(result['tools'][0]['callToDelivered'],{'n':1,'p50Ms':100,'p95Ms':100})

    def test_missing_delivery_is_not_zero_latency_or_failure(self):
        result=self.run_rows([self.row('tool.call',20,name='delegate_to_v')])['tools'][0]
        self.assertEqual(result['notDeliveredInWindow'],1)
        self.assertEqual(result['deliveredStatuses'],{})
        self.assertIsNone(result['callToDelivered']['p50Ms'])

    def test_window_duplicates_and_backends(self):
        result=self.run_rows([
            self.row('call.created',9),self.row('call.created',10),self.row('call.created',100),
            self.row('tool.call',20,name='memory_search'),self.row('tool.call',20,name='memory_search'),
            self.row('tool.delivered',30,status='error'),self.row('tool.delivered',30,status='error'),
            self.row('backend.start-requested',20),self.row('backend.completed',80),
            self.row('backend.completed',80),
        ],10,100)
        self.assertEqual(result['tools'][0]['calls'],1)
        self.assertEqual(result['tools'][0]['deliveredStatuses'],{'error':1})
        self.assertEqual(result['backendRequestedToCompleted']['seeduplex']['p50Ms'],60)
        self.assertEqual(result['quality'],{'duplicateCalls':1,'duplicateDeliveries':1,'duplicateBackendCompleted':1})

    def test_untrusted_names_and_unpaired_results(self):
        result=self.run_rows([
            self.row('tool.call',20,name='PRIVATE UNKNOWN NAME'),
            self.row('tool.delivered',30,status='PRIVATE STATUS'),
            self.row('tool.delivered',40,callId='another-private-call',status='ok'),
            self.row('record.gap',50,dropped=4),
        ])
        self.assertEqual(result['tools'][0]['name'],'other')
        self.assertEqual(result['tools'][0]['deliveredStatuses'],{'unknown':1})
        self.assertNotIn('PRIVATE',json.dumps(result))
        self.assertEqual(result['quality'],{'unpairedDeliveries':1,'gapRecords':1})

    def test_explicit_timezone_and_quantiles(self):
        self.assertEqual(audit.timestamp('2026-10-27T10:00:00+08:00'),audit.timestamp('2026-10-27T02:00:00+00:00'))
        with self.assertRaises(Exception):
            audit.timestamp('2026-10-27T10:00:00')
        self.assertEqual(audit.distribution([90,10,20]),{'n':3,'p50Ms':20,'p95Ms':90})


if __name__ == '__main__':
    unittest.main()
