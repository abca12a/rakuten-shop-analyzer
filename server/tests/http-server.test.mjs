import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.mjs';
import { createSharedState } from '../src/shared-state.mjs';
import { createFakeRedisClient } from './helpers/fake-redis-client.mjs';

function createFakeResponse() {
  const headers = new Map();
  let body = '';

  return {
    statusCode: 200,
    headers,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    end(chunk = '') {
      body += chunk;
      this.body = body;
      this.finished = true;
    },
  };
}

async function invoke(handler, url, options = {}) {
  const request = {
    method: 'GET',
    url,
    headers: {
      host: 'api.845817074.xyz',
    },
    socket: {
      remoteAddress: options.remoteAddress || '127.0.0.1',
    },
  };
  const response = createFakeResponse();

  await handler(request, response);
  return response;
}

test('cached endpoint serves cached response without calling upstream twice', async () => {
  const redis = createFakeRedisClient();
  const sharedState = createSharedState({
    redis,
    globalConcurrencyLimit: 10,
    concurrencyTtlSeconds: 30,
  });

  let upstreamCalls = 0;

  const app = createApp({
    config: {
      allowedOrigin: '*',
      workerId: 'test-worker',
      requestTimeoutMs: 500,
      rakutenApplicationId: 'app-id',
      rakutenAccessKey: 'access-key',
      singleFlightLockMs: 2000,
      singleFlightWaitMs: 1000,
      singleFlightPollMs: 10,
      endpointBaseUrls: [
        {
          pattern: /^IchibaGenre\/Search\//,
          baseUrl: 'https://example.invalid/ichibagt/api/',
        },
      ],
    },
    sharedState,
    fetchImpl: async () => {
      upstreamCalls += 1;
      return new Response(JSON.stringify({ genreId: 0, hits: 1 }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
      });
    },
    log: () => {},
  });

  const firstResponse = await invoke(
    app,
    '/rakuten/proxy?endpoint=IchibaGenre/Search/20120723&genreId=0&formatVersion=2'
  );
  assert.equal(firstResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(firstResponse.body), { genreId: 0, hits: 1 });

  const secondResponse = await invoke(
    app,
    '/rakuten/proxy?endpoint=IchibaGenre/Search/20120723&genreId=0&formatVersion=2'
  );
  assert.equal(secondResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(secondResponse.body), { genreId: 0, hits: 1 });

  assert.equal(upstreamCalls, 1);
});

test('endpoint backoff stops repeated upstream calls after a 429 response', async () => {
  const redis = createFakeRedisClient();
  const sharedState = createSharedState({
    redis,
    globalConcurrencyLimit: 10,
    concurrencyTtlSeconds: 30,
    backoffBaseMs: 2000,
  });

  let upstreamCalls = 0;

  const app = createApp({
    config: {
      allowedOrigin: '*',
      workerId: 'test-worker',
      requestTimeoutMs: 500,
      rakutenApplicationId: 'app-id',
      rakutenAccessKey: 'access-key',
      singleFlightLockMs: 2000,
      singleFlightWaitMs: 1000,
      singleFlightPollMs: 10,
      endpointBaseUrls: [
        {
          pattern: /^IchibaTag\/Search\//,
          baseUrl: 'https://example.invalid/ichibagt/api/',
        },
      ],
    },
    sharedState,
    fetchImpl: async () => {
      upstreamCalls += 1;
      return new Response(
        JSON.stringify({
          statusCode: 429,
          message: 'Rate limit is exceeded. Try again in 1 seconds.',
        }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
        }
      );
    },
    log: () => {},
  });

  const firstResponse = await invoke(
    app,
    '/rakuten/proxy?endpoint=IchibaTag/Search/20140222&tagId=1001&formatVersion=2'
  );
  assert.equal(firstResponse.statusCode, 429);

  const secondResponse = await invoke(
    app,
    '/rakuten/proxy?endpoint=IchibaTag/Search/20140222&tagId=1001&formatVersion=2'
  );
  assert.equal(secondResponse.statusCode, 429);
  assert.equal(upstreamCalls, 1);
  assert.match(secondResponse.body, /限流|繁忙|retry/i);
});

test('single-flight deduplicates concurrent item search requests', async () => {
  const redis = createFakeRedisClient();
  const sharedState = createSharedState({
    redis,
    globalConcurrencyLimit: 10,
    concurrencyTtlSeconds: 30,
  });

  let upstreamCalls = 0;

  const app = createApp({
    config: {
      allowedOrigin: '*',
      workerId: 'test-worker',
      requestTimeoutMs: 1000,
      rakutenApplicationId: 'app-id',
      rakutenAccessKey: 'access-key',
      singleFlightLockMs: 500,
      singleFlightWaitMs: 1000,
      singleFlightPollMs: 10,
      singleFlightResultTtlMs: 1000,
      endpointBaseUrls: [
        {
          pattern: /^IchibaItem\/Search\//,
          baseUrl: 'https://example.invalid/ichibams/api/',
        },
      ],
    },
    sharedState,
    fetchImpl: async () => {
      upstreamCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 50));
      return new Response(JSON.stringify({ page: 1, hits: 30 }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
      });
    },
    log: () => {},
  });

  const [firstResponse, secondResponse] = await Promise.all([
    invoke(
      app,
      '/rakuten/proxy?endpoint=IchibaItem/Search/20220601&shopCode=test-shop&page=1&formatVersion=2'
    ),
    invoke(
      app,
      '/rakuten/proxy?endpoint=IchibaItem/Search/20220601&shopCode=test-shop&page=1&formatVersion=2'
    ),
  ]);

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(firstResponse.body), { page: 1, hits: 30 });
  assert.deepEqual(JSON.parse(secondResponse.body), { page: 1, hits: 30 });
  assert.equal(upstreamCalls, 1);
});

