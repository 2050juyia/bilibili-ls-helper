const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../extension/popup.js'), 'utf8');
const settled = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
async function harness(options = {}) {
  const elements = new Map(), writes = [], reloads = [];
  let closed = false, throwWrite = false;
  const get = id => {
    if (!elements.has(id)) elements.set(id, { id, checked: false, disabled: true, value: '', hidden: false, textContent: '', dataset: {},
      events: new Map(), addEventListener(name, fn) { this.events.set(name, fn); } });
    return elements.get(id);
  };
  const initial = options.settings || { enabled: true, motion: 'fixed', position: 'top', hidePlaylistIndicator: false, extra: 'keep' };
  const context = { document: { getElementById: get }, chrome: { runtime: { getManifest: () => ({ version: 'test' }) },
    storage: { local: { get: async () => ({ bfdSettings: initial }), set(value) {
      if (throwWrite) throw Error('context invalidated');
      const entry = { settings: JSON.parse(JSON.stringify(value.bfdSettings)) };
      const pending = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; }); writes.push(entry); return pending;
    } } }, tabs: { query: async () => [{ id: 7, url: options.url || 'https://www.bilibili.com/video/BVtest' }],
      reload: async id => { reloads.push(id); } } }, close() { closed = true; } };
  context.window = context; vm.runInNewContext(source, context); await settled();
  return { get, writes, reloads, closed: () => closed, throwWrite: value => { throwWrite = value; },
    change(id, value) { const node = get(id); Object.assign(node, value); return node.events.get('change')({ target: node }); },
    reload: () => get('reload').events.get('click')() };
}

test('every rapid change submits its full snapshot immediately, preserving unrelated settings', async () => {
  const h = await harness(), saves = [];
  for (let i = 0; i < 20; i++) saves.push(h.change('position', { value: i % 2 ? 'bottom' : 'alternate' }));
  assert.equal(h.writes.length, 20, 'no storage submission may wait for another acknowledgement');
  assert.equal(h.writes.at(-1).settings.position, 'bottom'); assert(h.writes.every(write => write.settings.extra === 'keep'));
  assert(h.get('reload').disabled);
  for (const write of h.writes) write.resolve(); await Promise.all(saves); assert(!h.get('reload').disabled);
});
test('a late older success cannot clear a newer failed save', async () => {
  const h = await harness(), older = h.change('position', { value: 'bottom' }), newer = h.change('hide-playlist-indicator', { checked: true });
  h.writes[1].reject(Error('latest write failed')); await newer; assert.match(h.get('status-title').textContent, /保存失败/);
  h.writes[0].resolve(); await older; assert.match(h.get('status-title').textContent, /保存失败/); assert(h.get('reload').disabled);
});
test('a late older failure cannot overwrite a newer successful save', async () => {
  const h = await harness(), older = h.change('hide-playlist-indicator', { checked: true }), newer = h.change('position', { value: 'bottom' });
  h.writes[1].resolve(); await newer; assert(h.get('reload').disabled, 'older pending write still blocks reload');
  h.writes[0].reject(Error('old write failed')); await older;
  assert.doesNotMatch(h.get('status-title').textContent, /保存失败/); assert.match(h.get('save-result').textContent, /刷新/); assert(!h.get('reload').disabled);
});
test('late older acknowledgement cannot replace the latest animation-only confirmation', async () => {
  const h = await harness(), older = h.change('hide-playlist-indicator', { checked: true }), newer = h.change('hide-playlist-indicator', { checked: false });
  h.writes[1].resolve(); await newer; h.writes[0].resolve(); await older;
  assert.match(h.get('status-title').textContent, /页面动画.*立即生效/); assert.match(h.get('save-result').textContent, /页面动画.*立即生效/);
});
test('reload waits for all issued writes even if the latest acknowledgement arrives first', async () => {
  const h = await harness(), older = h.change('position', { value: 'bottom' }), newer = h.change('position', { value: 'alternate' });
  const reload = h.reload(); h.writes[1].resolve(); await newer; await settled(); assert.deepEqual(h.reloads, []); assert(!h.closed());
  h.writes[0].resolve(); await older; await reload; assert.deepEqual(h.reloads, [7]); assert(h.closed());
});
test('synchronous storage exceptions settle saving state and a later full snapshot can recover', async () => {
  const h = await harness(); h.throwWrite(true); await h.change('position', { value: 'bottom' });
  assert.match(h.get('status-title').textContent, /保存失败/); assert(h.get('reload').disabled);
  h.throwWrite(false); const retry = h.change('hide-playlist-indicator', { checked: true });
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].settings.position, 'bottom');
  h.writes[0].resolve(); await retry; assert(!h.get('reload').disabled); assert.doesNotMatch(h.get('status-title').textContent, /保存失败|正在保存/);
});
