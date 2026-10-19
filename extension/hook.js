(function () {
  "use strict";
  const core = globalThis.BFDFixedCore;
  if (!core || globalThis.__bfdHookInstalled) return;
  Object.defineProperty(globalThis, "__bfdHookInstalled", { value: true });
  const CHANNEL = "bfd-fixed-v1";
  let settings = core.normalizeSettings(null), revision = 0;
  let key = core.pageKey(location.href);
  let stats = freshStats();
  const xhrCache = new WeakMap();
  const sockets = new WeakMap(), socketCache = new WeakMap();
  const selfRenderers = new WeakMap();
  let selfOrdinal = 0;
  const videoSync = globalThis.BFDVideoSync?.create();
  function freshStats() {
    return { packets: 0, converted: 0, total: 0, errors: 0, lastError: "", fetch: false, xhr: false, socket: false, socketPackets: 0, socketConverted: 0, selfConverted: 0 };
  }
  function resetForRoute() {
    const next = core.pageKey(location.href);
    if (next !== key) {
      key = next;
      selfOrdinal = 0;
      const installed = { fetch: stats.fetch, xhr: stats.xhr, socket: stats.socket };
      stats = Object.assign(freshStats(), installed);
    }
  }
  function sendStatus() {
    resetForRoute();
    window.postMessage({
      channel: CHANNEL, type: "status",
      payload: { ...stats, enabled: settings.enabled, position: settings.position,
        selfRenderer: prepareSelfRenderer(), videoSync: videoSync?.status(), motion: settings.motion, supportedPage: core.isVideoPage(location.href), pageKey: key }
    }, location.origin);
  }
  function report(result, transport) {
    resetForRoute();
    stats.packets++;
    stats.converted += result.converted;
    stats.total += result.total;
    if (transport === 'socket') { stats.socketPackets++; stats.socketConverted += result.converted; }
    if (result.error) { stats.errors++; stats.lastError = result.error; }
    sendStatus();
  }
  // Read the transformed bytes through the original trusted MessageEvent. Do not
  // redispatch messages: that changes ordering, event identity and listener semantics.
  const NativeSocket = window.WebSocket, messageProto = window.MessageEvent?.prototype;
  const messageData = messageProto && Object.getOwnPropertyDescriptor(messageProto, 'data');
  if (NativeSocket && messageData?.get && messageData.configurable) {
    try {
      Object.defineProperty(messageProto, 'data', { ...messageData, get() {
        const original = Reflect.apply(messageData.get, this, []);
        const socket = this.target;
        if (!(socket instanceof NativeSocket) || !settings.enabled || !core.isVideoPage(location.href) || !(original instanceof ArrayBuffer)) return original;
        if (!sockets.has(socket)) sockets.set(socket, core.broadcastEndpoint(socket.url, socket.protocol, location.href));
        if (!sockets.get(socket)) return original;
        const cached = socketCache.get(this);
        if (cached?.original === original && cached.revision === revision) return cached.data;
        const result = core.rewriteBroadcast(original, settings);
        socketCache.set(this, { original, data: result.data, revision });
        if (result.matched || result.error) report(result, 'socket');
        return result.data;
      } });
      stats.socket = true;
    } catch { /* Preserve native sockets if the browser or another extension owns these hooks. */ }
  }
  function kindFor(url) {
    return settings.enabled && core.isVideoPage(location.href)
      ? core.endpointKind(url, location.href) : null;
  }
  function prepareSelfRenderer() {
    if (!core.isVideoPage(location.href)) { videoSync?.update({ enabled: false }); return false; }
    try {
      const renderer = window.player?.danmaku?.getDanmakuX?.();
      videoSync?.update(settings, renderer);
      if (!renderer || typeof renderer.add !== 'function') return false;
      if (selfRenderers.get(renderer) === renderer.add) return true;
      const nativeAdd = renderer.add;
      function add(data, ...args) {
        resetForRoute();
        // Command/interactive additions use the explicit second argument. Only
        // ordinary local self-comments are converted, on a copy, after sending.
        const result = args[0] === true || !core.isVideoPage(location.href)
          ? { data, converted: 0 } : core.rewriteSelf(data, settings, selfOrdinal);
        const value = Reflect.apply(nativeAdd, this, [result.data, ...args]);
        if (result.converted) { selfOrdinal++; stats.selfConverted++; sendStatus(); }
        return value;
      }
      renderer.add = add;
      if (renderer.add !== add) return false;
      selfRenderers.set(renderer, add);
      return true;
    } catch { return false; }
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin ||
        event.data?.channel !== CHANNEL) return;
    if (event.data.type === "settings") {
      const next = core.normalizeSettings(event.data.payload);
      if (next.position !== settings.position || next.enabled !== settings.enabled) selfOrdinal = 0;
      settings = next;
      revision++;
      sendStatus();
    } else if (event.data.type === "get-status") sendStatus();
  });
  // Attach at media readiness or before the player's send interaction. No DOM
  // observer, animation loop or permanent polling is needed for late/SPA players.
  if (typeof document !== 'undefined' && document.addEventListener) {
    const interaction = event => {
      if (event.type === 'keydown' ? event.key === 'Enter' : event.target?.closest?.('.bpx-player-container')) {
        prepareSelfRenderer(); videoSync?.refresh();
      }
    };
    for (const name of ['pointerdown', 'click', 'keydown', 'input', 'change']) document.addEventListener(name, interaction, true);
    for (const name of ['loadeddata', 'canplay', 'play', 'emptied']) document.addEventListener(name, prepareSelfRenderer, true);
    document.addEventListener('DOMContentLoaded', prepareSelfRenderer, { once: true });
    window.addEventListener('load', prepareSelfRenderer, { once: true });
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = async function (...args) {
      const response = await Reflect.apply(nativeFetch, this, args);
      const url = response.url || (typeof args[0] === "string" ? args[0] : args[0]?.url);
      const kind = kindFor(url);
      if (!kind || !response.ok || response.bodyUsed) return response;
      try {
        const copy = response.clone();
        const original = kind === "protobuf" ? await copy.arrayBuffer() : await copy.text();
        const result = kind === "protobuf"
          ? core.rewriteProtobuf(original, settings) : core.rewriteXml(original, settings);
        report(result);
        if (!result.converted) return response;
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");
        const rewritten = new Response(result.data, {
          status: response.status, statusText: response.statusText, headers
        });
        // Keep URL/type metadata; clone() must also keep it.
        function preserveMetadata(target) {
          for (const name of ["url", "type", "redirected"]) {
            Object.defineProperty(target, name, { value: response[name], configurable: true });
          }
          const clone = target.clone.bind(target);
          Object.defineProperty(target, "clone", {
            value: () => preserveMetadata(clone()), configurable: true
          });
          return target;
        }
        return preserveMetadata(rewritten);
      } catch {
        // Never turn a compatibility problem into a failed network request.
        stats.errors++; stats.lastError = "Fetch转换失败，已保留原始响应";
        sendStatus();
        return response;
      }
    };
    stats.fetch = true;
  }
  function convertXHR(xhr, value) {
    if (xhr.readyState !== 4 || xhr.status < 200 || xhr.status >= 300) return value;
    const kind = kindFor(xhr.responseURL);
    if (!kind || (kind === "protobuf" && !(value instanceof ArrayBuffer)) ||
        (kind === "xml" && typeof value !== "string")) return value;
    const cached = xhrCache.get(xhr);
    if (cached && cached.original === value && cached.revision === revision &&
        cached.url === xhr.responseURL) return cached.data;
    const result = kind === "protobuf"
      ? core.rewriteProtobuf(value, settings) : core.rewriteXml(value, settings);
    xhrCache.set(xhr, {
      original: value, data: result.data, revision, url: xhr.responseURL
    });
    report(result);
    return result.data;
  }
  const proto = window.XMLHttpRequest?.prototype;
  if (proto) {
    let installed = 0;
    for (const name of ["response", "responseText"]) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (!descriptor?.get || !descriptor.configurable) continue;
      try {
        Object.defineProperty(proto, name, {
          ...descriptor,
          get() { return convertXHR(this, Reflect.apply(descriptor.get, this, [])); }
        });
        installed++;
      } catch { /* Another extension may own this getter. */ }
    }
    stats.xhr = installed === 2;
  }
  sendStatus();
})();
