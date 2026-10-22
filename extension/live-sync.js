// Live-room adapter: native reception/layout stays intact; only video frames present.
(function (root) {
  'use strict';
  const diagnosticKey = 'bfd-live-sync-diagnostics-v1', delays = [150, 500, 1500], readyDelays = [50, 150, 350, 750, 1500, 3000];
  const reasons = ['draw-error', 'surface-create-error', 'frame-callback-stalled', 'invalid-frame-time', 'api-unavailable',
    'composite-context-lost', 'text-context-lost', 'InvalidStateError', 'SecurityError', 'QuotaExceededError', 'OperationError', 'TypeError'];
  let diagnostics = [], recentStatus = null;
  // This optional presentation refresh has a budget per VIDEO, rather than
  // per surface/settings instance. Rebuilding a canvas must not restart it.
  const presentationAttempted = new WeakSet();
  try {
    const stored = JSON.parse(root.sessionStorage?.getItem(diagnosticKey) || '[]');
    if (Array.isArray(stored)) diagnostics = stored.slice(-5).filter(entry => entry && typeof entry === 'object').map(entry => ({
      time: Number.isFinite(entry.time) ? entry.time : 0, roomId: /^\d{1,20}$/.test(entry.roomId || '') ? entry.roomId : '',
      stage: ['draw', 'create', 'stale', 'api'].includes(entry.stage) ? entry.stage : 'draw',
      reason: reasons.includes(entry.reason) ? entry.reason : 'draw-error',
      recovery: ['pending', 'retrying', 'retry-failed', 'recovered', 'exhausted', 'paused', 'seeking', 'loading', 'disabled', 'page-hidden', 'target-changed', 'unavailable'].includes(entry.recovery) ? entry.recovery : 'unavailable'
    }));
  } catch {}
  function persist() { try { root.sessionStorage?.setItem(diagnosticKey, JSON.stringify(diagnostics)); } catch {} }
  function roomId() { try { return new URL(root.location.href).pathname.match(/^\/(?:blanc\/)?([1-9]\d{0,19})\/?$/)?.[1] || ''; } catch { return ''; } }
  function livePage() {
    if (typeof root.BFDFixedCore?.isLivePage === 'function') return root.BFDFixedCore.isLivePage(root.location.href);
    try { const url = new URL(root.location.href); return url.protocol === 'https:' && url.hostname === 'live.bilibili.com' && /^\/(?:blanc\/)?[1-9]\d*\/?$/.test(url.pathname); } catch { return false; }
  }
  function failure(stage, error) {
    let reason = stage === 'stale' ? 'frame-callback-stalled' : stage === 'create' ? 'surface-create-error' : stage === 'api' ? 'api-unavailable' : 'draw-error';
    try {
      if (['合成画布上下文丢失', '直播合成画布上下文丢失'].includes(error?.message)) reason = 'composite-context-lost';
      else if (['文字画布上下文丢失', '直播文字画布上下文丢失'].includes(error?.message)) reason = 'text-context-lost';
      else if (error?.message === '视频帧时间不可用') reason = 'invalid-frame-time';
      else if (['InvalidStateError', 'SecurityError', 'QuotaExceededError', 'OperationError', 'TypeError'].includes(error?.name)) reason = error.name;
    } catch {}
    const entry = { time: Date.now(), roomId: roomId(), stage, reason, recovery: 'pending' };
    diagnostics.push(entry); diagnostics = diagnostics.slice(-5); persist(); return entry;
  }
  function outcome(entry, value) { if (entry && diagnostics.includes(entry)) { entry.recovery = value; persist(); } }
  function findLiveTarget() {
    let video;
    try {
      const candidate = root.livePlayer?.getVideoEl?.();
      if (candidate?.isConnected && candidate.closest?.('#live-player')?.isConnected) video = candidate;
    } catch {}
    video ||= document.querySelector('#live-player video');
    const host = video?.closest('#live-player') || video?.parentElement;
    const layer = host?.querySelector('.web-player-danmaku');
    return video?.isConnected && host?.isConnected && layer?.isConnected ? { video, host, layer } : null;
  }
  function create(options = {}) {
    const findTarget = typeof options.findTarget === 'function' ? options.findTarget : findLiveTarget;
    const quality = root.BFDLiveQuality?.create();
    let desired = {}, signature = '', state = null, reason = '未启用', hidden = false, readyTimer = 0, readyAttempt = 0;
    let recovery = null, attempts = 0, lastTarget = null, unavailableTarget = null, observer = null, discoveryQueued = false;
    const listeners = [];
    function discover() { try { return findTarget(); } catch { return null; } }
    function same(a, b) { return !!a && !!b && a.video === b.video && a.host === b.host && a.layer === b.layer && a.roomId === b.roomId; }
    function target() { const found = discover(); return found && { ...found, roomId: roomId() }; }
    function connected(t) { return t?.video.isConnected && t.host.isConnected && t.layer.isConnected; }
    function cancelReady() { if (readyTimer) clearTimeout(readyTimer); readyTimer = 0; }
    function clearRecovery(message, reset = false) {
      if (recovery) { if (recovery.timer) clearTimeout(recovery.timer); outcome(recovery.record, message); }
      recovery = null; if (reset) attempts = 0;
    }
    function clearPresentationSamples(s) {
      s.cadence = null;
      s.presentationRates = { sampledFPS: 0, callbackFPS: 0, droppedFPS: 0 };
    }
    function cancelPresentationRefresh(s) { try { s.surface?.cancelPresentationRefresh?.(); } catch {} }
    function samplePresentation(s, now, metadata) {
      const video = s.video;
      if (hidden || document.hidden || document.visibilityState === 'hidden' || video.paused || video.ended || video.seeking || video.readyState < 2 || !Number.isFinite(now)) {
        clearPresentationSamples(s); cancelPresentationRefresh(s); return;
      }
      const source = video.currentSrc || '', previous = s.cadence;
      if (previous && (source !== previous.source || now < previous.lastAt || now - previous.lastAt > 2500 || metadata.mediaTime < previous.lastMediaTime)) {
        clearPresentationSamples(s); cancelPresentationRefresh(s);
      }
      // Keep lifecycle validation through the two pending successful draws,
      // but stop reading quality counters after this VIDEO's budget is used.
      if (presentationAttempted.has(video)) {
        if (s.cadence) { s.cadence.lastAt = now; s.cadence.lastMediaTime = metadata.mediaTime; }
        return;
      }
      let value;
      try { value = video.getVideoPlaybackQuality?.(); } catch { clearPresentationSamples(s); return; }
      const total = value?.totalVideoFrames, dropped = value?.droppedVideoFrames;
      if (!Number.isFinite(total) || !Number.isFinite(dropped) || total < 0 || dropped < 0 || dropped > total) { clearPresentationSamples(s); return; }
      if (s.cadence && (total < s.cadence.lastTotal || dropped < s.cadence.lastDropped)) clearPresentationSamples(s);
      if (!s.cadence) {
        s.cadence = { source, at: now, total, dropped, callbacks: 0, qualifying: 0,
          lastAt: now, lastMediaTime: metadata.mediaTime, lastTotal: total, lastDropped: dropped };
        return;
      }
      const window = s.cadence;
      window.callbacks++; window.lastAt = now; window.lastMediaTime = metadata.mediaTime; window.lastTotal = total; window.lastDropped = dropped;
      const elapsed = now - window.at;
      if (elapsed < 1000) return;
      const delta = total - window.total;
      s.presentationRates = { sampledFPS: Math.round(delta * 10000 / elapsed) / 10,
        callbackFPS: Math.round(window.callbacks * 10000 / elapsed) / 10, droppedFPS: Math.round((dropped - window.dropped) * 10000 / elapsed) / 10 };
      // totalVideoFrames deliberately includes dropped frames. This is a
      // cadence signal for one bounded refresh, never an input-FPS diagnosis.
      window.qualifying = window.callbacks >= 8 && delta >= 16 && delta / window.callbacks >= 1.75 ? Math.min(2, window.qualifying + 1) : 0;
      window.at = now; window.total = total; window.dropped = dropped; window.callbacks = 0;
      if (window.qualifying < 2) return;
      try { if (s.surface.refreshPresentation?.() === true) presentationAttempted.add(video); } catch {}
    }
    function cancelFrame(s) {
      if (s.pending) s.video.cancelVideoFrameCallback(s.pending);
      if (s.uiPending) root.cancelAnimationFrame(s.uiPending);
      s.pending = s.uiPending = 0;
      clearPresentationSamples(s); cancelPresentationRefresh(s);
    }
    function stop(message) {
      const previous = state; state = null; reason = message;
      if (!previous) return;
      cancelFrame(previous); previous.resize?.disconnect();
      for (const [name, fn] of previous.events) previous.video.removeEventListener(name, fn);
      try { previous.surface?.restore(); } catch {}
    }
    function queueDiscovery() {
      if (discoveryQueued || hidden || !desired.enabled) return;
      discoveryQueued = true;
      Promise.resolve().then(() => { discoveryQueued = false; if (!hidden && desired.enabled) update(desired); });
    }
    function watch() {
      if (observer || typeof root.MutationObserver !== 'function' || !document.documentElement) return;
      observer = new root.MutationObserver(records => {
        const current = state || recovery?.target || lastTarget;
        for (const record of records) {
          // Receiving comments changes many children. It must not become an
          // independent discovery/render clock, nor observe per-frame styles.
          if (current?.layer.contains?.(record.target)) continue;
          const nodes = [...record.addedNodes, ...record.removedNodes];
          if (nodes.some(node => node === current?.video || node === current?.host || node === current?.layer ||
              node.matches?.('#live-player,video,.web-player-danmaku') || node.querySelector?.('#live-player,video,.web-player-danmaku'))) { queueDiscovery(); return; }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    function armRecovery(r) {
      if (recovery !== r || r.timer || hidden || !desired.enabled) return;
      if (!same(target(), r.target) || !connected(r.target)) { clearRecovery('target-changed', true); update(desired); return; }
      const video = r.target.video;
      if (video.paused || video.ended || video.seeking || video.readyState < 2) {
        r.phase = video.paused || video.ended ? 'paused' : video.seeking ? 'seeking' : 'loading'; outcome(r.record, r.phase); return;
      }
      if (attempts >= delays.length) { r.phase = 'exhausted'; outcome(r.record, 'exhausted'); return; }
      r.phase = 'pending';
      const timer = setTimeout(() => {
        if (recovery !== r || r.timer !== timer) return;
        r.timer = 0;
        if (hidden || !desired.enabled) return;
        if (!same(target(), r.target) || !connected(r.target)) { clearRecovery('target-changed', true); update(desired); return; }
        if (video.paused || video.ended || video.seeking || video.readyState < 2) { armRecovery(r); return; }
        attempts++; r.phase = 'retrying'; outcome(r.record, 'retrying'); update(desired, true);
      }, delays[attempts]);
      r.timer = timer;
    }
    function recover(t, stage, error) {
      clearRecovery('retry-failed'); stop(stage === 'stale' ? '直播视频帧回调停止，暂时恢复原生画面' : '直播合成暂时不可用，已恢复原生画面');
      const r = recovery = { target: t, timer: 0, phase: 'pending', record: failure(stage, error) };
      armRecovery(r);
    }
    function requestUi(s) {
      if (state !== s || s.inFrame || s.uiPending || !s.video.paused || s.video.seeking || s.video.readyState < 2) return;
      s.uiPending = root.requestAnimationFrame(now => {
        s.uiPending = 0;
        if (state === s && s.video.paused && !s.video.seeking && s.video.readyState >= 2) paint(s, now, { mediaTime: s.video.currentTime }, false);
      });
    }
    function schedule(s) {
      if (state !== s || s.pending || s.video.ended || s.video.seeking) return;
      if (s.video.paused) { requestUi(s); return; }
      s.pending = s.video.requestVideoFrameCallback((now, metadata) => { s.pending = 0; paint(s, now, metadata, true); });
    }
    function paint(s, now, metadata, videoFrame) {
      if (state !== s) return;
      if (!connected(s) || !same(s, target())) { stop('直播播放器已更换'); clearRecovery('target-changed', true); update(desired); return; }
      try {
        if (!Number.isFinite(metadata.mediaTime)) throw Error('视频帧时间不可用');
        s.inFrame = true;
        const painted = s.surface.draw(now, metadata);
        s.inFrame = false;
        if (state !== s) return;
        if (videoFrame) {
          if (painted) samplePresentation(s, now, metadata);
          else { clearPresentationSamples(s); cancelPresentationRefresh(s); }
          s.frames++; s.lastCallbackAt = Date.now(); s.mediaTime = metadata.mediaTime;
          if (s.windowStart === null) { s.windowStart = now; s.windowFrames = s.frames; }
          if (now - s.windowStart >= 1000) { s.fps = Math.round((s.frames - s.windowFrames) * 10000 / (now - s.windowStart)) / 10; s.windowFrames = s.frames; s.windowStart = now; }
          if (attempts > 0) { s.stableFrames = painted ? s.stableFrames + 1 : 0; if (s.stableFrames >= 120) { clearRecovery('recovered', true); s.stableFrames = 0; } }
        } else s.uiFrames++;
        if (painted) s.presents++;
        if (videoFrame) schedule(s);
      } catch (error) { s.inFrame = false; recover(s, 'draw', error); }
    }
    function update(settings, recoveryAttach = false) {
      const next = { enabled: settings?.enabled === true && livePage(), mode: settings?.motion === 'video-sync' ? 'video-sync' : 'fixed',
        position: ['top', 'bottom', 'alternate'].includes(settings?.position) ? settings.position : 'top' };
      quality?.update(next.enabled && !hidden);
      const nextSignature = `${next.mode}|${next.position}`;
      const changed = signature !== nextSignature;
      if (next.enabled && !desired.enabled) readyAttempt = 0;
      desired = { ...settings, enabled: next.enabled }; signature = nextSignature;
      if (!next.enabled) { cancelReady(); observer?.disconnect(); observer = null; clearRecovery('disabled', true); unavailableTarget = null; stop('未启用'); return; }
      if (hidden) return;
      watch();
      const found = target();
      if (changed || lastTarget && !same(lastTarget, found)) { clearRecovery('target-changed', true); unavailableTarget = null; readyAttempt = 0; lastTarget = found; }
      if (recovery && !same(recovery.target, found)) clearRecovery('target-changed', true);
      if (state && (changed || !same(state, found))) stop('重新适配直播播放器');
      if (!found) {
        reason = '等待直播播放器就绪';
        if (!readyTimer && readyAttempt < readyDelays.length) readyTimer = setTimeout(() => { readyTimer = 0; update(desired); }, readyDelays[readyAttempt++]);
        return;
      }
      cancelReady(); lastTarget = found;
      if (state) { if (state.video.paused && !state.surface.status().committed) requestUi(state); return; }
      if (same(unavailableTarget, found)) return;
      if (recovery && !recoveryAttach) { if (recovery.phase !== 'exhausted') armRecovery(recovery); return; }
      if (typeof found.video.requestVideoFrameCallback !== 'function' || typeof found.video.cancelVideoFrameCallback !== 'function' || typeof root.BFDLiveCompositor?.create !== 'function') {
        clearRecovery('unavailable'); unavailableTarget = found; reason = '此播放器暂不支持直播视频合成'; outcome(failure('api'), 'unavailable'); return;
      }
      const s = { ...found, surface: null, events: [], pending: 0, uiPending: 0, frames: 0, uiFrames: 0, presents: 0, fps: 0,
        windowStart: null, windowFrames: 0, mediaTime: null, lastCallbackAt: Date.now(), inFrame: false, stableFrames: 0,
        cadence: null, presentationRates: { sampledFPS: 0, callbackFPS: 0, droppedFPS: 0 } };
      state = s;
      try {
        // The compositor masks native comments only after a complete image;
        // native video visibility stays under the player's ownership.
        s.surface = root.BFDLiveCompositor.create({ video: s.video, host: s.host, layer: s.layer, mode: next.mode, position: next.position });
        if (recovery) recovery.phase = 'stabilizing';
        function listen(name, fn) { s.video.addEventListener(name, fn); s.events.push([name, fn]); }
        listen('play', () => { cancelFrame(s); s.lastCallbackAt = Date.now(); schedule(s); });
        listen('pause', () => cancelFrame(s)); listen('ended', () => cancelFrame(s));
        listen('seeking', () => { cancelFrame(s); s.stableFrames = 0; });
        listen('seeked', () => { s.lastCallbackAt = Date.now(); schedule(s); });
        listen('loadeddata', () => schedule(s)); listen('canplay', () => { if (!s.surface.status().committed) schedule(s); });
        listen('emptied', () => { clearRecovery('loading'); stop('等待直播视频重新加载'); });
        listen('timeupdate', () => {
          if (!s.video.paused && !s.video.seeking && s.video.readyState >= 2 && s.mediaTime !== null && Date.now() - s.lastCallbackAt > 2000 && s.video.currentTime - s.mediaTime > 1) recover(s, 'stale');
        });
        if (typeof root.ResizeObserver === 'function') { s.resize = new root.ResizeObserver(() => { if (s.surface.needsResize?.()) requestUi(s); }); s.resize.observe(s.host); }
        reason = ''; schedule(s);
      } catch (error) { recover(s, 'create', error); }
    }
    function mediaEvent(event) {
      if (hidden || !desired.enabled) return;
      if (recovery && event.target === recovery.target.video && ['pause', 'ended', 'seeking', 'emptied'].includes(event.type)) {
        if (recovery.timer) clearTimeout(recovery.timer); recovery.timer = 0;
        recovery.phase = event.type === 'seeking' ? 'seeking' : event.type === 'emptied' ? 'loading' : 'paused'; outcome(recovery.record, recovery.phase);
      }
      if (['play', 'loadeddata', 'canplay', 'seeked'].includes(event.type)) update(desired);
    }
    function listen(targetNode, name, fn) { targetNode.addEventListener(name, fn, true); listeners.push([targetNode, name, fn]); }
    for (const name of ['play', 'pause', 'ended', 'seeking', 'seeked', 'loadeddata', 'canplay', 'emptied']) listen(document, name, mediaEvent);
    for (const name of ['click', 'input', 'change', 'keydown', 'fullscreenchange']) listen(document, name, event => {
      if (event.type === 'fullscreenchange' || state?.host.contains?.(event.target)) { update(desired); if (state) requestUi(state); }
    });
    listen(root, 'resize', () => { update(desired); if (state && state.surface.needsResize?.()) requestUi(state); });
    listen(root, 'popstate', queueDiscovery);
    listen(document, 'visibilitychange', () => {
      if (!state) return;
      clearPresentationSamples(state);
      if (document.hidden || document.visibilityState === 'hidden') cancelPresentationRefresh(state);
    });
    listen(root, 'pagehide', () => { hidden = true; quality?.update(false); cancelReady(); observer?.disconnect(); observer = null; clearRecovery('page-hidden'); stop('页面已离开'); });
    listen(root, 'pageshow', () => { hidden = false; readyAttempt = 0; update(desired); });
    function status() {
      const recoveryStatus = { phase: recovery?.phase || (unavailableTarget ? 'unavailable' : state && attempts ? 'stabilizing' : 'idle'), attempts, maxAttempts: delays.length, stableFrames: state?.stableFrames || 0, stableFramesRequired: 120 };
      const presentationRecovery = { attempted: !!(state?.video || lastTarget?.video) && presentationAttempted.has(state?.video || lastTarget.video),
        ...(state?.presentationRates || { sampledFPS: 0, callbackFPS: 0, droppedFPS: 0 }) };
      return state ? { active: true, mode: desired.motion === 'video-sync' ? 'video-sync' : 'fixed', frames: state.frames, uiFrames: state.uiFrames,
        presents: state.presents, fps: state.fps, paused: state.video.paused, mediaTime: state.mediaTime, composite: state.surface.status(), recovery: recoveryStatus, presentationRecovery, reason: '' }
        : { active: false, reason, recovery: recoveryStatus, presentationRecovery };
    }
    function destroy() { update({ enabled: false }); quality?.destroy(); for (const [node, name, fn] of listeners) node.removeEventListener(name, fn, true); }
    recentStatus = status;
    return { update, status, refresh: () => state && requestUi(state), destroy };
  }
  root.BFDLiveSync = { create, readStatus: () => recentStatus?.() || { active: false, reason: '未创建直播同步实例' }, readDiagnostics: () => diagnostics.map(entry => ({ ...entry })) };
})(globalThis);