test('health output reports redis readiness and worker identity', async () => {
  const redis = createFakeRedisClient();
  const sharedState = createSharedState({
    redis,
    globalConcurrencyLimit: 10,
    concurrencyTtlSeconds: 30,
  });

  const app = createApp({
    config: {
      allowedOrigin: '*',
      workerId: 'worker-1',
      requestTimeoutMs: 500,
      rakutenApplicationId: 'app-id',
      rakutenAccessKey: 'access-key',
      publicBaseUrl: 'https://api.845817074.xyz',
      singleFlightLockMs: 500,
      singleFlightWaitMs: 1000,
      singleFlightPollMs: 10,
      endpointBaseUrls: [],
    },
    sharedState,
    fetchImpl: async () => {
      throw new Error('health should not hit upstream');
    },
    log: () => {},
  });

  const response = await invoke(app, '/health');
  const payload = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'rakuten-proxy');
  assert.equal(payload.endpoint, 'https://api.845817074.xyz');
  assert.equal(payload.rakutenConfigured, true);
  assert.equal(payload.workerId, 'worker-1');
  assert.equal(payload.redis.ready, true);
  assert.equal(payload.degraded, false);
  assert.deepEqual(payload.cache, {
    hits: 0,
    misses: 0,
  });
  assert.equal(payload.globalConcurrency.limit, 10);
});

test('internal status is loopback-only', async () => {
  const redis = createFakeRedisClient();
  const sharedState = createSharedState({
    redis,
    globalConcurrencyLimit: 10,
    concurrencyTtlSeconds: 30,
  });

  const app = createApp({
    config: {
      allowedOrigin: '*',
      workerId: 'worker-1',
      requestTimeoutMs: 500,
      rakutenApplicationId: 'app-id',
      rakutenAccessKey: 'access-key',
      publicBaseUrl: 'https://api.845817074.xyz',
      singleFlightLockMs: 500,
      singleFlightWaitMs: 1000,
      singleFlightPollMs: 10,
      endpointBaseUrls: [],
    },
    sharedState,
    fetchImpl: async () => {
      throw new Error('internal status should not hit upstream');
    },
    log: () => {},
  });

  const allowedResponse = await invoke(app, '/internal/status', {
    remoteAddress: '127.0.0.1',
  });
  assert.equal(allowedResponse.statusCode, 200);
  assert.equal(JSON.parse(allowedResponse.body).workerId, 'worker-1');

  const deniedResponse = await invoke(app, '/internal/status', {
    remoteAddress: '203.0.113.10',
  });
  assert.equal(deniedResponse.statusCode, 403);
  assert.match(deniedResponse.body, /forbidden|禁止|仅限/i);
});

test('repeated upstream 5xx responses open a short circuit breaker window', async () => {
  const redis = createFakeRedisClient();
  const sharedState = createSharedState({
    redis,
    globalConcurrencyLimit: 10,
    concurrencyTtlSeconds: 30,
    backoffBaseMs: 1000,
    failureWindowMs: 5000,
    circuitFailureThreshold: 2,
    circuitOpenMs: 3000,
  });

  let upstreamCalls = 0;

  const app = createApp({
    config: {
      allowedOrigin: '*',
      workerId: 'worker-1',
      requestTimeoutMs: 500,
      rakutenApplicationId: 'app-id',
      rakutenAccessKey: 'access-key',
      backoffBaseMs: 1000,
      publicBaseUrl: 'https://api.845817074.xyz',
      singleFlightLockMs: 500,
      singleFlightWaitMs: 1000,
      singleFlightPollMs: 10,
      endpointBaseUrls: [
        {
          pattern: /^IchibaItem\/Ranking\//,
          baseUrl: 'https://example.invalid/ichibaranking/api/',
        },
      ],
    },
    sharedState,
    fetchImpl: async () => {
      upstreamCalls += 1;
      return new Response(JSON.stringify({ error: 'server_error' }), {
        status: 503,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
      });
    },
    log: () => {},
  });

  const firstResponse = await invoke(
    app,
    '/rakuten/proxy?endpoint=IchibaItem/Ranking/20220601&genreId=123&formatVersion=2'
  );
  assert.equal(firstResponse.statusCode, 503);

  const secondResponse = await invoke(
    app,
    '/rakuten/proxy?endpoint=IchibaItem/Ranking/20220601&genreId=123&formatVersion=2'
  );
  assert.equal(secondResponse.statusCode, 503);

  const thirdResponse = await invoke(
    app,
    '/rakuten/proxy?endpoint=IchibaItem/Ranking/20220601&genreId=123&formatVersion=2'
  );
  assert.equal(thirdResponse.statusCode, 503);
  assert.equal(upstreamCalls, 2);
  assert.match(thirdResponse.body, /熔断|circuit|繁忙|稍后/i);
});
