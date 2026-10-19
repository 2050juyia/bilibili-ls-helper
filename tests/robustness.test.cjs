// Reproducible input coverage; this does not make any network requests.
const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../extension/core.js'), f = require('./fixtures.cjs');
let seed = 0x20261015;
function random(n) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; }
test('6000 seeded binary inputs never throw and failed transforms retain original bytes', () => {
  for (let i = 0; i < 6000; i++) {
    const bytes = Uint8Array.from({ length: random(256) }, () => random(256)), original = bytes.slice();
    for (const transform of [core.rewriteProtobuf, core.rewriteBroadcast]) {
      const result = transform(bytes);
      assert.equal(typeof result.converted, 'number'); assert(result.converted >= 0);
      if (result.error) assert.equal(result.data, bytes);
      assert.deepEqual(bytes, original);
    }
  }
});
test('1000 seeded valid packets keep count, ordinary-mode mapping, specials and idempotence', () => {
  const kinds = [1, 2, 3, 6, 4, 5, 7, 8, 9], rolling = new Set([1, 2, 3, 6]);
  for (let i = 0; i < 1000; i++) {
    const modes = Array.from({ length: 1 + random(24) }, () => kinds[random(kinds.length)]);
    const position = ['top', 'bottom', 'alternate'][random(3)], input = f.packet(modes), original = input.slice();
    const result = core.rewriteProtobuf(input, { position }); let ordinal = 0;
    const expected = modes.map(mode => { if (!rolling.has(mode)) return mode; const index = ordinal++; return position === 'bottom' || (position === 'alternate' && index % 2 === 1) ? 4 : 5; });
    assert.deepEqual(f.modesFrom(result.data), expected); assert.equal(result.total, modes.length); assert.equal(result.converted, ordinal);
    const again = core.rewriteProtobuf(result.data, { position }); assert.equal(again.converted, 0); assert.equal(again.data, result.data);
    assert.deepEqual(input, original);
    assert.equal(core.rewriteProtobuf(input, { motion: 'video-sync' }).data, input);
  }
});
