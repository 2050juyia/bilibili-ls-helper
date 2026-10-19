const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
function harness() {
  const properties = () => {
    const map = new Map(), writes = [];
    return { visibility: 'hidden', writes, setProperty(k, v, priority = '') { writes.push([k, v, priority]); map.set(k, [v, priority]); }, removeProperty: k => map.delete(k),
      getPropertyValue: k => map.get(k)?.[0] || '', getPropertyPriority: k => map.get(k)?.[1] || '' };
  };
  const operations = [], presents = [], draws = [], buffers = [];
  const box = { x: 10, y: 20, width: 800, height: 600 };
  const host = { style: properties(), isConnected: true, appends: 0, getBoundingClientRect: () => box,
    appendChild(c) { this.child = c; c.parentElement = this; this.appends++; } };
  const video = { style: properties(), videoWidth: 1920, videoHeight: 1080, closest: () => host, getBoundingClientRect: () => box };
  const container = { style: properties(), getBoundingClientRect: () => box };
  const item = { textData: { mode: 1, color: 0xffffff }, text: 'ordinary', showed: true, duration: 10, endTime: 10, moveDistance: 1000,
    element: { textContent: 'ordinary', querySelector: () => null, getBoundingClientRect: () => ({ x: 710, y: 25, width: 100, height: 25 }),
      classList: { contains: name => name === 'bili-danmaku-x-roll' } } };
  const renderer = { container, manager: { visualArray: [item] }, renderTime: 1 };
  const output = { transferFromImageBitmap(bitmap) { presents.push([...bitmap.operations]); operations.push(['present']); } };
  const canvas = { style: properties(), setAttribute() {}, getContext: () => output,
    remove() { host.child = null; this.parentElement = null; } };
  const context2d = {}, textContext = {};
  for (const [target, id] of [[context2d, 'video'], [textContext, 'text']]) {
    for (const name of ['setTransform', 'clearRect', 'fillRect', 'save', 'restore', 'beginPath', 'rect', 'clip', 'drawImage', 'strokeText', 'fillText', 'strokeRect'])
      target[name] = (...args) => { operations.push([name, ...args]); draws.push({ target: id, name, alpha: target.globalAlpha, args }); };
    target.measureText = () => ({ width: 100, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 100, actualBoundingBoxAscent: -3, actualBoundingBoxDescent: 24 });
  }
  class OffscreenCanvas {
    constructor(w, h) { this.width = w; this.height = h; this.index = buffers.length; buffers.push(this); }
    getContext() { return this.index === 0 ? context2d : textContext; }
    transferToImageBitmap() { const bitmap = { operations: [...operations], close() {} }; operations.push(['bitmap']); return bitmap; }
  }
  const textCss = { display: 'flex', opacity: '0.8', color: '#fff', fontWeight: '700', fontSize: '20px', fontFamily: 'Arial', textShadow: 'none', lineHeight: '22.5px' };
  const context = { OffscreenCanvas, devicePixelRatio: 2, document: { createElement: () => canvas },
    getComputedStyle: node => node === host ? { position: 'relative' } : node === video ? { objectFit: 'contain' } :
      textCss };
  vm.createContext(context); vm.runInContext(fs.readFileSync(require.resolve('../extension/compositor.js'), 'utf8'), context);
  return { create: () => context.BFDCompositor.create(renderer, video), context, context2d, textContext, textCss, buffers, draws, canvas, host, video, container, renderer, item, operations, presents, box };
}
test('video and text complete off-screen before exactly one atomic present; original layers hidden only after success', () => {
  const h = harness(), surface = h.create(); assert.equal(h.video.style.getPropertyValue('visibility'), ''); assert.equal(h.presents.length, 0);
  surface.draw();
  assert.equal(h.presents.length, 1);
  const frame = h.presents[0]; assert.equal(frame.filter(op => op[0] === 'drawImage' && op[1] === h.video).length, 1); assert.equal(frame.filter(op => op[0] === 'fillText').length, 1);
  assert(frame.findIndex(op => op[0] === 'drawImage') < frame.findIndex(op => op[0] === 'fillText'));
  assert.deepEqual(frame.find(op => op[0] === 'drawImage').slice(2), [0, 75, 800, 450]);
  assert.deepEqual(frame.find(op => op[0] === 'fillText').slice(1), ['ordinary', 600, 5]);
  assert.equal(h.canvas.width, 1600); assert.equal(h.canvas.height, 1200);
  assert.equal(h.video.style.getPropertyValue('visibility'), 'hidden'); assert.equal(h.container.style.getPropertyValue('visibility'), 'hidden');
  assert.equal(surface.status().presents, 1); assert.equal(surface.status().comments, 1);
});
test('original visibility priorities, pointer behavior and resources restore without changing other styles', () => {
  const h = harness(); h.video.style.setProperty('visibility', 'visible', 'important'); h.container.style.setProperty('pointer-events', 'auto');
  const surface = h.create(); surface.draw(); surface.restore();
  assert.equal(h.host.child, null); assert.equal(h.video.style.getPropertyValue('visibility'), 'visible'); assert.equal(h.video.style.getPropertyPriority('visibility'), 'important');
  assert.equal(h.container.style.getPropertyValue('pointer-events'), 'auto'); assert.equal(h.canvas.width, 1);
  assert(h.buffers.every(buffer => buffer.width === 1 && buffer.height === 1));
});
test('successful frames repair externally changed visibility and a detached canvas with one presentation and no stable-frame mutations', () => {
  const h = harness(), surface = h.create(); surface.draw();
  const counts = () => [h.video.style.writes.length, h.container.style.writes.length, h.canvas.style.writes.length, h.host.appends];
  const stable = counts(); surface.draw(); assert.deepEqual(counts(), stable);
  h.video.style.setProperty('visibility', 'visible');
  h.container.style.setProperty('visibility', 'hidden');
  h.container.style.setProperty('pointer-events', 'auto');
  h.canvas.style.setProperty('visibility', 'hidden', 'important'); h.canvas.remove();
  const before = h.presents.length; surface.draw();
  assert.equal(h.presents.length, before + 1); assert.equal(h.host.child, h.canvas);
  assert.equal(h.canvas.parentElement, h.host);
  for (const node of [h.video, h.container]) {
    assert.equal(node.style.getPropertyValue('visibility'), 'hidden');
    assert.equal(node.style.getPropertyPriority('visibility'), 'important');
  }
  assert.equal(h.container.style.getPropertyValue('pointer-events'), 'none');
  assert.equal(h.canvas.style.getPropertyValue('visibility'), 'visible');
  assert.equal(h.canvas.style.getPropertyPriority('visibility'), 'important');
  const repaired = counts(); surface.draw(); assert.deepEqual(counts(), repaired);
  surface.restore(); assert.equal(h.host.child, null); assert.equal(h.video.style.getPropertyValue('visibility'), '');
  assert.equal(h.container.style.getPropertyValue('pointer-events'), '');
  assert(h.buffers.every(buffer => buffer.width === 1 && buffer.height === 1));
});
test('failed composition does not rehide externally restored video or reattach a removed canvas', () => {
  const h = harness(), surface = h.create(); surface.draw();
  h.video.style.setProperty('visibility', 'visible', 'important'); h.canvas.remove();
  h.context2d.drawImage = () => { throw new Error('decode unavailable'); };
  const before = h.presents.length; assert.throws(() => surface.draw(), /decode unavailable/);
  assert.equal(h.presents.length, before); assert.equal(h.host.child, null);
  assert.equal(h.video.style.getPropertyValue('visibility'), 'visible');
  surface.restore(); assert.equal(h.video.style.getPropertyValue('visibility'), 'visible');
});
test('a removed output is not attached to a disconnected host', () => {
  const h = harness(), surface = h.create(); surface.draw();
  h.canvas.remove(); h.host.isConnected = false; surface.draw();
  assert.equal(h.host.child, null); surface.restore();
});
test('failed video draw never presents partial text or hides original video', () => {
  const h = harness(); h.context2d.drawImage = () => { throw new Error('decode unavailable'); };
  const surface = h.create(); assert.throws(() => surface.draw(), /decode unavailable/);
  assert.equal(h.presents.length, 0); assert.equal(h.video.style.getPropertyValue('visibility'), ''); assert.equal(h.canvas.style.visibility, 'hidden'); surface.restore();
});
test('native hidden/filtered items stay absent; fixed text stays still; unsupported rich types are counted', () => {
  const h = harness(); h.item.textData.mode = 5;
  h.renderer.manager.visualArray.push({ ...h.item, isHide: true }, { ...h.item, textData: { mode: 7 } });
  const surface = h.create(); surface.draw();
  assert.equal(surface.status().comments, 1); assert.equal(surface.status().skipped, 1);
  assert.deepEqual(h.presents[0].find(op => op[0] === 'fillText').slice(1), ['ordinary', 700, 5]);
});
test('size changes resize both backing stores together before presentation', () => {
  const h = harness(), surface = h.create(); surface.draw(); h.box.width = 1280; h.box.height = 720; surface.draw();
  assert.equal(h.canvas.width, 2560); assert.equal(h.canvas.height, 1440); assert.equal(surface.status().presents, 2);
});
test('native danmaku visibility switch suppresses canvas comments even if native visual items remain', () => {
  const h = harness(); h.renderer.config = { setting: { visible: false } };
  const surface = h.create(); surface.draw();
  assert.equal(surface.status().comments, 0); assert(!h.presents[0].some(op => op[0] === 'fillText'));
});

