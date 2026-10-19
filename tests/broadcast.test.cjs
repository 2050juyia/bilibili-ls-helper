const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../extension/core.js'), f = require('./fixtures.cjs');
for (const room of [true, false]) test(`real-time ${room ? 'room-wrapped' : 'direct'} protobuf comments are fixed without changing specials`, () => {
  const input = f.broadcast(f.packet([1, 2, 3, 6, 4, 5, 7, 8, 9]), { room });
  const result = core.rewriteBroadcast(input);
  assert.equal(result.error, null); assert(result.matched); assert.equal(result.converted, 4); assert.equal(result.total, 9);
  assert.deepEqual(f.modesFrom(f.broadcastPayload(result.data, room)), [5, 5, 5, 5, 4, 5, 7, 8, 9]);
  assert.deepEqual(f.modesFrom(f.broadcastPayload(input, room)), [1, 2, 3, 6, 4, 5, 7, 8, 9]);
  assert.equal([...input.keys()].filter(i => input[i] !== result.data[i]).length, 4);
});
test('implicit scrolling mode, explicit zero and growing nested protobuf lengths are handled', () => {
  const long = [...f.number(1, 12), ...f.text(7, 'x'.repeat(120))];
  const packet = new Uint8Array([...f.sized(1, long), ...f.sized(1, f.element(0)), ...f.sized(1, f.element(6))]);
  const result = core.rewriteBroadcast(f.broadcast(packet).buffer, { position: 'alternate' });
  assert(result.data instanceof ArrayBuffer); assert.equal(result.converted, 3); assert.equal(result.error, null);
  const out = f.broadcastPayload(new Uint8Array(result.data));
  assert.deepEqual(f.modesFrom(out), [5, 4, 5]);
  assert.equal(new TextDecoder().decode(f.bytesField(f.bytesField(out, 1), 7)), '测试弹幕'); // Last element is preserved.
});
test('64-bit identifiers and unknown fields survive byte-for-byte', () => {
  const extra = [...f.field(19, 0, [255, 255, 255, 255, 255, 255, 255, 255, 127]), ...f.sized(42, [24, 1])];
  const input = f.broadcast(new Uint8Array(f.sized(1, f.element(1, 'id', extra))));
  const result = core.rewriteBroadcast(input, { position: 'bottom' });
  assert.equal(result.error, null); assert.equal(result.converted, 1);
  assert.equal([...input.keys()].filter(i => input[i] !== result.data[i]).length, 1);
  assert.deepEqual(f.modesFrom(f.broadcastPayload(result.data)), [4]);
});
test('unrelated room messages and targets, disabled mode, malformed packets remain original', () => {
  for (const options of [{ target: 'other.Event' }, { id: 'live://1' }, { room: false, target: '/bilibili.broadcast.v1.Broadcast/Heartbeat' }]) {
    const input = f.broadcast(f.packet([1]), options), result = core.rewriteBroadcast(input);
    assert.equal(result.data, input); assert.equal(result.converted, 0); assert.equal(result.matched, false);
  }
  const input = f.broadcast(f.packet([1])); assert.equal(core.rewriteBroadcast(input, { enabled: false }).data, input);
  const malformed = f.broadcast(new Uint8Array([...f.packet([1]), 10, 127, 24, 1]));
  const failed = core.rewriteBroadcast(malformed); assert(failed.error); assert.equal(failed.data, malformed); assert.equal(failed.converted, 0);
});
test('only secure native point-to-point broadcast sockets with proto subprotocol are intercepted', () => {
  assert(core.broadcastEndpoint('wss://broadcast.chat.bilibili.com:7826/sub?platform=web', 'proto'));
  for (const [url, proto] of [['wss://broadcast.chat.bilibili.com:7826/sub', undefined], ['wss://evil.example/sub', 'proto'], ['wss://broadcast.chat.bilibili.com.evil.example/sub', 'proto'], ['ws://broadcast.chat.bilibili.com/sub', 'proto'], ['wss://broadcast.chat.bilibili.com/other', 'proto']]) assert.equal(core.broadcastEndpoint(url, proto), false);
});
