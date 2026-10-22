const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const core = require('../extension/core.js'), fixture = require('./fixtures.cjs');
test('video-sync retains downloaded XML/protobuf, realtime bytes and own scrolling modes', () => {
  const options = { enabled: true, motion: 'video-sync' }, packet = fixture.packet([1, 2, 3, 6, 4, 5, 7]);
  const xml = '<i><d p="0,1,25,0,0,0,u,1">text</d></i>', own = Object.freeze({ mode: 1, rawMode: 1, border: true });
  assert.equal(core.rewriteProtobuf(packet, options).data, packet);
  assert.equal(core.rewriteXml(xml, options).data, xml);
  assert.equal(core.rewriteBroadcast(packet, options).data, packet);
  assert.equal(core.rewriteSelf(own, options).data, own);
  assert.equal(core.normalizeSettings({}).motion, 'fixed');
  assert.equal(core.normalizeSettings({ motion: 'unknown' }).motion, 'fixed');
});
function harness(options = {}) {
  const callbacks = new Map(), uiCallbacks = new Map(), events = new Map(), rootEvents = new Map(), timers = new Map(), properties = new Map(), classes = new Set();
  const add = (map, name, fn) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(fn); };
  const remove = (map, name, fn) => map.get(name)?.delete(fn);
  let next = 0, now = 100, inFrame = false, writes = 0, nativeStarts = 0, nativeStops = 0, drawFailures = 0, drawError = null, noPaints = 0, createFailures = 0, creates = 0;
  const delays = [], styles = [], storage = options.storage || new Map();
  let styleAppends = 0;
  const video = { paused: false, ended: false, seeking: false, playbackRate: 1, isConnected: true, readyState: 4, currentTime: 1,
    requestVideoFrameCallback(fn) { callbacks.set(++next, fn); return next; }, cancelVideoFrameCallback(id) { callbacks.delete(id); },
    addEventListener: (name, fn) => add(events, name, fn), removeEventListener: (name, fn) => remove(events, name, fn) };
  const node = { classList: { contains: name => name === 'bili-danmaku-x-roll' },
    setAttribute() {}, removeAttribute() {}, style: {
      setProperty(name, value) { assert(inFrame, 'motion outside a video callback'); properties.set(name, value); writes++; },
      removeProperty: name => properties.delete(name) } };
  const container = { isConnected: true, closest: () => ({ querySelector: () => video }), querySelectorAll: () => [node],
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) } };
  const clock = { renderTime: 1, currentTime: 1, updateTime() { this.renderTime = 1; this.currentTime = 1; } };
  const calls = [];
  const scheduler = { start() { nativeStarts++; }, stop() { nativeStops++; },
    startImmediate() { clock.updateTime(); calls.push({ render: clock.renderTime, media: clock.currentTime }); } };
  const item = { textData: { mode: 1 }, element: node, showed: true, duration: 10, endTime: 11, moveDistance: 1000 };
  let renderer = { container, frameScheduler: scheduler, timeController: clock, manager: { visualArray: [item] }, isRunning: true,
    startFrameScheduler() { this.frameScheduler = { ...this.frameScheduler }; },
    setSetting(name, value) { this.config ||= { setting: {} }; this.config.setting[name] = value; return 'native-setting-result'; } };
  const native = { start: scheduler.start, immediate: scheduler.startImmediate, update: clock.updateTime };
  const context = { console, URL, location: { href: 'https://www.bilibili.com/video/BV1KspF6iELH/?p=16&private=DO-NOT-STORE' }, Date: { now: () => now }, document: { createElement: () => { const style = { isConnected: false, sheet: { disabled: false }, remove() { this.isConnected = false; } }; styles.push(style); return style; }, head: { appendChild(style) { style.isConnected = true; styleAppends++; } } },
    sessionStorage: { getItem: key => { if (options.storageThrows) throw Error('storage denied'); return storage.get(key) || null; }, setItem: (key, value) => { if (options.storageThrows) throw Error('storage denied'); storage.set(key, value); } },
    player: { danmaku: { getDanmakuX: () => renderer } }, addEventListener: (name, fn) => add(rootEvents, name, fn), removeEventListener: (name, fn) => remove(rootEvents, name, fn),
    requestAnimationFrame(fn) { uiCallbacks.set(++next, fn); return next; }, cancelAnimationFrame(id) { uiCallbacks.delete(id); },
    BFDCompositor: { create(x) { creates++; if (createFailures > 0) { createFailures--; throw Error('合成画布上下文丢失'); } return { draw() { assert(inFrame); if (drawFailures > 0) { drawFailures--; throw drawError || Error('private comment text https://example.invalid/private?token=secret'); } if (noPaints > 0) { noPaints--; return false; } const i=x.manager.visualArray[0]; const elapsed=i.duration-(i.endTime-clock.renderTime); properties.set('--bfd-sync-x', `${-i.moveDistance*elapsed/i.duration}px`); writes++; return true; }, restore() { properties.clear(); }, status() { return { surface: 'single-canvas' }; } }; } },
    setTimeout(fn, delay) { delays.push(delay); timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); } };
  vm.createContext(context); vm.runInContext(fs.readFileSync(require.resolve('../extension/video-sync.js'), 'utf8'), context);
  const controller = context.BFDVideoSync.create();
  function frame(media) {
    const entry = callbacks.entries().next().value; assert(entry, 'missing frame request'); callbacks.delete(entry[0]);
    inFrame = true; try { entry[1](now += 41.6667, { mediaTime: media }); } finally { inFrame = false; }
  }
  function event(name) { for (const fn of [...(events.get(name) || [])]) fn(); }
  function rootEvent(name) { for (const fn of [...(rootEvents.get(name) || [])]) fn(); }
  function timer() { const entry=timers.entries().next().value; assert(entry, 'missing recovery timer'); timers.delete(entry[0]); entry[1](); }
  function uiFrame() { const entry=uiCallbacks.entries().next().value; assert(entry); uiCallbacks.delete(entry[0]); inFrame=true; try { entry[1](now+=16); } finally { inFrame=false; } }
  return { controller, context, video, scheduler, renderer, clock, native, callbacks, uiCallbacks, uiFrame, classes, properties, calls, frame, event, rootEvent, timers, timer, delays, storage, styles, styleAppends: () => styleAppends,
    failDraw: (count = 1, error = null) => { drawFailures = count; drawError = error; }, noPaint: (count = 1) => { noPaints = count; },
    failCreate: (count = 1) => { createFailures = count; }, creates: () => creates,
    count: () => writes, starts: () => nativeStarts, stops: () => nativeStops, replace: value => renderer = value, advance: value => now += value,
    listenerCount: () => [...events.values(), ...rootEvents.values()].reduce((n, set) => n + set.size, 0) };
}
const enabled = { enabled: true, motion: 'video-sync' };
function trackContainerSurfaces(h) {
  const surfaces = [], create = h.context.BFDCompositor.create;
  h.context.BFDCompositor.create = function (renderer, video) {
    const surface = create(renderer, video), originalDraw = surface.draw, originalRestore = surface.restore;
    const record = { container: renderer.container, draws: 0, restores: 0, committed: false };
    surfaces.push(record);
    surface.draw = function (...args) {
      assert.equal(record.restores, 0, 'released surfaces must never draw again');
      const painted = Reflect.apply(originalDraw, this, args);
      if (painted) { record.draws++; record.committed = true; }
      return painted;
    };
    surface.restore = function (...args) { record.restores++; return Reflect.apply(originalRestore, this, args); };
    surface.status = () => ({ surface: 'single-canvas', committed: record.committed });
    return surface;
  };
  function replaceContainer() {
    const previous = h.renderer.container, classes = new Set();
    const replacement = { ...previous, classList: {
      add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name)
    } };
    h.renderer.container = replacement;
    return { previous, replacement, classes };
  }
  return { surfaces, replaceContainer };
}
function assertContainerRebound(h, tracked, target) {
  assert(target.previous.isConnected && target.replacement.isConnected && h.video.isConnected);
  assert.equal(h.creates(), 2); assert.equal(tracked.surfaces[0].restores, 1);
  assert.equal(tracked.surfaces[1].container, target.replacement);
  assert.equal(h.styles[0].isConnected, false); assert.equal(h.styles[1].isConnected, true);
  assert(!h.classes.has('bfd-video-sync')); assert(target.classes.has('bfd-video-sync'));
  assert.equal(h.timers.size, 0); assert.equal(h.starts(), 0);
}
test('a connected replacement danmaku container rebinds on update while the renderer, scheduler and playing video stay the same', () => {
  const h = harness(), tracked = trackContainerSurfaces(h);
  h.controller.update(enabled, h.renderer); h.frame(1);
  const previousFrame = h.callbacks.values().next().value, target = tracked.replaceContainer();
  h.controller.update(enabled, h.renderer);
  assertContainerRebound(h, tracked, target);
  assert.equal(h.callbacks.size, 1); assert.equal(h.uiCallbacks.size, 0);
  const before = h.count(); previousFrame(1000, { mediaTime: 2 });
  assert.equal(h.count(), before); assert.equal(h.callbacks.size, 1);
  h.frame(1 + 1 / 24);
  assert.equal(tracked.surfaces[0].draws, 1); assert.equal(tracked.surfaces[1].draws, 1);
  assert.equal(h.callbacks.size, 1); assert.equal(h.uiCallbacks.size, 0); assert.equal(h.timers.size, 0);
  h.controller.update({ enabled: false }, h.renderer);
  assert.equal(tracked.surfaces[1].restores, 1); assert.equal(h.callbacks.size, 0); assert.equal(h.styles[1].isConnected, false);
});
test('the next video callback discovers a connected replacement container without an explicit settings update', () => {
  const h = harness(), tracked = trackContainerSurfaces(h);
  h.controller.update(enabled, h.renderer); h.frame(1);
  const target = tracked.replaceContainer(); h.frame(1 + 1 / 24);
  assertContainerRebound(h, tracked, target);
  assert.equal(tracked.surfaces[0].draws, 1); assert.equal(tracked.surfaces[1].draws, 0);
  assert.equal(h.callbacks.size, 1); assert.equal(h.uiCallbacks.size, 0);
  h.frame(1 + 2 / 24);
  assert.equal(tracked.surfaces[1].draws, 1); assert.equal(h.callbacks.size, 1);
  assert.equal(h.uiCallbacks.size, 0); assert.equal(h.timers.size, 0);
  h.controller.update({ enabled: false }, h.renderer);
  assert.equal(tracked.surfaces[1].restores, 1); assert.equal(h.callbacks.size, 0); assert.equal(h.styles[1].isConnected, false);
});
test('a paused committed surface is released and repainted once when its connected container changes', () => {
  const h = harness(), tracked = trackContainerSurfaces(h); h.video.paused = true;
  h.controller.update(enabled, h.renderer); h.uiFrame();
  assert(tracked.surfaces[0].committed); assert.equal(h.uiCallbacks.size, 0);
  const target = tracked.replaceContainer(); h.controller.update(enabled, h.renderer);
  assertContainerRebound(h, tracked, target);
  assert.equal(h.callbacks.size, 0); assert.equal(h.uiCallbacks.size, 1);
  h.uiFrame(); h.controller.update(enabled, h.renderer);
  assert.equal(tracked.surfaces[0].draws, 1); assert.equal(tracked.surfaces[1].draws, 1);
  assert.equal(h.controller.status().uiFrames, 1); assert.equal(h.uiCallbacks.size, 0);
  assert.equal(h.callbacks.size, 0); assert.equal(h.timers.size, 0);
  h.controller.update({ enabled: false }, h.renderer);
  assert.equal(tracked.surfaces[1].restores, 1); assert.equal(h.styles[1].isConnected, false);
});
test('one callback per video frame, media-time motion, no native RAF start or independent position writes', () => {
  const h = harness(); h.controller.update(enabled, h.renderer);
  assert.equal(h.stops(), 1); assert.equal(h.starts(), 0); assert.equal(h.callbacks.size, 1);
  h.scheduler.start(); h.scheduler.start(); assert.equal(h.callbacks.size, 1);
  h.frame(1); h.frame(1 + 1 / 24); h.frame(1 + 2 / 24);
  assert.equal(h.controller.status().frames, 3); assert.equal(h.count(), 3);
  assert(Math.abs(parseFloat(h.properties.get('--bfd-sync-x')) + 8.333333) < 0.01);
  assert.equal(h.calls.at(-1).media, 1 + 2 / 24);
  assert.equal(h.starts(), 0);
});
test('pause cancels callback; paused seek is single frame; resume and playback speed use video timeline', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.frame(1);
  h.video.paused = true; h.event('pause'); assert.equal(h.callbacks.size, 0);
  h.scheduler.start(); assert.equal(h.callbacks.size, 0);
  h.event('seeking'); h.video.currentTime = 20; h.event('seeked'); assert.equal(h.uiCallbacks.size, 1); h.uiFrame();
  assert.equal(h.callbacks.size, 0); assert.equal(h.calls.at(-1).media, 20);
  h.video.paused = false; h.event('play'); h.frame(20.04);
  h.video.playbackRate = 2; h.event('ratechange'); h.frame(20.08); h.frame(20.16);
  assert(Math.abs(h.calls.at(-1).render - 1.04) < 0.0001);
});
test('disable restores original functions/styles and removes frame and media listeners', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.frame(1);
  h.controller.update({ enabled: false }, h.renderer);
  assert(!h.controller.status().active); assert.equal(h.callbacks.size, 0); assert.equal(h.classes.size, 0); assert.equal(h.properties.size, 0);
  assert.equal(h.scheduler.start, h.native.start); assert.equal(h.scheduler.startImmediate, h.native.immediate); assert.equal(h.clock.updateTime, h.native.update);
  assert.equal(h.starts(), 1); h.event('play'); assert.equal(h.callbacks.size, 0);
});
test('readiness retries are bounded and canceled after successful attach or disable', () => {
  const h = harness(); h.controller.update(enabled);
  assert.equal(h.timers.size, 1);
  const callback = h.timers.values().next().value; h.timers.clear(); callback();
  assert(h.controller.status().active); assert.equal(h.timers.size, 0);
  h.controller.update({ enabled: false }); assert.equal(h.callbacks.size, 0);
  h.controller.update(enabled); assert.equal(h.timers.size, 1);
  h.controller.update({ enabled: false }); assert.equal(h.timers.size, 0);
  const pending = harness(); pending.replace(null); pending.controller.update(enabled);
  for (let i = 0; i < 6; i++) { const fn = pending.timers.values().next().value; assert(fn); pending.timers.clear(); fn(); }
  assert.equal(pending.timers.size, 0); assert(!pending.controller.status().active);
});
test('unsupported versions stay native and failures restore a running player', () => {
  const h = harness(); h.video.requestVideoFrameCallback = undefined;
  h.controller.update(enabled, h.renderer); assert(!h.controller.status().active); assert.equal(h.stops(), 0);
  const bad = harness(); bad.renderer.manager.visualArray = null;
  bad.controller.update(enabled, bad.renderer); assert(!bad.controller.status().active); assert.equal(bad.stops(), 0);
  const broken = harness(); Object.defineProperty(broken.renderer.manager.visualArray[0], 'duration', { get() { throw new Error('failure'); } });
  broken.controller.update(enabled, broken.renderer); broken.frame(1);
  assert(!broken.controller.status().active); assert.equal(broken.scheduler.start, broken.native.start); assert.equal(broken.callbacks.size, 0);
});
test('native scheduler rebuild and SPA renderer replacement cancel old callbacks and reattach once', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.frame(1);
  h.renderer.startFrameScheduler(); assert(h.controller.status().active); assert.equal(h.callbacks.size, 1);
  assert.notEqual(h.renderer.frameScheduler, h.scheduler); assert.equal(h.scheduler.start, h.native.start);
  h.frame(2); assert.equal(h.controller.status().frames, 1);
  const next = { ...h.renderer, frameScheduler: { ...h.scheduler } }; h.replace(next);
  h.frame(2.04); assert(h.controller.status().active); assert.equal(h.callbacks.size, 1);
  h.frame(2.08); assert.equal(h.controller.status().frames, 1);
  h.controller.update({ enabled: false }); assert.equal(h.callbacks.size, 0);
});
test('native timeupdate restores original display if audio/video time advances but frame callbacks stop', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.frame(1);
  h.video.readyState = 4; h.video.currentTime = 4;
  h.advance(2501); h.event('timeupdate');
  assert(!h.controller.status().active); assert(h.controller.status().reason.includes('视频帧回调停止'));
  assert.equal(h.callbacks.size, 0); assert.equal(h.scheduler.start, h.native.start);
});
test('paused enable paints once; repeated UI invalidations coalesce and never start a rendering loop', () => {
  const h = harness(); h.video.paused = true; h.controller.update(enabled, h.renderer);
  assert.equal(h.callbacks.size, 0); assert.equal(h.uiCallbacks.size, 1);
  h.controller.refresh(); h.controller.refresh(); assert.equal(h.uiCallbacks.size, 1);
  h.uiFrame(); assert.equal(h.count(), 1); assert.equal(h.uiCallbacks.size, 0); assert.equal(h.controller.status().frames, 0); assert.equal(h.controller.status().uiFrames, 1);
  h.advance(10000); h.controller.refresh(); h.uiFrame(); assert.equal(h.clock.renderTime, 1);
});
test('native paused setting changes refresh once, preserve receiver/arguments/result, and restore originals', () => {
  const h = harness(), original = h.renderer.setSetting;
  h.video.paused = true; h.controller.update(enabled, h.renderer); h.uiFrame();
  assert.equal(h.renderer.setSetting('visible', false), 'native-setting-result'); assert.equal(h.renderer.config.setting.visible, false);
  assert.equal(h.uiCallbacks.size, 1); h.uiFrame();
  h.controller.update({ enabled: false }); assert.equal(h.renderer.setSetting, original);
});
test('playing UI actions never queue extra paints; pending paused UI paint is canceled by play or disable', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.controller.refresh(); h.renderer.setSetting('opacity', 0.5);
  assert.equal(h.uiCallbacks.size, 0); assert.equal(h.callbacks.size, 1);
  h.video.paused = true; h.event('pause'); h.controller.refresh(); assert.equal(h.uiCallbacks.size, 1);
  h.video.paused = false; h.event('play'); assert.equal(h.uiCallbacks.size, 0); assert.equal(h.callbacks.size, 1);
  h.video.paused = true; h.event('pause'); h.controller.refresh(); h.controller.update({ enabled: false }); assert.equal(h.uiCallbacks.size, 0);
});
test('50 repeated installs remove all per-install media/window listeners and pending UI/video callbacks', () => {
  const h = harness(), baseline = h.listenerCount();
  for (let i = 0; i < 50; i++) {
    h.controller.update(enabled, h.renderer); h.frame(i / 24 + 1); h.controller.update({ enabled: false });
    assert.equal(h.listenerCount(), baseline); assert.equal(h.callbacks.size, 0); assert.equal(h.uiCallbacks.size, 0);
  }
});