test('translucent outline, fill and own border combine at full opacity before one group blend', () => {
  const h = harness(); h.textCss.textShadow = '1px 0 1px #000'; h.textCss.opacity = '0.36'; h.item.textData.border = true;
  h.renderer.manager.visualArray.push({ ...h.item });
  h.create().draw();
  const text = h.draws.filter(d => ['strokeText', 'fillText', 'strokeRect'].includes(d.name));
  assert.equal(text.length, 6); assert(text.every(d => d.target === 'text' && d.alpha === 1));
  const groups = h.draws.filter(d => d.name === 'drawImage' && h.buffers.slice(2).includes(d.args[0]));
  assert.equal(groups.length, 2); assert(groups.every(d => d.target === 'video' && d.alpha === 0.36));
  assert.equal(h.buffers[1].width, 1, 'ordinary translucent comments should not reuse the mutable group tile');
  assert.equal(h.presents.length, 1);
});

test('fully opaque text keeps the direct path; a very long translucent comment uses a bounded reusable tile', () => {
  const h = harness(); h.textCss.opacity = '1'; h.create().draw();
  assert(h.draws.filter(d => d.name === 'fillText').every(d => d.target === 'video' && d.alpha === 1));
  assert.equal(h.buffers[1].width, 1);
  const huge = harness(); huge.textCss.textShadow = '1px 0 1px #000'; huge.item.element.getBoundingClientRect = () => ({ x: 10, y: 20, width: 1e9, height: 1e9 }); huge.item.moveDistance = 0;
  const s = huge.create(); s.draw(); s.draw();
  assert.equal(huge.buffers.length, 2); assert(huge.buffers[1].width <= huge.canvas.width); assert(huge.buffers[1].height <= huge.canvas.height);
  assert.equal(huge.draws.filter(d => d.target === 'text' && d.name === 'clearRect').length, 2);
});

