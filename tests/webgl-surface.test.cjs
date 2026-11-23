const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../extension/webgl-surface.js'), 'utf8');

function createMockGL(overrides = {}) {
  const calls = [];
  const deletedTextures = [];
  const deletedBuffers = [];
  const deletedPrograms = [];
  const deletedShaders = [];
  let nextTexId = 1;
  let lost = false;

  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    SCISSOR_TEST: 0x0c11,
    COLOR_BUFFER_BIT: 0x4000,
    BLEND: 0x0be2,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    TRIANGLE_STRIP: 0x0005,

    createShader: type => ({ type }),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    deleteShader: s => deletedShaders.push(s),
    createProgram: () => ({ id: 'prog' }),
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    deleteProgram: p => deletedPrograms.push(p),
    useProgram() {},
    createBuffer: () => ({ id: 'quad' }),
    bindBuffer() {},
    bufferData() {},
    deleteBuffer: b => deletedBuffers.push(b),
    getAttribLocation: () => 0,
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    getUniformLocation: (_prog, name) => name,
    uniform1i: (u, v) => calls.push(['uniform1i', u, v]),
    uniform1f: (u, v) => calls.push(['uniform1f', u, v]),
    uniform2f: (u, x, y) => calls.push(['uniform2f', u, x, y]),
    uniform4f: (u, x, y, z, w) => calls.push(['uniform4f', u, x, y, z, w]),
    createTexture: () => ({ texId: nextTexId++ }),
    bindTexture: (_t, tex) => calls.push(['bindTexture', tex?.texId ?? null]),
    texParameteri() {},
    deleteTexture: tex => deletedTextures.push(tex?.texId ?? tex),
    viewport: (x, y, w, h) => calls.push(['viewport', x, y, w, h]),
    enable: cap => calls.push(['enable', cap]),
    disable: cap => calls.push(['disable', cap]),
    scissor: (x, y, w, h) => calls.push(['scissor', x, y, w, h]),
    clearColor() {},
    clear: mask => calls.push(['clear', mask]),
    activeTexture() {},
    pixelStorei: (k, v) => calls.push(['pixelStorei', k, v]),
    texImage2D: (_t, _l, _if, _f, _ty, src) => calls.push(['texImage2D', src]),
    texSubImage2D: (_t, _l, _x, _y, _f, _ty, src) => calls.push(['texSubImage2D', src]),
    blendFunc: (s, d) => calls.push(['blendFunc', s, d]),
    drawArrays: (mode, first, count) => calls.push(['drawArrays', mode, first, count]),
    isContextLost: () => lost,
    setLost: v => { lost = v; },
    ...overrides
  };

  return { gl, calls, deletedTextures, deletedBuffers, deletedPrograms, deletedShaders };
}

function loadSurface() {
  const ctx = { Float32Array };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return ctx.BFDWebGLSurface;
}

test('BFDWebGLSurface initializes opaque WebGL2/WebGL1 context, flips Y scissor accurately, and crops dynamic sub-rects', () => {
  const BFDWebGLSurface = loadSurface();
  const mock = createMockGL();
  const requested = [];
  const canvas = {
    width: 1,
    height: 1,
    getContext(kind, attrs) {
      requested.push({ kind, attrs });
      return kind === 'webgl' ? mock.gl : null; // force webgl1 fallback
    }
  };

  const surface = BFDWebGLSurface.create(canvas);
  assert(surface);
  assert.deepEqual(requested.map(r => r.kind), ['webgl2', 'webgl']);
  assert.equal(requested[0].attrs.alpha, false);
  assert.equal(requested[0].attrs.premultipliedAlpha, true);
  assert.equal(requested[0].attrs.preserveDrawingBuffer, false);

  surface.beginFrame(1920, 1080, 960, 540, 2);
  assert.equal(canvas.width, 1920);
  assert.equal(canvas.height, 1080);

  // Scissor at CSS (10, 20, 400, 100) inside 960x540 at DPR 2 -> WebGL bottom-up sy = (540 - 120) * 2 = 840
  surface.setScissor(10, 20, 400, 100);
  assert.deepEqual(mock.calls.find(c => c[0] === 'scissor'), ['scissor', 20, 840, 800, 200]);

  const video = { id: 'hw-video', videoWidth: 1920, videoHeight: 1080 };
  surface.drawVideo(video, 0, 0, 960, 540);
  assert(mock.calls.some(c => c[0] === 'texImage2D' && c[1] === video));
  assert(mock.calls.some(c => c[0] === 'uniform1f' && c[1] === 'uOpaque' && c[2] === 1));
  surface.drawVideo(video, 0, 0, 960, 540);
  assert(mock.calls.some(c => c[0] === 'texSubImage2D' && c[1] === video), 'unchanged video dimensions reuse texture via texSubImage2D');

  const tile = { width: 200, height: 50 };
  const tex = surface.uploadSprite(tile);
  assert.equal(tex.texId, 3);
  surface.drawTexture(tex, 120, 40, 100, 25, 0.8);
  assert(mock.calls.some(c => c[0] === 'uniform1f' && c[1] === 'uAlpha' && Math.abs(c[2] - 0.8) < 1e-6));

  // Shared 800x100 buffer with 200x50 painted sub-region -> uUvRect (0, 0, 0.25, 0.5)
  const shared = { width: 800, height: 100 };
  mock.calls.length = 0;
  surface.drawDynamicSource(shared, 10, 10, 100, 25, 0.5, 200, 50);
  assert.deepEqual(
    mock.calls.find(c => c[0] === 'uniform4f' && c[1] === 'uUvRect'),
    ['uniform4f', 'uUvRect', 0, 0, 0.25, 0.5]
  );

  surface.deleteTexture(tex);
  assert.deepEqual(mock.deletedTextures, [3]);

  assert.equal(surface.isContextLost(), false);
  mock.gl.setLost(true);
  assert.equal(surface.isContextLost(), true);

  surface.dispose();
  assert.deepEqual(mock.deletedTextures, [3, 1, 2]);
  assert.equal(mock.deletedBuffers.length, 1);
  assert.equal(mock.deletedPrograms.length, 1);
});

test('BFDWebGLSurface cleans up failed shader/texture allocations and supports strict upload errors', () => {
  const BFDWebGLSurface = loadSurface();
  const badShader = createMockGL({ getShaderParameter: () => false });
  assert.equal(BFDWebGLSurface.create({ getContext: () => badShader.gl }), null);
  assert.equal(badShader.deletedShaders.length, 2);

  const mock = createMockGL({
    texImage2D: (_t, _l, _if, _f, _ty, src) => {
      if (src?.corrupt) throw new Error('corrupt bitmap');
    }
  });
  const surface = BFDWebGLSurface.create({ width: 1, height: 1, getContext: () => mock.gl });
  assert.equal(surface.uploadSprite({ corrupt: true }, false), null);
  assert.throws(() => surface.uploadSprite({ corrupt: true }, true), /corrupt bitmap/);
  assert.equal(mock.deletedTextures.length, 2, 'failed uploads must immediately free allocated GL texture');
  surface.dispose();
});
