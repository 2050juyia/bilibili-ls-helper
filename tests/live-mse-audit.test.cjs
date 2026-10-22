const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../scripts/live-mse-audit.js'), 'utf8');
const concat = (...parts) => Buffer.concat(parts.flat());
const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32BE(value >>> 0); return b; };
const u64 = value => concat(u32(Math.floor(value / 4294967296)), u32(value % 4294967296));
function box(type, ...payload) { const body = concat(...payload); return concat(u32(body.length + 8), Buffer.from(type), body); }
function largeBox(type, ...payload) { const body = concat(...payload); return concat(u32(1), Buffer.from(type), u64(body.length + 16), body); }
function full(type, version, flags, ...payload) { return box(type, Buffer.from([version, flags >> 16 & 255, flags >> 8 & 255, flags & 255]), ...payload); }
function init({ scale = 90000, defaultDuration = 3000, audio = false, version = 0 } = {}) {
  function track(id, kind, timescale, codec) {
    const dates = version ? concat(u64(0), u64(0)) : concat(u32(0), u32(0));
    return box('trak', full('tkhd', version, 0, dates, u32(id), u32(0)), box('mdia', full('mdhd', version, 0, dates, u32(timescale), u32(0)), full('hdlr', 0, 0, u32(0), Buffer.from(kind)),
      box('minf', box('stbl', full('stsd', 0, 0, u32(1), box(codec, Buffer.alloc(8)))))));
  }
  const defaults = defaultDuration === null ? [] : [full('trex', 0, 0, u32(1), u32(1), u32(defaultDuration), u32(0), u32(0))];
  return box('moov', track(1, 'vide', scale, 'av01'), ...(audio ? [track(2, 'soun', 48000, 'mp4a')] : []), box('mvex', defaults));
}
function fragment({ count = 30, duration, defaultDuration, base = 0, version = 0, cto, track = 1, noTfdt = false, extended = false, zeroMdat = false } = {}) {
  const tfhd = full('tfhd', 0, defaultDuration === undefined ? 0 : 8, u32(track), ...(defaultDuration === undefined ? [] : [u32(defaultDuration)]));
  const tfdt = noTfdt ? [] : [full('tfdt', version, 0, version ? u64(base) : u32(base))];
  const samples = [];
  for (let i = 0; i < count; i++) { if (duration !== undefined) samples.push(u32(Array.isArray(duration) ? duration[i] : duration)); if (cto !== undefined) samples.push(u32(Array.isArray(cto) ? cto[i] : cto)); }
  const trun = full('trun', cto !== undefined ? 1 : 0, (duration !== undefined ? 0x100 : 0) | (cto !== undefined ? 0x800 : 0), u32(count), samples);
  const traf = box('traf', tfhd, tfdt, trun), moof = (extended ? largeBox : box)('moof', traf);
  return concat(moof, zeroMdat ? concat(u32(0), Buffer.from('mdat'), Buffer.alloc(100)) : box('mdat', Buffer.alloc(100)));
}
function harness(options = {}) {
  let time = 0, serial = 0, nativeRequests = 0, nativeAppends = 0;
  const pending = new Map(), calls = [], allBuffers = [], sentinel = {}, failure = new Error('native failure with private source');
  class SB {
    constructor() { this.events = new Map(); this.mode = 'segments'; this.timestampOffset = 0; this.appendWindowStart = 0; this.appendWindowEnd = Infinity; this.ranges = []; this.updating = false; allBuffers.push(this); }
    get buffered() { const list = this.ranges; return { length: list.length, start: i => list[i][0], end: i => list[i][1] }; }
    addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(fn); }
    removeEventListener(name, fn) { this.events.get(name)?.delete(fn); }
    emit(name) { for (const fn of [...(this.events.get(name) || [])]) fn({ type: name }); }
    appendBuffer(...args) { nativeAppends++; calls.push({ receiver: this, args }); if (this.throwNext) { this.throwNext = false; throw failure; } this.updating = true; return sentinel; }
  }
  class MS { constructor() { this.sourceBuffers = []; } addSourceBuffer(mime) { const sb = new SB(); this.sourceBuffers.push(sb); return sb; } }
  class ObjectURL extends URL { static createObjectURL(object) { return 'blob:https://live.bilibili.com/private-source-' + (++serial); } }
  class Video {
    constructor() { this.currentSrc = this.src = ''; this.currentTime = 0; this.paused = false; this.isConnected = true; this.videoWidth = 1920; this.videoHeight = 1080; this.srcObject = null; }
    getVideoPlaybackQuality() { return { totalVideoFrames: 90, droppedVideoFrames: 0 }; }
    requestVideoFrameCallback(callback) { nativeRequests++; const id = ++serial; pending.set(id, { video: this, callback }); return id; }
    cancelVideoFrameCallback(id) { pending.delete(id); }
  }
  const video = new Video(), forbidden = () => { throw Error('audit must not create a clock or fetch'); };
  const originals = { append: SB.prototype.appendBuffer, add: MS.prototype.addSourceBuffer, url: ObjectURL.createObjectURL, request: Video.prototype.requestVideoFrameCallback, cancel: Video.prototype.cancelVideoFrameCallback };
  const context = vm.createContext({ URL: ObjectURL, MediaSource: MS, SourceBuffer: SB, HTMLVideoElement: Video, performance: { now: () => time },
    livePlayer: { getVideoEl: () => video }, document: { querySelector: () => video }, setTimeout: forbidden, setInterval: forbidden, requestAnimationFrame: forbidden, fetch: forbidden });
  let preexisting;
  if (options.preexisting) { const media = new MS(); video.currentSrc = ObjectURL.createObjectURL(media); preexisting = media.addSourceBuffer('video/mp4'); }
  vm.runInContext(source, context);
  function attach() { const media = new MS(), url = ObjectURL.createObjectURL(media); video.currentSrc = video.src = url; return { media, sb: media.addSourceBuffer('video/mp4; codecs="av01.0.08M.08"') }; }
  function complete(sb, ranges, error = false) { if (ranges) sb.ranges = ranges; if (error) sb.emit('error'); sb.updating = false; sb.emit('updateend'); }
  function append(sb, data, accepted) { const result = sb.appendBuffer(data); complete(sb, accepted); return result; }
  function fire(mediaTime, at = 0, presented = 1) { const item = pending.entries().next().value; assert(item, 'no callback registered by caller'); pending.delete(item[0]); time = at;
    return item[1].callback.call(item[1].video, at, { mediaTime, presentedFrames: presented, expectedDisplayTime: at + 16, presentationTime: at - 2 }); }
  const s = {}; let draw;
  function paint() { time += 2; return draw?.(); }
  function formal(now, metadata) { return paint(s, now, metadata, true); }
  return { context, video, SB, MS, ObjectURL, Video, originals, calls, allBuffers, pending, sentinel, failure, preexisting,
    api: context.__bfdMSEAudit, attach, append, complete, fire, formal, setDraw: fn => { draw = fn; },
    requests: () => nativeRequests, appends: () => nativeAppends, setTime: value => { time = value; } };
}
function near(actual, expected) { assert(Math.abs(actual - expected) < 1e-7, actual + ' != ' + expected); }

