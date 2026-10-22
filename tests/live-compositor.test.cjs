const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../extension/live-compositor.js'), 'utf8');
function harness(options = {}) {
  const writes = [], draws = [], buffers = [], presents = [], fetches = [], closes = [], contexts = [];
  const style = () => { const values = new Map(); return { cssText: '', setProperty(k, v, p = '') { writes.push([k, v, p]); values.set(k, [v, p]); }, getPropertyValue: k => values.get(k)?.[0] || '', getPropertyPriority: k => values.get(k)?.[1] || '', removeProperty: k => values.delete(k) }; };
  const base = { x: 10, y: 20, width: 800, height: 450 };
  function node(tag, box = base, css = {}) {
    const attributes = new Map();
    return { nodeType: 1, tagName: tag.toUpperCase(), style: style(), box: { ...box }, css: { display: 'block', opacity: '1', visibility: 'visible', fontSize: '25px', fontFamily: 'Arial', fontWeight: '700', color: '#fff', textShadow: '1px 1px 1px #000', ...css }, childNodes: [], isConnected: true,
      getBoundingClientRect() { return this.box; }, getAttribute: k => attributes.get(k) ?? null, setAttribute: (k, v) => attributes.set(k, v), removeAttribute: k => attributes.delete(k),
      appendChild(child) { this.childNodes.push(child); child.parentElement = child.parentNode = this; return child; },
      remove() { const parent = this.parentNode; if (parent) parent.childNodes.splice(parent.childNodes.indexOf(this), 1); this.parentNode = this.parentElement = null; },
      classList: { contains: () => false } };
  }
  const host = node('div', base, { position: 'relative' }), video = node('video', base, { objectFit: 'contain' }), layer = node('div');
  host.appendChild(video); host.appendChild(layer); video.videoWidth = 1920; video.videoHeight = 1080; video.currentTime = 0;
  const classes = new Set(['bili-danmaku-x-dm', 'bili-danmaku-x-show']), item = node('div', { x: 600, y: 40, width: 140, height: 30 }, { opacity: '0.26' });
  item.classList.contains = name => classes.has(name); layer.appendChild(item);
  const text = { nodeType: 3, textContent: '普通弹幕', parentElement: item, box: { x: 600, y: 40, width: 140, height: 30 } }; item.childNodes.push(text);
  const items = [item]; layer.querySelectorAll = selector => { if (selector !== '*') return items; const all = []; function walk(n) { for (const child of n.childNodes || []) if (child.nodeType === 1) { all.push(child); walk(child); } } walk(layer); return all; };
  const head = node('head'), documentElement = node('html'); let canvas, mask;
  const context = { URL, Blob, AbortController, Uint8Array, devicePixelRatio: options.dpr || 2, location: { href: 'https://live.bilibili.com/1', origin: 'https://live.bilibili.com' },
    requestAnimationFrame() { throw new Error('must not register rAF'); }, setTimeout() { throw new Error('must not register timer'); },
    getComputedStyle: n => n.css,
    document: { head, documentElement, createElement(tag) { const n = node(tag); if (tag === 'canvas') { canvas = n; n.getContext = (kind, options) => { contexts.push({ kind, options }); return { transferFromImageBitmap(bitmap) { presents.push(bitmap); } }; }; } else { mask = n; n.textContent = ''; n.sheet = { disabled: false }; } return n; },
      createRange() { let selected; return { selectNodeContents(n) { selected = n; }, getBoundingClientRect: () => selected.box, detach() {} }; } },
    fetch: async (url, init) => { fetches.push({ url, init }); return { ok: true, type: 'cors', headers: { get: key => key === 'content-type' ? 'image/png' : null }, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }; },
    createImageBitmap: async () => ({ width: 59, height: 59, id: 'static', close() { closes.push(this.id); } }) };
  class OffscreenCanvas {
    constructor(w, h) { this.width = w; this.height = h; this.index = buffers.length; buffers.push(this); this.context = {}; for (const method of ['setTransform', 'fillRect', 'clearRect', 'beginPath', 'rect', 'clip', 'save', 'restore', 'fillText', 'strokeText', 'strokeRect', 'drawImage']) this.context[method] = (...args) => { draws.push({ index: this.index, method, args, alpha: this.context.globalAlpha, fillStyle: this.context.fillStyle, strokeStyle: this.context.strokeStyle, lineWidth: this.context.lineWidth }); }; }
    getContext(kind, options) { contexts.push({ kind, options }); return this.context; }
    transferToImageBitmap() { return { id: 'present', close() { closes.push('present'); } }; }
  }
  context.OffscreenCanvas = OffscreenCanvas;
  vm.createContext(context); vm.runInContext(source, context);
  function image(url = 'https://i0.hdslb.com/bfs/live/test.png') { const n = node('img', { x: 740, y: 40, width: 30, height: 30 }); n.src = url; n.alt = '[喜欢]'; item.appendChild(n); return n; }
  return { context, create: extra => context.BFDLiveCompositor.create({ video, host, layer, ...extra }), host, video, layer, item, text, classes, items, draws, presents, fetches, closes, buffers, writes, contexts, head, node, image, get canvas() { return canvas; }, get mask() { return mask; } };
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
test('local comment solid outline is copied in its native color outside the full item box', () => {
  const h = harness(); Object.assign(h.item.css, { outlineStyle: 'solid', outlineWidth: '2px', outlineColor: 'rgb(102, 255, 255)', outlineOffset: '0px' });
  const s = h.create(); s.draw();
  const frame = h.draws.filter(d => d.index === 0 && d.method === 'strokeRect'); assert.equal(frame.length, 1);
  assert.deepEqual(frame[0].args, [589, 19, 142, 32]); assert.equal(frame[0].strokeStyle, 'rgb(102, 255, 255)'); assert.equal(frame[0].lineWidth, 2);
  assert.equal(frame[0].alpha, 0.26); assert.equal(h.presents.length, 1); assert.equal(s.status().comments, 1); s.restore();
});
test('ordinary comments with nonzero outline width but outline-style none do not acquire a self frame', () => {
  const h = harness(); Object.assign(h.item.css, { outlineStyle: 'none', outlineWidth: '2.90909px', outlineColor: '#fff' });
  const s = h.create(); s.draw(); s.draw(); assert(!h.draws.some(d => d.method === 'strokeRect'));
  assert.equal(s.status().cacheBuilds, 1); assert.equal(s.status().cacheHits, 1); assert.equal(h.presents.length, 2); s.restore();
});
test('fixed self outline follows centered bottom placement and native outline offset', () => {
  const h = harness(); Object.assign(h.item.css, { outlineStyle: 'solid', outlineWidth: '2px', outlineColor: '#66ffff', outlineOffset: '2px' });
  const s = h.create({ mode: 'fixed', position: 'bottom' }); s.draw();
  const frame = h.draws.find(d => d.method === 'strokeRect'); assert.deepEqual(frame.args, [327, 417, 146, 36]);
  assert.equal(h.canvas.width, 1600); assert.equal(h.presents.length, 1); s.restore();
});
test('solid native border retains colors and uses disjoint strips with the comment opacity only once', () => {
  const h = harness(); for (const side of ['Top', 'Right', 'Bottom', 'Left']) Object.assign(h.item.css, {
    ['border' + side + 'Style']: 'solid', ['border' + side + 'Width']: '1px', ['border' + side + 'Color']: '#66ffff'
  }); h.item.css.opacity = '0.5'; h.layer.css.opacity = '0.5';
  const s = h.create(); s.draw(); const edges = h.draws.filter(d => d.index === 0 && d.method === 'fillRect' && d.fillStyle === '#66ffff');
  assert.deepEqual(edges.map(d => d.args), [[590, 20, 140, 1], [729, 21, 1, 28], [590, 49, 140, 1], [590, 21, 1, 28]]);
  assert(edges.every(d => d.alpha === 0.25)); assert.equal(h.presents.length, 1); s.restore();
});
test('self outline encloses text and emoji once and updates independently of cached text', () => {
  const h = harness(); h.image('https://untrusted.invalid/test.png'); h.item.box.width = 180;
  Object.assign(h.item.css, { outlineStyle: 'solid', outlineWidth: '1px', outlineColor: '#66ffff' });
  const s = h.create(); s.draw(); h.item.box.x -= 10; h.text.box.x -= 10; h.item.css.outlineColor = '#00a1d6'; s.draw();
  h.item.css.outlineStyle = 'none'; s.draw(); const frames = h.draws.filter(d => d.method === 'strokeRect');
  assert.equal(frames.length, 2); assert.equal(frames[0].strokeStyle, '#66ffff'); assert.equal(frames[1].strokeStyle, '#00a1d6');
  assert.equal(frames[0].args[2], 181); assert.equal(frames[0].args[0] - frames[1].args[0], 10);
  assert.equal(s.status().cacheBuilds, 1); assert.equal(h.presents.length, 3); s.restore();
});
test('video and native text are completed before one presentation; no native animation scheduler is changed', () => {
  const h = harness(), surface = h.create(); assert.equal(h.video.style.getPropertyValue('visibility'), '');
  assert.equal(surface.draw(0, { mediaTime: 10 }), true); assert.equal(h.presents.length, 1);
  assert.equal(h.draws.filter(d => d.method === 'drawImage' && d.args[0] === h.video).length, 1);
  assert.equal(h.draws.filter(d => d.method === 'fillText').length, 1);
  assert.equal(h.canvas.width, 1600); assert.equal(h.canvas.height, 900);
  assert.equal(h.video.style.getPropertyValue('visibility'), '');
  assert.equal(h.video.style.getPropertyPriority('visibility'), '');
  assert.match(h.mask.textContent, /\]\s*\*\{visibility:hidden!important/);
  assert(!h.mask.textContent.includes('animation')); assert.equal(surface.status().comments, 1); surface.restore();
});
test('opaque output leaves native video visibility under player ownership through frames and restore', () => {
  for (const initial of ['', 'visible', 'hidden']) {
    const h = harness();
    if (initial) h.video.style.setProperty('visibility', initial, 'important');
    const s = h.create(); s.draw(); s.draw();
    assert.equal(h.video.style.getPropertyValue('visibility'), initial);
    assert.equal(h.video.style.getPropertyPriority('visibility'), initial ? 'important' : '');
    const background = h.draws.find(d => d.index === 0 && d.method === 'fillRect');
    assert.deepEqual(background.args, [0, 0, 800, 450]); assert.equal(background.alpha, 1);
    assert.equal(h.contexts[0].options.alpha, false);
    assert.equal(h.contexts.find(c => c.kind === 'bitmaprenderer').options.alpha, false);
    assert(h.draws.indexOf(background) < h.draws.findIndex(d => d.method === 'drawImage' && d.args[0] === h.video));
    h.video.style.setProperty('visibility', 'collapse'); s.draw(); s.restore();
    assert.equal(h.video.style.getPropertyValue('visibility'), 'collapse');
    assert.equal(h.video.style.getPropertyPriority('visibility'), '');
  }
});
test('pooled, filtered, zero opacity and display none ancestor items do not leak into the surface', () => {
  for (const kind of ['pooled', 'opacity', 'display', 'ancestor', 'inline-hidden']) {
    const h = harness(); if (kind === 'pooled') h.classes.delete('bili-danmaku-x-show'); if (kind === 'opacity') h.item.css.opacity = '0'; if (kind === 'display') h.item.css.display = 'none'; if (kind === 'ancestor') h.layer.css.display = 'none'; if (kind === 'inline-hidden') h.item.style.setProperty('visibility', 'hidden');
    const s = h.create(); s.draw(); assert.equal(s.status().comments, 0, kind); assert(!h.draws.some(d => d.method === 'fillText'), kind); s.restore();
  }
});
test('native positions are sampled each frame while repeated text rasters and final group opacity are reused', () => {
  const h = harness(), s = h.create(); s.draw(); h.text.box.x -= 11; h.item.box.x -= 11; s.draw();
  assert.equal(s.status().cacheBuilds, 1); assert.equal(s.status().cacheHits, 1);
  assert.equal(h.draws.filter(d => d.method === 'fillText').length, 1);
  const copies = h.draws.filter(d => d.index === 0 && d.method === 'drawImage' && d.args[0] !== h.video);
  assert.equal(copies.length, 2); assert.equal(copies[0].alpha, 0.26); assert.equal(copies[0].args[1] - copies[1].args[1], 11); s.restore();
});
test('fixed mode centers active comments and allocates a bottom lane without displaying inactive queue items', () => {
  const h = harness(), s = h.create({ mode: 'fixed', position: 'bottom' }); s.draw();
  const copy = h.draws.find(d => d.index === 0 && d.method === 'drawImage' && d.args[0] !== h.video);
  assert.equal(copy.args[1], 330 - 6); assert.equal(copy.args[2], 420 - 6); s.restore();
});
test('static emoji CORS fetch is deduplicated, asynchronous completion does not present, and next frame paints it', async () => {
  const h = harness(); h.image(); const s = h.create(); s.draw(0, { mediaTime: 10 }); assert.equal(s.status().placeholders, 1);
  await settle(); assert.equal(h.presents.length, 1); assert.equal(h.fetches.length, 1); assert.equal(h.fetches[0].init.mode, 'cors'); assert.equal(h.fetches[0].init.credentials, 'omit');
  s.draw(1, { mediaTime: 11 }); s.draw(2, { mediaTime: 12 }); assert.equal(h.fetches.length, 1); assert.equal(s.status().placeholders, 0);
  assert(h.draws.some(d => d.method === 'drawImage' && d.args[0]?.id === 'static')); s.restore(); assert(h.closes.includes('static'));
});
test('untrusted URL or failed CORS produces readable placeholder without drawing the native image or freezing video', async () => {
  for (const blocked of [true, false]) {
    const h = harness(), image = h.image(blocked ? 'https://untrusted.invalid/private.png' : undefined);
    if (!blocked) h.context.fetch = async () => { throw new Error('CORS denied'); };
    const s = h.create(); s.draw(); await settle(); s.draw();
    assert.equal(h.presents.length, 2); assert.equal(s.status().placeholders, 1); assert(!h.draws.some(d => d.method === 'drawImage' && d.args[0] === image));
    assert(h.draws.some(d => d.method === 'fillText' && d.args[0] === '[喜欢]')); if (!blocked) assert.equal(s.status().imageFailures, 1); s.restore();
  }
});
function decoderMock(h, count = 3, size = 16, duration = 100000) {
  const decoded = [];
  h.context.ImageDecoder = class {
    static async isTypeSupported() { return true; }
    constructor() { this.tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: count, animated: count > 1, repetitionCount: Infinity } }; }
    async decode({ frameIndex }) { decoded.push(frameIndex); return { image: { id: 'frame-' + frameIndex, displayWidth: size, displayHeight: size, duration, close() { h.closes.push(this.id); } } }; }
    close() { h.closes.push('decoder'); }
  };
  return decoded;
}
test('animated emoji selects decoded frames by video media time and never draws from decode callbacks', async () => {
  const h = harness(), decoded = decoderMock(h); h.image(); const s = h.create(); s.draw(0, { mediaTime: 10 }); await settle();
  assert.deepEqual(decoded, [0, 1, 2]); assert.equal(h.presents.length, 1); assert.equal(s.status().animatedImages, 1);
  for (const time of [10.01, 10.11, 10.21, 10.31]) s.draw(1, { mediaTime: time });
  assert.deepEqual(h.draws.filter(d => d.method === 'drawImage' && /^frame-/.test(d.args[0]?.id || '')).map(d => d.args[0].id), ['frame-0', 'frame-1', 'frame-2', 'frame-0']);
  s.restore(); for (let i = 0; i < 3; i++) assert(h.closes.includes('frame-' + i)); assert.equal(s.status().cacheBytes, 0);
});
test('long animation uses a reported first-frame fallback rather than a truncated fake cycle', async () => {
  const h = harness(), decoded = decoderMock(h, 121); h.image(); const s = h.create(); s.draw(0, { mediaTime: 10 }); await settle(); s.draw(0, { mediaTime: 11 });
  assert.deepEqual(decoded, [0]); assert.equal(s.status().staticFallbacks, 1); assert.equal(s.status().animatedImages, 0); assert(s.status().fallbackReasons.includes('animation-frame-limit')); s.restore();
});
test('image decode failure falls back to a safe bitmap and does not interrupt text or video', async () => {
  const h = harness(); decoderMock(h); h.context.ImageDecoder.prototype.decode = async () => { throw new Error('bad animation'); }; h.image();
  const s = h.create(); s.draw(); await settle(); s.draw(); assert.equal(s.status().placeholders, 0); assert.equal(s.status().staticFallbacks, 1); assert.equal(h.presents.length, 2); s.restore();
});
test('oversized decoded images cannot consume unbounded memory or contaminate the completed surface', async () => {
  const h = harness(); decoderMock(h, 1, 8192); h.context.createImageBitmap = async () => ({ width: 8192, height: 8192, close() { h.closes.push('huge'); } }); h.image();
  const s = h.create(); s.draw(); await settle(); s.draw(); assert.equal(s.status().placeholders, 1); assert(s.status().cacheBytes < 4 * 1024 * 1024); assert(h.closes.includes('huge')); assert.equal(h.presents.length, 2); s.restore();
});
test('restore while an asset is pending aborts it and closes a late bitmap without extra presents', async () => {
  const h = harness(); let finish; h.context.createImageBitmap = () => new Promise(resolve => { finish = resolve; }); h.image(); const s = h.create(); s.draw(); await settle();
  s.restore(); assert(h.fetches[0].init.signal.aborted); finish({ width: 59, height: 59, close() { h.closes.push('late'); } }); await settle();
  assert(h.closes.includes('late')); assert.equal(h.presents.length, 1); assert.equal(s.status().cacheBytes, 0); assert.equal(s.draw(), false);
});
test('expired offscreen image requests release the four loading slots for a queued current emoji', async () => {
  const h = harness(), normalFetch = h.context.fetch, started = [], aborted = [], old = [];
  h.context.fetch = (url, init) => {
    started.push(url);
    if (url.endsWith('/current.png')) return normalFetch(url, init);
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => {
      aborted.push(url); reject(new Error('aborted'));
    }, { once: true }));
  };
  for (let i = 0; i < 4; i++) old.push(h.image('https://i0.hdslb.com/bfs/live/stalled-' + i + '.png'));
  const s = h.create(); s.draw(); assert.equal(started.length, 4);
  h.item.childNodes = h.item.childNodes.filter(node => !old.includes(node)); h.image('https://i0.hdslb.com/bfs/live/current.png');
  for (let i = 0; i < 239; i++) s.draw();
  await settle(); assert.equal(aborted.length, 0); assert.equal(started.length, 4);
  s.draw(); const before = h.presents.length;
  await settle(); assert.equal(aborted.length, 4); assert.equal(started.length, 5);
  assert(started[4].endsWith('/current.png')); assert.equal(s.status().assets, 1); assert.equal(s.status().pendingImages, 0);
  assert.equal(s.status().imageFailures, 0, 'cancelled offscreen work is not an emoji decode failure');
  assert.equal(h.presents.length, before, 'abort and load completion must not create an independent presentation');
  s.draw(); assert.equal(s.status().placeholders, 0); s.restore();
});
test('on-screen slow images are retained and restoring the surface cannot start queued work', async () => {
  const h = harness(), started = [], aborted = [];
  h.context.fetch = (url, init) => {
    started.push(url);
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => {
      aborted.push(url); reject(new Error('aborted'));
    }, { once: true }));
  };
  for (let i = 0; i < 5; i++) h.image('https://i0.hdslb.com/bfs/live/visible-slow-' + i + '.png');
  const s = h.create();
  for (let i = 0; i < 301; i++) s.draw();
  await settle(); assert.equal(started.length, 4); assert.equal(aborted.length, 0); assert.equal(s.status().pendingImages, 5);
  const before = h.presents.length; s.restore(); await settle();
  assert.equal(aborted.length, 4); assert.equal(started.length, 4, 'restore must not pump the fifth queued request');
  assert.equal(h.presents.length, before); assert.equal(s.status().assets, 0); assert.equal(s.status().pendingImages, 0);
  assert.equal(s.status().cacheBytes, 0);
});
test('expired pending decode closes late images even if the surface is restored before decode completion', async () => {
  for (const method of ['bitmap', 'decoder']) {
    const h = harness(); let finish;
    if (method === 'bitmap') h.context.createImageBitmap = () => new Promise(resolve => { finish = image => resolve(image); });
    else h.context.ImageDecoder = class {
      static async isTypeSupported() { return true; }
      constructor() { this.tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 1 } }; }
      decode() { return new Promise(resolve => { finish = image => resolve({ image }); }); }
      close() { h.closes.push('expired-decoder'); }
    };
    const image = h.image(), s = h.create(); s.draw(); await settle(); assert.equal(typeof finish, 'function');
    h.item.childNodes = h.item.childNodes.filter(node => node !== image);
    for (let i = 0; i < 240; i++) s.draw();
    assert(h.fetches[0].init.signal.aborted); assert.equal(s.status().assets, 0);
    if (method === 'decoder') assert(h.closes.includes('expired-decoder'));
    const before = h.presents.length; s.restore();
    finish({ width: 16, height: 16, displayWidth: 16, displayHeight: 16, close() { h.closes.push('expired-late-' + method); } });
    await settle(); assert(h.closes.includes('expired-late-' + method));
    assert.equal(h.presents.length, before); assert.equal(s.status().cacheBytes, 0); assert.equal(s.status().assets, 0);
  }
});
test('restore restores owned styles/attribute, releases all backing stores and leaves externally changed styles alone', () => {
  const h = harness(); h.video.style.setProperty('visibility', 'visible'); h.layer.setAttribute('data-bfd-live-mask', 'previous'); const s = h.create(); s.draw();
  h.video.style.setProperty('visibility', 'collapse'); s.restore(); s.restore();
  assert.equal(h.video.style.getPropertyValue('visibility'), 'collapse'); assert.equal(h.layer.getAttribute('data-bfd-live-mask'), 'previous'); assert.equal(h.canvas.parentNode, null); assert.equal(h.mask.parentNode, null);
  assert(h.buffers.every(b => b.width === 1 && b.height === 1)); assert.equal(s.status().cacheBytes, 0);
});
test('successful frames repair removed mask/output and disabled stylesheet without a second presentation', () => {
  const h = harness(), s = h.create(); s.draw(); h.canvas.remove(); h.mask.remove(); h.mask.textContent = 'broken'; h.mask.disabled = true; h.mask.sheet.disabled = true; h.layer.removeAttribute('data-bfd-live-mask');
  s.draw(); assert.equal(h.presents.length, 2); assert.equal(h.canvas.parentElement, h.host); assert.equal(h.mask.parentNode, h.head); assert.match(h.mask.textContent, /visibility:hidden!important/); assert.equal(h.mask.disabled, false); assert.equal(h.mask.sheet.disabled, false); s.restore();
});
test('failed video composition leaves native layers and canvas visibility untouched', () => {
  const h = harness(), s = h.create(); h.buffers[0].context.drawImage = () => { throw new Error('video unavailable'); };
  assert.throws(() => s.draw(), /video unavailable/); assert.equal(h.presents.length, 0); assert.equal(h.video.style.getPropertyValue('visibility'), ''); assert.equal(h.layer.getAttribute('data-bfd-live-mask'), null); s.restore();
});
test('resize updates backing dimensions and needsResize while unsupported effect boundaries stay explicit', () => {
  const h = harness(), s = h.create(); s.draw(); assert.equal(s.needsResize(), false); h.host.box.width = 1000; assert.equal(s.needsResize(), true); s.draw(); assert.equal(h.canvas.width, 2000); assert.equal(s.needsResize(), false);
  assert.equal(s.status().specialEffectsSupported, false); assert.equal(s.status().scope, 'ordinary-native-dom-and-emoticons'); s.restore();
});
test('fixed comments sharing a native rolling lane get separate stable lanes, release them and count overflow', () => {
  const h = harness(); h.layer.box.height = 65;
  function add(label) { const n = h.node('div', { ...h.item.box }); n.classList.contains = name => name === 'bili-danmaku-x-show'; const t = { nodeType: 3, textContent: label, parentElement: n, box: { ...h.text.box } }; n.childNodes.push(t); h.layer.appendChild(n); h.items.push(n); return n; }
  const second = add('第二条'), third = add('第三条'), s = h.create({ mode: 'fixed' });
  s.draw(); assert.equal(s.status().comments, 2); assert.equal(s.status().fixedOverflow, 1);
  const copies = h.draws.filter(d => d.index === 0 && d.method === 'drawImage' && d.args[0] !== h.video); assert(copies[1].args[2] - copies[0].args[2] >= 34);
  second.css.opacity = '0'; s.draw(); assert.equal(s.status().comments, 2); assert.equal(s.status().fixedOverflow, 0); assert.equal(h.presents.length, 2); s.restore();
});
test('recycled native nodes reset animation media origin after inactive lifetime, changed content, or CSS animation restart', async () => {
  const h = harness(); decoderMock(h); const image = h.image(); const s = h.create();
  s.draw(0, { mediaTime: 10 }); await settle(); s.draw(0, { mediaTime: 10.21 });
  const latest = () => h.draws.filter(d => d.method === 'drawImage' && /^frame-/.test(d.args[0]?.id || '')).at(-1).args[0].id;
  assert.equal(latest(), 'frame-2'); h.item.css.opacity = '0'; s.draw(0, { mediaTime: 10.22 }); h.item.css.opacity = '0.26'; s.draw(0, { mediaTime: 10.23 }); assert.equal(latest(), 'frame-0');
  s.draw(0, { mediaTime: 10.44 }); assert.equal(latest(), 'frame-2'); h.text.textContent = '新弹幕'; s.draw(0, { mediaTime: 10.45 }); assert.equal(latest(), 'frame-0');
  let startTime = 1; h.item.getAnimations = () => [{ startTime }]; s.draw(0, { mediaTime: 11 }); s.draw(0, { mediaTime: 11.21 }); assert.equal(latest(), 'frame-2'); startTime = 2; s.draw(0, { mediaTime: 11.22 }); assert.equal(latest(), 'frame-0'); s.restore();
});
test('inline visible important overrides are hidden after presentation and restored without hiding sampled content next frame', () => {
  const h = harness(); h.item.style.setProperty('visibility', 'visible', 'important'); const s = h.create(); s.draw();
  assert.equal(h.item.style.getPropertyValue('visibility'), 'hidden'); s.draw(); assert.equal(s.status().comments, 1);
  s.restore(); assert.equal(h.item.style.getPropertyValue('visibility'), 'visible'); assert.equal(h.item.style.getPropertyPriority('visibility'), 'important');
});
test('native transparent text remains transparent and placeholder is clipped to image bounds', async () => {
  const h = harness(); h.item.css.color = 'transparent'; h.item.css.textShadow = 'none'; h.image('https://untrusted.invalid/e.png'); const s = h.create(); s.draw();
  const tile = h.buffers[2].context; assert.equal(tile.fillStyle, 'transparent');
  const clip = h.draws.find(d => d.method === 'rect' && d.args[2] === 30 && d.args[3] === 30); assert(clip);
  s.restore();
});
test('restore during a pending decoder capability check prevents a late decoder or bitmap from being created', async () => {
  const h = harness(); let support, constructed = 0, bitmaps = 0;
  h.context.ImageDecoder = class {
    static isTypeSupported() { return new Promise(resolve => { support = resolve; }); }
    constructor() { constructed++; this.tracks = { ready: new Promise(() => {}) }; }
    close() { h.closes.push('late-decoder'); }
  };
  h.context.createImageBitmap = async () => { bitmaps++; return { width: 1, height: 1, close() {} }; };
  h.image(); const s = h.create(); s.draw(); await settle(); assert.equal(typeof support, 'function');
  s.restore(); support(true); await settle();
  assert.equal(constructed, 0); assert.equal(bitmaps, 0); assert.equal(h.presents.length, 1); assert.equal(s.status().cacheBytes, 0);
});
test('restore while decoder tracks are pending closes the decoder and blocks late decode or bitmap fallback', async () => {
  for (const rejected of [false, true]) {
    const h = harness(); let ready, rejectReady, decoded = 0, bitmaps = 0;
    h.context.ImageDecoder = class {
      static async isTypeSupported() { return true; }
      constructor() { this.tracks = { ready: new Promise((resolve, reject) => { ready = resolve; rejectReady = reject; }), selectedTrack: { frameCount: 1 } }; }
      async decode() { decoded++; throw new Error('must not decode after restore'); }
      close() { h.closes.push('pending-decoder'); }
    };
    h.context.createImageBitmap = async () => { bitmaps++; return { width: 1, height: 1, close() {} }; };
    h.image(); const s = h.create(); s.draw(); await settle(); assert.equal(typeof ready, 'function');
    s.restore(); assert(h.closes.includes('pending-decoder'));
    if (rejected) rejectReady(new Error('closed decoder')); else ready();
    await settle(); assert.equal(decoded, 0); assert.equal(bitmaps, 0); assert.equal(h.presents.length, 1); assert.equal(s.status().cacheBytes, 0);
  }
});
test('ancestor clip prevents new visible-important descendants from escaping between frames and disabling removes only the owned mask', () => {
  const h = harness(); h.layer.style.setProperty('clip-path', 'inset(2px)');
  const originalBox = { ...h.layer.box }, s = h.create(); s.draw();
  const token = h.layer.getAttribute('data-bfd-live-mask'), selector = '[data-bfd-live-mask="' + token + '"]';
  assert(h.mask.textContent.includes(selector + '{clip-path:inset(50%)!important}'));
  assert(h.mask.textContent.includes(selector + ' *{visibility:hidden!important'));
  const image = h.image(); image.style.setProperty('visibility', 'visible', 'important');
  assert.equal(h.presents.length, 1, 'new descendants must remain covered by ancestor clip without another presentation');
  assert.deepEqual(h.layer.box, originalBox); assert.equal(h.layer.style.getPropertyValue('clip-path'), 'inset(2px)');
  assert.equal(s.status().nativeSpecialEffects, 'suppressed-in-danmaku-layer');
  s.restore(); assert.equal(h.mask.parentNode, null); assert.equal(h.layer.getAttribute('data-bfd-live-mask'), null);
  assert.equal(h.layer.style.getPropertyValue('clip-path'), 'inset(2px)');
});
test('dual-track image uses its animation instead of the default static poster and advances on media time', async () => {
  const h = harness();
  h.context.ImageDecoder = class {
    static async isTypeSupported() { return true; }
    constructor(init) {
      this.animation = init.preferAnimation === true;
      const poster = { frameCount: 1, animated: false }, animation = { frameCount: 2, animated: true, repetitionCount: Infinity };
      this.tracks = { ready: Promise.resolve(), selectedTrack: this.animation ? animation : poster };
    }
    async decode({ frameIndex }) {
      return { image: { id: this.animation ? 'animation-' + frameIndex : 'poster', displayWidth: 16, displayHeight: 16, duration: 100000, close() { h.closes.push(this.id); } } };
    }
    close() {}
  };
  h.image(); const s = h.create(); s.draw(0, { mediaTime: 10 }); await settle();
  assert.equal(s.status().animatedImages, 1); assert.equal(s.status().staticFallbacks, 0);
  s.draw(0, { mediaTime: 10.01 }); s.draw(0, { mediaTime: 10.11 });
  const imageIds = h.draws.filter(d => d.method === 'drawImage' && /^(animation-|poster)/.test(d.args[0]?.id || '')).map(d => d.args[0].id);
  assert.deepEqual(imageIds, ['animation-0', 'animation-1']); s.restore();
});

