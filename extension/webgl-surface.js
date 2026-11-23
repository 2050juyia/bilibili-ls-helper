// Zero-readback WebGL single-canvas presenter for Gecko/Firefox.
// Composites hardware <video> + cached premultiplied 2D sprites on GPU in <1ms,
// avoiding both CPU video readbacks and dual-swapchain WGC double-flips.
(function (root) {
  'use strict';
  const VS = [
    'attribute vec2 aPos;',
    'uniform vec4 uRect;',
    'uniform vec4 uUvRect;',
    'uniform vec2 uCanvasSize;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec2 css = uRect.xy + aPos * uRect.zw;',
    '  vec2 clip = vec2((css.x / uCanvasSize.x) * 2.0 - 1.0, 1.0 - (css.y / uCanvasSize.y) * 2.0);',
    '  vUv = uUvRect.xy + aPos * uUvRect.zw;',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '}'
  ].join('\n');

  const FS = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform float uAlpha;',
    'uniform float uOpaque;',
    'void main() {',
    '  vec4 c = texture2D(uTex, vUv);',
    '  gl_FragColor = uOpaque > 0.5 ? vec4(c.rgb, 1.0) : c * uAlpha;',
    '}'
  ].join('\n');

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function create(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const attrs = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false
    };
    let gl = null;
    try {
      gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
    } catch {
      return null;
    }
    if (!gl || typeof gl.createShader !== 'function') return null;

    const vs = compile(gl, gl.VERTEX_SHADER, VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }

    gl.useProgram(program);
    const quad = gl.createBuffer();
    if (!quad) {
      gl.deleteProgram(program);
      return null;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRect = gl.getUniformLocation(program, 'uRect');
    const uUvRect = gl.getUniformLocation(program, 'uUvRect');
    const uCanvasSize = gl.getUniformLocation(program, 'uCanvasSize');
    const uAlpha = gl.getUniformLocation(program, 'uAlpha');
    const uOpaque = gl.getUniformLocation(program, 'uOpaque');
    const uTex = gl.getUniformLocation(program, 'uTex');
    gl.uniform1i(uTex, 0);

    function makeTexture() {
      const tex = gl.createTexture();
      if (!tex) return null;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }

    const videoTex = makeTexture();
    const dynamicTex = makeTexture();
    if (!videoTex || !dynamicTex) {
      if (videoTex) gl.deleteTexture(videoTex);
      if (dynamicTex) gl.deleteTexture(dynamicTex);
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
      return null;
    }
    let cssW = 1, cssH = 1, currentDpr = 1;

    function isContextLost() {
      return gl.isContextLost?.() === true;
    }

    function beginFrame(width, height, boxWidth, boxHeight, dpr) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      cssW = boxWidth;
      cssH = boxHeight;
      currentDpr = dpr;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uCanvasSize, cssW, cssH);
    }

    function setScissor(x, y, w, h) {
      const sx = Math.max(0, Math.round(x * currentDpr));
      const sy = Math.max(0, Math.round((cssH - (y + h)) * currentDpr));
      const sw = Math.max(0, Math.round(w * currentDpr));
      const sh = Math.max(0, Math.round(h * currentDpr));
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(sx, sy, sw, sh);
    }

    function clearScissor() {
      gl.disable(gl.SCISSOR_TEST);
    }

    function drawVideo(video, x, y, w, h) {
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.uniform4f(uRect, x, y, w, h);
      gl.uniform4f(uUvRect, 0, 0, 1, 1);
      gl.uniform1f(uAlpha, 1);
      gl.uniform1f(uOpaque, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function uploadSprite(source, strict = false) {
      const tex = makeTexture();
      if (!tex) {
        if (strict) throw new Error('WebGL texture allocation failed');
        return null;
      }
      try {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        return tex;
      } catch (err) {
        deleteTexture(tex);
        if (strict) throw err;
        return null;
      }
    }

    function drawQuad(tex, x, y, w, h, alpha, uw, vh) {
      if (!tex || !(w > 0 && h > 0) || alpha <= 0) return;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform4f(uRect, x, y, w, h);
      gl.uniform4f(uUvRect, 0, 0, uw, vh);
      gl.uniform1f(uAlpha, Math.max(0, Math.min(1, alpha)));
      gl.uniform1f(uOpaque, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function drawTexture(tex, x, y, w, h, alpha) {
      drawQuad(tex, x, y, w, h, alpha, 1, 1);
    }

    function drawDynamicSource(source, x, y, w, h, alpha, srcW, srcH) {
      if (!source || !(w > 0 && h > 0) || alpha <= 0) return;
      const totalW = source.width || source.displayWidth || source.codedWidth || srcW || 0;
      const totalH = source.height || source.displayHeight || source.codedHeight || srcH || 0;
      const subW = srcW || totalW;
      const subH = srcH || totalH;
      if (!(totalW > 0 && totalH > 0 && subW > 0 && subH > 0)) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dynamicTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      drawQuad(dynamicTex, x, y, w, h, alpha, Math.min(1, subW / totalW), Math.min(1, subH / totalH));
    }

    function deleteTexture(tex) {
      if (tex) {
        try { gl.deleteTexture(tex); } catch {}
      }
    }

    function dispose() {
      try {
        gl.disable(gl.SCISSOR_TEST);
        gl.deleteTexture(videoTex);
        gl.deleteTexture(dynamicTex);
        gl.deleteBuffer(quad);
        gl.deleteProgram(program);
      } catch {}
    }

    return {
      isContextLost,
      beginFrame,
      setScissor,
      clearScissor,
      drawVideo,
      uploadSprite,
      drawTexture,
      drawDynamicSource,
      deleteTexture,
      dispose
    };
  }

  root.BFDWebGLSurface = { create };
})(globalThis);
