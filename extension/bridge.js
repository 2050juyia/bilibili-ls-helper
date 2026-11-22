(function () {
  "use strict";
  const CHANNEL = "bfd-fixed-v1";
  const hasBrowser = typeof browser === "object" && !!browser?.runtime;
  const ext = hasBrowser ? browser : chrome;
  let status = null, settingsRevision = 0;
  function post(type, payload) {
    window.postMessage({ channel: CHANNEL, type, payload }, location.origin);
  }
  async function syncSettings() {
    const initial = settingsRevision;
    try {
      const values = await ext.storage.local.get("bfdSettings");
      if (settingsRevision === initial)
        post("settings", values?.bfdSettings || { enabled: true, position: "top" });
    } catch { if (settingsRevision === initial) post("get-status"); }
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin ||
        event.data?.channel !== CHANNEL || event.data.type !== "status") return;
    const value = event.data.payload;
    if (typeof value?.supportedPage === "boolean" && Number.isFinite(value.converted))
      status = value;
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.bfdSettings) {
      settingsRevision++;
      post("settings", changes.bfdSettings.newValue);
    }
  });
  if (hasBrowser) {
    browser.runtime.onMessage.addListener((message) => {
      if (message?.type !== "bfd-get-status") return undefined;
      post("get-status");
      // browser.runtime.onMessage requires returning a Promise for async replies.
      return new Promise((resolve) => setTimeout(() => resolve(status), 30));
    });
  } else {
    chrome.runtime.onMessage.addListener((message, _sender, reply) => {
      if (message?.type !== "bfd-get-status") return;
      post("get-status");
      // postMessage dispatch is asynchronous; give MAIN a task to respond.
      setTimeout(() => reply(status), 30);
      return true;
    });
  }
  syncSettings();
})();