test('lost cached live text context fails before another presentation and restore releases every store', () => {
  const h = harness(), s = h.create(); s.draw();
  assert.equal(s.status().textCache, 1);
  h.buffers[2].context.isContextLost = () => true;
  assert.throws(() => s.draw(), /文字画布上下文丢失/);
  assert.equal(h.presents.length, 1, 'do not publish a frame with missing cached text');
  s.restore(); assert.equal(s.status().cacheBytes, 0);
  assert(h.buffers.every(b => b.width === 1 && b.height === 1));
  assert.equal(h.layer.getAttribute('data-bfd-live-mask'), null);
});

test('a lost new live text context never commits an empty raster and releases the uncached store', () => {
  for (const duringPaint of [false, true]) {
    const h = harness(), Base = h.context.OffscreenCanvas;
    h.context.OffscreenCanvas = class extends Base {
      getContext(...args) {
        const target = super.getContext(...args);
        if (this.index >= 2) {
          let lost = !duringPaint;
          target.isContextLost = () => lost;
          if (duringPaint) { const fill = target.fillText; target.fillText = (...values) => { fill(...values); lost = true; }; }
        }
        return target;
      }
    };
    const s = h.create(); assert.throws(() => s.draw(), /文字画布上下文丢失/);
    assert.equal(h.presents.length, 0); assert.equal(s.status().textCache, 0);
    assert.equal(s.status().cacheBytes, 0); assert.equal(h.buffers[2].width, 1); assert.equal(h.buffers[2].height, 1);
    assert.equal(h.layer.getAttribute('data-bfd-live-mask'), null); s.restore();
  }
});