test('lost text context does not present a partial frame or hide native video', () => {
  const h = harness(); h.textCss.textShadow = '1px 0 1px #000'; h.textContext.isContextLost = () => true;
  const surface = h.create(); assert.throws(() => surface.draw(), /文字画布上下文丢失/);
  assert.equal(h.presents.length, 0); assert.equal(h.video.style.getPropertyValue('visibility'), ''); surface.restore();
});

function dense(h, count = 64) {
  h.renderer.manager.visualArray = Array.from({ length: count }, (_, i) => ({ ...h.item,
    textData: { ...h.item.textData }, element: { ...h.item.element, textContent: 'dense ' + i, className: 'word', style: { cssText: '' } } }));
}
test('dense text warms at most 16 sprites per frame and then reuses rasters while still presenting every frame', () => {
  const h = harness(); h.textCss.textShadow = '1px 0 1px #000'; dense(h);
  const s = h.create();
  for (let i = 0; i < 4; i++) { s.draw(); assert.equal(s.status().textCache.builds, (i + 1) * 16); }
  const before = h.draws.length; h.renderer.renderTime += 0.1; s.draw();
  assert.equal(h.draws.slice(before).filter(d => d.name === 'fillText').length, 0);
  assert.equal(s.status().comments, 64); assert.equal(s.status().textCache.entries, 64); assert.equal(h.presents.length, 5);
  assert(h.draws.slice(before).filter(d => d.name === 'drawImage' && d.args[0] !== h.video).every(d => d.alpha === 0.8));
  assert(h.draws.slice(before).filter(d => d.name === 'drawImage' && d.args[0] !== h.video).every(d => Number.isInteger(d.args[1] * 2) && Number.isInteger(d.args[2] * 2)));
});
test('dense cache invalidates text, style, own border and DPR/layout, and restores all backing stores', () => {
  const h = harness(); dense(h, 32); const s = h.create(); s.draw(); s.draw();
  const first = h.renderer.manager.visualArray[0], before = s.status().textCache.builds;
  first.element.textContent = 'changed'; s.draw(); assert.equal(s.status().textCache.builds, before + 1);
  first.element.style.cssText = 'color:blue'; s.draw(); assert.equal(s.status().textCache.builds, before + 2);
  first.textData.border = true; first.textData.borderColor = '#f00'; s.draw(); assert.equal(s.status().textCache.builds, before + 3);
  const buffers = h.buffers.slice(2); h.context.devicePixelRatio = 1.25; s.draw(); assert(buffers.every(b => b.width === 1 && b.height === 1));
  assert.equal(h.canvas.width, 1000);
  const resized = h.buffers.slice(2); h.box.width = 810; s.draw(); assert(resized.every(b => b.width === 1 && b.height === 1));
  s.restore(); assert.equal(s.status().textCache.bytes, 0); assert.equal(s.status().textCache.entries, 0); assert(h.buffers.every(b => b.width === 1 && b.height === 1));
});
test('cache byte and entry budgets fall back to drawing all excess comments instead of hiding them', () => {
  const h = harness(); dense(h, 300); const s = h.create();
  for (let i = 0; i < 20; i++) s.draw();
  assert.equal(s.status().textCache.entries, 256); assert.equal(s.status().comments, 300); assert.equal(s.status().skipped, 0);
  const large = harness(); large.item.element.getBoundingClientRect = () => ({ x: 10, y: 20, width: 1000, height: 45 }); dense(large, 100);
  const t = large.create(); for (let i = 0; i < 8; i++) t.draw();
  assert(t.status().textCache.entries < 100); assert(t.status().textCache.bytes <= 48 * 1024 * 1024); assert.equal(t.status().comments, 100);
});
test('inactive rasters expire after a complete unused frame, and sparse direct text does not retain them', () => {
  const h = harness(); dense(h); const s = h.create(); s.draw(); s.draw();
  const retained = h.renderer.manager.visualArray.slice(32), old = h.buffers.slice(2);
  h.renderer.manager.visualArray = retained;
  s.draw(); s.draw(); s.draw();
  assert(old.every(b => b.width === 1 && b.height === 1));
  h.renderer.manager.visualArray = retained.slice(0, 2); s.draw();
  assert.equal(s.status().textCache.entries, 32, 'one inactive frame may retain bounded rasters');
  s.draw();
  assert.equal(s.status().textCache.entries, 0); assert.equal(s.status().comments, 2);
});

