const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function harness(options = {}) {
  let now = 100, next = 0, inside = false, drawFailures = 0, createFailures = 0, noPaints = 0;
  const callbacks = new Map(), ui = new Map(), timers = new Map(), delays = [], observers = [], surfaces = [], storage = options.storage || new Map();
  const emitter = () => {
    const events = new Map(), captures = new WeakMap();
    return { events, addEventListener(name, fn, capture = false) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); captures.set(fn, capture === true || capture?.capture === true); },
      removeEventListener(name, fn) { events.get(name)?.delete(fn); }, emit(name, event) {
        // At the target, capture listeners run before non-capture listeners.
        for (const fn of [...(events.get(name) || [])].sort((a, b) => Number(captures.get(b)) - Number(captures.get(a)))) fn(event);
      } };
  };
  function makeTarget(id = 'original') {
    const layer = { id: id + '-layer', isConnected: true, hidden: false, contains(node) { return node === this || node?.parentElement === this; },
      matches: selector => selector.includes('.web-player-danmaku') };
    const host = { id: 'live-player', isConnected: true, querySelector: selector => selector === '.web-player-danmaku' ? layer : null,
      contains: node => node === host || node === video || layer.contains(node), matches: selector => selector.includes('#live-player') };
    const video = { ...emitter(), id, isConnected: true, paused: false, ended: false, seeking: false, readyState: 4, currentTime: 1, hidden: false,
      parentElement: host, closest: selector => selector === '#live-player' ? host : null,
      requestVideoFrameCallback(fn) { callbacks.set(++next, { fn, video }); return next; }, cancelVideoFrameCallback(id) { callbacks.delete(id); },
      matches: selector => selector.includes('video') };
    return { video, host, layer };
  }
  let current = makeTarget(); const original = current;
  const document = { ...emitter(), documentElement: {}, querySelector: () => current?.video };
  const context = { ...emitter(), console, URL, Promise, Date: { now: () => now }, document,
    location: { href: 'https://live.bilibili.com/12345?private=DO-NOT-STORE' }, livePlayer: { getVideoEl: () => current?.video },
    sessionStorage: { getItem: key => { if (options.storageThrows) throw Error('denied'); return storage.get(key); }, setItem: (key, value) => { if (options.storageThrows) throw Error('denied'); storage.set(key, value); } },
    setTimeout(fn, delay) { delays.push(delay); timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { ui.set(++next, fn); return next; }, cancelAnimationFrame(id) { ui.delete(id); },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(node, settings) { this.active = true; this.settings = settings; } disconnect() { this.active = false; } },
    ResizeObserver: class { constructor(fn) { this.fn = fn; } observe() {} disconnect() {} },
    BFDLiveCompositor: { create(params) {
      assert(!params.video.hidden && !params.layer.hidden, 'factory must not inherit prematurely hidden native layers');
      if (createFailures > 0) { createFailures--; throw Error('合成画布上下文丢失'); }
      const s = { params, committed: false, presents: 0, restored: false, presentationRefreshes: 0, presentationCancels: 0, refreshingPresentation: false,
        refreshPresentation() { assert(inside, 'presentation refresh must use an existing video frame'); s.presentationRefreshes++; s.refreshingPresentation = true; return true; },
        cancelPresentationRefresh() { s.presentationCancels++; s.refreshingPresentation = false; },
        draw(at, metadata) { assert(inside, 'visible present outside a video/UI frame'); assert(!s.restored); if (drawFailures > 0) { drawFailures--; throw Error('private message https://example.invalid/token'); } if (noPaints > 0) { noPaints--; return false; }
          s.metadata = metadata; s.presents++; s.committed = true; params.layer.hidden = true; return true; },
        restore() { s.restored = true; params.layer.hidden = false; },
        status: () => ({ surface: 'single-canvas', committed: s.committed, presents: s.presents }), needsResize: () => true };
      surfaces.push(s); return s;
    } }
  };
  const quality = { creates: 0, updates: [], destroys: 0 };
  if (options.quality && options.quality !== 'native') context.BFDLiveQuality = { create() { quality.creates++; return {
    update(enabled) { quality.updates.push(enabled); }, destroy() { quality.destroys++; }
  }; } };
  let nativeQuality = false;
  if (options.quality === 'native') {
    context.livePlayer.__PRIVATE_TOOLS_ONLY_FOR_DEBUG__ = { info: { getSeamlessInfo: () => ({ disableManualSeamless: nativeQuality }) } };
    context.livePlayer.updateDisableManualSeamless = value => { nativeQuality = value; quality.updates.push(value); };
  }
  vm.createContext(context);
  if (options.quality === 'native') vm.runInContext(fs.readFileSync(require.resolve('../extension/live-quality.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../extension/live-sync.js'), 'utf8'), context);
  const controller = context.BFDLiveSync.create(options.injectDiscovery ? { findTarget: () => current } : {});
  function frame(media = 1, elapsed = 1000 / 24) { const entry = callbacks.entries().next().value; assert(entry, 'missing frame callback'); callbacks.delete(entry[0]); inside = true; try { entry[1].fn(now += elapsed, { mediaTime: media, presentedFrames: next }); } finally { inside = false; } }
  function uiFrame() { const entry = ui.entries().next().value; assert(entry); ui.delete(entry[0]); inside = true; try { entry[1](now += 16); } finally { inside = false; } }
  function event(name, video = current?.video) { const ev = { type: name, target: video }; document.emit(name, ev); video?.emit(name, ev); }
  function rootEvent(name) { context.emit(name, { type: name }); }
  function timer() { const entry = timers.entries().next().value; assert(entry, 'missing timer'); timers.delete(entry[0]); entry[1](); }
  function mutations(records) { for (const observer of observers) if (observer.active) observer.fn(records); }
  function listeners() { return [document, context, original.video, current?.video].filter((node, i, all) => node && all.indexOf(node) === i).reduce((n, node) => n + [...node.events.values()].reduce((s, v) => s + v.size, 0), 0); }
  return { context, controller, quality, original, callbacks, ui, timers, delays, surfaces, observers, storage, frame, uiFrame, event, rootEvent, timer, mutations, listeners, makeTarget,
    setTarget: value => { current = value; }, target: () => current, advance: ms => now += ms, failDraw: (n = 1) => { drawFailures = n; }, failCreate: (n = 1) => { createFailures = n; }, noPaint: n => { noPaints = n; } };
}
const rolling = { enabled: true, motion: 'video-sync', position: 'top' };

