const DEFAULT_ENDPOINT_BASE_URLS = [
  {
    pattern: /^IchibaItem\/Search\//,
    baseUrl: 'https://openapi.rakuten.co.jp/ichibams/api/',
  },
  {
    pattern: /^IchibaGenre\/Search\//,
    baseUrl: 'https://openapi.rakuten.co.jp/ichibagt/api/',
  },
  {
    pattern: /^IchibaTag\/Search\//,
    baseUrl: 'https://openapi.rakuten.co.jp/ichibagt/api/',
  },
  {
    pattern: /^IchibaItem\/Ranking\//,
    baseUrl: 'https://openapi.rakuten.co.jp/ichibaranking/api/',
  },
];

function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env = process.env) {
  return {
    port: readNumber(env.PORT, 3000),
    listenHost: env.LISTEN_HOST || '127.0.0.1',
    allowedOrigin: env.ALLOWED_ORIGIN || '*',
    publicBaseUrl: env.PUBLIC_BASE_URL || 'https://api.845817074.xyz',
    workerId: env.WORKER_ID || 'worker-0',
    requestTimeoutMs: readNumber(env.REQUEST_TIMEOUT_MS, 30000),
    backoffBaseMs: readNumber(env.BACKOFF_BASE_MS, 1000),
    failureWindowMs: readNumber(env.FAILURE_WINDOW_MS, 10000),
    circuitFailureThreshold: readNumber(env.CIRCUIT_FAILURE_THRESHOLD, 3),
    circuitOpenMs: readNumber(env.CIRCUIT_OPEN_MS, 5000),
    globalConcurrencyLimit: readNumber(env.GLOBAL_CONCURRENCY_LIMIT, 10),
    concurrencyTtlSeconds: readNumber(env.CONCURRENCY_TTL_SECONDS, 30),
    singleFlightLockMs: readNumber(env.SINGLE_FLIGHT_LOCK_MS, 2000),
    singleFlightWaitMs: readNumber(env.SINGLE_FLIGHT_WAIT_MS, 1000),
    singleFlightPollMs: readNumber(env.SINGLE_FLIGHT_POLL_MS, 25),
    singleFlightResultTtlMs: readNumber(env.SINGLE_FLIGHT_RESULT_TTL_MS, 1000),
    genreCacheTtlSeconds: readNumber(env.GENRE_CACHE_TTL_SECONDS, 60),
    tagCacheTtlSeconds: readNumber(env.TAG_CACHE_TTL_SECONDS, 10),
    rankingCacheTtlSeconds: readNumber(env.RANKING_CACHE_TTL_SECONDS, 5),
    negativeCacheTtlSeconds: readNumber(env.NEGATIVE_CACHE_TTL_SECONDS, 10),
    redisHost: env.REDIS_HOST || '127.0.0.1',
    redisPort: readNumber(env.REDIS_PORT, 6379),
    redisConnectTimeoutMs: readNumber(env.REDIS_CONNECT_TIMEOUT_MS, 2000),
    redisNamespace: env.REDIS_NAMESPACE || 'rakuten-proxy',
    rakutenApplicationId: env.RAKUTEN_APPLICATION_ID || '',
    rakutenAccessKey: env.RAKUTEN_ACCESS_KEY || '',
    endpointBaseUrls: DEFAULT_ENDPOINT_BASE_URLS,
  };
}
