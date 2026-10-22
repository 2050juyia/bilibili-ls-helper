const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

function native(initial = false, options = {}) {
  let value = initial;
  const writes = [], info = { getSeamlessInfo() {
    if (options.readThrows) throw Error('private message must not escape');
    return { disableManualSeamless: value };
  } };
  const api = {
    __PRIVATE_TOOLS_ONLY_FOR_DEBUG__: { info },
    updateDisableManualSeamless(next) {
      writes.push(next);
      if (!options.ignoreWrite) value = next;
      if (options.writeThrows) throw Error('private write error');
    },
    switchQuality() { assert.fail('quality prevention must not change selected quality'); },
    switchQualityAsync() { assert.fail('quality prevention must not reload a video'); },
    reload() { assert.fail('quality prevention must not reload the player'); }
  };
  return { api, info, writes, options, value: () => value, external: next => { value = next; } };
}

function harness(api) {
  const events = new Map();
  const context = { livePlayer: api,
    addEventListener(name, fn, capture = false) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add({ fn, capture }); },
    removeEventListener(name, fn, capture = false) { for (const entry of events.get(name) || []) if (entry.fn === fn && entry.capture === capture) events.get(name).delete(entry); },
    setTimeout() { assert.fail('no quality polling'); }, requestAnimationFrame() { assert.fail('no rendering clock'); },
    fetch() { assert.fail('no playback API requests'); } };
  vm.createContext(context); vm.runInContext(fs.readFileSync(require.resolve('../extension/live-quality.js'), 'utf8'), context);
  const controller = context.BFDLiveQuality.create();
  return { controller, context, events,
    event(name) { for (const entry of [...(events.get(name) || [])].sort((a, b) => Number(b.capture) - Number(a.capture))) entry.fn(); },
    listeners: () => [...events.values()].reduce((n, set) => n + set.size, 0) };
}

test('enable changes only the native manual seamless policy once and off restores the original boolean', () => {
  const n = native(), h = harness(n.api);
  assert.equal(h.controller.status().enabled, false); assert.deepEqual(n.writes, []);
  h.controller.update(true); assert.deepEqual(n.writes, [true]); assert.equal(n.value(), true);
  assert.equal(h.controller.status().active, true); assert.equal(h.controller.status().owned, true);
  for (let i = 0; i < 10; i++) h.controller.update(true);
  assert.deepEqual(n.writes, [true]);
  h.controller.update(false); assert.equal(n.value(), false); assert.deepEqual(n.writes, [true, false]);
  h.controller.update(false); h.controller.destroy(); assert.deepEqual(n.writes, [true, false]);
});

test('an already true native policy is observed without claiming or restoring it', () => {
  const n = native(true), h = harness(n.api);
  h.controller.update(true); assert.equal(h.controller.status().active, true); assert.equal(h.controller.status().owned, false);
  for (let i = 0; i < 5; i++) h.controller.update(true);
  assert.equal(h.controller.status().active, true); assert.equal(h.controller.status().phase, 'preexisting');
  h.controller.update(false); h.controller.destroy(); assert.equal(n.value(), true); assert.deepEqual(n.writes, []);
});

test('external false relinquishes ownership and is not overwritten by later updates in the same activation', () => {
  const n = native(), h = harness(n.api);
  h.controller.update(true); n.external(false);
  for (let i = 0; i < 10; i++) h.controller.update(true);
  assert.equal(h.controller.status().phase, 'yielded'); assert.equal(h.controller.status().owned, false);
  h.controller.update(false); assert.deepEqual(n.writes, [true]); assert.equal(n.value(), false);
  h.controller.update(true); assert.deepEqual(n.writes, [true, true]); h.controller.destroy(); assert.equal(n.value(), false);
});

test('external false before off or pagehide is preserved even without an intervening update', () => {
  for (const action of ['off', 'pagehide', 'destroy']) {
    const n = native(), h = harness(n.api); h.controller.update(true); n.external(false);
    if (action === 'off') h.controller.update(false);
    else if (action === 'destroy') h.controller.destroy();
    else h.event('pagehide');
    assert.deepEqual(n.writes, [true]); assert.equal(n.value(), false);
  }
});

test('a preexisting true cannot later be claimed after its native owner sets false', () => {
  const n = native(true), h = harness(n.api); h.controller.update(true); n.external(false);
  h.controller.update(true); assert.equal(h.controller.status().active, false);
  assert.deepEqual(n.writes, []); h.controller.destroy(); assert.equal(n.value(), false);
});

test('native API replacement restores only an owned old flag before applying the new policy', () => {
  const a = native(), b = native(), h = harness(a.api);
  h.controller.update(true); h.context.livePlayer = b.api; h.controller.update(true);
  assert.equal(a.value(), false); assert.equal(b.value(), true);
  assert.deepEqual(a.writes, [true, false]); assert.deepEqual(b.writes, [true]);
  h.controller.update(true, null); assert.equal(b.value(), false); assert.equal(h.controller.status().phase, 'unavailable');
  h.controller.update(true, a.api); assert.equal(a.value(), true); h.controller.destroy(); assert.equal(a.value(), false);
});