test('dense live text checks the scratch context after the per-frame raster budget is filled', () => {
  const h = harness(), s = h.create();
  h.buffers[1].context.isContextLost = () => true;
  for (let i = 0; i < 16; i++) h.item.childNodes.push({ nodeType: 3, textContent: 'unique-' + i, parentElement: h.item,
    box: { x: 600, y: 40, width: 140, height: 30 } });
  assert.throws(() => s.draw(), /文字画布上下文丢失/);
  assert.equal(s.status().cacheBuilds, 16); assert.equal(h.presents.length, 0);
  assert.equal(h.layer.getAttribute('data-bfd-live-mask'), null);
  s.restore(); assert.equal(s.status().cacheBytes, 0); assert(h.buffers.every(b => b.width === 1 && b.height === 1));
});

test('presentation refresh changes opacity only for two existing successful draws and never presents on its own', () => {
  const h = harness(), s = h.create();
  assert.equal(s.refreshPresentation(), false, 'no invalidation before the first complete picture');
  s.draw(); const before = h.presents.length;
  assert.equal(s.refreshPresentation(), true); assert.equal(h.presents.length, before);
  assert.equal(h.canvas.style.getPropertyValue('opacity'), '0.999'); assert.equal(h.canvas.style.getPropertyPriority('opacity'), 'important');
  assert.equal(s.status().presentationRefresh.remaining, 2);
  assert.equal(s.refreshPresentation(), false, 'a repeated request cannot extend the interval');
  s.draw(); assert.equal(s.status().presentationRefresh.remaining, 1); assert.equal(h.canvas.style.getPropertyValue('opacity'), '0.999');
  s.draw(); assert.equal(s.status().presentationRefresh.active, false); assert.equal(h.canvas.style.getPropertyValue('opacity'), '');
  assert.equal(h.presents.length, before + 2); s.restore(); assert.equal(s.refreshPresentation(), false);
});