test('one transient draw failure restores native playback then rebuilds without refresh and clears budget after 120 painted video frames', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.failDraw(); h.frame(1);
  assert(!h.controller.status().active); assert.equal(h.callbacks.size, 0); assert.equal(h.starts(), 1);
  assert.equal(h.timers.size, 1); assert.equal(h.delays.at(-1), 150);
  const diagnostic = h.context.BFDVideoSync.readDiagnostics(); assert.equal(diagnostic.at(-1).reason, 'draw-error');
  assert.equal(diagnostic.at(-1).pageKey, '/video/BV1KspF6iELH/?p=16');
  for (let i = 0; i < 10; i++) h.controller.update(enabled, h.renderer);
  assert.equal(h.timers.size, 1); assert.equal(h.callbacks.size, 0);
  h.timer(); assert(h.controller.status().active); assert.equal(h.controller.status().recovery.attempts, 1);
  h.noPaint(2); h.frame(2); h.frame(2.04); assert.equal(h.controller.status().recovery.stableFrames, 0);
  for (let i = 0; i < 119; i++) h.frame(3 + i / 24);
  assert.equal(h.controller.status().recovery.stableFrames, 119); assert.equal(h.controller.status().recovery.attempts, 1);
  h.frame(8); assert.equal(h.controller.status().recovery.phase, 'idle'); assert.equal(h.controller.status().recovery.attempts, 0);
  assert.equal(h.context.BFDVideoSync.readDiagnostics().at(-1).recovery, 'recovered');
  h.failDraw(); h.frame(8.04); assert.equal(h.delays.at(-1), 150);
});

