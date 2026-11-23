import {createFalClient} from '@fal-ai/director-client';
import {wma} from '@fal-ai/director-client/realtime';

export function openDirector(proxyUrl, callbacks) {
  const client = createFalClient({proxyUrl});
  return client.realtime.open(wma('minimax/h3-max/director'), {
    receive:['video','audio'], negotiationTimeoutMs:90000, ...callbacks
  });
}
