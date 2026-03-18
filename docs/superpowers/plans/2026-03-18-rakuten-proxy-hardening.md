# Rakuten Proxy Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Rakuten proxy into a Redis-backed multi-instance service that remains backward compatible while failing fast under load and reducing upstream `429` failures.

**Architecture:** Split the current single-file proxy into focused modules, add Redis-backed shared state for cache and concurrency control, preserve the public API surface, and ship deployment templates for Redis, multi-instance `systemd`, and Nginx upstream load balancing.

**Tech Stack:** Node.js 18 ESM, built-in `node:test`, Redis, systemd, Nginx

---

### Task 1: Add server test harness and write failing behavior tests

**Files:**
- Create: `server/package.json`
- Create: `server/tests/cache-policy.test.mjs`
- Create: `server/tests/shared-state.test.mjs`
- Create: `server/tests/http-server.test.mjs`
- Create: `server/tests/helpers/fake-redis-client.mjs`

- [ ] **Step 1: Write the failing cache policy test**

```js
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
```

- [ ] **Step 2: Run the cache policy test and verify it fails**

Run: `cd /root/chajian/server && node --test tests/cache-policy.test.mjs`
Expected: FAIL because `../src/cache-policy.mjs` does not exist yet.

- [ ] **Step 3: Write failing shared-state tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedState } from '../src/shared-state.mjs';
import { createFakeRedisClient } from './helpers/fake-redis-client.mjs';

test('shared state rejects when global concurrency limit is exhausted', async () => {
  const redis = createFakeRedisClient();
  const sharedState = createSharedState({
    redis,
    globalConcurrencyLimit: 1,
    backoffBaseMs: 1000,
  });

  const first = await sharedState.acquireConcurrencyToken('IchibaTag/Search/20140222');
  assert.equal(first.acquired, true);

  const second = await sharedState.acquireConcurrencyToken('IchibaTag/Search/20140222');
  assert.equal(second.acquired, false);
});
```

- [ ] **Step 4: Run the shared-state test and verify it fails**

Run: `cd /root/chajian/server && node --test tests/shared-state.test.mjs`
Expected: FAIL because `../src/shared-state.mjs` does not exist yet.

- [ ] **Step 5: Write failing HTTP behavior tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';

test('cached endpoint serves cached response without calling upstream twice', async () => {
  // Build the app with a fake upstream fetcher and fake Redis-backed shared state.
  // Prime one request, then repeat it and assert the second request is served from cache.
});
```

- [ ] **Step 6: Run the HTTP test and verify it fails**

Run: `cd /root/chajian/server && node --test tests/http-server.test.mjs`
Expected: FAIL because `../src/app.mjs` does not exist yet.

- [ ] **Step 7: Record the checkpoint**

Git commit is unavailable in this extracted snapshot because `/root/chajian` is not a git repository. Do not initialize a repository as part of this task.

### Task 2: Implement cache policy, shared state, and modular app code

**Files:**
- Create: `server/src/cache-policy.mjs`
- Create: `server/src/config.mjs`
- Create: `server/src/logger.mjs`
- Create: `server/src/redis-client.mjs`
- Create: `server/src/shared-state.mjs`
- Create: `server/src/proxy-service.mjs`
- Create: `server/src/app.mjs`
- Modify: `server/rakuten-proxy-server.mjs`

- [ ] **Step 1: Implement the minimal cache policy module**

```js
export function getCachePolicyForEndpoint(endpoint) {
  if (/^IchibaGenre\/Search\//.test(endpoint)) {
    return {
      cacheable: true,
      ttlSeconds: 60,
      negativeTtlSeconds: 10,
      singleFlight: true,
    };
  }

  if (/^IchibaTag\/Search\//.test(endpoint)) {
    return {
      cacheable: true,
      ttlSeconds: 10,
      negativeTtlSeconds: 10,
      singleFlight: true,
    };
  }

  if (/^IchibaItem\/Ranking\//.test(endpoint)) {
    return {
      cacheable: true,
      ttlSeconds: 5,
      negativeTtlSeconds: 5,
      singleFlight: true,
    };
  }

  if (/^IchibaItem\/Search\//.test(endpoint)) {
    return {
      cacheable: false,
      ttlSeconds: 0,
      negativeTtlSeconds: 0,
      singleFlight: true,
    };
  }

  return {
    cacheable: false,
    ttlSeconds: 0,
    negativeTtlSeconds: 0,
    singleFlight: false,
  };
}
```

- [ ] **Step 2: Run the cache policy test and verify it passes**

Run: `cd /root/chajian/server && node --test tests/cache-policy.test.mjs`
Expected: PASS

- [ ] **Step 3: Implement Redis-backed shared state**

```js
export function createSharedState({ redis, globalConcurrencyLimit, backoffBaseMs }) {
  return {
    async acquireConcurrencyToken(endpoint) {
      const key = `rakuten:concurrency:${endpoint}`;
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, 30);
      }

      if (current > globalConcurrencyLimit) {
        await redis.decr(key);
        return { acquired: false, reason: 'limit_exceeded' };
      }

      return { acquired: true, key };
    },
  };
}
```