test('two to nine long translucent outlined or bordered comments reuse rasters below the dense threshold', () => {
  for (const count of [2, 9]) {
    const h = harness();
    h.textCss.textShadow = count === 2 ? '1px 0 1px #000' : 'none';
    h.textCss.fontSize = '42.26px'; h.textCss.lineHeight = '47.55px';
    h.item.textData.border = count === 9;
    h.item.element.getBoundingClientRect = () => ({ x: 10, y: 20, width: 1100, height: 48 });
    dense(h, count);
    for (const item of h.renderer.manager.visualArray) item.element.textContent = '长弹幕片段'.repeat(10) + item.element.textContent;
    const s = h.create(); s.draw();
    assert.equal(s.status().textCache.entries, count);
    assert.equal(s.status().textCache.builds, count);
    const before = h.draws.length;
    h.renderer.renderTime += 1 / 24; s.draw();
    const nextFrame = h.draws.slice(before);
    assert.equal(nextFrame.filter(d => ['fillText', 'strokeText', 'strokeRect', 'clearRect'].includes(d.name)).length, 0);
    assert.equal(s.status().textCache.hits, count);
    assert.equal(s.status().comments, count); assert.equal(h.presents.length, 2);
    const copies = nextFrame.filter(d => d.name === 'drawImage' && d.args[0] !== h.video);
    assert.equal(copies.length, count); assert(copies.every(d => d.alpha === 0.8));
    assert.equal(h.buffers[1].width, 1);
  }
});