test('persistent draw errors exhaust exactly three backed-off rebuild attempts and status/settings cannot trigger a retry storm', () => {
  const h = harness(), baseline = h.listenerCount(); h.controller.update(enabled, h.renderer); h.failDraw(10); h.frame(1);
  for (let i = 0; i < 3; i++) { assert.equal(h.timers.size, 1); h.timer(); h.frame(2 + i); }
  assert.deepEqual(h.delays, [150, 500, 1500]);
  assert(!h.controller.status().active); assert.equal(h.controller.status().recovery.phase, 'exhausted');
  assert.equal(h.controller.status().recovery.attempts, 3); assert.equal(h.timers.size, 0); assert.equal(h.callbacks.size, 0);
  assert.equal(h.starts(), 4); assert.equal(h.scheduler.start, h.native.start);
  for (let i = 0; i < 20; i++) { h.context.BFDVideoSync.readStatus(); h.controller.update(enabled, h.renderer); h.event('canplay'); }
  assert.equal(h.timers.size, 0); assert.equal(h.callbacks.size, 0); assert.equal(h.starts(), 4);
  h.controller.update({ enabled: false }, h.renderer);
  assert.equal(h.listenerCount(), baseline); assert.equal(h.controller.status().recovery.attempts, 0);
});

test('stalled video callbacks recover automatically instead of permanently locking the same renderer to native playback', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.frame(1);
  h.video.currentTime = 4; h.advance(2501); h.event('timeupdate');
  assert(!h.controller.status().active); assert.equal(h.context.BFDVideoSync.readDiagnostics().at(-1).stage, 'stale');
  const summary = h.context.BFDVideoSync.readDiagnostics().at(-1);
  assert.equal(summary.frameAgeMs, 2501); assert.equal(summary.mediaBehindMs, 3000);
  assert.equal(summary.readyState, 4); assert.equal(summary.paused, false); assert.equal(summary.seeking, false);
  assert.equal(h.callbacks.size, 0); assert.equal(h.timers.size, 1);
  h.timer(); h.frame(4); assert(h.controller.status().active); assert.equal(h.controller.status().frames, 1);
  assert.equal(h.controller.status().recovery.attempts, 1);
});

