const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../extension/bridge.js'), 'utf8');

function harness() {
  const posts = [];
  let resolveRead, rejectRead, change;
  const context = {
    location: { origin: 'https://www.bilibili.com' }, addEventListener() {},
    postMessage(message, origin) { posts.push({ message, origin }); },
    chrome: { storage: { local: { get: () => new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; }) },
      onChanged: { addListener(callback) { change = callback; } } }, runtime: { onMessage: { addListener() {} } } }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { posts, resolveRead: value => resolveRead(value), rejectRead: error => rejectRead(error),
    change: (value, area = 'local', key = 'bfdSettings') => change({ [key]: { newValue: value } }, area) };
}
const settled = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

test('initial settings reach MAIN without writing storage or adding a render clock', async () => {
  const h = harness(), settings = { enabled: false, motion: 'video-sync', position: 'bottom' };
  h.resolveRead({ bfdSettings: settings }); await settled();
  assert.equal(h.posts.length, 1); assert.equal(h.posts[0].message.type, 'settings');
  assert.equal(h.posts[0].message.payload, settings); assert.equal(h.posts[0].origin, 'https://www.bilibili.com');
});
test('new local settings win when a pending initial read resolves with an older snapshot', async () => {
  const h = harness(), latest = { enabled: false, motion: 'video-sync' };
  h.change(latest); h.resolveRead({ bfdSettings: { enabled: true, motion: 'fixed' } }); await settled();
  assert.equal(h.posts.length, 1); assert.equal(h.posts[0].message.payload, latest);
});
test('deletion and multiple local changes also supersede the pending initial read', async () => {
  const h = harness(), intermediate = { enabled: false };
  h.change(intermediate); h.change(undefined); h.resolveRead({ bfdSettings: { enabled: true, position: 'bottom' } }); await settled();
  assert.equal(h.posts.length, 2); assert.equal(h.posts[0].message.payload, intermediate);
  assert.equal(h.posts[1].message.type, 'settings'); assert.equal(h.posts[1].message.payload, undefined);
});
test('unrelated storage changes do not discard the initial settings', async () => {
  const h = harness(), settings = { enabled: true, position: 'alternate' };
  h.change({ enabled: false }, 'sync'); h.change('unrelated', 'local', 'anotherKey');
  h.resolveRead({ bfdSettings: settings }); await settled();
  assert.equal(h.posts.length, 1); assert.equal(h.posts[0].message.payload, settings);
});
test('initial read failure requests status only when a newer setting was not delivered', async () => {
  const first = harness(); first.rejectRead(Error('storage unavailable')); await settled();
  assert.equal(first.posts.length, 1); assert.equal(first.posts[0].message.type, 'get-status');
  const changed = harness(), latest = { enabled: false };
  changed.change(latest); changed.rejectRead(Error('storage unavailable')); await settled();
  assert.equal(changed.posts.length, 1); assert.equal(changed.posts[0].message.payload, latest);
});
