import test from 'node:test';
import assert from 'node:assert/strict';

import { createSharedState } from '../src/shared-state.mjs';
import { createFakeRedisClient } from './helpers/fake-redis-client.mjs';

test('shared state rejects when global concurrency limit is exhausted', async () => {
  const redis = createFakeRedisClient();
  const sharedState = createSharedState({
    redis,
    globalConcurrencyLimit: 1,
    concurrencyTtlSeconds: 30,
  });

  const first = await sharedState.acquireConcurrencyToken('IchibaTag/Search/20140222');
  assert.equal(first.acquired, true);

  const second = await sharedState.acquireConcurrencyToken('IchibaTag/Search/20140222');
  assert.equal(second.acquired, false);
  assert.equal(second.reason, 'limit_exceeded');

  await first.release();

  const third = await sharedState.acquireConcurrencyToken('IchibaTag/Search/20140222');
  assert.equal(third.acquired, true);
});
