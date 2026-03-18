function createKey(namespace, suffix) {
  return `${namespace}:${suffix}`;
}

export function createSharedState({
  redis,
  namespace = 'rakuten-proxy',
  globalConcurrencyLimit = 10,
  concurrencyTtlSeconds = 30,
  backoffBaseMs = 1000,
  failureWindowMs = 10000,
  circuitFailureThreshold = 3,
  circuitOpenMs = 5000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  const concurrencyKey = createKey(namespace, 'concurrency:global');
  const cachePrefix = createKey(namespace, 'cache');
  const backoffPrefix = createKey(namespace, 'backoff');
  const failurePrefix = createKey(namespace, 'failure');
  const singleFlightLockPrefix = createKey(namespace, 'singleflight:lock');
  const singleFlightResultPrefix = createKey(namespace, 'singleflight:result');
  const stats = {
    cacheHits: 0,
    cacheMisses: 0,
    backoffRejects: 0,
    concurrencyRejects: 0,
  };

  return {
    async acquireConcurrencyToken() {
      const activeCount = await redis.incr(concurrencyKey);

      if (activeCount === 1) {
        await redis.expire(concurrencyKey, concurrencyTtlSeconds);
      }

      if (activeCount > globalConcurrencyLimit) {
        await redis.decr(concurrencyKey);
        stats.concurrencyRejects += 1;
        return {
          acquired: false,
          reason: 'limit_exceeded',
          activeCount,
        };
      }

      let released = false;

      return {
        acquired: true,
        activeCount,
        async release() {
          if (released) {
            return;
          }

          released = true;
          await redis.decr(concurrencyKey);
        },
      };
    },

    async getCachedResponse(cacheKey) {
      const rawValue = await redis.get(`${cachePrefix}:${cacheKey}`);
      return rawValue ? JSON.parse(rawValue) : null;
    },

    recordCacheHit() {
      stats.cacheHits += 1;
    },

    recordCacheMiss() {
      stats.cacheMisses += 1;
    },

    async setCachedResponse(cacheKey, value, ttlSeconds) {
      await redis.set(`${cachePrefix}:${cacheKey}`, JSON.stringify(value), {
        exSeconds: ttlSeconds,
      });
    },

    async getEndpointBackoff(endpoint) {
      const rawValue = await redis.get(`${backoffPrefix}:${endpoint}`);
      if (!rawValue) {
        return null;
      }

      return JSON.parse(rawValue);
    },

    async recordUpstreamFailure(endpoint, failure) {
      if (failure.statusCode === 429) {
        const retryAfterMs = Math.max(failure.retryAfterMs || 0, backoffBaseMs);
        const value = {
          reason: 'upstream_rate_limited',
          statusCode: 429,
          retryAfterMs,
        };

        await redis.set(`${backoffPrefix}:${endpoint}`, JSON.stringify(value), {
          pxMs: retryAfterMs,
        });

        return value;
      }

      if (failure.statusCode >= 500) {
        const failureKey = `${failurePrefix}:${endpoint}`;
        const failureCount = await redis.incr(failureKey);

        if (failureCount === 1) {
          await redis.expire(
            failureKey,
            Math.max(1, Math.ceil(failureWindowMs / 1000))
          );
        }

        if (failureCount >= circuitFailureThreshold) {
          const value = {
            reason: 'circuit_open',
            statusCode: failure.statusCode,
            retryAfterMs: circuitOpenMs,
          };

          await redis.set(`${backoffPrefix}:${endpoint}`, JSON.stringify(value), {
            pxMs: circuitOpenMs,
          });

          return value;
        }
      }

      return null;
    },

    async clearEndpointFailures(endpoint) {
      await redis.del(`${backoffPrefix}:${endpoint}`);
      await redis.del(`${failurePrefix}:${endpoint}`);
    },

    recordBackoffReject() {
      stats.backoffRejects += 1;
    },

    async tryAcquireSingleFlight(cacheKey, lockMs) {
      const lockKey = `${singleFlightLockPrefix}:${cacheKey}`;
      const result = await redis.set(lockKey, '1', {
        nx: true,
        pxMs: lockMs,
      });

      if (result !== 'OK') {
        return {
          acquired: false,
        };
      }

      let released = false;

      return {
        acquired: true,
        async release() {
          if (released) {
            return;
          }

          released = true;
          await redis.del(lockKey);
        },
      };
    },

    async publishSingleFlightResult(cacheKey, value, ttlMs) {
      await redis.set(
        `${singleFlightResultPrefix}:${cacheKey}`,
        JSON.stringify(value),
        {
          pxMs: ttlMs,
        }
      );
    },

    async waitForSingleFlightResult(cacheKey, waitMs, pollMs) {
      const deadline = Date.now() + waitMs;

      while (Date.now() <= deadline) {
        const rawValue = await redis.get(`${singleFlightResultPrefix}:${cacheKey}`);
        if (rawValue) {
          return JSON.parse(rawValue);
        }

        await sleep(pollMs);
      }

      return null;
    },

    async getStatus() {
      let redisReady = true;
      let activeConcurrency = 0;

      try {
        await redis.ping();
        activeConcurrency = Number((await redis.get(concurrencyKey)) || 0);
      } catch {
        redisReady = false;
      }

      return {
        redis: {
          ready: redisReady,
        },
        degraded: !redisReady,
        cache: {
          hits: stats.cacheHits,
          misses: stats.cacheMisses,
        },
        globalConcurrency: {
          limit: globalConcurrencyLimit,
          active: activeConcurrency,
        },
        rejections: {
          backoff: stats.backoffRejects,
          concurrency: stats.concurrencyRejects,
        },
      };
    },
  };
}