test('pause and seek cancel scheduled recovery, and media resume re-arms only one bounded attempt', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.failDraw(); h.frame(1);
  const staleTimer = h.timers.values().next().value;
  h.video.paused = true; h.event('pause'); assert.equal(h.timers.size, 0); assert.equal(h.controller.status().recovery.phase, 'paused');
  h.controller.update(enabled, h.renderer); assert.equal(h.timers.size, 0);
  h.video.paused = false; h.event('play'); assert.equal(h.timers.size, 1);
  staleTimer(); assert.equal(h.timers.size, 1); assert(!h.controller.status().active);
  h.video.seeking = true; h.event('seeking'); assert.equal(h.timers.size, 0);
  h.event('canplay'); assert.equal(h.timers.size, 0);
  h.video.seeking = false; h.event('seeked'); h.event('canplay'); assert.equal(h.timers.size, 1);
  h.timer(); h.frame(10); assert(h.controller.status().active); assert.equal(h.controller.status().recovery.attempts, 1);
});

test('disable and pagehide cancel recovery and even a stale timer cannot reattach; pageshow may attach again', () => {
  for (const action of ['disable', 'pagehide']) {
    const h = harness(); h.controller.update(enabled, h.renderer); h.failDraw(); h.frame(1);
    const canceled = h.timers.values().next().value;
    if (action === 'disable') h.controller.update({ enabled: false }, h.renderer); else h.rootEvent('pagehide');
    assert.equal(h.timers.size, 0); canceled(); assert.equal(h.callbacks.size, 0); assert(!h.controller.status().active);
    h.event('play'); assert.equal(h.timers.size, 0);
    if (action === 'pagehide') { h.controller.update(enabled, h.renderer); assert(!h.controller.status().active); h.rootEvent('pageshow'); assert(h.controller.status().active); }
  }
});

