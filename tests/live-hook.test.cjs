'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const core = require('../extension/core.js');
function harness(url = 'https://live.bilibili.com/13308358') {
  const listeners = [], messages = [], updates = [];
  const nativeFetch = async () => {}, nativeXHR = function () {}, nativeSocket = function () {};
  const status = { active: true, frames: 60, fps: 60, composite: { comments: 2, images: 1 } };
  const context = { BFDFixedCore: core, URL, location: { href: url, origin: new URL(url).origin },
    fetch: nativeFetch, XMLHttpRequest: nativeXHR, WebSocket: nativeSocket,
    BFDVideoSync: { create() { throw new Error('VOD adapter must not be created in live rooms'); } },
    BFDLiveSync: { create: () => ({ update: s => updates.push(s), status: () => status }) },
    addEventListener: (name, fn) => { assert.equal(name, 'message'); listeners.push(fn); }, postMessage: m => messages.push(m) };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../extension/hook.js'), 'utf8'), context);
  function send(type, payload, origin = context.location.origin, own = true) {
    context.incoming = { channel: 'bfd-fixed-v1', type, payload }; context.testOrigin = origin; context.testOwn = own;
    context.dispatch = listeners[0];
    vm.runInContext('dispatch({source:testOwn?window:{},origin:testOrigin,data:incoming})', context);
  }
  return { context, messages, updates, send, nativeFetch, nativeXHR, nativeSocket };
}
test('live routing preserves native network transports and uses only the live adapter', () => {
  const h = harness();
  assert.equal(h.context.fetch, h.nativeFetch); assert.equal(h.context.XMLHttpRequest, h.nativeXHR); assert.equal(h.context.WebSocket, h.nativeSocket);
  assert.equal(h.updates.length, 1); assert.equal(h.messages.at(-1).payload.pageType, 'live');
  assert.equal(h.messages.at(-1).payload.supportedPage, true); assert.equal(h.messages.at(-1).payload.liveSync.composite.images, 1);
});
test('live settings preserve both modes and off while get-status never rebinds the adapter', () => {
  const h = harness(); h.send('settings', { enabled: true, motion: 'video-sync', position: 'bottom' });
  assert.equal(h.updates.at(-1).motion, 'video-sync'); assert.equal(h.updates.at(-1).position, 'bottom');
  const n = h.updates.length; h.send('get-status'); assert.equal(h.updates.length, n);
  h.send('settings', { enabled: false }); assert.equal(h.updates.at(-1).enabled, false);
});
test('live settings ignore foreign origins and foreign windows', () => {
  const h = harness(), n = h.updates.length;
  h.send('settings', { enabled: false }, 'https://other.example');
  h.send('settings', { enabled: false }, h.context.location.origin, false);
  assert.equal(h.updates.length, n);
});
test('live home and activity pages install neither live controllers nor VOD network hooks', () => {
  for (const url of ['https://live.bilibili.com/', 'https://live.bilibili.com/p/eden/area-tags', 'https://live.bilibili.com/video/BVtest']) {
    const h = harness(url);
    assert.equal(h.updates.length, 0); assert.equal(h.messages.length, 0);
    assert.equal(h.context.fetch, h.nativeFetch); assert.equal(h.context.XMLHttpRequest, h.nativeXHR); assert.equal(h.context.WebSocket, h.nativeSocket);
  }
});