test('DPR 2 long comments between one and four MiB are cached while larger or overwide comments use bounded fallback', () => {
  const h = harness(); h.textCss.textShadow = '1px 0 1px #000'; h.item.moveDistance = 0;
  h.item.element.getBoundingClientRect = () => ({ x: 10, y: 20, width: 2100, height: 60 });
  const s = h.create(); s.draw();
  assert.equal(s.status().textCache.entries, 1);
  assert(s.status().textCache.bytes > 1024 * 1024);
  assert(s.status().textCache.bytes <= 4 * 1024 * 1024);
  const before = h.draws.length; s.draw();
  assert.equal(h.draws.slice(before).filter(d => d.name === 'fillText').length, 0);
  assert.equal(s.status().textCache.hits, 1);
  for (const [width, height] of [[5000, 100], [9000, 1]]) {
    const large = harness(); large.textCss.textShadow = '1px 0 1px #000'; large.item.moveDistance = 0;
    large.item.element.getBoundingClientRect = () => ({ x: 10, y: 20, width, height });
    const surface = large.create(); surface.draw(); surface.draw();
    assert.equal(surface.status().textCache.entries, 0);
    assert.equal(surface.status().comments, 1); assert.equal(large.presents.length, 2);
    assert.equal(large.buffers.length, 2, 'oversized rasters must never be allocated');
    assert(large.buffers[1].width <= large.canvas.width); assert(large.buffers[1].height <= large.canvas.height);
    assert.equal(large.draws.filter(d => d.name === 'clearRect').length, 2);
  }
});

test('crossing 31 and 32 comments preserves active rasters and only rebuilds an expired returning item', () => {
  const h = harness(); h.textCss.textShadow = '1px 0 1px #000'; dense(h, 32);
  const items = h.renderer.manager.visualArray, s = h.create(); s.draw(); s.draw();
  assert.equal(s.status().textCache.builds, 32);
  const before = h.draws.length;
  for (const [count, builds] of [[31, 32], [32, 33], [31, 33], [32, 34]]) {
    h.renderer.manager.visualArray = items.slice(0, count); s.draw();
    assert.equal(s.status().comments, count); assert.equal(s.status().textCache.builds, builds);
  }
  assert.equal(h.draws.slice(before).filter(d => d.name === 'fillText').length, 2);
  assert.equal(s.status().textCache.entries, 32); assert.equal(h.presents.length, 6);
});

test('hiding native danmaku immediately releases sparse outlined rasters without repainting text', () => {
  const h = harness(); h.textCss.textShadow = '1px 0 1px #000';
  const s = h.create(); s.draw();
  assert.equal(s.status().textCache.entries, 1);
  const rasters = h.buffers.slice(2), before = h.draws.length;
  h.renderer.config = { setting: { visible: false } }; s.draw();
  assert.equal(s.status().textCache.entries, 0); assert.equal(s.status().textCache.bytes, 0);
  assert.equal(s.status().comments, 0); assert(rasters.every(b => b.width === 1 && b.height === 1));
  assert.equal(h.draws.slice(before).filter(d => ['fillText', 'strokeText'].includes(d.name)).length, 0);
});
test('lost dense raster context fails before presentation and can release every cached store', () => {
  const h = harness(); dense(h, 32); const s = h.create(); s.draw(); s.draw();
  const before = h.presents.length; h.textContext.isContextLost = () => true;
  assert.throws(() => s.draw(), /文字画布上下文丢失/); assert.equal(h.presents.length, before);
  s.restore(); assert.equal(s.status().textCache.bytes, 0); assert(h.buffers.every(b => b.width === 1 && b.height === 1));
});
