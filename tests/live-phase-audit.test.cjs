const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../scripts/live-phase-audit.js'), 'utf8');
function harness(options = {}) {
  let clock = 0, next = 0, presented = 0, draw = () => {}, pendingId = 0;
  const native = new Map(), order = [], cancels = [], events = new Map(), rootEvents = new Map();
  const eventApi = target => ({ addEventListener(name, fn) { if (!target.has(name)) target.set(name, new Set()); target.get(name).add(fn); }, removeEventListener(name, fn) { target.get(name)?.delete(fn); } });
  const request = function (fn) { order.push('request'); native.set(++next, fn); return next; }, cancel = function (id) { cancels.push(id); native.delete(id); };
  const video = { ...eventApi(events), paused: false, ended: false, seeking: false, readyState: 4, requestVideoFrameCallback: request, cancelVideoFrameCallback: cancel };
  const context = { performance: { now: () => clock }, Date, console, ...eventApi(rootEvents) }; vm.createContext(context); vm.runInContext(source, context);
  function formal(at, metadata) { /* paint(s, now, metadata, true) */ pendingId = 0; order.push('draw'); draw(at, metadata); }
  const rearm = () => { pendingId = video.requestVideoFrameCallback(formal); return pendingId; };
  const frame = () => { const [id, fn] = native.entries().next().value || []; assert(fn, 'no native callback'); native.delete(id); clock += 1000 / 60; fn(clock, { mediaTime: ++presented / 60, presentedFrames: presented, presentationTime: clock - 1, expectedDisplayTime: clock + 3, processingDuration: .001, width: 640, height: 360, unsafe: 'not-recorded' }); };
  return { context, video, native, order, cancels, events, rootEvents, request, cancel, formal, rearm, frame, setDraw(fn) { draw = fn; }, advance(ms) { clock += ms; }, pending: () => pendingId,
    install: opts => context.BFDLivePhaseAudit.install(video, opts), event(name) { for (const fn of [...(events.get(name) || [])]) fn(); }, rootEvent(name) { for (const fn of [...(rootEvents.get(name) || [])]) fn(); } };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('install does not add an observer callback; next natural formal rearm hands over, retaining native IDs', () => {
  const h = harness(); h.setDraw(() => h.rearm()); h.rearm(); const initial = h.pending(), p = h.install({ mode: 'late' });
  assert.equal(h.native.size, 1); assert.equal(p.read().counts.nativeRequests, 0); h.frame(); assert.equal(h.native.size, 1); assert(h.pending() > initial);
  h.order.length = 0; h.frame(); assert.deepEqual(h.order, ['draw', 'request']); assert.equal(h.native.size, 1); assert.equal(p.read().counts.callbacks, 1); assert.equal(p.read().counts.maxOwnedPending, 1);
  assert(h.native.has(h.pending())); assert.equal(p.read().boundaries.outerFormalAuditMayStopMatchingPump, true);
});

test('early reserves one native slot before draw; rearm fills it without adding a second native request', () => {
  const h = harness(), p = h.install({ mode: 'early' }); h.setDraw(() => { assert.equal(h.native.size, 1); h.advance(12); h.rearm(); }); h.rearm(); h.order.length = 0;
  h.frame(); assert.deepEqual(h.order, ['request', 'draw']); assert.equal(h.native.size, 1); let row = p.read().rows[0]; assert.equal(row.nextRegisteredAt, row.enteredAt); assert.equal(row.durationMs, 12); assert.equal(row.rearmCalledAt - row.enteredAt, 12);
  p.setMode('late'); h.setDraw(() => { assert.equal(h.native.size, 0); h.advance(8); h.rearm(); }); h.frame(); row = p.read().rows[1]; assert.equal(row.nextRegisteredAt - row.enteredAt, 8); assert.equal(row.mode, 'late');
  h.frame(); assert.equal(p.read().phases[1].presentedSteps['1'], 1);
});

test('a callback that does not rearm cancels the early reservation without introducing a clock', () => {
  const h = harness(), p = h.install({ mode: 'early' }); h.rearm(); h.frame(); assert.equal(h.native.size, 0); assert.equal(p.read().ownedPending, 0); assert.equal(p.read().counts.noRearm, 1); assert.equal(h.cancels.length, 1);
});

test('original callback errors propagate unchanged and clean even a filled early reservation', () => {
  const h = harness(), p = h.install({ mode: 'early' }), fault = new TypeError('private detail not recorded'); h.setDraw(() => { h.rearm(); throw fault; }); h.rearm();
  assert.throws(() => h.frame(), error => error === fault); assert.equal(h.native.size, 0); assert.equal(p.read().counts.callbackErrors, 1); assert(!JSON.stringify(p.read()).includes('private detail'));
});

test('pause, seeking, emptied, ended and pagehide cancel owned native slots', () => {
  for (const name of ['pause', 'seeking', 'emptied', 'ended', 'pagehide']) {
    const h = harness(), p = h.install({ mode: 'early' }); h.setDraw(() => h.rearm()); h.rearm(); h.frame();
    if (name === 'pagehide') h.rootEvent(name); else h.event(name);
    assert.equal(h.native.size, 0, name); assert.equal(p.read().ownedPending, 0); p.restore(); assert(p.read().detached); assert([...h.events.values()].every(set => set.size === 0));
  }
});

test('cancel uses the real native ID and delegates unrelated cancellation', () => {
  const h = harness(), p = h.install({ mode: 'early' }); const id = h.rearm(); assert(h.native.has(id)); h.video.cancelVideoFrameCallback(id); assert.equal(h.native.size, 0); assert.equal(p.read().ownedPending, 0);
  h.video.cancelVideoFrameCallback(987); assert.equal(h.cancels.at(-1), 987);
});

test('restore hands off the existing requested callback once, then the untouched player chain continues', () => {
  const h = harness(), p = h.install({ mode: 'early' }); h.setDraw(() => h.rearm()); const id = h.rearm(); const beforeRestore = p.restore();
  assert.equal(beforeRestore.handoffPending, 1); assert.equal(h.video.requestVideoFrameCallback, h.request); assert(h.native.has(id)); h.frame();
  assert(p.read().detached); assert.equal(p.read().counts.handoffs, 1); assert.equal(p.read().counts.callbacks, 0); assert.equal(h.video.cancelVideoFrameCallback, h.cancel); assert.equal(h.native.size, 1); h.frame(); assert.equal(h.native.size, 1);
});

test('cancelling an in-flight handoff finalizes restore without calling the player callback', () => {
  const h = harness(), p = h.install({ mode: 'early' }); const id = h.rearm(); p.restore(); h.video.cancelVideoFrameCallback(id);
  assert(p.read().detached); assert.equal(h.native.size, 0); assert.equal(h.video.cancelVideoFrameCallback, h.cancel); assert.equal(p.read().counts.handoffs, 0);
});

test('wrappers installed later are not overwritten; restored inner wrappers only pass through', () => {
  const h = harness(), p = h.install({ mode: 'early' }); h.setDraw(() => h.rearm()); h.rearm(); const innerRequest = h.video.requestVideoFrameCallback, innerCancel = h.video.cancelVideoFrameCallback;
  const outerRequest = function () { return Reflect.apply(innerRequest, this, arguments); }, outerCancel = function () { return Reflect.apply(innerCancel, this, arguments); };
  h.video.requestVideoFrameCallback = outerRequest; h.video.cancelVideoFrameCallback = outerCancel; p.restore(); h.frame();
  assert.equal(h.video.requestVideoFrameCallback, outerRequest); assert.equal(h.video.cancelVideoFrameCallback, outerCancel); assert(p.read().detached); assert.equal(h.native.size, 1); h.frame(); assert.equal(p.read().counts.nativeRequests, 1);
});

test('foreign callbacks preserve native semantics and do not enter phase statistics', () => {
  const h = harness(), p = h.install({ mode: 'early' }); let called = 0; const id = h.video.requestVideoFrameCallback(function () { called++; }); assert(h.native.has(id)); h.frame();
  assert.equal(called, 1); assert.equal(p.read().counts.foreignRequests, 1); assert.equal(p.read().counts.callbacks, 0); assert.equal(p.read().counts.nativeRequests, 0);
});

test('records and phase summaries stay bounded and only copy safe numeric metadata', () => {
  const h = harness(), p = h.install({ mode: 'late', limit: 16 }); h.setDraw(() => h.rearm()); h.rearm();
  for (let i = 0; i < 40; i++) { if (i % 2 === 0) p.setMode(i % 4 === 0 ? 'early' : 'late'); h.frame(); }
  assert.equal(p.read().rows.length, 16); assert.equal(p.read().phases.length, 12); assert(!JSON.stringify(p.read()).includes('not-recorded'));
  const snapshot = p.read(); snapshot.rows[0].mediaTime = 999; assert.notEqual(p.read().rows[0].mediaTime, 999);
});

test('a nonwritable cancel method rolls back the partial installation', () => {
  const h = harness(); Object.defineProperty(h.video, 'cancelVideoFrameCallback', { value: h.cancel, writable: false, configurable: true });
  assert.throws(() => h.install(), /read only|not writable|assign/i); assert.equal(h.video.requestVideoFrameCallback, h.request); assert.equal([...h.events.values()].flatMap(set => [...set]).length, 0);
});

test('an existing MSE-style wrapper may stop classifying formal frames; probe records its own native metadata', () => {
  const h = harness(); let outerFormalCalls = 0;
  h.video.requestVideoFrameCallback = function (fn) { if (Function.prototype.toString.call(fn).includes('paint(s, now, metadata, true)')) outerFormalCalls++; return h.request.call(this, (at, metadata) => fn(at, metadata)); };
  h.setDraw(() => h.rearm()); h.rearm(); const p = h.install({ mode: 'early' }); h.frame(); h.frame();
  assert.equal(outerFormalCalls, 1); assert.equal(p.read().counts.callbacks, 1); assert.equal(p.read().rows[0].presentedFrames, 2); assert.equal(p.read().rows[0].mediaTime, 2 / 60); assert(p.read().boundaries.recordsAreProbeNativeCallbacks);
});

test('overlapping formal requests are explicitly rejected without a second owned native callback', () => {
  const h = harness(), p = h.install(); const first = h.rearm(); assert.throws(() => h.rearm(), /Concurrent formal/); assert.equal(h.native.size, 1); assert(h.native.has(first)); assert.equal(p.read().counts.duplicateRequests, 1);
});
