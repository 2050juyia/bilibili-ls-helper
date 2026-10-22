// Experimental native DanmakuX adapter. Only video-frame callbacks drive motion.
(function (root) {
  'use strict';
  const diagnosticKey = 'bfd-video-sync-diagnostics-v1', recoveryDelays = [150, 500, 1500];
  const syncCSS = '.bfd-video-sync .bili-danmaku-x-dm,.bfd-video-sync .bili-danmaku-x-dm *{animation:none!important;transition:none!important;visibility:hidden!important}';
  const failureMessages = { 'draw-error': '视频合成绘制异常', 'frame-callback-stalled': '视频帧回调停止', 'install-error': '同步适配安装失败',
    'composite-context-lost': '合成画布上下文丢失', 'text-context-lost': '文字画布上下文丢失', 'invalid-frame-time': '视频帧时间不可用',
    InvalidStateError: 'InvalidStateError', SecurityError: 'SecurityError', QuotaExceededError: 'QuotaExceededError', OperationError: 'OperationError', TypeError: 'TypeError' };
  function failureReason(stage, error) {
    if (stage === 'stale') return 'frame-callback-stalled';
    try {
      if (error?.message === '合成画布上下文丢失') return 'composite-context-lost';
      if (error?.message === '文字画布上下文丢失') return 'text-context-lost';
      if (error?.message === '视频帧时间不可用') return 'invalid-frame-time';
      if (['InvalidStateError', 'SecurityError', 'QuotaExceededError', 'OperationError', 'TypeError'].includes(error?.name)) return error.name;
    } catch {}
    return stage === 'install' ? 'install-error' : 'draw-error';
  }
  function staleDetails(value) {
    const bounded = number => Number.isFinite(number) ? Math.max(0, Math.min(86400000, Math.round(number))) : 0;
    return { frameAgeMs: bounded(value?.frameAgeMs), mediaBehindMs: bounded(value?.mediaBehindMs),
      readyState: Number.isInteger(value?.readyState) && value.readyState >= 0 && value.readyState <= 4 ? value.readyState : 0,
      paused: value?.paused === true, seeking: value?.seeking === true };
  }
  let recentStatus = null, diagnostics = [];
  function readStoredDiagnostics() {
    try {
      const stored = JSON.parse(root.sessionStorage?.getItem(diagnosticKey) || '[]');
      if (Array.isArray(stored)) diagnostics = stored.slice(-5).map(entry => ({
        time: Number.isFinite(entry.time) ? entry.time : 0,
        pageKey: typeof entry.pageKey === 'string' && /^\/(?:video\/[A-Za-z0-9]+|bangumi\/play\/[A-Za-z0-9]+)\/?\?p=\d+$/.test(entry.pageKey) ? entry.pageKey.slice(0, 120) : '',
        stage: ['draw', 'stale', 'install'].includes(entry.stage) ? entry.stage : 'draw',
        reason: Object.hasOwn(failureMessages, entry.reason) ? entry.reason : 'draw-error',
        message: Object.hasOwn(failureMessages, entry.reason) ? failureMessages[entry.reason] : failureMessages['draw-error'],
        recovery: ['pending', 'retrying', 'recovered', 'retry-failed', 'exhausted', 'paused', 'seeking', 'media-loading', 'disabled', 'page-hidden', 'renderer-changed', 'unavailable'].includes(entry.recovery) ? entry.recovery : 'unavailable',
        ...(entry.stage === 'stale' ? staleDetails(entry) : {})
      }));
    } catch { /* Storage is optional and never part of the playback path. */ }
    return diagnostics.map(entry => ({ ...entry }));
  }
  readStoredDiagnostics();
  function persistDiagnostics() { try { root.sessionStorage?.setItem(diagnosticKey, JSON.stringify(diagnostics)); } catch {} }
  function cleanPageKey() {
    try {
      const url = new URL(root.location.href), page = url.searchParams.get('p');
      return /^\/(?:video\/[A-Za-z0-9]+|bangumi\/play\/[A-Za-z0-9]+)\/?$/.test(url.pathname)
        ? (url.pathname + '?p=' + (/^\d+$/.test(page || '') ? page : '1')).slice(0, 120) : '';
    } catch { return ''; }
  }
  function recordFailure(stage, error, details) {
    const reason = failureReason(stage, error);
    const entry = { time: Date.now(), pageKey: cleanPageKey(), stage,
      reason, message: failureMessages[reason], recovery: 'pending', ...(stage === 'stale' ? staleDetails(details) : {}) };
    diagnostics.push(entry); diagnostics = diagnostics.slice(-5); persistDiagnostics(); return entry;
  }
  function outcome(entry, value) { if (entry && diagnostics.includes(entry)) { entry.recovery = value; persistDiagnostics(); } }
  function create() {
    let state = null, reason = '未启用', failedRenderer = null, retry = 0, attempt = 0, desired = {};
    let recovery = null, recoveryAttempts = 0, pageHidden = false;
    function currentRenderer() { try { return root.player?.danmaku?.getDanmakuX?.(); } catch { return null; } }
    function ensureSyncStyle(s) {
      if (!s.style.isConnected) (document.head || document.documentElement).appendChild(s.style);
      if (s.style.textContent !== syncCSS) s.style.textContent = syncCSS;
      if (s.style.sheet?.disabled) s.style.sheet.disabled = false;
      if (!s.container.classList.contains('bfd-video-sync')) s.container.classList.add('bfd-video-sync');
    }
    function clearRecovery(message, resetBudget = false) {
      const previous = recovery; recovery = null;
      if (previous) {
        if (previous.timer) clearTimeout(previous.timer);
        for (const [name, fn] of previous.events) previous.video.removeEventListener(name, fn);
        if (message === 'renderer-changed' || message === 'page-hidden') { try { previous.scheduler.stop(); } catch {} }
        if (message) outcome(previous.record, message);
      }
      if (resetBudget) recoveryAttempts = 0;
    }
    function unavailable(renderer, message, error) {
      clearRecovery('unavailable');
      failedRenderer = renderer; reason = message;
      outcome(recordFailure('install', error), 'unavailable');
    }
    function restore(s, resumeNative) {
      s.video.cancelVideoFrameCallback(s.pending);
      if (s.uiPending) root.cancelAnimationFrame(s.uiPending);
      // A renderer being replaced must never restart its old native RAF loop.
      try { s.scheduler.stop(); } catch {}
      s.resizeObserver?.disconnect();
      for (const [object, name, native, wrapped] of s.patches.reverse()) {
        if (object[name] === wrapped) object[name] = native;
      }
      for (const [name, fn] of s.events) s.video.removeEventListener(name, fn);
      for (const [target, name, fn] of s.uiEvents) target.removeEventListener(name, fn, true);
      s.surface?.restore();
      s.style.remove();
      s.container.classList.remove('bfd-video-sync');
      // Resume only a still-live renderer which the player considers running.
      if (resumeNative && !pageHidden && currentRenderer() === s.renderer && s.renderer.isRunning && s.video.isConnected && s.container.isConnected && s.renderer.frameScheduler === s.scheduler) {
        // A broken native resume must not interrupt cleanup or prevent the
        // bounded synchronous-renderer rebuild from being scheduled next.
        try { s.scheduler.start(); } catch {}
      }
    }
    function stop(message, resumeNative = true) {
      const previous = state; state = null; reason = message;
      if (previous) restore(previous, resumeNative);
    }
    function armRecovery(r) {
      if (recovery !== r || r.timer || pageHidden) return;
      if (!desired.enabled || desired.motion !== 'video-sync') { clearRecovery('disabled', true); return; }
      if (currentRenderer() !== r.renderer || r.renderer.frameScheduler !== r.scheduler || !r.video.isConnected || !r.renderer.container?.isConnected) {
        clearRecovery('renderer-changed', true); update(desired, currentRenderer()); return;
      }
      if (r.video.paused || r.video.ended) { r.phase = 'paused'; outcome(r.record, 'paused'); return; }
      if (r.video.seeking) { r.phase = 'seeking'; outcome(r.record, 'seeking'); return; }
      if (r.video.readyState < 2) { r.phase = 'media-loading'; outcome(r.record, 'media-loading'); return; }
      if (recoveryAttempts >= recoveryDelays.length) { r.phase = 'exhausted'; outcome(r.record, 'exhausted'); return; }
      r.phase = 'pending';
      const timer = setTimeout(() => {
        if (recovery !== r || r.timer !== timer) return;
        r.timer = 0;
        if (pageHidden) return;
        if (r.video.paused || r.video.ended || r.video.seeking || r.video.readyState < 2) { armRecovery(r); return; }
        if (currentRenderer() !== r.renderer || r.renderer.frameScheduler !== r.scheduler || !r.video.isConnected) {
          clearRecovery('renderer-changed', true); update(desired, currentRenderer()); return;
        }
        recoveryAttempts++; r.phase = 'retrying'; outcome(r.record, 'retrying');
        update(desired, r.renderer, true);
      }, recoveryDelays[recoveryAttempts]);
      r.timer = timer;
    }
    function recover(s, stage, message, error) {
      if (state !== s) return;
      const details = stage === 'stale' ? { frameAgeMs: Date.now() - s.lastCallbackAt, mediaBehindMs: (s.video.currentTime - s.mediaTime) * 1000,
        readyState: s.video.readyState, paused: s.video.paused, seeking: s.video.seeking } : null;
      clearRecovery('retry-failed');
      stop(message);
      const r = recovery = { renderer: s.renderer, video: s.video, scheduler: s.scheduler, timer: 0, events: [], phase: 'pending', stableFrames: 0, record: recordFailure(stage, error, details) };
      function listen(name, fn) { s.video.addEventListener(name, fn); r.events.push([name, fn]); }
      function suspend(phase) { if (recovery !== r) return; if (r.timer) clearTimeout(r.timer); r.timer = 0; r.phase = phase; outcome(r.record, phase); }
      listen('pause', () => suspend('paused')); listen('ended', () => suspend('paused'));
      listen('seeking', () => suspend('seeking')); listen('emptied', () => suspend('media-loading'));
      for (const name of ['play', 'seeked', 'loadeddata', 'canplay']) listen(name, () => armRecovery(r));
      armRecovery(r);
    }
    function update(settings, renderer, recoveryAttach = false) {
      if (root.BFDFixedCore && !root.BFDFixedCore.isVideoPage(root.location.href)) settings = { enabled: false };
      if (desired.enabled !== settings.enabled || desired.motion !== settings.motion) attempt = 0;
      desired = settings;
      if (!settings.enabled || settings.motion !== 'video-sync') {
        clearRecovery('disabled', true);
        if (retry) { clearTimeout(retry); retry = 0; }
        failedRenderer = null;
        if (state) stop('未启用');
        return;
      }
      if (pageHidden) return;
      const container = renderer?.container;
      const video = container?.closest('.bpx-player-container')?.querySelector('video');
      if (recovery && (recovery.renderer !== renderer || recovery.video !== video || recovery.scheduler !== renderer?.frameScheduler)) clearRecovery('renderer-changed', true);
      if (recovery && recovery.phase !== 'stabilizing' && !recoveryAttach) {
        if (recovery.phase !== 'exhausted') armRecovery(recovery);
        return;
      }
      if (state && state.renderer === renderer && state.scheduler === renderer.frameScheduler && state.container === container && state.video === video && video.isConnected) {
        if (video.paused && !state.surface.status().committed) state.requestUi?.();
        return;
      }
      if (state) stop('等待播放器', false);
      if (!renderer || !video || !container?.isConnected) {
        reason = '等待原生播放器就绪';
        // Player internals may appear after canplay. Bounded readiness retries,
        // never a continuous timer or a substitute for video-frame scheduling.
        const delays = [50, 150, 350, 750, 1500, 3000];
        if (!retry && attempt < delays.length) retry = setTimeout(() => {
          retry = 0; update(desired, root.player?.danmaku?.getDanmakuX?.());
        }, delays[attempt++]);
        return;
      }
      if (retry) { clearTimeout(retry); retry = 0; }
      if (renderer === failedRenderer) return;
      if (typeof video.requestVideoFrameCallback !== 'function' || typeof video.cancelVideoFrameCallback !== 'function') {
        unavailable(renderer, '此浏览器不支持视频帧回调'); return;
      }
      if (typeof root.BFDCompositor?.create !== 'function') {
        unavailable(renderer, '此浏览器不支持合成画布'); return;
      }
      const scheduler = renderer.frameScheduler, clock = renderer.timeController;
      if (!scheduler || !['start', 'stop', 'startImmediate'].every(name => typeof scheduler[name] === 'function') ||
          !clock || typeof clock.updateTime !== 'function' || !Array.isArray(renderer.manager?.visualArray)) {
        unavailable(renderer, '当前播放器版本暂不支持同步滚动'); return;
      }
      const s = { renderer, video, container, scheduler, clock, patches: [], events: [], uiEvents: [], pending: 0, uiPending: 0, uiFrames: 0, seekPending: false,
        frames: 0, updated: 0, fps: 0, windowFrames: 0, windowStart: null, lastMedia: null,
        renderTime: null, mediaTime: null, reset: true, inFrame: false, stableFrames: 0, lastCallbackAt: Date.now() };
      function patch(object, name, wrapped) {
        const native = object[name]; object[name] = wrapped;
        if (object[name] !== wrapped) throw new Error('播放器调度不可修改');
        s.patches.push([object, name, native, wrapped]); return native;
      }
      function schedule(force = false) {
        if (video.paused) { requestUi(); return; }
        if (state !== s || s.pending || (!force && (video.paused || video.ended || video.seeking))) return;
        s.pending = video.requestVideoFrameCallback(frame);
      }
      function cancel() {
        if (s.pending) video.cancelVideoFrameCallback(s.pending);
        s.pending = 0;
        if (s.uiPending) root.cancelAnimationFrame(s.uiPending);
        s.uiPending = 0;
      }
      function requestUi() {
        if (state !== s || s.inFrame || !video.paused || video.seeking || video.readyState < 2 || s.uiPending) return;
        s.uiPending = root.requestAnimationFrame(now => {
          s.uiPending = 0;
          if (state !== s || !video.paused || video.seeking || video.readyState < 2) return;
          const media = s.seekPending || s.mediaTime === null ? video.currentTime : s.mediaTime;
          paint(now, { mediaTime: media }, false);
        });
      }
      s.requestUi = requestUi;
      function frame(now, metadata) {
        s.pending = 0;
        paint(now, metadata, true);
      }
      function paint(now, metadata, videoFrame) {
        if (state !== s) return;
        try {
          if (!video.isConnected || !container.isConnected || renderer.container !== container || root.player?.danmaku?.getDanmakuX?.() !== renderer || renderer.frameScheduler !== scheduler) {
            clearRecovery('renderer-changed', true);
            stop('播放器已更换，等待重新适配', false);
            attempt = 0; update(desired, root.player?.danmaku?.getDanmakuX?.()); return;
          }
          const media = metadata.mediaTime;
          if (!Number.isFinite(media)) throw new Error('视频帧时间不可用');
          if (videoFrame) s.lastCallbackAt = Date.now();
          s.mediaTime = media;
          const delta = s.lastMedia === null ? 0 : media - s.lastMedia;
          if (!videoFrame && !s.seekPending && s.renderTime !== null) {
            // A paused UI action may repaint, but must not advance scrolling.
          } else if (s.reset || delta < 0 || delta > 1) {
            if (!videoFrame && clock.pauseTime > 0 && Number.isFinite(clock.playTime)) s.renderTime = clock.pauseTime - clock.playTime;
            else { nativeUpdate.call(clock); s.renderTime = clock.renderTime; }
            s.reset = false;
          } else s.renderTime += delta / Math.max(0.01, video.playbackRate);
          s.lastMedia = media;
          s.seekPending = false;
          ensureSyncStyle(s);
          s.inFrame = true;
          // Runs native fetch, collision, render and lifetime bookkeeping together.
          nativeImmediate.call(scheduler, now);
          // startImmediate runs each split phase in full. Its normal seek path
          // leaves the index untouched; finish it before the next video frame.
          for (const phase of scheduler.splitFrameCallbacks || []) {
            phase.index = phase.callbacks.length; phase.mayReset();
          }
          s.inFrame = false;
          if (state !== s) return;
          const painted = s.surface.draw();
          if (painted) s.updated++;
          if (videoFrame) { s.frames++; s.windowFrames++; } else s.uiFrames++;
          if (videoFrame && recoveryAttempts > 0) {
            s.stableFrames = painted ? s.stableFrames + 1 : 0;
            if (recovery) recovery.stableFrames = s.stableFrames;
            if (s.stableFrames >= 120) { clearRecovery('recovered', true); s.stableFrames = 0; }
          }
          if (videoFrame && s.windowStart === null) s.windowStart = now;
          if (videoFrame && now - s.windowStart >= 1000) {
            s.fps = Math.round((s.windowFrames - 1) * 10000 / (now - s.windowStart)) / 10;
            s.windowStart = now; s.windowFrames = 1;
          }
          if (videoFrame) schedule();
        } catch (error) {
          s.inFrame = false;
          recover(s, 'draw', '同步滚动暂时停止，已恢复原生画面：' + error.message, error);
        }
      }
      let nativeImmediate, nativeUpdate, constructingSurface = false;
      state = s;
      try {
        scheduler.stop();
        patch(scheduler, 'start', () => schedule());
        nativeImmediate = patch(scheduler, 'startImmediate', () => { s.reset = true; schedule(true); });
        nativeUpdate = patch(clock, 'updateTime', function () {
          if (s.inFrame) { this.renderTime = s.renderTime; this.currentTime = s.mediaTime; }
          else return Reflect.apply(nativeUpdate, this, arguments);
        });
        // A native settings change may rebuild the scheduler. Rebind immediately.
        if (typeof renderer.startFrameScheduler === 'function') {
          const rebuild = renderer.startFrameScheduler;
          patch(renderer, 'startFrameScheduler', function (...args) {
            clearRecovery('renderer-changed', true);
            stop('重新适配播放器', false);
            const result = Reflect.apply(rebuild, this, args);
            update(settings, renderer); return result;
          });
        }
        s.style = document.createElement('style');
        s.style.textContent = syncCSS;
        (document.head || document.documentElement).appendChild(s.style);
        container.classList.add('bfd-video-sync');
        constructingSurface = true;
        s.surface = root.BFDCompositor.create(renderer, video);
        constructingSurface = false;
        if (recoveryAttach && recovery) {
          for (const [name, fn] of recovery.events) recovery.video.removeEventListener(name, fn);
          recovery.events = []; recovery.phase = 'stabilizing'; recovery.stableFrames = 0;
        }
        if (typeof renderer.setSetting === 'function') {
          const nativeSetting = renderer.setSetting;
          patch(renderer, 'setSetting', function (...args) {
            const result = Reflect.apply(nativeSetting, this, args);
            requestUi(); return result;
          });
        }
        function listen(name, fn) { video.addEventListener(name, fn); s.events.push([name, fn]); }
        function resetFps() { s.windowStart = null; s.windowFrames = 0; s.fps = 0; }
        listen('play', () => { cancel(); s.reset = true; s.lastCallbackAt = Date.now(); resetFps(); schedule(); });
        listen('pause', cancel); listen('ended', cancel);
        listen('seeking', () => { cancel(); s.reset = true; s.seekPending = true; s.stableFrames = 0; if (recovery) recovery.stableFrames = 0; });
        listen('seeked', () => { s.reset = true; s.seekPending = true; s.lastCallbackAt = Date.now(); resetFps(); schedule(true); });
        listen('ratechange', () => { s.lastMedia = null; resetFps(); schedule(); });
        listen('emptied', () => { clearRecovery('media-loading'); stop('等待视频重新加载'); });
        listen('loadeddata', () => schedule());
        listen('canplay', () => { if (!s.surface.status().committed) schedule(); });
        const playerBox = container.closest('.bpx-player-container');
        function uiEvent(target, name, fn) { target.addEventListener(name, fn, true); s.uiEvents.push([target, name, fn]); }
        if (playerBox?.addEventListener) {
          for (const name of ['click', 'input', 'change', 'keydown']) uiEvent(playerBox, name, requestUi);
        }
        if (root.ResizeObserver && s.surface.host) {
          s.resizeObserver = new root.ResizeObserver(() => { if (s.surface.needsResize()) requestUi(); });
          for (const node of [s.surface.host, video, container]) s.resizeObserver.observe(node);
        }
        uiEvent(root, 'resize', () => { if (s.surface.needsResize?.()) requestUi(); });
        // Native media events detect a stale canvas without adding polling or
        // rendering extra frames. Never leave audio playing behind a frozen image.
        listen('timeupdate', () => {
          if (!video.paused && !video.seeking && video.readyState >= 2 && s.mediaTime !== null &&
              Date.now() - s.lastCallbackAt > 2000 && video.currentTime - s.mediaTime > Math.max(1, video.playbackRate)) {
            recover(s, 'stale', '视频帧回调停止，已恢复原生画面');
          }
        });
        reason = '';
        schedule();
      } catch (error) {
        // style may not yet exist when a readonly native method rejects a patch.
        s.style ||= { remove() {} };
        // A previously running compositor may still be unable to allocate a
        // surface on the first retry. Keep the same bounded recovery budget.
        // Readonly scheduler patches and preflight incompatibilities stay native.
        if (recoveryAttach && constructingSurface) {
          recover(s, 'install', '同步画布重建暂时失败，已恢复原生画面', error); return;
        }
        unavailable(renderer, '同步滚动不可用：' + error.message, error);
        stop('同步滚动不可用：' + error.message);
      }
    }
    function status() {
      const recoveryStatus = { phase: recovery?.phase || (failedRenderer ? 'unavailable' : state && recoveryAttempts > 0 ? 'stabilizing' : 'idle'), attempts: recoveryAttempts, maxAttempts: recoveryDelays.length,
        stableFrames: state?.stableFrames || recovery?.stableFrames || 0, stableFramesRequired: 120 };
      return state ? { active: true, frames: state.frames, uiFrames: state.uiFrames, updates: state.updated, fps: state.fps,
        mediaTime: state.mediaTime, paused: state.video.paused, composite: state.surface.status(), reason: '', recovery: recoveryStatus } : { active: false, reason, recovery: recoveryStatus };
    }
    root.addEventListener('pagehide', () => {
      pageHidden = true; clearRecovery('page-hidden');
      if (retry) { clearTimeout(retry); retry = 0; }
      stop('页面已离开');
    });
    root.addEventListener('pageshow', () => { pageHidden = false; attempt = 0; update(desired, currentRenderer()); });
    recentStatus = status;
    return { update, status, refresh: () => state?.requestUi() };
  }
  root.BFDVideoSync = { create, readDiagnostics: () => diagnostics.map(entry => ({ ...entry })), readStatus: () => recentStatus?.() || { active: false, reason: '未创建同步实例' } };
})(globalThis);
