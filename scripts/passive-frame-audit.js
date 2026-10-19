// Development-only, passive instrumentation. Do not include in the extension.
// Evaluate in the existing page's MAIN world, then use:
// BFDPassiveFrameAudit.start({ from: 1098, to: 1115, label: 'resident-code' });
// await BFDPassiveFrameAudit.report({ includeRows: true });
// BFDPassiveFrameAudit.dispose();
(function (root) {
  'use strict';
  if (root.BFDPassiveFrameAudit?.passiveAuditVersion === 1) {
    throw new Error('Passive frame audit already exists; reuse its start/report/dispose methods.');
  }
  const patches = [], unsupported = [];
  let installed = false, session = null, activeRow = null;
  const now = () => root.performance.now();
  function patch(object, name, make) {
    if (!object || typeof object[name] !== 'function') { unsupported.push(name); return; }
    const descriptor = Object.getOwnPropertyDescriptor(object, name), original = object[name];
    const wrapped = make(original);
    try {
      object[name] = wrapped;
      if (object[name] !== wrapped) throw new Error('readonly');
      patches.push({ object, name, descriptor, wrapped });
    } catch (_) { unsupported.push(name); }
  }
  function finish(reason, detail) {
    if (!session?.running) return;
    session.running = false; session.stopReason = reason;
    session.stopDetail = detail || null; session.stoppedAt = now();
  }
  function canvasSize(canvas) {
    return canvas ? { width: canvas.width, height: canvas.height } : null;
  }
  function recordCallback(callback, receiver, args, video) {
    const s = session, metadata = args[1] || {}, started = now(), media = metadata.mediaTime;
    if (!installed || !s?.running || video !== s.video || !Number.isFinite(media)) {
      return Reflect.apply(callback, receiver, args);
    }
    if (s.last) {
      const wallGap = started - s.last.started, mediaGap = media - s.last.mediaTime;
      if (mediaGap < -0.001) finish('media-time-backwards', { previous: s.last.mediaTime, media });
      else if (wallGap > s.maxGapMs) finish('callback-gap', { wallGapMs: wallGap, mediaGapSeconds: mediaGap });
      else if (mediaGap > s.maxMediaGapSeconds) finish('media-time-jump', { mediaGapSeconds: mediaGap });
      else if (Number.isFinite(metadata.presentedFrames) && Number.isFinite(s.last.presentedFrames) &&
          metadata.presentedFrames < s.last.presentedFrames) finish('presented-counter-reset');
    }
    if (s.running && media > s.to) finish('range-complete', { media });
    if (!s.running || media < s.from) return Reflect.apply(callback, receiver, args);
    if (s.rows.length >= s.maxRows) { finish('row-limit'); return Reflect.apply(callback, receiver, args); }
    s.canvas ||= root.document.querySelector('.bfd-video-composite');
    const row = { now: args[0], started, mediaTime: media,
      presentedFrames: metadata.presentedFrames ?? null,
      expectedDisplayTime: metadata.expectedDisplayTime ?? null,
      presentationTime: metadata.presentationTime ?? null,
      processingDuration: metadata.processingDuration ?? null,
      sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
      callbackWidth: metadata.width ?? null, callbackHeight: metadata.height ?? null,
      playbackRate: video.playbackRate, backing: canvasSize(s.canvas),
      ops: {}, counts: {}, maxCallMs: {} };
    const previousRow = activeRow; activeRow = row;
    try { return Reflect.apply(callback, receiver, args); }
    catch (error) { row.error = String(error?.message || error); throw error; }
    finally {
      row.callbackMs = now() - started;
      row.latenessMs = Number.isFinite(row.expectedDisplayTime) ? started - row.expectedDisplayTime : null;
      if (!s.canvas) s.canvas = root.document.querySelector('.bfd-video-composite');
      row.backing = canvasSize(s.canvas);
      activeRow = previousRow;
      // A report or dispose call from inside a callback must not redirect it
      // into a later session. Keep the row with the session it came from.
      s.rows.push(row); s.last = row;
    }
  }
  function timed(category) {
    return original => function (...args) {
      const row = activeRow;
      if (!row) return Reflect.apply(original, this, args);
      const key = typeof category === 'function' ? category.call(this, args, row) : category;
      const started = now();
      try { return Reflect.apply(original, this, args); }
      finally {
        const elapsed = now() - started;
        row.ops[key] = (row.ops[key] || 0) + elapsed;
        row.counts[key] = (row.counts[key] || 0) + 1;
        row.maxCallMs[key] = Math.max(row.maxCallMs[key] || 0, elapsed);
      }
    };
  }
  function install() {
    if (installed) return;
    installed = true; unsupported.length = 0;
    patch(root.HTMLVideoElement?.prototype, 'requestVideoFrameCallback', original => function (...args) {
      const callback = args[0];
      if (typeof callback === 'function' && callback.name === 'frame') {
        const video = this;
        args[0] = function auditedFrame(...callbackArgs) {
          return recordCallback(callback, this, callbackArgs, video);
        };
      }
      return Reflect.apply(original, this, args);
    });
    const drawCategory = function (args, row) {
      const source = args[0];
      if (source === session?.video || (root.HTMLVideoElement && source instanceof root.HTMLVideoElement)) {
        row.compositionBacking = canvasSize(this.canvas);
        return 'videoCopy';
      }
      if (this.canvas?.classList?.contains('bfd-video-composite')) return 'surfaceCopy';
      return 'textCopy';
    };
    const prototypes = new Set([root.OffscreenCanvasRenderingContext2D?.prototype, root.CanvasRenderingContext2D?.prototype]);
    for (const prototype of prototypes) {
      if (!prototype) continue;
      patch(prototype, 'drawImage', timed(drawCategory));
      for (const name of ['fillText', 'strokeText', 'clearRect', 'fillRect', 'strokeRect']) patch(prototype, name, timed(name));
    }
    patch(root.OffscreenCanvas?.prototype, 'transferToImageBitmap', timed('bitmap'));
    patch(root.ImageBitmapRenderingContext?.prototype, 'transferFromImageBitmap', timed('present'));
  }
  function start(options = {}) {
    const from = options.from ?? 0, to = options.to ?? Infinity;
    if (!Number.isFinite(from) || from < 0 || !(to > from) || (to !== Infinity && !Number.isFinite(to))) {
      throw new Error('Expected a finite nonnegative from and numeric to > from.');
    }
    const video = options.video || root.document.querySelector('.bpx-player-container video') || root.document.querySelector('video');
    if (!video) throw new Error('No existing video found.');
    for (const key of ['maxGapMs', 'maxMediaGapSeconds', 'maxRows']) {
      if (options[key] !== undefined && (!Number.isFinite(options[key]) || options[key] <= 0)) throw new Error(key + ' must be positive.');
    }
    if (options.maxRows !== undefined && !Number.isInteger(options.maxRows)) throw new Error('maxRows must be an integer.');
    finish('restarted'); install();
    const factory = root.BFDCompositor?.create;
    const factoryText = typeof factory === 'function' ? Function.prototype.toString.call(factory).replace(/\r\n/g, '\n') : '';
    session = { running: true, label: String(options.label || ''), from, to, video, canvas: null,
      startedAt: now(), startedWallTime: new Date().toISOString(), rows: [], last: null, factoryText,
      maxGapMs: options.maxGapMs ?? 1500, maxMediaGapSeconds: options.maxMediaGapSeconds ?? 2,
      maxRows: Math.floor(options.maxRows ?? 10000), stopReason: null, stopDetail: null };
    return { running: true, label: session.label, from, to, source: { width: video.videoWidth, height: video.videoHeight } };
  }
  function statistics(values) {
    const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!ordered.length) return { count: 0, mean: null, p95: null, max: null };
    return { count: ordered.length, mean: ordered.reduce((a, b) => a + b, 0) / ordered.length,
      p95: ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)], max: ordered.at(-1) };
  }
  function operationSummary(rows) {
    const keys = new Set(rows.flatMap(row => Object.keys(row.ops)));
    return Object.fromEntries([...keys].map(key => [key, {
      calls: rows.reduce((total, row) => total + (row.counts[key] || 0), 0),
      totalMs: rows.reduce((total, row) => total + (row.ops[key] || 0), 0),
      perCallbackMs: statistics(rows.map(row => row.ops[key] || 0)),
      maxCallMs: Math.max(0, ...rows.map(row => row.maxCallMs[key] || 0))
    }]));
  }
  function summary(rows) {
    const first = rows[0], last = rows.at(-1), span = first && last ? last.started - first.started : 0;
    let missedPresented = 0, repeatedMedia = 0;
    for (let i = 1; i < rows.length; i++) {
      const delta = rows[i].presentedFrames - rows[i - 1].presentedFrames;
      if (rows[i].presentedFrames !== null && rows[i - 1].presentedFrames !== null) missedPresented += Math.max(0, delta - 1);
      if (rows[i].mediaTime === rows[i - 1].mediaTime) repeatedMedia++;
    }
    return { callbacks: rows.length, firstMediaTime: first?.mediaTime ?? null, lastMediaTime: last?.mediaTime ?? null,
      callbackFPS: span > 0 ? (rows.length - 1) * 1000 / span : null,
      observedPresentedFPS: span > 0 && first.presentedFrames !== null && last.presentedFrames !== null ?
        (last.presentedFrames - first.presentedFrames) * 1000 / span : null,
      missedPresented, repeatedMedia, callbackMs: statistics(rows.map(row => row.callbackMs)),
      latenessMs: statistics(rows.map(row => row.latenessMs)) };
  }
  async function report(options = {}) {
    if (!session) return { running: false, stopReason: 'not-started', summary: summary([]), perSecond: [], ops: {} };
    const s = session, rows = s.rows.slice(), groups = new Map();
    for (const row of rows) {
      const second = Math.floor(row.mediaTime);
      if (!groups.has(second)) groups.set(second, []);
      groups.get(second).push(row);
    }
    let hash = null, hashError = null;
    if (s.factoryText) {
      try {
        const bytes = new TextEncoder().encode(s.factoryText);
        const digest = await root.crypto.subtle.digest('SHA-256', bytes);
        hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      } catch (error) { hashError = String(error?.message || error); }
    }
    const result = { label: s.label, running: s.running, from: s.from, to: Number.isFinite(s.to) ? s.to : null,
      stopReason: s.stopReason, stopDetail: s.stopDetail, startedWallTime: s.startedWallTime,
      loadedFactorySHA256: hash, loadedFactoryLength: s.factoryText.length,
      loadedFactoryHasRasterCache: /\bpaintSprite\b/.test(s.factoryText) && /\bmaxSpriteBytes\b/.test(s.factoryText), hashError,
      summary: summary(rows), ops: operationSummary(rows),
      perSecond: [...groups].map(([second, items]) => ({ second, ...summary(items), ops: operationSummary(items) })),
      unsupportedMethods: [...unsupported],
      boundary: 'Passive MAIN-world instrumentation of existing video callbacks named frame; no extra frame callbacks, animation callbacks or timers. Timings are JavaScript API submission/wait durations, not GPU execution or Lossless Scaling capture/output FPS. Factory hash/cache capability describe the factory visible when start was called, not an independent proof of a resident renderer cache.' };
    if (options.includeRows || options.rows) result.rows = rows;
    return result;
  }
  function dispose() {
    finish('disposed'); installed = false;
    for (const { object, name, descriptor, wrapped } of patches.reverse()) {
      if (object[name] !== wrapped) continue;
      if (descriptor) Object.defineProperty(object, name, descriptor); else delete object[name];
    }
    patches.length = 0;
  }
  root.BFDPassiveFrameAudit = { passiveAuditVersion: 1, start, report, stop: () => finish('manual'), dispose };
})(globalThis);
