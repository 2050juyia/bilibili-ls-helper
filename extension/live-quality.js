// Keep native manual quality changes on the path that refreshes fallback URLs.
// This changes neither the selected quality nor the video's frame rate.
(function (root) {
  'use strict';
  function create() {
    let enabled = false, hidden = false, destroyed = false, current = null;
    let phase = 'disabled', reason = '', yielded = new WeakSet(), preexisting = new WeakSet();
    const listeners = [];
    function inspect(api) {
      try {
        const info = api?.__PRIVATE_TOOLS_ONLY_FOR_DEBUG__?.info;
        const read = info?.getSeamlessInfo, write = api?.updateDisableManualSeamless;
        if (typeof read !== 'function' || typeof write !== 'function') return null;
        const value = read.call(info)?.disableManualSeamless;
        return typeof value === 'boolean' ? { info, read, write, value } : null;
      } catch { return null; }
    }
    function sameMethods(record, value) {
      return value && value.info === record.info && value.read === record.read && value.write === record.write;
    }
    function yieldRecord(record, value = false) {
      record.owned = false; record.value = value;
      yielded.add(record.api); phase = 'yielded'; reason = 'native-setting-changed';
    }
    function release() {
      const record = current; current = null;
      if (!record?.owned) return;
      const before = inspect(record.api);
      // A replacement method or an unreadable flag has no safe restore value.
      if (!sameMethods(record, before)) { reason = 'restore-unavailable'; return; }
      if (before.value !== true) { yielded.add(record.api); return; }
      try { record.write.call(record.api, record.original); }
      catch { reason = 'restore-failed'; }
    }
    function update(next, api) {
      if (destroyed) return status();
      const wanted = next === true;
      if (!wanted) {
        reason = ''; release(); enabled = false; yielded = new WeakSet(); preexisting = new WeakSet(); phase = 'disabled'; return status();
      }
      if (!enabled) { enabled = true; yielded = new WeakSet(); preexisting = new WeakSet(); }
      if (arguments.length < 2) {
        try { api = root.livePlayer; } catch { api = null; }
      }
      if (current?.api !== api) { reason = ''; release(); current = null; }
      if (hidden) { phase = 'page-hidden'; return status(); }
      if (!api || !['object', 'function'].includes(typeof api)) { phase = 'unavailable'; reason = 'native-api-unavailable'; return status(); }
      if (yielded.has(api)) { phase = 'yielded'; reason = 'native-setting-changed'; return status(); }
      const value = inspect(api);
      if (!value) { phase = 'unavailable'; reason = 'native-setting-unreadable'; return status(); }
      if (current) {
        if (!sameMethods(current, value) || value.value !== true) { yieldRecord(current, value.value); return status(); }
        current.value = true; phase = current.owned ? 'owned' : 'preexisting'; reason = ''; return status();
      }
      current = { api, ...value, original: value.value, owned: false };
      if (value.value) {
        // Remember that this API was already configured. A later external false
        // must not turn an observation into a new claim on the same activation.
        preexisting.add(api); phase = 'preexisting'; reason = ''; return status();
      }
      if (preexisting.has(api)) { yieldRecord(current); return status(); }
      const record = current;
      record.owned = true; record.value = null;
      try { record.write.call(api, true); }
      catch {
        // A setter can mutate before throwing. Undo only our still-readable true.
        release(); yielded.add(api); phase = 'unavailable'; reason = 'native-setting-write-failed'; return status();
      }
      const after = inspect(api);
      if (current !== record || !enabled || hidden || destroyed) {
        // A synchronous native setter can dispatch a lifecycle change. Undo a
        // late result without reviving the controller that just stopped.
        if (sameMethods(record, after) && after.value === true) {
          try { record.write.call(api, record.original); } catch { reason = 'restore-failed'; }
        }
        return status();
      }
      if (!sameMethods(record, after)) { phase = 'unavailable'; reason = 'native-setting-unreadable'; return status(); }
      if (!after.value) { yieldRecord(record); reason = 'native-setting-write-ignored'; return status(); }
      record.value = true; phase = 'owned'; reason = ''; return status();
    }
    function status() {
      return { enabled, active: enabled && !hidden && ['owned', 'preexisting'].includes(phase), owned: current?.owned === true,
        phase, reason, nativeManualSeamlessDisabled: current?.value ?? null,
        manualQualitySwitch: 'reload-selected-quality' };
    }
    function listen(name, fn) {
      if (typeof root.addEventListener !== 'function') return;
      // The parent uses capture listeners too. Register first in the same phase
      // so pageshow clears hidden before the parent's discovery update.
      root.addEventListener(name, fn, true); listeners.push([name, fn]);
    }
    listen('pagehide', () => { hidden = true; reason = ''; release(); phase = 'page-hidden'; });
    // The parent controller supplies its existing pageshow/discovery update.
    listen('pageshow', () => { hidden = false; if (enabled) phase = 'waiting'; });
    function destroy() {
      if (destroyed) return;
      reason = ''; release(); enabled = false; destroyed = true; phase = 'destroyed'; yielded = new WeakSet(); preexisting = new WeakSet();
      for (const [name, fn] of listeners) root.removeEventListener(name, fn, true);
      listeners.length = 0;
    }
    return { update, destroy, status };
  }
  root.BFDLiveQuality = { create };
})(globalThis);