test('yielded ownership persists if the same API returns after another API in the enabled session', () => {
  const a = native(), b = native(), h = harness(a.api);
  h.controller.update(true); a.external(false); h.controller.update(true);
  h.controller.update(true, b.api); h.controller.update(true, a.api);
  assert.equal(b.value(), false); assert.equal(a.value(), false); assert.deepEqual(a.writes, [true]);
  h.controller.destroy();
});

test('missing APIs, throwing readers and unknown initial values fail open without guessing false', () => {
  for (const value of [undefined, null, 0, 1, 'false', 'true', {}]) {
    const n = native(), h = harness(n.api); n.external(value); h.controller.update(true); h.controller.destroy(); assert.deepEqual(n.writes, []);
  }
  for (const api of [null, {}, { updateDisableManualSeamless() { assert.fail('unreadable state'); } }]) {
    const h = harness(api); assert.doesNotThrow(() => h.controller.update(true)); h.controller.destroy();
  }
  const n = native(false, { readThrows: true }), h = harness(n.api);
  h.controller.update(true); assert.equal(h.controller.status().phase, 'unavailable'); assert.deepEqual(n.writes, []);
  n.options.readThrows = false; h.controller.update(true); assert.equal(n.value(), true); h.controller.destroy();
});

test('ignored writes do not cause retries or a false ownership claim', () => {
  const n = native(false, { ignoreWrite: true }), h = harness(n.api);
  for (let i = 0; i < 5; i++) h.controller.update(true);
  assert.deepEqual(n.writes, [true]); assert.equal(h.controller.status().owned, false); assert.equal(n.value(), false);
  h.controller.destroy(); assert.deepEqual(n.writes, [true]);
});

test('a setter that mutates before throwing is conditionally rolled back and never retried in the activation', () => {
  const n = native(false, { writeThrows: true }), h = harness(n.api);
  assert.doesNotThrow(() => h.controller.update(true)); assert.equal(n.value(), false);
  assert.deepEqual(n.writes, [true, false]); assert.equal(h.controller.status().active, false);
  h.controller.update(true); h.controller.destroy(); assert.deepEqual(n.writes, [true, false]);
  assert(!/private/.test(JSON.stringify(h.controller.status())));
});

test('an unreadable state or replacement methods cannot be overwritten during restore', () => {
  const n = native(), h = harness(n.api); h.controller.update(true); n.options.readThrows = true;
  assert.doesNotThrow(() => h.controller.update(false)); assert.deepEqual(n.writes, [true]);
  assert.equal(h.controller.status().reason, 'restore-unavailable');
  const replaced = native(), other = harness(replaced.api); other.controller.update(true);
  replaced.api.updateDisableManualSeamless = () => assert.fail('new native setter is not ours');
  other.controller.update(true); other.controller.destroy(); assert.deepEqual(replaced.writes, [true]);
});

test('pagehide releases ownership, hidden updates stay passive and pageshow waits for parent discovery', () => {
  const n = native(), h = harness(n.api); h.controller.update(true); h.event('pagehide');
  assert.equal(n.value(), false); assert.equal(h.controller.status().active, false);
  h.controller.update(true); assert.deepEqual(n.writes, [true, false]);
  h.event('pageshow'); assert.deepEqual(n.writes, [true, false]); h.controller.update(true); assert.equal(n.value(), true);
  h.controller.destroy(); assert.equal(n.value(), false); assert.equal(h.listeners(), 0);
  h.event('pageshow'); h.controller.update(true); assert.deepEqual(n.writes, [true, false, true, false]);
});

test('a native setter dispatching stop during enable cannot revive ownership or leave a late true behind', () => {
  for (const action of ['off', 'destroy', 'pagehide']) {
    const n = native(), h = harness(n.api), original = n.api.updateDisableManualSeamless;
    let dispatched = false;
    n.api.updateDisableManualSeamless = function (value) {
      if (value && !dispatched) {
        dispatched = true;
        if (action === 'off') h.controller.update(false);
        else if (action === 'destroy') h.controller.destroy();
        else h.event('pagehide');
      }
      original.call(this, value);
    };
    h.controller.update(true); assert.equal(n.value(), false); assert.equal(h.controller.status().active, false);
    assert.equal(h.controller.status().owned, false); assert.deepEqual(n.writes, [true, false]); h.controller.destroy();
  }
});

test('capture pageshow ordering lets the existing parent discovery restore protection after BFCache', () => {
  const n = native(), h = harness(n.api);
  // The parent controller is created after its quality adapter and already uses
  // capture listeners. No subsequent play/mutation event is needed on return.
  const update = () => h.controller.update(true);
  h.context.addEventListener('pageshow', update, true);
  h.controller.update(true); h.event('pagehide'); assert.equal(n.value(), false);
  h.event('pageshow'); assert.equal(n.value(), true); assert.equal(h.controller.status().active, true);
  h.controller.destroy(); h.context.removeEventListener('pageshow', update, true); assert.equal(h.listeners(), 0);
});
