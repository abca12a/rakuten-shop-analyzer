function readTtl(overrides, key, fallback) {
  const value = overrides?.[key];
  return Number.isFinite(value) ? value : fallback;
}

export function getCachePolicyForEndpoint(endpoint, overrides = {}) {
  const negativeCacheTtlSeconds = readTtl(
    overrides,
    'negativeCacheTtlSeconds',
    10
  );

  if (/^IchibaGenre\/Search\//.test(endpoint)) {
    return {
      cacheable: true,
      ttlSeconds: readTtl(overrides, 'genreCacheTtlSeconds', 60),
      negativeTtlSeconds: negativeCacheTtlSeconds,
      singleFlight: true,
    };
  }

  if (/^IchibaTag\/Search\//.test(endpoint)) {
    return {
      cacheable: true,
      ttlSeconds: readTtl(overrides, 'tagCacheTtlSeconds', 10),
      negativeTtlSeconds: negativeCacheTtlSeconds,
      singleFlight: true,
    };
  }

  if (/^IchibaItem\/Ranking\//.test(endpoint)) {
    return {
      cacheable: true,
      ttlSeconds: readTtl(overrides, 'rankingCacheTtlSeconds', 5),
      negativeTtlSeconds: readTtl(overrides, 'negativeCacheTtlSeconds', 5),
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