test('actual bound MSE input parses 30 FPS video and only matches after successful updateend and buffered coverage', () => {
  const h = harness(), { sb } = h.attach(); h.append(sb, init());
  const data = fragment(); assert.equal(sb.appendBuffer(data), h.sentinel); h.video.currentTime = 0.5;
  assert.equal(h.api.snapshot().binding.bound, true); assert.equal(h.api.snapshot().matches.length, 0);
  h.complete(sb, [[0, 1]]); const snap = h.api.snapshot();
  assert.equal(snap.matches.length, 1); assert.equal(snap.matches[0].sampleFPS, 30); assert.equal(snap.matches[0].samples, 30); assert.equal(snap.matches[0].durationTicks, 90000);
  assert.equal(snap.matches[0].buffered, 'full'); assert.equal(snap.matches[0].appendCompleted, true); assert.equal(h.calls.at(-1).args[0], data);
  assert(!JSON.stringify(snap).includes('private-source')); assert.equal(h.requests(), 0);
});
test('trex, tfhd override and per-sample trun durations distinguish 30/60/120 without assuming a default FPS', () => {
  for (const [args, fps] of [[{}, 30], [{ defaultDuration: 1500 }, 60], [{ defaultDuration: 3000, duration: 750 }, 120]]) {
    const h = harness(), { sb } = h.attach(); h.append(sb, init()); h.append(sb, fragment(args), [[0, 2]]); h.video.currentTime = 0.01;
    assert.equal(h.api.snapshot().matches[0].sampleFPS, fps);
  }
  const h = harness(), { sb } = h.attach(); h.append(sb, init({ defaultDuration: null })); h.append(sb, fragment(), [[0, 2]]);
  assert.equal(h.api.snapshot().mse.latestSampleFPS, null); assert.equal(h.api.snapshot().mse.latestReason, 'missing-sample-duration'); assert.equal(h.api.snapshot().matches.length, 0);
});
test('64-bit tfdt, version-one init dates, signed CTO and timestampOffset map decoded input to presentation media time', () => {
  const h = harness(), { sb } = h.attach(), base = 4294967296 + 90000; sb.timestampOffset = 2;
  h.append(sb, init({ version: 1 })); h.append(sb, fragment({ count: 12, duration: 1500, base, version: 1, cto: -750, extended: true }), [[base / 90000 + 1, base / 90000 + 4]]);
  h.video.currentTime = (base - 750) / 90000 + 2.1; const entry = h.api.snapshot().matches[0];
  assert(entry); near(entry.rawStart, (base - 750) / 90000 + 2); near(entry.rawEnd, (base + 18000 - 750) / 90000 + 2);
  assert.equal(entry.baseDecodeTime, base); assert.equal(entry.hasCTO, true); assert.equal(entry.sampleFPS, 60);
});
test('sample timestamps must overlap the played media time; prebuffered future 60 FPS is not current-input proof', () => {
  const h = harness(), { sb } = h.attach(); h.append(sb, init()); h.append(sb, fragment({ base: 900000, count: 12, duration: 1500 }), [[10, 10.2]]);
  h.video.currentTime = 5; assert.equal(h.api.snapshot().mse.latestSampleFPS, 60); assert.equal(h.api.snapshot().matches.length, 0);
  h.video.currentTime = 10.1; assert.equal(h.api.snapshot().matches.length, 1);
});
test('audio tracks are excluded and missing tfdt may chain only after a known valid video decode endpoint', () => {
  const h = harness(), { sb } = h.attach(); h.append(sb, init({ audio: true })); h.append(sb, fragment({ track: 2 }), []); assert.equal(h.api.snapshot().mse.retainedVideoSegments, 0);
  h.append(sb, fragment({ noTfdt: true }), []); assert.equal(h.api.snapshot().mse.latestReason, 'unanchored-tfdt'); assert.equal(h.api.snapshot().matches.length, 0);
  h.append(sb, fragment(), [[0, 1]]); h.append(sb, fragment({ noTfdt: true }), [[0, 2]]); h.video.currentTime = 1.5;
  assert.equal(h.api.snapshot().matches[0].baseDecodeTime, 90000);
});
test('appendWindow, partial buffering and asynchronous append failure are explicit instead of assuming all input was accepted', () => {
  const h = harness(), { sb } = h.attach(); h.append(sb, init()); sb.appendWindowStart = 0.2; sb.appendWindowEnd = 0.8;
  h.append(sb, fragment(), [[0.2, 0.4]]); h.video.currentTime = 0.3; assert.equal(h.api.snapshot().mse.partialSegments, 1); assert.equal(h.api.snapshot().matches.length, 0);
  h.video.currentTime = 0.7; assert.equal(h.api.snapshot().matches.length, 0);
  const broken = harness(), other = broken.attach().sb; broken.append(other, init()); other.appendBuffer(fragment()); broken.complete(other, [[0, 1]], true); broken.video.currentTime = 0.5;
  assert.equal(broken.api.snapshot().matches.length, 0); assert.equal(broken.api.snapshot().errors['append-error'], 1);
});
test('sequence mode and missing track timescale never fabricate a media-time binding or source FPS', () => {
  const h = harness(), { sb } = h.attach(); sb.mode = 'sequence'; h.append(sb, init()); h.append(sb, fragment(), [[0, 1]]); h.video.currentTime = 0.5;
  assert.equal(h.api.snapshot().mse.latestReason, 'sequence-mode-unmapped'); assert.equal(h.api.snapshot().matches.length, 0);
  const missing = harness(), next = missing.attach().sb; missing.append(next, init({ scale: 0 })); missing.append(next, fragment(), [[0, 1]]);
  assert.equal(missing.api.snapshot().mse.latestSampleFPS, null); assert.equal(missing.api.snapshot().errors['invalid-track-timescale'], 1);
});
test('split metadata headers, nonzero ArrayBufferView offsets, extended boxes and size-zero mdat are handled without parsing media payload', () => {
  const h = harness(), { sb } = h.attach(), metadata = init(); h.append(sb, metadata.subarray(0, 5)); h.append(sb, metadata.subarray(5, 23)); h.append(sb, metadata.subarray(23));
  const bytes = fragment({ duration: 1500, extended: true, zeroMdat: true }), padded = concat(Buffer.alloc(17, 255), bytes, Buffer.alloc(7, 255)), view = new Uint8Array(padded.buffer, padded.byteOffset + 17, bytes.length);
  h.append(sb, view, [[0, 1]]); h.video.currentTime = 0.1; assert.equal(h.api.snapshot().matches[0].sampleFPS, 60); assert.equal(h.calls.at(-1).args[0], view);
  assert.equal(Object.keys(h.api.snapshot().errors).length, 0);
});
test('native append exceptions and return values are unchanged and parse errors never affect native playback', () => {
  const h = harness(), { sb } = h.attach(); sb.throwNext = true;
  assert.throws(() => sb.appendBuffer(init()), error => error === h.failure); assert.equal(h.api.snapshot().callbacks.appendThrows, 1); assert.equal(h.api.snapshot().callbacks.appends, 0);
  assert.equal(h.append(sb, init()), h.sentinel);
  const huge = concat(u32(1), Buffer.from('moof'), u64(9007199254740992)); assert.equal(h.append(sb, huge), h.sentinel); assert.equal(h.api.snapshot().errors['unsafe-integer'], 1);
});
test('preexisting or worker MSE without a createObjectURL mapping stays explicitly unbound', () => {
  const h = harness({ preexisting: true }); h.append(h.preexisting, init()); h.append(h.preexisting, fragment(), [[0, 1]]); h.video.currentTime = 0.5;
  const snap = h.api.snapshot(); assert.equal(snap.binding.bound, false); assert.match(snap.binding.reason, /unbound-or-worker/); assert.equal(snap.matches.length, 0); assert.equal(snap.mse.latestSampleFPS, null);
});
test('only the existing formal plugin callback is wrapped and callback timing detects a 30/60 notification gap with no extra clock', () => {
  const h = harness(); let called = 0;
  h.video.requestVideoFrameCallback(function unrelated() { called++; }); h.fire(0, 0); assert.equal(h.api.snapshot().callbacks.retainedFrames, 0);
  h.setDraw(() => { called++; return h.sentinel; }); h.video.requestVideoFrameCallback(h.formal); assert.equal(h.fire(1, 1000, 60), h.sentinel);
  h.video.requestVideoFrameCallback(h.formal); h.fire(1 + 1 / 30, 1000 + 1000 / 30, 62);
  const snap = h.api.snapshot(); assert.equal(h.requests(), 3); assert.equal(called, 3); near(snap.callbacks.callbackFPS, 30); near(snap.callbacks.presentedFPS, 60);
  assert.equal(snap.callbacks.presentedStepHistogram[2], 1); assert.equal(snap.callbacks.callbackCostMs.mean, 2); assert.equal(snap.callbacks.maxPending, 1); assert.equal(snap.callbacks.pending, 0);
});
test('restore removes listeners and owned patches, preserves outside replacements and lets already-pending callbacks pass through', () => {
  const h = harness(), { sb } = h.attach(); h.append(sb, init()); let called = 0; h.setDraw(() => { called++; }); h.video.requestVideoFrameCallback(h.formal);
  const external = function outside() {}; h.SB.prototype.appendBuffer = external; h.api.restore(); h.api.restore();
  assert.equal(h.SB.prototype.appendBuffer, external); assert.equal(h.MS.prototype.addSourceBuffer, h.originals.add); assert.equal(h.ObjectURL.createObjectURL, h.originals.url); assert.equal(h.Video.prototype.requestVideoFrameCallback, h.originals.request);
  assert([...sb.events.values()].every(values => values.size === 0)); h.fire(1, 1000); assert.equal(called, 1); assert.equal(h.api.snapshot().callbacks.retainedFrames, 0); assert.equal(h.api.snapshot().running, false);
});
test('retained input timing and callback windows are bounded and snapshots export neither original bytes nor private URLs', () => {
  const h = harness(), { sb } = h.attach(); h.append(sb, init());
  for (let i = 0; i < 245; i++) h.append(sb, fragment({ base: i * 90000 }), [[0, 245]]);
  for (let i = 0; i < 7205; i++) { h.video.requestVideoFrameCallback(h.formal); h.fire(i / 60, i * 1000 / 60, i + 1); }
  const snap = h.api.snapshot(); assert.equal(snap.mse.retainedVideoSegments, 240); assert.equal(snap.callbacks.retainedFrames, 7200); assert(snap.matches.length <= 2);
  assert(!/private-source|native failure|ArrayBuffer|data:|blob:https/.test(JSON.stringify(snap)));
});
test('preexisting buffered overlap and later replacement make both candidate timelines ambiguous rather than consumer proof', () => {
  const h = harness(), { sb } = h.attach(); h.append(sb, init()); h.append(sb, fragment(), [[0, 1]]); h.video.currentTime = 0.5;
  assert.equal(h.api.snapshot().matches.length, 1);
  h.append(sb, fragment({ count: 60, duration: 1500 }), [[0, 1]]);
  assert.equal(h.api.snapshot().mse.latestSampleFPS, 60); assert.equal(h.api.snapshot().mse.ambiguousSegments, 2); assert.equal(h.api.snapshot().matches.length, 0);
});
test('header-only moof cannot become buffered proof until its media payload has actually arrived', () => {
  const h = harness(), { sb } = h.attach(); h.append(sb, init()); const data = fragment(), moofSize = data.readUInt32BE(0);
  h.append(sb, data.subarray(0, moofSize), [[0, 1]]); h.video.currentTime = 0.5; assert.equal(h.api.snapshot().matches.length, 0);
  h.append(sb, data.subarray(moofSize), [[0, 1]]); assert.equal(h.api.snapshot().matches[0].mdatObserved, true);
});
test('abort drops partial metadata and requires a new init before collecting subsequent video timing', () => {
  const h = harness(), { sb } = h.attach(), metadata = init(); h.append(sb, metadata.subarray(0, 25)); sb.emit('abort'); h.complete(sb);
  h.append(sb, fragment(), [[0, 1]]); assert.equal(h.api.snapshot().mse.boundVideoSegments, 0);
  h.append(sb, init({ defaultDuration: 1500 })); h.append(sb, fragment(), [[0, 1]]); h.video.currentTime = 0.5;
  assert.equal(h.api.snapshot().mse.latestSampleFPS, 60); assert.equal(h.api.snapshot().errors['append-abort'], 1);
});