test('replacing a live renderer stops the old scheduler and never restarts its native loop behind the new synchronized renderer', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.frame(1);
  const next = { ...h.renderer, frameScheduler: { start() { throw Error('new native start should stay stopped'); }, stop() {}, startImmediate: h.native.immediate } };
  h.replace(next); h.frame(2); h.frame(2.04);
  assert(h.controller.status().active); assert.equal(h.starts(), 0); assert.equal(h.stops(), 2);
  assert.equal(h.scheduler.start, h.native.start);
});

test('renderer replacement during native fallback cancels its retry and stops its old native scheduler', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.failDraw(); h.frame(1);
  const canceled = h.timers.values().next().value, before = h.stops();
  const next = { ...h.renderer, frameScheduler: { start() {}, stop() {}, startImmediate: h.native.immediate } };
  h.replace(next); h.controller.update(enabled, next); canceled(); h.frame(2);
  assert.equal(h.timers.size, 0); assert(h.controller.status().active); assert(h.stops() > before);
  assert.equal(h.starts(), 1); assert.equal(h.controller.status().recovery.attempts, 0);
});

test('diagnostics persist only five bounded safe summaries across factories, and read APIs cannot mutate playback or stored records', () => {
  const h = harness();
  for (let i = 0; i < 7; i++) { h.controller.update(enabled, h.renderer); h.failDraw(); h.frame(i + 1); h.controller.update({ enabled: false }, h.renderer); }
  const data = h.context.BFDVideoSync.readDiagnostics(); assert.equal(data.length, 5);
  assert(data.every(entry => entry.message.length <= 200));
  const raw = h.storage.get('bfd-video-sync-diagnostics-v1');
  assert(!/private|DO-NOT-STORE|example|token|https:|stack/.test(raw));
  data[0].message = 'mutated'; assert.notEqual(h.context.BFDVideoSync.readDiagnostics()[0].message, 'mutated');
  const snapshot = { starts: h.starts(), stops: h.stops(), timers: h.timers.size, callbacks: h.callbacks.size };
  for (let i = 0; i < 10; i++) h.context.BFDVideoSync.readStatus();
  assert.deepEqual({ starts: h.starts(), stops: h.stops(), timers: h.timers.size, callbacks: h.callbacks.size }, snapshot);
  const next = harness({ storage: h.storage }); assert.equal(next.context.BFDVideoSync.readDiagnostics().length, 5);
  assert.equal(next.context.BFDVideoSync.readDiagnostics()[0].pageKey, '/video/BV1KspF6iELH/?p=16');
});

