"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const core = require("../extension/core.js");
const f = require("./fixtures.cjs");
const hook = fs.readFileSync(require.resolve("../extension/hook.js"), "utf8");
const URL_DM = "https://api.bilibili.com/x/v2/dm/wbi/web/seg.so?oid=1";
function harness(body = f.packet([1, 4, 6]).buffer) {
  const listeners = [], messages = [];
  class FakeXHR {
    constructor(value = body, url = URL_DM) {
      this.value = value; this.responseURL = url;
      this.readyState = 4; this.status = 200;
    }
    get response() { return this.value; }
    get responseText() {
      if (typeof this.value !== "string") throw new Error("InvalidStateError");
      return this.value;
    }
  }
  const context = {
    BFDFixedCore: core, URL, ArrayBuffer, Headers, Response,
    location: { href: "https://www.bilibili.com/video/BVtest", origin: "https://www.bilibili.com" },
    XMLHttpRequest: FakeXHR,
    fetch: async url => {
      const response = new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } });
      Object.defineProperty(response, "url", { value: url });
      return response;
    },
    addEventListener: (_type, listener) => listeners.push(listener),
    postMessage: message => messages.push(message)
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(hook, context);
  function settings(value) {
    context.incoming = { channel: "bfd-fixed-v1", type: "settings", payload: value };
    context.dispatch = listeners[0];
    vm.runInContext("dispatch({source:window, origin:location.origin, data:incoming})", context);
  }
  if (body !== null) settings({ enabled: true, motion: "fixed", position: "top" });
  return { context, messages, settings, FakeXHR };
}
test("default MAIN hook state starts in video-sync without rewriting early danmaku packets", async () => {
  const { context } = harness(null);
  const packet = f.packet([1, 4, 6]).buffer;
  const response = await (async () => {
    context.XMLHttpRequest = class {};
    return core.rewriteProtobuf(packet);
  })();
  assert.equal(response.converted, 0);
  assert.equal(context.messages?.at(-1)?.payload.motion ?? "video-sync", "video-sync");
});
test("fetch protobuf transformed; URL metadata and clone preserved", async () => {
  const { context, messages } = harness();
  const response = await context.fetch(URL_DM);
  assert.equal(response.url, URL_DM);
  assert.equal(response.status, 200);
  const clone = response.clone();
  assert.equal(clone.url, URL_DM);
  assert.deepEqual(f.modesFrom(new Uint8Array(await response.arrayBuffer())), [5, 4, 5]);
  assert.deepEqual(f.modesFrom(new Uint8Array(await clone.arrayBuffer())), [5, 4, 5]);
  assert.equal(messages.at(-1).payload.converted, 2);
});
test("non-danmaku fetch requests are left untouched", async () => {
  const { context, messages } = harness();
  const count = messages.length;
  const response = await context.fetch("https://api.bilibili.com/x/web-interface/view");
  assert.deepEqual(f.modesFrom(new Uint8Array(await response.arrayBuffer())), [1, 4, 6]);
  assert.equal(messages.length, count);
});
test("XHR converted once, with stable cached response identity", () => {
  const { FakeXHR, messages } = harness();
  const xhr = new FakeXHR();
  const first = xhr.response;
  assert.equal(xhr.response, first);
  assert.deepEqual(f.modesFrom(new Uint8Array(first)), [5, 4, 5]);
  assert.equal(messages.at(-1).payload.packets, 1);
  assert.throws(() => xhr.responseText, /InvalidStateError/);
});
test("XHR XML response and responseText share cache", () => {
  const xml = '<i><d p="0,1,25,0,0,0,u,1">Text</d></i>';
  const { FakeXHR, messages } = harness(xml);
  const xhr = new FakeXHR(xml, "https://comment.bilibili.com/1.xml");
  assert.match(xhr.responseText, /p="0,5,/);
  assert.equal(xhr.response, xhr.responseText);
  assert.equal(messages.at(-1).payload.packets, 1);
});
test("settings apply to subsequent packets, including restore-original", async () => {
  const { context, settings, FakeXHR } = harness();
  settings({ enabled: true, motion: "fixed", position: "bottom" });
  let response = await context.fetch(URL_DM);
  assert.deepEqual(f.modesFrom(new Uint8Array(await response.arrayBuffer())), [4, 4, 4]);
  const xhr = new FakeXHR();
  assert.deepEqual(f.modesFrom(new Uint8Array(xhr.response)), [4, 4, 4]);
  settings({ enabled: false, motion: "fixed" });
  response = await context.fetch(URL_DM);
  assert.deepEqual(f.modesFrom(new Uint8Array(await response.arrayBuffer())), [1, 4, 6]);
  assert.equal(xhr.response, xhr.value);
});
test("parser failure preserves original fetch and reports compatibility issue", async () => {
  const original = new Uint8Array([10, 8, 24, 1]).buffer;
  const { context, messages } = harness(original);
  const response = await context.fetch(URL_DM);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(original));
  assert.equal(messages.at(-1).payload.errors, 1);
  assert.equal(messages.at(-1).payload.converted, 0);
});
test("route change resets per-video statistics and leaves other pages alone", async () => {
  const { context, messages } = harness();
  await context.fetch(URL_DM);
  context.location.href = "https://www.bilibili.com/video/BVnext?p=2";
  await context.fetch(URL_DM);
  assert.equal(messages.at(-1).payload.packets, 1);
  context.location.href = "https://www.bilibili.com/";
  const response = await context.fetch(URL_DM);
  assert.deepEqual(f.modesFrom(new Uint8Array(await response.arrayBuffer())), [1, 4, 6]);
});
test("unfinished or failed XHR and unsupported response types remain unchanged", () => {
  const { FakeXHR } = harness();
  const xhr = new FakeXHR();
  xhr.readyState = 3;
  assert.equal(xhr.response, xhr.value);
  xhr.readyState = 4; xhr.status = 500;
  assert.equal(xhr.response, xhr.value);
  xhr.status = 200; xhr.value = { untouched: true };
  assert.equal(xhr.response, xhr.value);
});
test("fetch XML gets transformed through the same hook", async () => {
  const { context } = harness('<i><d p="0,6,25,0,0,0,u,1">XML</d></i>');
  const response = await context.fetch("https://comment.bilibili.com/1.xml");
  assert.match(await response.text(), /p="0,5,/);
});
test("SPA pushState and deferred emptied rebind videoSync after target-phase emptied teardown", async () => {
  const docEvents = new Map(), winEvents = new Map(), syncUpdates = [];
  let renderer = { id: "r1", add() {} }, targetEmptiedDone = false;
  const history = {
    pushState(_state, _title, url) { context.location.href = new URL(url, context.location.origin).href; }
  };
  const context = {
    BFDFixedCore: core, URL, ArrayBuffer, Headers, Response, Promise, history,
    location: { href: "https://www.bilibili.com/video/BVprev", origin: "https://www.bilibili.com" },
    player: { danmaku: { getDanmakuX: () => renderer } },
    BFDVideoSync: { create: () => ({ update: (s, r) => syncUpdates.push({ s, r, targetEmptiedDone }), status: () => ({ active: true }), refresh() {} }) },
    document: { addEventListener: (name, fn) => docEvents.set(name, fn) },
    addEventListener: (name, fn) => winEvents.set(name, fn),
    postMessage() {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(hook, context);
  syncUpdates.length = 0;
  // Simulate capture-phase emptied firing BEFORE <video> target-phase emptied
  docEvents.get("emptied")({ type: "emptied" });
  assert.equal(syncUpdates.length, 0, "capture-phase emptied must defer until target-phase teardown completes");
  targetEmptiedDone = true;
  renderer = { id: "r2", add() {} };
  await Promise.resolve();
  assert.equal(syncUpdates.length, 1);
  assert.equal(syncUpdates[0].targetEmptiedDone, true);
  assert.equal(syncUpdates[0].r.id, "r2");
  // Simulate Vue Router pushState to recommended video
  syncUpdates.length = 0;
  context.history.pushState({}, "", "/video/BV1Uthv6fEKw/?spm_id_from=333.788.recommend_more_video.-1");
  await Promise.resolve();
  assert.equal(syncUpdates.length, 1);
  assert.equal(context.location.pathname || new URL(context.location.href).pathname, "/video/BV1Uthv6fEKw/");
});