test('presentation refresh preserves the original inline opacity and priority on completion or cancellation', () => {
  for (const [value, priority] of [['', ''], ['1', ''], ['1', 'important']]) {
    for (const action of ['complete', 'cancel', 'restore']) {
      const h = harness(), s = h.create(); s.draw();
      if (value) h.canvas.style.setProperty('opacity', value, priority);
      assert.equal(s.refreshPresentation(), true);
      if (action === 'complete') { s.draw(); s.draw(); }
      else if (action === 'cancel') assert.equal(s.cancelPresentationRefresh(), true);
      else s.restore();
      assert.equal(h.canvas.style.getPropertyValue('opacity'), value); assert.equal(h.canvas.style.getPropertyPriority('opacity'), priority);
      assert.equal(s.status().presentationRefresh.active, false); assert.equal(s.cancelPresentationRefresh(), false); s.restore();
    }
  }
});

test('presentation refresh yields both externally changed opacity values and priorities', () => {
  for (const [value, priority] of [['0.4', 'important'], ['0.999', ''], ['1', 'important']]) {
    const h = harness(), s = h.create(); s.draw(); assert.equal(s.refreshPresentation(), true);
    h.canvas.style.setProperty('opacity', value, priority); s.draw(); s.draw();
    assert.equal(h.canvas.style.getPropertyValue('opacity'), value); assert.equal(h.canvas.style.getPropertyPriority('opacity'), priority);
    assert.equal(s.status().presentationRefresh.active, false); s.restore();
    assert.equal(h.canvas.style.getPropertyValue('opacity'), value); assert.equal(h.canvas.style.getPropertyPriority('opacity'), priority);
  }
});

