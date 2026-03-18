# Rakuten Proxy Hardening Design

**Date:** 2026-03-18

**Status:** Approved by user in-session

**Goal**

Upgrade the current single-process Rakuten proxy into a multi-instance, Redis-backed service that keeps the public API fully backward compatible while reducing rate-limit failures, avoiding long request pileups, and degrading quickly under load instead of stalling or crashing.

**Current State**

The current backend is a single Node.js process behind a thin Nginx proxy. It forwards every eligible request directly to Rakuten, has per-request timeouts, and relies on `systemd` restart-on-failure. It does not have server-side caching, shared concurrency control, global rate limiting, request coalescing, or endpoint-specific backoff. Production logs already show frequent upstream `429` responses during bursts.

**Constraints**

- Keep `https://api.845817074.xyz/rakuten/proxy` and `/health` backward compatible.
- Allow deployment-layer changes, including Redis, `systemd`, and Nginx.
- Prefer stability over best-effort latency at high load.
- Use caching conservatively:
  - cache only the endpoints most likely to trigger `429`
  - do not broadly cache item search results
- Fast rejection is preferred over long queueing when the system is saturated.

**Rejected Approaches**

1. Single-process hardening only
   This reduces risk somewhat, but it leaves the process as a single hot spot and does not isolate event-loop or resource contention.

2. Full distributed redesign
   This would solve more long-term scaling concerns, but it is more operational complexity than needed for the current single-host deployment.

**Chosen Architecture**

Use a same-host multi-instance architecture:

`Client -> Nginx -> multiple Node proxy workers -> Redis -> Rakuten API`

- Nginx remains the public entrypoint and performs lightweight per-IP burst control plus upstream load balancing.
- Multiple Node workers serve the same API on different loopback ports.
- Redis provides shared cache, shared concurrency counters, shared backoff windows, shared circuit state, and duplicate-request suppression.
- Public request paths, query parameters, and response bodies remain compatible with the existing plugin.

**Request Flow**

1. Nginx receives the request and applies a lightweight request-rate guard.
2. Nginx forwards the request to one Node worker.
3. The worker validates the request and resolves the target Rakuten endpoint.
4. The worker checks whether the request is cacheable under the configured endpoint policy.
5. The worker looks for a cached success or short-lived negative cache entry in Redis.
6. The worker checks whether the target endpoint is in a temporary backoff or circuit-open window.
7. The worker tries to acquire a global concurrency token from Redis.
8. If the request is eligible, the worker tries to acquire a short-lived single-flight lock for identical requests.
9. The winning worker calls Rakuten, maps the upstream response, writes cache entries when allowed, then releases the token and lock.
10. Losing workers either read the newly populated cache or fail fast if the request remains blocked.

**Caching Policy**

Caching is intentionally narrow:

- `IchibaGenre/Search/*`
  Cache success responses for about 60 seconds.
- `IchibaTag/Search/*`
  Cache success responses for about 10 seconds.
- `IchibaItem/Ranking/*`
  Cache success responses for about 5 seconds.
- `IchibaItem/Search/*`
  Do not apply general response caching by default.
  Only use short-lived duplicate suppression for identical concurrent requests.
- Known business `404` and equivalent negative responses
  Cache for about 5 to 10 seconds to suppress repeated bad lookups.

All TTLs must be environment-configurable.

**Protection Model**

The protection model has three layers:

1. Nginx edge guard
   A small per-IP rate limit smooths bursts before they reach Node.

2. Shared worker protection
   All Node workers use Redis-backed counters and token keys to enforce a global concurrency ceiling.
   When the ceiling is reached, requests are rejected quickly with a controlled `429` or `503`.

3. Upstream protection
   Endpoint-specific backoff and circuit-open windows reduce repeated Rakuten calls after `429`, timeout, or `5xx` responses.

**Degradation Strategy**

The service must fail fast under sustained load.

- Keep queues short or eliminate them entirely.
- Prefer a clear `429`/`503` over a 20 to 30 second stall.
- Reuse cached data when safe.
- Keep endpoint isolation so a noisy endpoint does not drag the rest of the service down.

**Health and Observability**

The public `/health` endpoint remains compatible, but can include additive fields such as:

- `workerId`
- `redis`
- `degraded`
- `cache`
- `globalConcurrency`

Add a loopback-only `/internal/status` endpoint for operational inspection. It should expose current worker identity, Redis connectivity, cache hit/miss counts, recent upstream errors, current open circuits, and current global token pressure.

Structured logs should include:

- request id
- worker id
- endpoint
- cache status
- limiter result
- upstream latency
- final status code

Do not log full upstream URLs containing sensitive query data or credentials.

**Code Structure**

Refactor the single-file server into focused modules under `server/src/`:

- `config.mjs`
  Environment parsing and defaults.
- `cache-policy.mjs`
  Endpoint cache rules.
- `redis-client.mjs`
  Redis connection and helper operations.
- `shared-state.mjs`
  Global limiters, backoff keys, lock keys, and counters.
- `proxy-service.mjs`
  Request handling, upstream calls, and response mapping.
- `http-handlers.mjs`
  Route handling and JSON/error helpers.
- `logger.mjs`
  Structured log formatting.

The entrypoint stays `server/rakuten-proxy-server.mjs` for deployment compatibility.

**Deployment Changes**

- Install and run local Redis bound to `127.0.0.1`.
- Replace the single `rakuten-proxy.service` with a template service such as `rakuten-proxy@.service`.
- Assign one loopback port per worker using an environment file or instance number mapping.
- Update Nginx to use an upstream pool targeting those worker ports.
- Add edge rate limiting and tighter proxy timeout defaults.

**Testing Strategy**

Use automated Node tests in `server/tests/`:

- unit tests for cache policy selection
- unit tests for limiter and backoff decisions using a fake Redis adapter
- integration tests for HTTP behavior with stub upstream responses
- compatibility tests for `/health`, `/rakuten/proxy`, and error JSON shapes

Deployment verification after implementation:

- `node --test` for the server tests
- `nginx -t` for generated configuration
- `systemd-analyze verify` for service units if available
- controlled local concurrency test against loopback workers

**Risks**

- Redis becomes a new dependency.
  Mitigation: bind locally, keep config minimal, expose health clearly, and fail closed on Redis unavailability.
- Too-aggressive thresholds could over-reject.
  Mitigation: keep all thresholds configurable and start with conservative defaults.
- Logging or state code could add new overhead.
  Mitigation: keep logs structured and small, and avoid per-request heavy serialization.

**Out of Scope**

- Multi-host deployment
- Container orchestration
- Public metrics stack such as Prometheus/Grafana
- Changes to the browser extension request contract

**Implementation Readiness Notes**

- This extracted snapshot is not a git repository, so the normal superpowers commit checkpoints cannot be performed here.
- Subagent-based spec review is unavailable in this environment without explicit delegation permission, so review must be performed inline.