- [ ] **Step 4: Run the shared-state test and verify it passes**

Run: `cd /root/chajian/server && node --test tests/shared-state.test.mjs`
Expected: PASS

- [ ] **Step 5: Implement the HTTP app and proxy service**

```js
const app = createApp({
  config,
  sharedState,
  fetchImpl,
});
```

Implement:
- request validation
- backward-compatible `/health`
- loopback-only `/internal/status`
- cache lookup and write-through behavior
- single-flight lock path
- global concurrency token acquire/release
- endpoint-specific backoff on `429`, timeout, and `5xx`
- structured logging without leaking credentials

- [ ] **Step 6: Replace the entrypoint with the modular app bootstrap**

```js
import { createServer } from 'node:http';
import { createApp } from './src/app.mjs';
import { loadConfig } from './src/config.mjs';
import { createRedisClient } from './src/redis-client.mjs';
import { createSharedState } from './src/shared-state.mjs';
```

- [ ] **Step 7: Run the HTTP tests and verify they pass**

Run: `cd /root/chajian/server && node --test tests/http-server.test.mjs`
Expected: PASS

- [ ] **Step 8: Run the full server test suite**

Run: `cd /root/chajian/server && node --test tests/*.test.mjs`
Expected: PASS with 0 failures

- [ ] **Step 9: Record the checkpoint**

Git commit is unavailable in this extracted snapshot because `/root/chajian` is not a git repository. Do not initialize a repository as part of this task.

### Task 3: Add deployment templates for Redis, multi-instance systemd, and Nginx

**Files:**
- Modify: `server/rakuten-proxy.env.example`
- Create: `server/rakuten-redis.conf`
- Create: `server/rakuten-proxy@.service`
- Modify: `server/nginx.api.845817074.xyz.ssl.conf`
- Modify: `server/nginx.api.845817074.xyz.conf`

- [ ] **Step 1: Write failing configuration coverage into the HTTP test**

```js
test('health output reports redis readiness and worker identity', async () => {
  // Expect additive fields, while keeping old fields present.
});
```

- [ ] **Step 2: Run the HTTP test and verify it fails**

Run: `cd /root/chajian/server && node --test tests/http-server.test.mjs`
Expected: FAIL because the health payload does not yet expose the new fields.

- [ ] **Step 3: Update the env template**

Add explicit knobs for:
- worker id
- listen host and port
- Redis host and port
- endpoint TTLs
- global concurrency limit
- Nginx-facing fast-fail thresholds

- [ ] **Step 4: Add Redis and multi-instance service templates**

Create:
- `server/rakuten-redis.conf`
- `server/rakuten-proxy@.service`

Ensure the service template reads instance-specific port and worker configuration.

- [ ] **Step 5: Update Nginx templates**

Add:
- upstream block for multiple loopback workers
- `limit_req_zone` and `limit_req`
- stronger proxy timeout and `proxy_next_upstream` rules
- loopback-only access rule for `/internal/status`

- [ ] **Step 6: Re-run the HTTP tests and verify they pass**

Run: `cd /root/chajian/server && node --test tests/http-server.test.mjs`
Expected: PASS

- [ ] **Step 7: Record the checkpoint**

Git commit is unavailable in this extracted snapshot because `/root/chajian` is not a git repository. Do not initialize a repository as part of this task.

### Task 4: Verify locally and deploy the updated templates

**Files:**
- Modify: `/opt/rakuten-proxy/rakuten-proxy-server.mjs`
- Create or Modify: `/opt/rakuten-proxy/src/*`
- Modify: `/etc/systemd/system/rakuten-proxy@.service`
- Modify: `/etc/nginx/sites-available/api.845817074.xyz.conf`
- Create: `/etc/redis/redis.conf` or dedicated local include, depending on package layout

- [ ] **Step 1: Run the full local test suite before deployment**

Run: `cd /root/chajian/server && node --test tests/*.test.mjs`
Expected: PASS with 0 failures

- [ ] **Step 2: Deploy the server code and templates to the live paths**

Use non-destructive copy/install commands so the working source under `/root/chajian/server` remains the source of truth.

- [ ] **Step 3: Install and enable Redis**

Run the system package install, configure it to bind to `127.0.0.1`, and start it.

- [ ] **Step 4: Enable multiple proxy worker instances**

Use `systemctl daemon-reload`, then enable and start the chosen worker instances, for example `rakuten-proxy@1`, `rakuten-proxy@2`, and `rakuten-proxy@3`.

- [ ] **Step 5: Validate configuration**

Run:
- `nginx -t`
- `systemctl --no-pager --full status rakuten-proxy@1.service`
- `systemctl --no-pager --full status redis.service`

Expected: all commands succeed.

- [ ] **Step 6: Run live verification**

Run a short concurrency check against:
- `https://api.845817074.xyz/health`
- `https://api.845817074.xyz/rakuten/proxy?...`

Expected:
- public API still responds
- repeated cacheable calls stop hammering upstream
- overload returns controlled failures instead of long stalls

- [ ] **Step 7: Record the completion checkpoint**

Git commit is unavailable in this extracted snapshot because `/root/chajian` is not a git repository. Do not initialize a repository as part of this task.
