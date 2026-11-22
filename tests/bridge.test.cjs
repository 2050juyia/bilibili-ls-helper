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

test('Firefox browser namespace uses Promise-based runtime.onMessage replies without requiring chrome global', async () => {
  const posts = [];
  let onMessage, onWindowMessage, onStorageChange;
  const context = vm.createContext({
    location: { origin: 'https://www.bilibili.com' },
    addEventListener(name, fn) { if (name === 'message') onWindowMessage = fn; },
    postMessage(message, origin) { posts.push({ message, origin }); },
    setTimeout(fn) { Promise.resolve().then(fn); return 1; },
    browser: {
      storage: {
        local: { get: async () => ({ bfdSettings: { enabled: true, motion: 'video-sync', position: 'top' } }) },
        onChanged: { addListener(fn) { onStorageChange = fn; } }
      },
      runtime: { onMessage: { addListener(fn) { onMessage = fn; } } }
    }
  });
  const vmWindow = vm.runInContext('this.window = this', context);
  vm.runInContext(source, context);
  await settled();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].message.payload.motion, 'video-sync');
  assert.equal(onMessage({ type: 'unrelated' }), undefined);
  onWindowMessage({
    source: vmWindow,
    origin: 'https://www.bilibili.com',
    data: { channel: 'bfd-fixed-v1', type: 'status', payload: { supportedPage: true, converted: 4, motion: 'video-sync' } }
  });
  const replyPromise = onMessage({ type: 'bfd-get-status' });
  assert.equal(typeof replyPromise?.then, 'function', 'Firefox browser.runtime.onMessage must return a Promise');
  const status = await replyPromise;
  assert.deepEqual(status, { supportedPage: true, converted: 4, motion: 'video-sync' });
  onStorageChange({ bfdSettings: { newValue: { enabled: false, motion: 'fixed', position: 'bottom' } } }, 'local');
  assert.equal(posts.at(-1).message.payload.position, 'bottom');
});
