export function createFakeRedisClient() {
  const store = new Map();
  const expirations = new Map();

  function cleanupExpired(key) {
    const expiresAt = expirations.get(key);
    if (!expiresAt) {
      return;
    }

    if (expiresAt <= Date.now()) {
      store.delete(key);
      expirations.delete(key);
    }
  }

  function setExpiration(key, ttlMs) {
    if (!ttlMs || ttlMs <= 0) {
      expirations.delete(key);
      return;
    }

    expirations.set(key, Date.now() + ttlMs);
  }

  return {
    async ping() {
      return 'PONG';
    },

    async get(key) {
      cleanupExpired(key);
      return store.has(key) ? store.get(key) : null;
    },

    async set(key, value, options = {}) {
      cleanupExpired(key);

      if (options.nx && store.has(key)) {
        return null;
      }

      store.set(key, String(value));

      if (options.exSeconds) {
        setExpiration(key, options.exSeconds * 1000);
      } else if (options.pxMs) {
        setExpiration(key, options.pxMs);
      } else {
        expirations.delete(key);
      }

      return 'OK';
    },

    async del(key) {
      cleanupExpired(key);
      expirations.delete(key);
      return store.delete(key) ? 1 : 0;
    },

    async incr(key) {
      cleanupExpired(key);
      const nextValue = Number(store.get(key) || 0) + 1;
      store.set(key, String(nextValue));
      return nextValue;
    },

    async decr(key) {
      cleanupExpired(key);
      const nextValue = Number(store.get(key) || 0) - 1;
      store.set(key, String(nextValue));
      return nextValue;
    },

    async expire(key, ttlSeconds) {
      cleanupExpired(key);
      if (!store.has(key)) {
        return 0;
      }

      setExpiration(key, ttlSeconds * 1000);
      return 1;
    },

    async pttl(key) {
      cleanupExpired(key);
      if (!store.has(key)) {
        return -2;
      }

      const expiresAt = expirations.get(key);
      if (!expiresAt) {
        return -1;
      }

      return Math.max(0, expiresAt - Date.now());
    },
  };
}