test('numeric live rooms use the independent live API and one video-driven presentation with native layers initially visible', () => {
  const h = harness(); assert.equal(h.context.BFDVideoSync, undefined); h.controller.update(rolling);
  assert(h.controller.status().active); assert.equal(h.callbacks.size, 1); assert(!h.original.video.hidden); assert(!h.original.layer.hidden);
  assert.equal(h.ui.size, 0); h.frame(1); h.frame(1 + 1 / 24);
  assert.equal(h.controller.status().frames, 2); assert.equal(h.controller.status().presents, 2); assert.equal(h.callbacks.size, 1);
  assert(!h.original.video.hidden); assert(h.original.layer.hidden); assert.equal(h.surfaces[0].metadata.mediaTime, 1 + 1 / 24);
});

test('non-room live pages and VOD pages remain untouched even when the global setting is enabled', () => {
  for (const href of ['https://live.bilibili.com/', 'https://live.bilibili.com/0', 'https://live.bilibili.com/0123', 'https://live.bilibili.com/activity/test', 'https://www.bilibili.com/video/BV1test/', 'https://example.com/123']) {
    const h = harness(); h.context.location.href = href; h.controller.update(rolling);
    assert(!h.controller.status().active); assert.equal(h.callbacks.size, 0); assert.equal(h.surfaces.length, 0); assert.equal(h.timers.size, 0);
  }
});

test('blanc live-room URLs use the same numeric room identity and the core route gate is respected', () => {
  const h = harness(); h.context.location.href = 'https://live.bilibili.com/blanc/6789?private=DO-NOT-STORE';
  h.controller.update(rolling); h.failDraw(); h.frame(1);
  assert.equal(h.context.BFDLiveSync.readDiagnostics().at(-1).roomId, '6789');
  h.context.BFDFixedCore = { isLivePage: () => false }; h.controller.update(rolling);
  assert(!h.controller.status().active); assert.equal(h.timers.size, 0);
});

test('default discovery falls back to the current DOM video when the native API still returns a disconnected or foreign video', () => {
  for (const staleKind of ['disconnected', 'foreign']) {
    const h = harness(), stale = h.makeTarget('stale'), current = h.makeTarget('current');
    if (staleKind === 'disconnected') stale.video.isConnected = false;
    else stale.video.closest = () => null;
    h.context.livePlayer.getVideoEl = () => stale.video; h.setTarget(current); h.controller.update(rolling);
    assert(h.controller.status().active); assert.equal(h.surfaces[0].params.video, current.video);
    assert.equal(h.surfaces[0].params.host, current.host); assert.equal(h.timers.size, 0);
    h.frame(1); assert.equal(h.controller.status().presents, 1);
  }
});