test('storage denial does not affect automatic recovery and readonly installation failures remain native without retries', () => {
  const h = harness({ storageThrows: true }); h.controller.update(enabled, h.renderer); h.failDraw(); h.frame(1); h.timer(); h.frame(2);
  assert(h.controller.status().active); assert.equal(h.context.BFDVideoSync.readDiagnostics().length, 1);
  const locked = harness(); Object.defineProperty(locked.scheduler, 'start', { value: locked.native.start, writable: false });
  locked.controller.update(enabled, locked.renderer); assert(!locked.controller.status().active); assert.equal(locked.timers.size, 0);
  locked.controller.update(enabled, locked.renderer); assert.equal(locked.timers.size, 0);
  assert.equal(locked.context.BFDVideoSync.readDiagnostics().at(-1).recovery, 'unavailable');
});

test('video callbacks repair removed, changed or disabled sync CSS and lost ownership class without a new render loop', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.frame(1);
  const style = h.styles[0], original = style.textContent, appends = h.styleAppends();
  h.frame(1.04); assert.equal(h.styleAppends(), appends);
  style.remove(); style.textContent = 'unrelated'; style.sheet.disabled = true; h.classes.delete('bfd-video-sync');
  h.frame(1.08);
  assert(style.isConnected); assert.equal(style.textContent, original); assert.equal(style.sheet.disabled, false);
  assert(h.classes.has('bfd-video-sync')); assert.equal(h.styleAppends(), appends + 1);
  assert.equal(h.uiCallbacks.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.callbacks.size, 1);
  h.frame(1.12); assert.equal(h.styleAppends(), appends + 1);
  h.controller.update({ enabled: false }, h.renderer); assert(!style.isConnected); assert(!h.classes.has('bfd-video-sync'));
});

