import test from 'node:test';
import assert from 'node:assert/strict';

import { getCachePolicyForEndpoint } from '../src/cache-policy.mjs';

test('genre search is cacheable but item search is not', () => {
  assert.deepEqual(getCachePolicyForEndpoint('IchibaGenre/Search/20120723'), {
    cacheable: true,
    ttlSeconds: 60,
    negativeTtlSeconds: 10,
    singleFlight: true,
  });

  assert.deepEqual(getCachePolicyForEndpoint('IchibaItem/Search/20220601'), {
    cacheable: false,
    ttlSeconds: 0,
    negativeTtlSeconds: 0,
    singleFlight: true,
  });
});

test('cache policy accepts ttl overrides from config', () => {
  assert.deepEqual(
    getCachePolicyForEndpoint('IchibaTag/Search/20140222', {
      tagCacheTtlSeconds: 22,
      negativeCacheTtlSeconds: 7,
    }),
    {
      cacheable: true,
      ttlSeconds: 22,
      negativeTtlSeconds: 7,
      singleFlight: true,
    }
  );
});
