import net from 'node:net';

function findLineEnd(buffer, offset) {
  return buffer.indexOf('\r\n', offset, 'utf8');
}

export function encodeRedisCommand(parts) {
  const chunks = [`*${parts.length}\r\n`];

  for (const part of parts) {
    const value = String(part);
    chunks.push(`$${Buffer.byteLength(value)}\r\n${value}\r\n`);
  }

  return Buffer.from(chunks.join(''));
}

export function parseRedisReply(buffer, offset = 0) {
  if (offset >= buffer.length) {
    return null;
  }

  const prefix = String.fromCharCode(buffer[offset]);
  const lineEnd = findLineEnd(buffer, offset);

  if (lineEnd === -1) {
    return null;
  }

  const payload = buffer.toString('utf8', offset + 1, lineEnd);

  if (prefix === '+') {
    return {
      value: payload,
      bytesConsumed: lineEnd + 2 - offset,
    };
  }

  if (prefix === '-') {
    return {
      value: new Error(payload),
      bytesConsumed: lineEnd + 2 - offset,
    };
  }

  if (prefix === ':') {
    return {
      value: Number(payload),
      bytesConsumed: lineEnd + 2 - offset,
    };
  }

  if (prefix === '$') {
    const length = Number(payload);
    if (length === -1) {
      return {
        value: null,
        bytesConsumed: lineEnd + 2 - offset,
      };
    }

    const bodyStart = lineEnd + 2;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd + 2) {
      return null;
    }

    return {
      value: buffer.toString('utf8', bodyStart, bodyEnd),
      bytesConsumed: bodyEnd + 2 - offset,
    };
  }

  if (prefix === '*') {
    const length = Number(payload);
    if (length === -1) {
      return {
        value: null,
        bytesConsumed: lineEnd + 2 - offset,
      };
    }

    const values = [];
    let cursor = lineEnd + 2;

    for (let index = 0; index < length; index += 1) {
      const parsed = parseRedisReply(buffer, cursor);
      if (!parsed) {
        return null;
      }

      values.push(parsed.value);
      cursor += parsed.bytesConsumed;
    }

    return {
      value: values,
      bytesConsumed: cursor - offset,
    };
  }

  throw new Error(`Unsupported RESP prefix: ${prefix}`);
}

export function createRedisClient({
  host = '127.0.0.1',
  port = 6379,
  connectTimeoutMs = 2000,
} = {}) {
  let socket = null;
  let connectPromise = null;
  let buffer = Buffer.alloc(0);
  const pending = [];

  function resetSocket() {
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
      socket = null;
    }
  }

  function rejectPending(error) {
    while (pending.length > 0) {
      pending.shift().reject(error);
    }
  }

  function drainReplies() {
    while (pending.length > 0) {
      const parsed = parseRedisReply(buffer);
      if (!parsed) {
        break;
      }

      buffer = buffer.subarray(parsed.bytesConsumed);
      const { resolve, reject } = pending.shift();
      if (parsed.value instanceof Error) {
        reject(parsed.value);
      } else {
        resolve(parsed.value);
      }
    }
  }

  async function ensureConnected() {
    if (socket && !socket.destroyed) {
      return;
    }

    if (connectPromise) {
      return connectPromise;
    }

    connectPromise = new Promise((resolve, reject) => {
      const nextSocket = net.createConnection({ host, port });
      let settled = false;

      function settle(callback, value) {
        if (settled) {
          return;
        }

        settled = true;
        callback(value);
      }

      nextSocket.setNoDelay(true);
      nextSocket.setKeepAlive(true, 1000);
      nextSocket.setTimeout(connectTimeoutMs, () => {
        nextSocket.destroy(new Error('Redis connection timed out'));
      });

      nextSocket.on('connect', () => {
        socket = nextSocket;
        connectPromise = null;
        settle(resolve);
      });

      nextSocket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        drainReplies();
      });

      nextSocket.on('error', error => {
        resetSocket();
        connectPromise = null;
        rejectPending(error);
        settle(reject, error);
      });

      nextSocket.on('close', () => {
        const error = new Error('Redis connection closed');
        resetSocket();
        connectPromise = null;
        rejectPending(error);
        settle(reject, error);
      });
    });

    return connectPromise;
  }

  async function sendCommand(parts) {
    await ensureConnected();

    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      socket.write(encodeRedisCommand(parts), error => {
        if (!error) {
          return;
        }

        const current = pending.pop();
        if (current) {
          current.reject(error);
        }
      });
    });
  }

  return {
    ping() {
      return sendCommand(['PING']);
    },

    get(key) {
      return sendCommand(['GET', key]);
    },

    set(key, value, options = {}) {
      const parts = ['SET', key, value];

      if (options.nx) {
        parts.push('NX');
      }

      if (options.exSeconds) {
        parts.push('EX', options.exSeconds);
      }

      if (options.pxMs) {
        parts.push('PX', options.pxMs);
      }

      return sendCommand(parts);
    },

    del(key) {
      return sendCommand(['DEL', key]);
    },

    incr(key) {
      return sendCommand(['INCR', key]);
    },

    decr(key) {
      return sendCommand(['DECR', key]);
    },

    expire(key, ttlSeconds) {
      return sendCommand(['EXPIRE', key, ttlSeconds]);
    },

    pttl(key) {
      return sendCommand(['PTTL', key]);
    },

    async close() {
      resetSocket();
      connectPromise = null;
      buffer = Buffer.alloc(0);
      rejectPending(new Error('Redis client closed'));
    },
  };
}