test('rebuilding a scheduler during fallback stops the old scheduler and safely attaches its replacement', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.failDraw(); h.frame(1);
  const before = h.stops(), oldTimer = h.timers.values().next().value;
  h.renderer.frameScheduler = { start() {}, stop() {}, startImmediate: h.native.immediate };
  h.controller.update(enabled, h.renderer); oldTimer(); h.frame(2);
  assert(h.controller.status().active); assert(h.stops() > before); assert.equal(h.timers.size, 0);
  assert.equal(h.controller.status().recovery.attempts, 0);
});

test('safe diagnostic reason enums distinguish context loss, frame time and native error names without storing raw messages', () => {
  const cases = [
    [Error('合成画布上下文丢失'), 'composite-context-lost'], [Error('文字画布上下文丢失'), 'text-context-lost'],
    [Error('视频帧时间不可用'), 'invalid-frame-time'],
    ...['InvalidStateError', 'SecurityError', 'QuotaExceededError', 'OperationError', 'TypeError'].map(name => [{ name, message: 'https://example.invalid/private?secret=comment-text' }, name]),
    [{ name: 'SecretCustomError', message: 'private comment text' }, 'draw-error']
  ];
  for (const [error, expected] of cases) {
    const h = harness(); h.controller.update(enabled, h.renderer); h.failDraw(1, error); h.frame(1);
    assert.equal(h.context.BFDVideoSync.readDiagnostics().at(-1).reason, expected);
    const reloaded = harness({ storage: h.storage }); assert.equal(reloaded.context.BFDVideoSync.readDiagnostics().at(-1).reason, expected);
    assert(!/private|secret|comment-text|https:/.test(h.storage.get('bfd-video-sync-diagnostics-v1')));
  }
});

test('a surface construction failure during the first automatic rebuild keeps its budget and the next rebuild succeeds', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.failDraw(); h.frame(1); h.failCreate();
  h.timer();
  assert(!h.controller.status().active); assert.equal(h.controller.status().recovery.phase, 'pending');
  assert.equal(h.controller.status().recovery.attempts, 1); assert.equal(h.delays.at(-1), 500);
  assert.equal(h.scheduler.start, h.native.start); assert(h.styles.every(style => !style.isConnected));
  assert.equal(h.classes.size, 0); assert.equal(h.callbacks.size, 0);
  assert.equal(h.context.BFDVideoSync.readDiagnostics().at(-1).stage, 'install');
  assert.equal(h.context.BFDVideoSync.readDiagnostics().at(-1).reason, 'composite-context-lost');
  h.timer(); h.frame(2);
  assert(h.controller.status().active); assert.equal(h.controller.status().recovery.phase, 'stabilizing');
  assert.equal(h.controller.status().recovery.attempts, 2); assert.equal(h.creates(), 3);
});

test('persistent surface construction failures consume exactly three automatic rebuilds and leave clean native playback', () => {
  const h = harness(); h.controller.update(enabled, h.renderer); h.failDraw(); h.frame(1); h.failCreate(10);
  for (let i = 0; i < 3; i++) h.timer();
  assert(!h.controller.status().active); assert.equal(h.controller.status().recovery.phase, 'exhausted');
  assert.equal(h.controller.status().recovery.attempts, 3); assert.deepEqual(h.delays, [150, 500, 1500]);
  assert.equal(h.creates(), 4); assert.equal(h.timers.size, 0); assert.equal(h.callbacks.size, 0);
  assert.equal(h.scheduler.start, h.native.start); assert.equal(h.clock.updateTime, h.native.update);
  assert(h.styles.every(style => !style.isConnected)); assert.equal(h.classes.size, 0);
  h.controller.update(enabled, h.renderer); h.event('canplay'); assert.equal(h.timers.size, 0);
});

