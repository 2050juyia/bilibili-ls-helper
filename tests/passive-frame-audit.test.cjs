const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), crypto = require('node:crypto');
const source = fs.readFileSync(require.resolve('../scripts/passive-frame-audit.js'), 'utf8');
function harness() {
  let time = 0, requests = 0, nextId = 0;
  const pending = new Map();
  class Video {
    constructor() { this.videoWidth = 1920; this.videoHeight = 1080; this.playbackRate = 1; }
    requestVideoFrameCallback(callback) { requests++; pending.set(++nextId, callback); return nextId; }
  }
  class Context2D {
    constructor(canvas) { this.canvas = canvas; }
    drawImage() { time += 2; }
    fillText() { time += 3; }
    strokeText() { time += 2; }
    clearRect() { time += 1; }
    fillRect() { time += 1; }
    strokeRect() { time += 1; }
  }
  class OffscreenContext2D extends Context2D {}
  class OffscreenCanvas { transferToImageBitmap() { time += 4; return {}; } }
  class BitmapContext { transferFromImageBitmap() { time += 5; } }
  const video = new Video(), canvas = { width: 2560, height: 1440, classList: { contains: value => value === 'bfd-video-composite' } };
  const buffer = new OffscreenCanvas(); buffer.width = 2560; buffer.height = 1440;
  const forbidden = () => { throw new Error('Audit must not register a timer or animation callback'); };
  const context = vm.createContext({ HTMLVideoElement: Video, CanvasRenderingContext2D: Context2D,
    OffscreenCanvasRenderingContext2D: OffscreenContext2D, OffscreenCanvas, ImageBitmapRenderingContext: BitmapContext,
    performance: { now: () => time }, crypto: crypto.webcrypto, TextEncoder, Date,
    setTimeout: forbidden, setInterval: forbidden, requestAnimationFrame: forbidden,
    document: { querySelector: selector => selector === '.bfd-video-composite' ? canvas : video },
    BFDCompositor: { create: function create() { const textCache = new WeakMap(); return textCache; } } });
  vm.runInContext(source, context);
  return { context, video, canvas, buffer, ctx2d: new OffscreenContext2D(buffer), bitmap: new BitmapContext(),
    api: context.BFDPassiveFrameAudit, requests: () => requests, pending,
    fire(media, at, presented = Math.round(media * 24)) {
      const first = pending.entries().next().value; assert(first, 'caller must register its own callback');
      pending.delete(first[0]); time = at;
      return first[1](at, { mediaTime: media, presentedFrames: presented, expectedDisplayTime: at + 5,
        presentationTime: at - 1, processingDuration: 0.003, width: 1920, height: 1080 });
    } };
}
test('passive audit does not register frames and only records existing callbacks named frame', async () => {
  const h = harness(); h.api.start({ from: 1098, to: 1115, label: 'existing-page' });
  assert.equal(h.requests(), 0);
  let called = 0;
  h.video.requestVideoFrameCallback(function playerObserver() { called++; });
  h.fire(1098, 0);
  assert.equal((await h.api.report()).summary.callbacks, 0);
  h.video.requestVideoFrameCallback(function frame() {
    called++; h.ctx2d.drawImage(h.video); h.ctx2d.fillText('text', 0, 0);
    h.buffer.transferToImageBitmap(); h.bitmap.transferFromImageBitmap({});
  });
  h.fire(1098.041, 42);
  assert.equal(called, 2); assert.equal(h.requests(), 2); assert.equal(h.pending.size, 0);
  const report = await h.api.report({ includeRows: true });
  assert.equal(report.summary.callbacks, 1); assert.equal(report.rows[0].sourceWidth, 1920);
  assert.equal(report.rows[0].backing.width, 2560); assert.equal(report.rows[0].compositionBacking.height, 1440);
  assert.equal(report.rows[0].ops.videoCopy, 2); assert.equal(report.rows[0].ops.fillText, 3);
  assert.equal(report.rows[0].ops.bitmap, 4); assert.equal(report.rows[0].ops.present, 5);
  assert.equal(report.rows[0].callbackMs, 14);
  assert.equal(report.perSecond[0].second, 1098); assert.equal(report.ops.videoCopy.calls, 1);
  assert(!Object.hasOwn(await h.api.report(), 'rows'));
  h.api.dispose();
});
test('time window ends without changing or swallowing the original callback', async () => {
  const h = harness(); h.api.start({ from: 1098, to: 1099 }); let calls = 0;
  function frame() { calls++; }
  for (const [media, at] of [[1097, 0], [1098, 42], [1098.5, 542], [1099.1, 1142], [1098.2, 1184]]) {
    h.video.requestVideoFrameCallback(frame); h.fire(media, at);
  }
  const report = await h.api.report({ rows: true });
  assert.equal(calls, 5); assert.equal(h.requests(), 5);
  assert.equal(report.stopReason, 'range-complete'); assert.equal(report.rows.length, 2);
  assert(report.rows.every(row => row.mediaTime >= 1098 && row.mediaTime <= 1099));
  h.api.dispose();
});
test('rewinds and long gaps stop a sample instead of mixing different playback segments', async () => {
  for (const [nextMedia, at, reason] of [[1098.1, 42, 'media-time-backwards'], [1098.6, 2001, 'callback-gap'], [1101, 42, 'media-time-jump']]) {
    const h = harness(); h.api.start({ from: 1098, to: 1115 }); let calls = 0;
    function frame() { calls++; }
    h.video.requestVideoFrameCallback(frame); h.fire(1098.5, 0);
    h.video.requestVideoFrameCallback(frame); h.fire(nextMedia, at);
    const report = await h.api.report();
    assert.equal(report.stopReason, reason); assert.equal(report.summary.callbacks, 1); assert.equal(calls, 2);
    h.api.dispose();
  }
});
test('factory hash is captured at start and metrics distinguish style caches from raster caches', async () => {
  const h = harness();
  vm.runInContext('BFDCompositor.create = function create() {\r\n const textCache = new WeakMap();\r\n return textCache;\r\n};', h.context);
  const factory = h.context.BFDCompositor.create;
  h.api.start({ from: 1098, to: 1115 });
  h.context.BFDCompositor.create = function create() { const paintSprite = true, maxSpriteBytes = 4; return [paintSprite, maxSpriteBytes]; };
  const first = await h.api.report();
  assert.equal(first.loadedFactorySHA256, crypto.createHash('sha256').update(factory.toString().replace(/\r\n/g, '\n')).digest('hex'));
  assert.equal(first.loadedFactoryHasRasterCache, false);
  h.api.start({ from: 1098, to: 1115 });
  assert.equal((await h.api.report()).loadedFactoryHasRasterCache, true);
  h.api.dispose();
});
test('dispose restores owned methods and preserves a method replaced by another tool', async () => {
  const h = harness(), proto = h.context.HTMLVideoElement.prototype, original = proto.requestVideoFrameCallback;
  const contextProto = h.context.OffscreenCanvasRenderingContext2D.prototype;
  assert(!Object.hasOwn(contextProto, 'drawImage'));
  h.api.start({ from: 1098, to: 1115 });
  assert(Object.hasOwn(contextProto, 'drawImage'));
  const later = function laterWrapper() {};
  proto.requestVideoFrameCallback = later;
  h.api.dispose();
  assert.equal(proto.requestVideoFrameCallback, later);
  assert(!Object.hasOwn(contextProto, 'drawImage'));
  assert.equal((await h.api.report()).stopReason, 'disposed');
  proto.requestVideoFrameCallback = original;
  h.api.start({ from: 1098, to: 1115 }); h.api.dispose();
  assert.equal(proto.requestVideoFrameCallback, original);
});