test('fixed and rolling modes pass explicit native-layout policy to the compositor without touching a VOD scheduler', () => {
  const h = harness(); h.controller.update({ enabled: true, motion: 'fixed', position: 'alternate' }); h.frame(1);
  assert.equal(h.surfaces[0].params.mode, 'fixed'); assert.equal(h.surfaces[0].params.position, 'alternate');
  h.controller.update(rolling); assert(h.surfaces[0].restored); assert.equal(h.callbacks.size, 1); assert.equal(h.surfaces[1].params.mode, 'video-sync');
});

test('paused enable paints once; pause stays static, UI invalidations coalesce and resume cancels stale UI work', () => {
  const h = harness(); h.original.video.paused = true; h.controller.update(rolling);
  assert.equal(h.callbacks.size, 0); assert.equal(h.ui.size, 1); h.controller.refresh(); assert.equal(h.ui.size, 1); h.uiFrame();
  assert.equal(h.ui.size, 0); assert.equal(h.controller.status().uiFrames, 1); assert.equal(h.controller.status().frames, 0);
  h.advance(5000); assert.equal(h.surfaces[0].presents, 1);
  h.controller.refresh(); h.original.video.paused = false; h.event('play'); assert.equal(h.ui.size, 0); assert.equal(h.callbacks.size, 1);
  h.frame(2); h.original.video.paused = true; h.event('pause'); assert.equal(h.callbacks.size, 0); assert.equal(h.ui.size, 0);
});

test('seek, emptied/media-ready and replacement cancel old callbacks and never reuse a restored surface', () => {
  const h = harness(); h.controller.update(rolling); h.frame(1);
  h.original.video.seeking = true; h.event('seeking'); assert.equal(h.callbacks.size, 0);
  h.original.video.seeking = false; h.event('seeked'); h.frame(30);
  h.event('emptied'); assert.equal(h.callbacks.size, 0); assert(h.surfaces[0].restored);
  h.event('loadeddata'); assert.equal(h.callbacks.size, 1); h.frame(31);
  const stale = h.callbacks.values().next().value.fn, replacement = h.makeTarget('replacement');
  h.setTarget(replacement); h.controller.update(rolling); stale(1000, { mediaTime: 99 });
  assert.equal(h.callbacks.size, 1); h.frame(32); assert(h.surfaces[1].restored); assert(!h.surfaces[2].restored);
});

test('readiness retries are bounded and comment insertions do not turn the child observer into a render or discovery clock', async () => {
  const h = harness(); h.setTarget(null); h.controller.update(rolling);
  for (let i = 0; i < 6; i++) h.timer();
  assert.equal(h.timers.size, 0); assert(!h.controller.status().active);
  h.setTarget(h.original); h.event('canplay'); h.frame(1); const before = h.surfaces.length;
  h.mutations([{ target: h.original.layer, addedNodes: [{ parentElement: h.original.layer }], removedNodes: [] }]); await Promise.resolve();
  assert.equal(h.surfaces.length, before); assert.equal(h.callbacks.size, 1); assert.equal(h.ui.size, 0);
  assert(h.observers.every(o => !o.settings?.attributes), 'no per-frame style observation');
  const replacement = h.makeTarget('new'); h.setTarget(replacement);
  h.mutations([{ target: {}, addedNodes: [replacement.host], removedNodes: [h.original.host] }]); await Promise.resolve();
  assert(h.surfaces[0].restored); assert.equal(h.surfaces.length, before + 1); assert.equal(h.callbacks.size, 1);
});

test('transient draw and surface-create failures recover without refresh with bounded backoff and stable-frame reset', () => {
  const h = harness(); h.controller.update(rolling); h.failDraw(); h.frame(1); assert(!h.original.video.hidden);
  assert.equal(h.controller.status().recovery.phase, 'pending'); h.failCreate(); h.timer();
  assert.equal(h.controller.status().recovery.attempts, 1); assert.equal(h.delays.at(-1), 500); assert.equal(h.callbacks.size, 0);
  h.timer(); h.noPaint(2); h.frame(2); h.frame(2.04); assert.equal(h.controller.status().recovery.stableFrames, 0);
  for (let i = 0; i < 120; i++) h.frame(3 + i / 24);
  assert(h.controller.status().active); assert.equal(h.controller.status().recovery.attempts, 0);
  assert.equal(h.context.BFDLiveSync.readDiagnostics().at(-1).recovery, 'recovered');
});