test('readonly scheduler failure during rebuilding is unavailable, does not retry, and cleans partial installation', () => {
  const h = harness(), baseline = h.listenerCount(); h.controller.update(enabled, h.renderer); h.failDraw(); h.frame(1);
  Object.defineProperty(h.scheduler, 'start', { value: h.native.start, writable: false });
  h.timer();
  assert(!h.controller.status().active); assert.equal(h.controller.status().recovery.phase, 'unavailable');
  assert.equal(h.controller.status().recovery.attempts, 1); assert.equal(h.timers.size, 0); assert.equal(h.callbacks.size, 0);
  assert.equal(h.listenerCount(), baseline); assert(h.styles.every(style => !style.isConnected)); assert.equal(h.classes.size, 0);
  h.controller.update(enabled, h.renderer); assert.equal(h.timers.size, 0);
});

test('unsupported recovery preflight cleans waiting listeners and records unavailable instead of remaining retrying', () => {
  for (const unavailableAPI of ['rvfc', 'scheduler', 'compositor']) {
    const h = harness(), baseline = h.listenerCount(); h.controller.update(enabled, h.renderer); h.failDraw(); h.frame(1);
    if (unavailableAPI === 'rvfc') h.video.requestVideoFrameCallback = undefined;
    if (unavailableAPI === 'scheduler') h.clock.updateTime = undefined;
    if (unavailableAPI === 'compositor') h.context.BFDCompositor.create = undefined;
    h.timer();
    assert(!h.controller.status().active); assert.equal(h.controller.status().recovery.phase, 'unavailable');
    assert.equal(h.timers.size, 0); assert.equal(h.callbacks.size, 0); assert.equal(h.listenerCount(), baseline);
    assert.equal(h.context.BFDVideoSync.readDiagnostics().at(-1).recovery, 'unavailable');
    assert(h.styles.every(style => !style.isConnected)); assert.equal(h.classes.size, 0);
  }
});

test('healthy playback resets the remaining retry budget after pagehide/pageshow or emptied/loadeddata clears the recovery object', () => {
  for (const transition of ['pagehide', 'emptied']) {
    const h = harness(); h.controller.update(enabled, h.renderer); h.failDraw(); h.frame(1); h.timer(); h.frame(2);
    assert.equal(h.controller.status().recovery.attempts, 1);
    if (transition === 'pagehide') { h.rootEvent('pagehide'); h.rootEvent('pageshow'); }
    else {
      h.event('emptied'); h.event('loadeddata');
      // hook.js invokes update from its document-level loadeddata listener.
      h.controller.update(enabled, h.renderer);
    }
    assert(h.controller.status().active); assert.equal(h.context.BFDVideoSync.readStatus().recovery.phase, 'stabilizing');
    for (let i = 0; i < 60; i++) h.frame(3 + i / 24);
    assert.equal(h.context.BFDVideoSync.readStatus().recovery.stableFrames, 60);
    h.video.seeking = true; h.event('seeking'); assert.equal(h.controller.status().recovery.stableFrames, 0);
    h.video.seeking = false; h.event('seeked');
    for (let i = 0; i < 119; i++) h.frame(10 + i / 24);
    assert.equal(h.controller.status().recovery.attempts, 1); assert.equal(h.controller.status().recovery.stableFrames, 119);
    h.frame(15); assert.equal(h.controller.status().recovery.attempts, 0); assert.equal(h.controller.status().recovery.phase, 'idle');
    h.failDraw(); h.frame(15.04); assert.equal(h.delays.at(-1), 150);
  }
});

test('a throwing native scheduler resume cannot prevent bounded recovery or explicit disable cleanup', () => {
  const h = harness();
  h.scheduler.start = () => { throw Error('native scheduler resume failed'); };
  h.controller.update(enabled, h.renderer); h.failDraw();
  assert.doesNotThrow(() => h.frame(1));
  assert(!h.controller.status().active); assert.equal(h.controller.status().recovery.phase, 'pending');
  assert.equal(h.timers.size, 1); assert.equal(h.context.BFDVideoSync.readDiagnostics().at(-1).reason, 'draw-error');
  h.timer(); h.frame(2); assert(h.controller.status().active); assert.equal(h.controller.status().recovery.attempts, 1);
  assert.doesNotThrow(() => h.controller.update({ enabled: false }, h.renderer));
  assert.equal(h.timers.size, 0); assert.equal(h.callbacks.size, 0); assert.equal(h.classes.size, 0);
});
