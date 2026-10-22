// Development-only live rVFC phase probe. Never loaded by the extension manifest.
// Install registers no callback. Only the player's next formal paint rearm is
// intercepted. Native request IDs are preserved, including cancel/restore.
(() => {
  'use strict';
  const root = globalThis, needle = 'paint(s, now, metadata, true)';
  function install(video, options = {}) {
    if (!video || typeof video.requestVideoFrameCallback !== 'function' || typeof video.cancelVideoFrameCallback !== 'function') throw new TypeError('Video frame API unavailable');
    const requestBefore = video.requestVideoFrameCallback, cancelBefore = video.cancelVideoFrameCallback;
    const requestDescriptor = Object.getOwnPropertyDescriptor(video, 'requestVideoFrameCallback'), cancelDescriptor = Object.getOwnPropertyDescriptor(video, 'cancelVideoFrameCallback');
    const limit = Math.max(16, Math.min(3000, Math.floor(Number(options.limit) || 1800))), rows = [], phases = [];
    const counts = { formalRequests: 0, foreignRequests: 0, nativeRequests: 0, callbacks: 0, cancelled: 0, noRearm: 0, callbackErrors: 0, armErrors: 0, duplicateRequests: 0, handoffs: 0, maxOwnedPending: 0 };
    let active = true, pending = null, executing = null, restoring = false, detached = false, mode, phase, sequence = 0;
    const now = () => root.performance?.now?.() ?? Date.now();
    const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    function startPhase(value) {
      if (value !== 'late' && value !== 'early') throw new TypeError('Mode must be late or early');
      mode = value; phase = { id: ++sequence, mode, callbacks: 0, firstAt: null, lastAt: null, durationSumMs: 0, maxDurationMs: 0, presentedSteps: {}, previousPresented: null };
      phases.push(phase); if (phases.length > 12) phases.shift();
    }
    function restoreProperty(name, ours, prior, descriptor) {
      if (video[name] !== ours) return;
      if (descriptor) Object.defineProperty(video, name, descriptor);
      else { delete video[name]; if (video[name] !== prior) video[name] = prior; }
    }
    function finishRestore() {
      if (!restoring || pending) return;
      restoreProperty('cancelVideoFrameCallback', cancel, cancelBefore, cancelDescriptor);
      for (const name of ['pause', 'ended', 'seeking', 'emptied']) video.removeEventListener(name, mediaStop, true);
      root.removeEventListener?.('pagehide', mediaStop, true);
      detached = true;
    }
    function cancelOwned() {
      const token = pending; if (!token) return;
      pending = null; token.fn = null;
      Reflect.apply(cancelBefore, video, [token.id]); counts.cancelled++; finishRestore();
    }
    function mediaStop() { cancelOwned(); }
    function arm(fn) {
      if (pending) throw new Error('Probe already has a native callback');
      const token = { id: null, fn, armedAt: now() }; pending = token;
      try {
        token.id = Reflect.apply(requestBefore, video, [function bfdPhasePump(at, metadata) { pump(token, at, metadata); }]);
        counts.nativeRequests++; counts.maxOwnedPending = Math.max(counts.maxOwnedPending, 1); return token;
      } catch (error) { if (pending === token) pending = null; counts.armErrors++; throw error; }
    }
    function request(fn) {
      if (!active || typeof fn !== 'function' || !Function.prototype.toString.call(fn).includes(needle)) { if (active) counts.foreignRequests++; return Reflect.apply(requestBefore, this, arguments); }
      counts.formalRequests++;
      if (executing) executing.rearmCalledAt = now();
      if (pending) {
        if (pending.fn) { counts.duplicateRequests++; throw new Error('Concurrent formal paint requests are unsupported by phase probe'); }
        pending.fn = fn; return pending.id;
      }
      return arm(fn).id;
    }
    function cancel(id) {
      if (pending && pending.id === id) { cancelOwned(); return; }
      return Reflect.apply(cancelBefore, this, arguments);
    }
    function pump(token, at, metadata) {
      if (pending !== token) return;
      pending = null;
      const fn = token.fn; token.fn = null;
      if (!fn) { finishRestore(); return; }
      if (!active) { counts.handoffs++; finishRestore(); return Reflect.apply(fn, video, [at, metadata]); }
      const current = phase, begun = now(), row = { phase: current.id, mode: current.mode, at: numeric(at), enteredAt: begun, registeredAt: token.armedAt };
      for (const name of ['mediaTime', 'presentedFrames', 'presentationTime', 'expectedDisplayTime', 'processingDuration', 'width', 'height']) row[name] = numeric(metadata?.[name]);
      row.expectedLeadMs = row.expectedDisplayTime === null ? null : row.expectedDisplayTime - begun;
      if (row.presentedFrames !== null && current.previousPresented !== null) { row.presentedStep = row.presentedFrames - current.previousPresented; const key = row.presentedStep >= 0 && row.presentedStep <= 8 ? String(row.presentedStep) : 'other'; current.presentedSteps[key] = (current.presentedSteps[key] || 0) + 1; }
      current.previousPresented = row.presentedFrames; current.callbacks++; counts.callbacks++;
      if (current.firstAt === null) current.firstAt = begun; current.lastAt = begun;
      executing = row;
      if (current.mode === 'early' && !video.paused && !video.ended && !video.seeking && video.readyState >= 2) {
        try { const next = arm(null); row.nextRegisteredAt = next.armedAt; } catch (_) { row.prearmFailed = true; }
      }
      try { return Reflect.apply(fn, video, [at, metadata]); }
      catch (error) { row.errorName = ['Error', 'TypeError', 'RangeError', 'InvalidStateError'].includes(error?.name) ? error.name : 'callback-error'; counts.callbackErrors++; cancelOwned(); throw error; }
      finally {
        row.finishedAt = now(); row.durationMs = row.finishedAt - begun;
        if (pending) row.nextRegisteredAt = pending.armedAt;
        if (pending && !pending.fn) { counts.noRearm++; cancelOwned(); }
        row.ownedPendingAfter = pending ? 1 : 0;
        current.durationSumMs += row.durationMs; current.maxDurationMs = Math.max(current.maxDurationMs, row.durationMs);
        rows.push(row); if (rows.length > limit) rows.shift(); executing = null; finishRestore();
      }
    }
    function restore() {
      if (restoring) return read();
      active = false; restoring = true;
      restoreProperty('requestVideoFrameCallback', request, requestBefore, requestDescriptor);
      if (pending && !pending.fn) cancelOwned();
      // A filled slot is the player's existing requested callback. Keep its real
      // ID and hand it through once; cancelling it here would stop its chain.
      finishRestore(); return read();
    }
    function read() {
      return { active, mode, detached, restoring, ownedPending: active && pending ? 1 : 0, handoffPending: !active && pending ? 1 : 0, counts: { ...counts },
        boundaries: { matchedFormalPaintOnly: true, maxPendingAppliesToProbeOwnedChain: true, otherCallbacksDelegated: true, capturedOuterRequestWrapper: requestBefore !== Object.getPrototypeOf(video)?.requestVideoFrameCallback,
          outerFormalAuditMayStopMatchingPump: true, recordsAreProbeNativeCallbacks: true, restoreKeepsOneExistingPlayerCallbackAsHandoff: true },
        phases: phases.map(p => ({ id: p.id, mode: p.mode, callbacks: p.callbacks, firstAt: p.firstAt, lastAt: p.lastAt, fps: p.callbacks > 1 && p.lastAt > p.firstAt ? (p.callbacks - 1) * 1000 / (p.lastAt - p.firstAt) : null, meanDurationMs: p.callbacks ? p.durationSumMs / p.callbacks : 0, maxDurationMs: p.maxDurationMs, presentedSteps: { ...p.presentedSteps } })), rows: rows.map(row => ({ ...row })) };
    }
    startPhase(options.mode || 'late');
    try { video.requestVideoFrameCallback = request; if (video.requestVideoFrameCallback !== request) throw new TypeError('Request method not writable'); video.cancelVideoFrameCallback = cancel; if (video.cancelVideoFrameCallback !== cancel) throw new TypeError('Cancel method not writable'); }
    catch (error) { restoreProperty('requestVideoFrameCallback', request, requestBefore, requestDescriptor); restoreProperty('cancelVideoFrameCallback', cancel, cancelBefore, cancelDescriptor); throw error; }
    for (const name of ['pause', 'ended', 'seeking', 'emptied']) video.addEventListener(name, mediaStop, true);
    root.addEventListener?.('pagehide', mediaStop, true);
    return { setMode(value) { if (!active) throw new Error('Probe has been restored'); startPhase(value); return read(); }, read, restore };
  }
  root.BFDLivePhaseAudit = { install };
})();
