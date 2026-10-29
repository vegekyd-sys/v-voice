// Server catalog is authoritative. Never restore a model omitted by the service.
export function phoneModelOptions(status, previous = 'seeduplex') {
  const models = (Array.isArray(status.models) ? status.models : [{id:'gpt-live',label:'GPT Live',available:true}])
    .filter(m => ['gpt-live','seeduplex','grok','fish-stt'].includes(m.id) && (!status.unidentified || m.id !== 'gpt-live'))
    .map(m => ({...m,available:Boolean(m.available)}));
  const usable = id => models.some(m => m.id === id && m.available);
  const model = [status.defaultModel, previous, 'seeduplex','gpt-live','grok'].find(usable) ?? null;
  return {models, model};
}
