import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeRedisCommand,
  parseRedisReply,
} from '../src/redis-client.mjs';

test('encodeRedisCommand serializes a SET command as RESP', () => {
  const encoded = encodeRedisCommand(['SET', 'foo', 'bar']);
  assert.equal(
    encoded.toString(),
    '*3\r\n$3\r\nSET\r\n$3\r\nfoo\r\n$3\r\nbar\r\n'
  );
});

test('parseRedisReply parses simple, bulk, and integer replies', () => {
  const simpleReply = parseRedisReply(Buffer.from('+OK\r\n'));
  assert.equal(simpleReply.value, 'OK');
  assert.equal(simpleReply.bytesConsumed, 5);

  const bulkReply = parseRedisReply(Buffer.from('$3\r\nbar\r\n'));
  assert.equal(bulkReply.value, 'bar');
  assert.equal(bulkReply.bytesConsumed, 9);

  const integerReply = parseRedisReply(Buffer.from(':2\r\n'));
  assert.equal(integerReply.value, 2);
  assert.equal(integerReply.bytesConsumed, 4);
});