test('presentation refresh declines transparent canvases and opacity animations without changing styles', () => {
  const cases = [
    { opacity: '0.7' },
    { transitionProperty: 'opacity', transitionDuration: '1s' },
    { transitionProperty: 'all', transitionDuration: '0s', transitionDelay: '10ms' },
    { transitionProperty: 'transform, opacity', transitionDuration: '0s, 1s' },
    { animationName: 'none, glow' }
  ];
  for (const css of cases) {
    const h = harness(), s = h.create(); s.draw(); Object.assign(h.canvas.css, css);
    assert.equal(s.refreshPresentation(), false, JSON.stringify(css)); assert.equal(h.canvas.style.getPropertyValue('opacity'), ''); s.restore();
  }
  for (const animations of [
    [{ playState: 'running', effect: { getKeyframes: () => [{ opacity: '1' }, { opacity: '0.5' }] } }],
    [{ playState: 'paused', effect: { getKeyframes: () => [{ opacity: '1' }] } }]
  ]) {
    const h = harness(), s = h.create(); s.draw(); h.canvas.getAnimations = () => animations;
    assert.equal(s.refreshPresentation(), false); assert.equal(h.canvas.style.getPropertyValue('opacity'), ''); s.restore();
  }
  const h = harness(), s = h.create(); s.draw();
  Object.assign(h.canvas.css, { transitionProperty: 'transform, opacity', transitionDuration: '1s, 0s' });
  h.canvas.getAnimations = () => [{ playState: 'running', effect: { getKeyframes: () => [{ transform: 'none' }] } },
    { playState: 'finished', effect: { getKeyframes: () => [{ opacity: '0.5' }] } }];
  assert.equal(s.refreshPresentation(), true, 'unrelated transitions do not animate opacity'); s.restore();
});

test('failed or unpaintable live draws cancel a pending presentation refresh immediately', () => {
  for (const failure of ['context-lost', 'zero-size']) {
    const h = harness(), s = h.create(); s.draw(); assert.equal(s.refreshPresentation(), true);
    if (failure === 'context-lost') {
      h.buffers[2].context.isContextLost = () => true; assert.throws(() => s.draw(), /文字画布上下文丢失/);
    } else { h.host.box.width = 0; assert.equal(s.draw(), false); }
    assert.equal(h.presents.length, 1); assert.equal(h.canvas.style.getPropertyValue('opacity'), '');
    assert.equal(s.status().presentationRefresh.active, false); s.restore();
  }
});