test('persistent construction failures exhaust exactly three retries and repeated reads/media-ready events cannot restart a storm', () => {
  const h = harness(); h.failCreate(10); h.controller.update(rolling);
  for (let i = 0; i < 3; i++) h.timer();
  assert.equal(h.controller.status().recovery.phase, 'exhausted'); assert.equal(h.timers.size, 0); assert.deepEqual(h.delays, [150, 500, 1500]);
  for (let i = 0; i < 10; i++) { h.context.BFDLiveSync.readStatus(); h.event('canplay'); h.controller.update(rolling); }
  assert.equal(h.timers.size, 0); assert.equal(h.callbacks.size, 0); assert(!h.original.video.hidden);
});

test('recovery timers suspend on pause/seek and cancel on off, target replacement and pagehide', () => {
  const h = harness(); h.controller.update(rolling); h.failDraw(); h.frame(1);
  h.original.video.paused = true; h.event('pause'); assert.equal(h.timers.size, 0);
  h.original.video.paused = false; h.event('play'); assert.equal(h.timers.size, 1);
  h.original.video.seeking = true; h.event('seeking'); assert.equal(h.timers.size, 0);
  h.original.video.seeking = false; h.event('seeked'); assert.equal(h.timers.size, 1);
  const stale = h.timers.values().next().value; h.rootEvent('pagehide'); stale(); assert.equal(h.timers.size, 0); assert.equal(h.callbacks.size, 0);
  h.rootEvent('pageshow'); h.frame(3); assert(h.controller.status().active);
  h.failDraw(); h.frame(3.04); h.setTarget(h.makeTarget('other')); h.controller.update(rolling); assert.equal(h.timers.size, 0); assert.equal(h.controller.status().recovery.attempts, 0);
  h.frame(4); h.failDraw(); h.frame(4.04); h.controller.update({ enabled: false }); assert.equal(h.timers.size, 0); assert.equal(h.callbacks.size, 0);
});

test('a true frame-callback stall restores native while ordinary buffering without media advance does not', () => {
  const h = harness(); h.controller.update(rolling); h.frame(1); h.advance(2501); h.event('timeupdate');
  assert(h.controller.status().active); h.original.video.currentTime = 4; h.event('timeupdate');
  assert(!h.controller.status().active); assert.equal(h.context.BFDLiveSync.readDiagnostics().at(-1).reason, 'frame-callback-stalled');
  h.timer(); h.frame(4); assert(h.controller.status().active);
});

test('diagnostics are independent, bounded, safe across factories and storage denial never blocks playback', () => {
  const h = harness();
  for (let i = 0; i < 7; i++) { h.controller.update(rolling); h.failDraw(); h.frame(i + 1); h.controller.update({ enabled: false }); }
  const data = h.context.BFDLiveSync.readDiagnostics(); assert.equal(data.length, 5); assert.equal(data[0].roomId, '12345');
  assert(!/private|token|https:|DO-NOT-STORE/.test(h.storage.get('bfd-live-sync-diagnostics-v1')));
  data[0].reason = 'mutated'; assert.notEqual(h.context.BFDLiveSync.readDiagnostics()[0].reason, 'mutated');
  assert.equal(harness({ storage: h.storage }).context.BFDLiveSync.readDiagnostics().length, 5);
  const denied = harness({ storageThrows: true }); denied.controller.update(rolling); denied.failDraw(); denied.frame(1); denied.timer(); denied.frame(2); assert(denied.controller.status().active);
});

test('unsupported APIs stay native and repeated enable/disable/destroy releases owned callbacks, observers and listeners', () => {
  const h = harness(), baseline = h.listeners(); h.original.video.requestVideoFrameCallback = undefined; h.controller.update(rolling);
  assert(!h.controller.status().active); assert.equal(h.timers.size, 0); assert.equal(h.controller.status().recovery.phase, 'unavailable');
  h.controller.destroy(); assert.equal(h.listeners(), 0);
  const good = harness(), listeners = good.listeners();
  for (let i = 0; i < 30; i++) { good.controller.update(rolling); good.frame(i + 1); good.controller.update({ enabled: false }); assert.equal(good.listeners(), listeners); assert.equal(good.callbacks.size, 0); assert.equal(good.ui.size, 0); }
  assert(good.observers.every(o => !o.active)); assert.equal(good.surfaces.filter(s => !s.restored).length, 0);
  good.controller.destroy(); assert.equal(good.listeners(), 0);
});

test('loss of an existing target does not reset every readiness retry, while a deliberate off/on gets a fresh bounded attempt', () => {
  const h = harness({ injectDiscovery: true }); h.controller.update(rolling); h.frame(1); h.setTarget(null); h.controller.update(rolling);
  for (let i = 0; i < 6; i++) h.timer();
  assert.equal(h.timers.size, 0); assert(h.surfaces[0].restored);
  h.controller.update({ enabled: false }); h.controller.update(rolling); assert.equal(h.timers.size, 1);
  assert.equal(h.delays.at(-1), 50);
});

