const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const core = require('../extension/core.js');
test('local self-comment is copied into native fixed mode without changing submission data', () => {
  const source = Object.freeze({ mode: 1, rawMode: 1, border: true, text: 'own', dmid: '90071992547409930001', stime: 1200, color: 42, size: 25 });
  const top = core.rewriteSelf(source), bottom = core.rewriteSelf(source, { position: 'bottom' });
  assert.equal(top.converted, 1); assert.equal(top.data.mode, 5); assert.equal(top.data.rawMode, 5);
  assert.equal(bottom.data.mode, 4); assert.equal(bottom.data.rawMode, 4); assert.equal(source.mode, 1);
  for (const key of ['text', 'dmid', 'stime', 'color', 'size', 'border']) assert.equal(top.data[key], source[key]);
});
test('only own ordinary types convert; disabled, other users, original fixed and specials keep identity', () => {
  for (const mode of [1, 2, 3, 6]) assert.equal(core.rewriteSelf({ mode, isMine: true }).data.mode, 5);
  for (const source of [{ mode: 1 }, ...[4, 5, 7, 8, 9, 20017].map(mode => ({ mode, border: true }))]) assert.equal(core.rewriteSelf(source).data, source);
  const source = { mode: 1, border: true }; assert.equal(core.rewriteSelf(source, { enabled: false }).data, source);
  assert.deepEqual([0, 1, 2].map(i => core.rewriteSelf(source, { position: 'alternate' }, i).data.mode), [5, 4, 5]);
});
function harness() {
  const messages = [], listeners = new Map(), documentListeners = new Map(), calls = [];
  let renderer = null;
  const context = { BFDFixedCore: core, URL, ArrayBuffer, location: { href: 'https://www.bilibili.com/video/BVself', origin: 'https://www.bilibili.com' },
    player: { danmaku: { getDanmakuX: () => renderer } },
    addEventListener: (name, fn) => listeners.set(name, fn), postMessage: message => messages.push(message),
    document: { addEventListener: (name, fn) => documentListeners.set(name, fn) } };
  context.window = context; vm.createContext(context); vm.runInContext(fs.readFileSync(require.resolve('../extension/hook.js'), 'utf8'), context);
  function message(type, payload) {
    context.incoming = { channel: 'bfd-fixed-v1', type, payload }; context.message = listeners.get('message');
    vm.runInContext('message({source:window,origin:location.origin,data:incoming})', context);
  }
  function createRenderer() {
    renderer = { add(data, ...args) { calls.push({ data, args, receiver: this }); if (data.fail) throw new Error('native failure'); return 'native-result'; } }; return renderer;
  }
  return { context, messages, calls, message, createRenderer, documentListeners };
}
test('late renderer attaches before a send interaction; settings, command flags and native return survive', () => {
  const h = harness(), renderer = h.createRenderer(), source = { mode: 1, border: true };
  h.documentListeners.get('keydown')({ type: 'keydown', key: 'Enter' });
  const wrapped = renderer.add;
  assert.equal(renderer.add(source, false), 'native-result'); assert.equal(h.calls.at(-1).data.mode, 5); assert.equal(source.mode, 1);
  assert.equal(h.calls.at(-1).receiver, renderer); assert.equal(h.calls.at(-1).args[0], false);
  h.message('get-status'); assert.equal(renderer.add, wrapped); assert.equal(h.messages.at(-1).payload.selfConverted, 1);
  renderer.add(source, true); assert.equal(h.calls.at(-1).data, source);
  h.message('settings', { enabled: false }); renderer.add(source); assert.equal(h.calls.at(-1).data, source);
  h.message('settings', { enabled: true, position: 'bottom' }); renderer.add(source); assert.equal(h.calls.at(-1).data.mode, 4);
  assert.throws(() => renderer.add({ ...source, fail: true }), /native failure/); assert.equal(h.messages.at(-1).payload.selfConverted, 2);
});
test('alternate self-comments balance across additions and reset for SPA/new renderer', () => {
  const h = harness(), first = h.createRenderer(); h.message('settings', { enabled: true, position: 'alternate' });
  first.add({ mode: 1, border: true }); first.add({ mode: 6, border: true });
  assert.deepEqual(h.calls.map(c => c.data.mode), [5, 4]);
  h.context.location.href = 'https://www.bilibili.com/video/BVnext?p=2';
  const next = h.createRenderer(); h.documentListeners.get('click')({ type: 'click', target: { closest: () => ({}) } });
  next.add({ mode: 1, isMine: true }); assert.equal(h.calls.at(-1).data.mode, 5); assert.equal(h.messages.at(-1).payload.selfConverted, 1);
});
