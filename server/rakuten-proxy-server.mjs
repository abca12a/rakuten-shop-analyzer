import { createServer } from 'node:http';

import { createApp } from './src/app.mjs';
import { loadConfig } from './src/config.mjs';
import { createRedisClient } from './src/redis-client.mjs';
import { createSharedState } from './src/shared-state.mjs';

function log(event) {
  const payload =
    typeof event === 'string'
      ? { message: event }
      : {
          timestamp: new Date().toISOString(),
          ...event,
        };

  const line = JSON.stringify(payload);

  if (payload.level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
}

const config = loadConfig(process.env);
const redis = createRedisClient({
  host: config.redisHost,
  port: config.redisPort,
  connectTimeoutMs: config.redisConnectTimeoutMs,
});
const sharedState = createSharedState({
  redis,
  namespace: config.redisNamespace,
  globalConcurrencyLimit: config.globalConcurrencyLimit,
  concurrencyTtlSeconds: config.concurrencyTtlSeconds,
  backoffBaseMs: config.backoffBaseMs,
  failureWindowMs: config.failureWindowMs,
  circuitFailureThreshold: config.circuitFailureThreshold,
  circuitOpenMs: config.circuitOpenMs,
});
const app = createApp({
  config,
  sharedState,
  log,
});
const server = createServer(app);

server.listen(config.port, config.listenHost, () => {
  log({
    level: 'info',
    event: 'server_started',
    workerId: config.workerId,
    listenHost: config.listenHost,
    port: config.port,
    redisHost: config.redisHost,
    redisPort: config.redisPort,
  });
});

async function shutdown(signal) {
  log({
    level: 'info',
    event: 'server_shutdown_requested',
    signal,
    workerId: config.workerId,
  });

  server.close(async () => {
    await redis.close().catch(error => {
      log({
        level: 'error',
        event: 'redis_close_failed',
        workerId: config.workerId,
        message: error.message,
      });
    });

    process.exit(0);
  });
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