test('healthy video frames still reset a retry budget after pagehide or media reload removes its recovery object', () => {
  for (const lifecycle of ['pagehide', 'emptied']) {
    const h = harness(); h.controller.update(rolling); h.failDraw(); h.frame(1); h.timer(); h.frame(2);
    if (lifecycle === 'pagehide') { h.rootEvent('pagehide'); h.rootEvent('pageshow'); }
    else { h.event('emptied'); h.event('loadeddata'); }
    for (let i = 0; i < 119; i++) h.frame(3 + i / 24);
    assert.equal(h.controller.status().recovery.attempts, 1); assert.equal(h.controller.status().recovery.stableFrames, 119);
    h.frame(8); assert.equal(h.controller.status().recovery.attempts, 0); assert.equal(h.controller.status().recovery.phase, 'idle');
  }
});

test('optional quality protection follows the live enable gate and never adds per-frame work', () => {
  const h = harness({ quality: true }); assert.equal(h.quality.creates, 1);
  h.controller.update({ enabled: false }); assert.deepEqual(h.quality.updates, [false]);
  h.context.location.href = 'https://www.bilibili.com/video/BV1test/'; h.controller.update(rolling);
  assert.deepEqual(h.quality.updates, [false, false]); assert.equal(h.callbacks.size, 0);
  h.context.location.href = 'https://live.bilibili.com/12345'; h.controller.update(rolling);
  const calls = h.quality.updates.length;
  for (let i = 0; i < 10; i++) h.frame(1 + i / 24);
  assert.equal(h.quality.updates.length, calls); assert.equal(h.quality.updates.at(-1), true);
  assert.equal(h.callbacks.size, 1); assert.equal(h.timers.size, 0); assert.equal(h.ui.size, 0);
});

test('existing readiness, media and target discovery retry optional quality attachment without a new clock', async () => {
  const h = harness({ quality: true, injectDiscovery: true }); h.setTarget(null); h.controller.update(rolling);
  assert.deepEqual(h.quality.updates, [true]); assert.equal(h.timers.size, 1);
  h.timer(); assert.deepEqual(h.quality.updates, [true, true]); assert.equal(h.timers.size, 1);
  h.setTarget(h.original); h.event('canplay'); assert.equal(h.quality.updates.length, 3); assert.equal(h.timers.size, 0);
  h.frame(1); h.event('emptied'); assert.equal(h.quality.updates.length, 3);
  h.event('loadeddata'); assert.equal(h.quality.updates.length, 4); h.frame(2);
  const replacement = h.makeTarget('quality-replacement'); h.setTarget(replacement);
  h.mutations([{ target: {}, addedNodes: [replacement.host], removedNodes: [h.original.host] }]); await Promise.resolve();
  assert.equal(h.quality.updates.length, 5); assert(h.quality.updates.every(Boolean)); assert.equal(h.callbacks.size, 1);
});

test('renderer failures, recovery and mode replacement keep optional quality protection enabled', () => {
  const h = harness({ quality: true }); h.controller.update(rolling); h.frame(1);
  h.failDraw(); h.frame(1.04); assert.deepEqual(h.quality.updates, [true]);
  h.failCreate(); h.timer(); h.timer(); h.frame(2);
  h.controller.update({ enabled: true, motion: 'fixed', position: 'bottom' }); h.frame(3);
  h.advance(2501); h.original.video.currentTime = 6; h.event('timeupdate');
  assert.equal(h.controller.status().recovery.phase, 'pending'); assert(h.quality.updates.every(Boolean));
  h.timer(); h.frame(6); assert(h.controller.status().active); assert(h.quality.updates.every(Boolean));
});

test('pagehide disables quality protection until pageshow, and destroy releases it after disabling', () => {
  const h = harness({ quality: true }); h.controller.update(rolling); h.frame(1);
  h.rootEvent('pagehide'); assert.deepEqual(h.quality.updates, [true, false]); assert.equal(h.callbacks.size, 0);
  h.controller.update(rolling); assert.equal(h.quality.updates.at(-1), false); assert.equal(h.callbacks.size, 0);
  h.rootEvent('pageshow'); assert.equal(h.quality.updates.at(-1), true); h.frame(2);
  h.controller.destroy(); assert.equal(h.quality.updates.at(-1), false); assert.equal(h.quality.destroys, 1);
  const calls = h.quality.updates.length; h.rootEvent('pageshow'); h.event('canplay');
  assert.equal(h.quality.updates.length, calls); assert.equal(h.listeners(), 0); assert.equal(h.callbacks.size, 0);
});

