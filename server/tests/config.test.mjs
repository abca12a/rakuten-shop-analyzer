import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.mjs';

test('loadConfig applies defaults and environment overrides', () => {
  const config = loadConfig({
    PORT: '3102',
    LISTEN_HOST: '127.0.0.1',
    ALLOWED_ORIGIN: 'https://plugin.example',
    WORKER_ID: 'worker-2',
    REQUEST_TIMEOUT_MS: '15000',
    BACKOFF_BASE_MS: '2500',
    GLOBAL_CONCURRENCY_LIMIT: '12',
    RAKUTEN_APPLICATION_ID: 'app-id',
    RAKUTEN_ACCESS_KEY: 'access-key',
  });

  assert.equal(config.port, 3102);
  assert.equal(config.listenHost, '127.0.0.1');
  assert.equal(config.allowedOrigin, 'https://plugin.example');
  assert.equal(config.workerId, 'worker-2');
  assert.equal(config.requestTimeoutMs, 15000);
  assert.equal(config.backoffBaseMs, 2500);
  assert.equal(config.failureWindowMs, 10000);
  assert.equal(config.circuitFailureThreshold, 3);
  assert.equal(config.circuitOpenMs, 5000);
  assert.equal(config.globalConcurrencyLimit, 12);
  assert.equal(config.rakutenApplicationId, 'app-id');
  assert.equal(config.rakutenAccessKey, 'access-key');
  assert.equal(config.genreCacheTtlSeconds, 60);
  assert.equal(config.singleFlightResultTtlMs, 1000);
  assert.equal(config.endpointBaseUrls.length >= 4, true);
});
