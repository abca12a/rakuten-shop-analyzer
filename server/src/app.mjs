import { getCachePolicyForEndpoint } from './cache-policy.mjs';

function setCorsHeaders(response, allowedOrigin) {
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  response.setHeader('Vary', 'Origin');
}

function sendJson(response, statusCode, payload, allowedOrigin) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  setCorsHeaders(response, allowedOrigin);
  response.end(JSON.stringify(payload));
}

function createError(statusCode, message, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function resolveRakutenBaseUrl(endpoint, endpointBaseUrls) {
  const matched = endpointBaseUrls.find(({ pattern }) => pattern.test(endpoint));

  if (!matched) {
    throw createError(400, `不支持的 endpoint: ${endpoint}`);
  }

  return matched.baseUrl;
}

function buildRakutenUrl(requestUrl, config) {
  const endpoint = requestUrl.searchParams.get('endpoint')?.trim();

  if (!endpoint || !/^[A-Za-z0-9/_-]+$/.test(endpoint)) {
    throw createError(400, '缺少或无效的 endpoint 参数');
  }

  const rakutenBaseUrl = resolveRakutenBaseUrl(endpoint, config.endpointBaseUrls);
  const rakutenUrl = new URL(endpoint, rakutenBaseUrl);
  rakutenUrl.searchParams.set('applicationId', config.rakutenApplicationId);
  rakutenUrl.searchParams.set('accessKey', config.rakutenAccessKey);

  for (const [key, value] of requestUrl.searchParams.entries()) {
    if (key === 'endpoint' || value === '') {
      continue;
    }

    rakutenUrl.searchParams.append(key, value);
  }

  return rakutenUrl;
}

function buildCacheKey(requestUrl) {
  return `${requestUrl.pathname}?${requestUrl.searchParams.toString()}`;
}

function isLoopbackAddress(address = '') {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}

function parseRetryAfterMs(upstreamResponse, body, fallbackMs) {
  const retryAfterHeader = upstreamResponse.headers.get('retry-after');
  if (retryAfterHeader && /^\d+$/.test(retryAfterHeader.trim())) {
    return Number(retryAfterHeader.trim()) * 1000;
  }

  const retryAfterMatch = body.match(/try again in (\d+)\s*seconds?/i);
  if (retryAfterMatch) {
    return Number(retryAfterMatch[1]) * 1000;
  }

  return fallbackMs;
}

async function proxyRakuten(requestUrl, response, context) {
  const { config, sharedState, fetchImpl } = context;
  const endpoint = requestUrl.searchParams.get('endpoint')?.trim() || '';
  const cachePolicy = getCachePolicyForEndpoint(endpoint, config);
  const cacheKey = buildCacheKey(requestUrl);

  if (cachePolicy.cacheable) {
    const cachedResponse = await sharedState.getCachedResponse(cacheKey);
    if (cachedResponse) {
      sharedState.recordCacheHit();
      response.statusCode = cachedResponse.statusCode;
      response.setHeader('Content-Type', cachedResponse.contentType);
      setCorsHeaders(response, config.allowedOrigin);
      response.end(cachedResponse.body);
      return;
    }

    sharedState.recordCacheMiss();
  }

  const activeBackoff = await sharedState.getEndpointBackoff(endpoint);
  if (activeBackoff) {
    sharedState.recordBackoffReject();
    const statusCode = activeBackoff.reason === 'circuit_open' ? 503 : 429;
    const message =
      activeBackoff.reason === 'circuit_open'
        ? '上游 Rakuten API 当前熔断保护中，请稍后重试'
        : '上游 Rakuten API 当前限流，请稍后重试';
    throw createError(statusCode, message, {
      endpoint,
      retryAfterMs: activeBackoff.retryAfterMs,
      reason: activeBackoff.reason,
    });
  }

  let singleFlight = null;
  if (cachePolicy.singleFlight) {
    singleFlight = await sharedState.tryAcquireSingleFlight(
      cacheKey,
      config.singleFlightLockMs || 2000
    );

    if (!singleFlight.acquired) {
      const reusedResponse = await sharedState.waitForSingleFlightResult(
        cacheKey,
        config.singleFlightWaitMs || 1000,
        config.singleFlightPollMs || 25
      );

      if (reusedResponse) {
        response.statusCode = reusedResponse.statusCode;
        response.setHeader('Content-Type', reusedResponse.contentType);
        setCorsHeaders(response, config.allowedOrigin);
        response.end(reusedResponse.body);
        return;
      }

      throw createError(503, '代理服务当前繁忙，请稍后重试');
    }
  }

  const token = await sharedState.acquireConcurrencyToken(endpoint);
  if (!token.acquired) {
    if (singleFlight?.acquired) {
      await singleFlight.release();
    }
    throw createError(503, '代理服务当前繁忙，请稍后重试');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const upstreamResponse = await fetchImpl(buildRakutenUrl(requestUrl, config), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.rakutenAccessKey}`,
        'User-Agent': 'rakuten-proxy/2.0',
      },
      signal: controller.signal,
    });

    const body = await upstreamResponse.text();
    const contentType =
      upstreamResponse.headers.get('content-type') ||
      'application/json; charset=utf-8';

    if (upstreamResponse.status === 429) {
      await sharedState.recordUpstreamFailure(endpoint, {
        statusCode: 429,
        retryAfterMs: parseRetryAfterMs(
          upstreamResponse,
          body,
          config.backoffBaseMs || 1000
        ),
      });
    } else if (upstreamResponse.status >= 500) {
      await sharedState.recordUpstreamFailure(endpoint, {
        statusCode: upstreamResponse.status,
      });
    } else if (upstreamResponse.ok) {
      await sharedState.clearEndpointFailures(endpoint);
    }

    if (cachePolicy.cacheable && upstreamResponse.ok) {
      await sharedState.setCachedResponse(
        cacheKey,
        {
          statusCode: upstreamResponse.status,
          contentType,
          body,
        },
        cachePolicy.ttlSeconds
      );
    }

    if (cachePolicy.singleFlight) {
      await sharedState.publishSingleFlightResult(
        cacheKey,
        {
          statusCode: upstreamResponse.status,
          contentType,
          body,
        },
        config.singleFlightResultTtlMs || 1000
      );
    }

    response.statusCode = upstreamResponse.status;
    response.setHeader('Content-Type', contentType);
    setCorsHeaders(response, config.allowedOrigin);
    response.end(body);
  } catch (error) {
    if (error.name === 'AbortError') {
      await sharedState.recordUpstreamFailure(endpoint, {
        statusCode: 504,
      });
      throw createError(504, '上游 Rakuten API 请求超时');
    }

    throw createError(502, '连接 Rakuten API 失败', error.message);
  } finally {
    clearTimeout(timeoutId);
    await token.release();
    if (singleFlight?.acquired) {
      await singleFlight.release();
    }
  }
}

export function createApp({
  config,
  sharedState,
  fetchImpl = globalThis.fetch,
  log = () => {},
}) {
  return async function app(request, response) {
    setCorsHeaders(response, config.allowedOrigin);

    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (request.method !== 'GET') {
      sendJson(
        response,
        405,
        {
          error: 'method_not_allowed',
          message: '仅支持 GET 和 OPTIONS 请求',
        },
        config.allowedOrigin
      );
      return;
    }

    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    try {
      if (requestUrl.pathname === '/health') {
        const status = await sharedState.getStatus();
        sendJson(
          response,
          200,
          {
            ok: true,
            service: 'rakuten-proxy',
            endpoint: config.publicBaseUrl || 'https://api.845817074.xyz',
            rakutenConfigured:
              Boolean(config.rakutenApplicationId) &&
              Boolean(config.rakutenAccessKey),
            workerId: config.workerId || 'worker-unknown',
            redis: status.redis,
            degraded: status.degraded,
            cache: status.cache,
            globalConcurrency: status.globalConcurrency,
            timestamp: new Date().toISOString(),
          },
          config.allowedOrigin
        );
        return;
      }

      if (requestUrl.pathname === '/internal/status') {
        if (!isLoopbackAddress(request.socket?.remoteAddress)) {
          sendJson(
            response,
            403,
            {
              error: 'forbidden',
              message: '仅限本机访问内部状态接口',
            },
            config.allowedOrigin
          );
          return;
        }

        const status = await sharedState.getStatus();
        sendJson(
          response,
          200,
          {
            workerId: config.workerId || 'worker-unknown',
            ...status,
            timestamp: new Date().toISOString(),
          },
          config.allowedOrigin
        );
        return;
      }

      if (requestUrl.pathname === '/rakuten/proxy') {
        await proxyRakuten(requestUrl, response, {
          config,
          sharedState,
          fetchImpl,
        });
        return;
      }

      sendJson(
        response,
        404,
        {
          error: 'not_found',
          message: '请求路径不存在',
          path: requestUrl.pathname,
        },
        config.allowedOrigin
      );
    } catch (error) {
      log({
        level: 'error',
        event: 'proxy_error',
        message: error.message,
        details: error.details || null,
      });

      sendJson(
        response,
        error.statusCode || 500,
        {
          error: 'proxy_error',
          message: error.message || '代理请求失败',
          details: error.details || null,
          timestamp: new Date().toISOString(),
        },
        config.allowedOrigin
      );
    }
  };
}