test('real quality module restores and reapplies across parent capture-phase page lifecycle without another media event', () => {
  const h = harness({ quality: 'native' }); h.controller.update(rolling); h.frame(1);
  assert.deepEqual(h.quality.updates, [true]);
  h.rootEvent('pagehide'); assert.deepEqual(h.quality.updates, [true, false]);
  h.rootEvent('pageshow'); assert.deepEqual(h.quality.updates, [true, false, true]);
  h.frame(2); h.controller.destroy(); assert.deepEqual(h.quality.updates, [true, false, true, false]);
  assert.equal(h.listeners(), 0); assert.equal(h.callbacks.size, 0); assert.equal(h.timers.size, 0);
});

test('manifest loads the quality guard before the live controller and the syntax check includes it', () => {
  const manifest = JSON.parse(fs.readFileSync(require.resolve('../extension/manifest.json'), 'utf8'));
  const main = manifest.content_scripts.find(entry => entry.world === 'MAIN');
  assert(main.js.indexOf('live-quality.js') >= 0); assert(main.js.indexOf('live-quality.js') < main.js.indexOf('live-sync.js'));
  const pkg = JSON.parse(fs.readFileSync(require.resolve('../package.json'), 'utf8'));
  assert(pkg.scripts.check.includes('node --check extension/live-quality.js'));
});

function qualityCadence(h, { totalFPS = 60, callbackFPS = 30, droppedFPS = 0, video = h.target().video } = {}) {
  const quality = { totalVideoFrames: 0, droppedVideoFrames: 0 };
  let total = 0, dropped = 0, media = 1, reads = 0;
  const read = () => { reads++; return quality; };
  video.currentSrc = 'blob:fixture-current'; video.getVideoPlaybackQuality = read;
  return { video, quality, read, reads: () => reads,
    seed() { h.frame(media, 0); },
    tick(count = 1) {
      for (let i = 0; i < count; i++) {
        total += totalFPS / callbackFPS; dropped += droppedFPS / callbackFPS; media += 1 / callbackFPS;
        quality.totalVideoFrames = Math.floor(total); quality.droppedVideoFrames = Math.floor(dropped);
        h.frame(media, 1000 / callbackFPS);
      }
    },
    rates(nextTotal, nextCallback = callbackFPS, nextDropped = droppedFPS) { totalFPS = nextTotal; callbackFPS = nextCallback; droppedFPS = nextDropped; } };
}

test('two video-driven cadence windows refresh once for 60/30, including the observed 60 total / 34 dropped / 26 callback pattern', () => {
  for (const [callbackFPS, droppedFPS] of [[30, 0], [30, 30], [26, 34]]) {
    const h = harness(); h.controller.update(rolling); const d = qualityCadence(h, { callbackFPS, droppedFPS }); d.seed();
    d.tick(Math.ceil(callbackFPS * 1.1)); assert.equal(h.surfaces[0].presentationRefreshes, 0, 'one window cannot trigger');
    d.tick(Math.ceil(callbackFPS * 1.2)); assert.equal(h.surfaces[0].presentationRefreshes, 1);
    const value = h.controller.status().presentationRecovery;
    assert(value.attempted); assert(Math.abs(value.sampledFPS - 60) < 1); assert(Math.abs(value.callbackFPS - callbackFPS) < 1); assert(Math.abs(value.droppedFPS - droppedFPS) < 1);
    d.tick(callbackFPS * 5); assert.equal(h.surfaces[0].presentationRefreshes, 1);
    assert.equal(h.callbacks.size, 1); assert.equal(h.timers.size, 0); assert.equal(h.ui.size, 0);
    assert.equal(h.controller.status().presents, h.controller.status().frames);
  }
});
test('a genuine 30/30 pipeline and a single mismatched cadence window do not refresh', () => {
  const h = harness(); h.controller.update(rolling); const d = qualityCadence(h, { totalFPS: 30 }); d.seed(); d.tick(100);
  assert.equal(h.surfaces[0].presentationRefreshes, 0); assert(!h.controller.status().presentationRecovery.attempted);
  d.rates(60); d.tick(32); assert.equal(h.surfaces[0].presentationRefreshes, 0);
  d.rates(30); d.tick(35); d.rates(60); d.tick(32); assert.equal(h.surfaces[0].presentationRefreshes, 0);
});
test('low-count cadence windows do not qualify solely from a two-to-one counter ratio', () => {
  for (const [totalFPS, callbackFPS] of [[10, 5], [14, 8]]) {
    const h = harness(); h.controller.update(rolling); const d = qualityCadence(h, { totalFPS, callbackFPS }); d.seed(); d.tick(callbackFPS * 4);
    assert.equal(h.surfaces[0].presentationRefreshes, 0); assert(!h.controller.status().presentationRecovery.attempted);
  }
});
test('the 120/60 counter ambiguity is bounded to one refresh per VIDEO across surface rebuilds, mode and off/on', () => {
  const h = harness(); h.controller.update(rolling); const d = qualityCadence(h, { totalFPS: 120, callbackFPS: 60 }); d.seed(); d.tick(150);
  assert.equal(h.surfaces[0].presentationRefreshes, 1);
  h.controller.update({ ...rolling, motion: 'fixed' }); d.tick(150);
  h.controller.update({ enabled: false }); h.controller.update(rolling); d.tick(150);
  h.failDraw(); d.tick(); h.timer(); d.tick(150);
  assert.equal(h.surfaces.reduce((sum, s) => sum + s.presentationRefreshes, 0), 1);
  assert(h.controller.status().presentationRecovery.attempted);
  const replacement = h.makeTarget('cadence-replacement'); h.setTarget(replacement); h.controller.update(rolling);
  const fresh = qualityCadence(h, { totalFPS: 120, callbackFPS: 60 }); fresh.seed(); fresh.tick(150);
  assert.equal(h.surfaces.at(-1).presentationRefreshes, 1); assert(h.controller.status().presentationRecovery.attempted);
});
test('destroying and recreating the controller does not reset the same VIDEO presentation budget', () => {
  const h = harness(); h.controller.update(rolling); const d = qualityCadence(h); d.seed(); d.tick(70);
  h.controller.destroy(); const second = h.context.BFDLiveSync.create(); second.update(rolling); d.tick(100);
  assert.equal(h.surfaces.reduce((sum, s) => sum + s.presentationRefreshes, 0), 1); assert(second.status().presentationRecovery.attempted);
  second.destroy(); assert.equal(h.callbacks.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.ui.size, 0);
});
test('failed or unavailable presentation refresh does not consume the VIDEO budget', () => {
  const h = harness(); h.controller.update(rolling); const d = qualityCadence(h); d.seed();
  h.surfaces[0].refreshPresentation = () => false; d.tick(70);
  assert(!h.controller.status().presentationRecovery.attempted);
  h.surfaces[0].refreshPresentation = undefined; d.tick(35); assert(!h.controller.status().presentationRecovery.attempted);
  h.surfaces[0].refreshPresentation = () => { throw Error('unavailable'); }; d.tick(35); assert(h.controller.status().active);
  h.surfaces[0].refreshPresentation = () => true; d.tick(35); assert(h.controller.status().presentationRecovery.attempted);
  assert.equal(h.timers.size, 0); assert.equal(h.ui.size, 0); assert.equal(h.callbacks.size, 1);
});
test('quality absence, invalid values, rollback, source/time changes and long callback gaps clear consecutive cadence windows', () => {
  const cases = [
    d => { d.video.getVideoPlaybackQuality = undefined; },
    d => { d.video.getVideoPlaybackQuality = () => { throw Error('unsupported'); }; },
    d => { d.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: NaN, droppedVideoFrames: 0 }); },
    d => { d.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 }); },
    d => { d.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 1000, droppedVideoFrames: 0 }); },
    d => { d.video.currentSrc = 'blob:replacement-source'; },
    (_d, h) => { h.advance(2501); },
    (_d, h) => { h.frame(0, 40); }
  ];
  for (const invalidate of cases) {
    const h = harness(); h.controller.update(rolling); const d = qualityCadence(h, { droppedFPS: 10 }); d.seed(); d.tick(32);
    invalidate(d, h); d.tick(); d.video.getVideoPlaybackQuality = d.read;
    d.tick(32); assert.equal(h.surfaces[0].presentationRefreshes, 0, 'invalid sample cannot retain the previous qualifying window');
    d.tick(36); assert.equal(h.surfaces[0].presentationRefreshes, 1); assert(h.controller.status().active);
    assert.equal(h.timers.size, 0); assert.equal(h.ui.size, 0);
  }
});
test('cadence sampling requires a successful formal video draw and never reads quality during paused UI work', () => {
  const h = harness(); h.controller.update(rolling); const d = qualityCadence(h); h.noPaint(5); d.tick(5); assert.equal(d.reads(), 0);
  d.seed(); d.tick(32); const reads = d.reads();
  h.original.video.paused = true; h.event('pause'); h.controller.refresh(); h.uiFrame(); assert.equal(d.reads(), reads);
  assert.equal(h.controller.status().presentationRecovery.sampledFPS, 0);
  h.original.video.paused = false; h.event('play'); d.tick(32); assert.equal(h.surfaces[0].presentationRefreshes, 0);
  d.tick(36); assert.equal(h.surfaces[0].presentationRefreshes, 1);
});
test('an unsuccessful draw breaks consecutive cadence windows instead of letting its quality counts trigger a refresh', () => {
  const h = harness(); h.controller.update(rolling); const d = qualityCadence(h); d.seed(); d.tick(32);
  h.noPaint(1); d.tick(); assert.equal(h.controller.status().presentationRecovery.sampledFPS, 0);
  d.tick(32); assert.equal(h.surfaces[0].presentationRefreshes, 0); d.tick(36); assert.equal(h.surfaces[0].presentationRefreshes, 1);
});
test('source, media-time, visibility and callback-gap changes cancel an already attempted refresh without reading quality again', () => {
  for (const invalidate of [
    (d, h) => { d.video.currentSrc = 'blob:changed-during-refresh'; d.tick(); },
    (_d, h) => { h.frame(0, 40); },
    (d, h) => { h.context.document.hidden = true; d.tick(); },
    (d, h) => { h.advance(2501); d.tick(); }
  ]) {
    const h = harness(); h.controller.update(rolling); const d = qualityCadence(h); d.seed();
    for (let i = 0; i < 70 && !h.controller.status().presentationRecovery.attempted; i++) d.tick();
    const surface = h.surfaces[0]; assert(surface.refreshingPresentation); const reads = d.reads(), cancels = surface.presentationCancels;
    invalidate(d, h); assert(!surface.refreshingPresentation); assert(surface.presentationCancels > cancels);
    assert.equal(d.reads(), reads); assert(h.controller.status().presentationRecovery.attempted);
    assert.equal(h.controller.status().presentationRecovery.sampledFPS, 0); assert.equal(h.timers.size, 0);
  }
});
test('pause, ended, seek, emptied, disable and pagehide synchronously cancel a pending presentation refresh', () => {
  for (const lifecycle of ['pause', 'ended', 'seeking', 'emptied', 'off', 'pagehide']) {
    const h = harness(); h.controller.update(rolling); const d = qualityCadence(h); d.seed(); d.tick(70);
    const surface = h.surfaces[0]; assert(surface.refreshingPresentation, lifecycle); const cancels = surface.presentationCancels;
    if (lifecycle === 'off') h.controller.update({ enabled: false });
    else if (lifecycle === 'pagehide') h.rootEvent(lifecycle);
    else { if (['pause', 'ended', 'seeking'].includes(lifecycle)) h.original.video[lifecycle === 'pause' ? 'paused' : lifecycle] = true; h.event(lifecycle); }
    assert(!surface.refreshingPresentation, lifecycle); assert(surface.presentationCancels > cancels, lifecycle);
    assert.equal(h.callbacks.size, 0, lifecycle); assert.equal(h.ui.size, 0, lifecycle);
  }
});
test('visibility and not-ready/paused/seeking samples clear cadence without changing the existing playback scheduling policy', () => {
  for (const property of ['hidden', 'paused', 'seeking', 'readyState']) {
    const h = harness(); h.controller.update(rolling); const d = qualityCadence(h); d.seed(); d.tick(32);
    if (property === 'hidden') {
      h.context.document.hidden = true; h.context.document.visibilityState = 'hidden';
      const pending = [...h.callbacks.keys()]; h.context.document.emit('visibilitychange', { type: 'visibilitychange' });
      assert.deepEqual([...h.callbacks.keys()], pending); assert.equal(h.surfaces[0].presentationCancels, 1);
      d.tick(2); h.context.document.hidden = false; h.context.document.visibilityState = 'visible';
      h.context.document.emit('visibilitychange', { type: 'visibilitychange' });
    } else {
      h.original.video[property] = property === 'readyState' ? 1 : true; d.tick();
      h.original.video[property] = property === 'readyState' ? 4 : false; h.event(property === 'seeking' ? 'seeked' : 'play');
    }
    d.tick(32); assert.equal(h.surfaces[0].presentationRefreshes, 0, property);
    d.tick(36); assert.equal(h.surfaces[0].presentationRefreshes, 1, property);
    assert.equal(h.callbacks.size, 1); assert.equal(h.timers.size, 0); assert.equal(h.ui.size, 0);
  }
});
