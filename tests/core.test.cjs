"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../extension/core.js");
const f = require("./fixtures.cjs");
test("all four ordinary scrolling types become native top fixed", () => {
  const input = f.packet([1, 2, 3, 6, 4, 5, 7, 8, 9]);
  const result = core.rewriteProtobuf(input);
  assert.equal(result.error, null);
  assert.equal(result.converted, 4);
  assert.equal(result.total, 9);
  assert.deepEqual(f.modesFrom(result.data), [5, 5, 5, 5, 4, 5, 7, 8, 9]);
  assert.deepEqual(f.modesFrom(input), [1, 2, 3, 6, 4, 5, 7, 8, 9]);
  assert.equal(result.data.length, input.length);
  assert.equal([...input.keys()].filter(i => input[i] !== result.data[i]).length, 4);
});
test("bottom and deterministic alternate modes", () => {
  const input = f.packet([1, 5, 6, 4, 2, 3]);
  assert.deepEqual(f.modesFrom(core.rewriteProtobuf(input, { position: "bottom" }).data), [4, 5, 4, 4, 4, 4]);
  assert.deepEqual(f.modesFrom(core.rewriteProtobuf(input, { position: "alternate" }).data), [5, 5, 4, 4, 5, 4]);
});
test("disabled conversion returns original object untouched", () => {
  const input = f.packet([1]);
  assert.equal(core.rewriteProtobuf(input, { enabled: false }).data, input);
  assert.equal(core.rewriteXml('<i><d p="0,1,25,0,0,0,u,1">Hi</d></i>', { enabled: false }).converted, 0);
});
test("ArrayBuffer API returns ArrayBuffer", () => {
  const result = core.rewriteProtobuf(f.packet([1]).buffer);
  assert.ok(result.data instanceof ArrayBuffer);
  assert.deepEqual(f.modesFrom(new Uint8Array(result.data)), [5]);
});
test("64-bit IDs and unknown fields are preserved exactly", () => {
  const largeId = [255, 255, 255, 255, 255, 255, 255, 255, 127];
  const unknown = [
    ...f.field(42, 0, largeId), ...f.field(43, 1, Array(8).fill(12)),
    ...f.field(44, 5, Array(4).fill(15)), ...f.text(45, "unknown 中文"),
    ...f.sized(99, [24, 1])
  ];
  const input = new Uint8Array(f.sized(1, f.element(6, "保留文字", unknown)));
  const result = core.rewriteProtobuf(input);
  assert.equal(result.error, null);
  assert.equal(result.converted, 1);
  assert.equal([...input.keys()].filter(i => input[i] !== result.data[i]).length, 1);
});
test("unknown top-level metadata is not mistaken for a danmaku", () => {
  const metadata = f.sized(3, f.element(1, "AI metadata"));
  const input = f.packet([1], metadata);
  const result = core.rewriteProtobuf(input);
  assert.equal(result.converted, 1);
  assert.deepEqual(result.data.slice(-metadata.length), input.slice(-metadata.length));
});
test("truncated and unsupported packets fail open with no partial edit", () => {
  const badInputs = [
    [10, 20, 24, 1], [10, 3, 24, 1, 128],
    [...f.packet([1]), 0], [...f.packet([1]), 19], [128,128,128,128,128],
    f.sized(1, [24,129,0])
  ];
  for (const bytes of badInputs) {
    const input = new Uint8Array(bytes);
    const result = core.rewriteProtobuf(input);
    assert.ok(result.error, JSON.stringify(bytes));
    assert.equal(result.data, input);
    assert.equal(result.converted, 0);
  }
});
test("protobuf singular-field last-one-wins semantics", () => {
  const input = new Uint8Array(f.sized(1, [...f.number(3, 1), ...f.number(3, 4)]));
  const result = core.rewriteProtobuf(input);
  assert.equal(result.converted, 0);
  assert.equal(result.data, input);
});
test("XML changes only p mode, preserving text, style and special comments", () => {
  const xml = '<i><d p="2.1,1,25,16777215,0,0,u,123">中文 &amp; &lt;b&gt;</d><d id="x" p="2.2,6,18,0,0,0,u,124">反向</d><d p="2.3,7,25,0,0,0,u,125">["special"]</d></i>';
  const result = core.rewriteXml(xml, { position: "bottom" });
  assert.equal(result.converted, 2);
  assert.equal(result.total, 3);
  assert.equal(result.data, xml.replace("2.1,1,", "2.1,4,").replace("2.2,6,", "2.2,4,"));
  const quoted = "<i><d p='0,1,25,0,0,0,u,1'>single</d></i>";
  assert.equal(core.rewriteXml(quoted).data, quoted.replace("0,1,", "0,5,"));
});
test("XML alternate and non-XML safety", () => {
  const result = core.rewriteXml('<i><d p="0,1,25,0,0,0,u,1">A</d><d p="1,1,25,0,0,0,u,2">B</d></i>', { position: "alternate" });
  assert.match(result.data, /p="0,5,/);
  assert.match(result.data, /p="1,4,/);
  const error = '{"code":-400,"message":"error"}';
  assert.equal(core.rewriteXml(error).data, error);
  assert.ok(core.rewriteXml(error).error);
});
test("URL allowlist accepts normal, WBI, history and legacy XML only", () => {
  for (const path of ["/x/v2/dm/web/seg.so", "/x/v2/dm/wbi/web/seg.so", "/x/v2/dm/web/history/seg.so"])
    assert.equal(core.endpointKind("https://api.bilibili.com" + path + "?oid=1"), "protobuf");
  assert.equal(core.endpointKind("https://comment.bilibili.com/123.xml"), "xml");
  assert.equal(core.endpointKind("https://api.bilibili.com/x/v1/dm/list.so?oid=1"), "xml");
  for (const url of ["https://example.com/x/v2/dm/web/seg.so", "https://api.bilibili.com/x/v2/dm/web/view", "https://api.bilibili.com.evil.test/x/v2/dm/web/seg.so", "http://api.bilibili.com/x/v2/dm/web/seg.so"])
    assert.equal(core.endpointKind(url), null);
});
test("supported routes and settings validation", () => {
  assert.ok(core.isVideoPage("https://www.bilibili.com/video/BV1?p=2"));
  assert.ok(core.isVideoPage("https://www.bilibili.com/bangumi/play/ep1"));
  assert.equal(core.isVideoPage("https://www.bilibili.com/"), false);
  assert.equal(core.isVideoPage('https://live.bilibili.com/video/BV1'), false);
  assert.equal(core.isVideoPage('https://www.bilibili.com.evil.test/video/BV1'), false);
  assert.equal(core.isVideoPage('http://www.bilibili.com/video/BV1'), false);
  assert.deepEqual(core.normalizeSettings({ enabled: "no", position: "bad" }), core.defaults);
  assert.equal(core.pageKey("https://www.bilibili.com/video/BV1?p=2&t=10"), "/video/BV1?p=2");
});
test('live room routes are explicitly separated from VOD and restricted to the live HTTPS origin', () => {
  for (const url of ['https://live.bilibili.com/13308358', 'https://live.bilibili.com/1/?live_from=1', 'https://live.bilibili.com/blanc/123#player']) {
    assert.equal(core.isLivePage(url), true, url);
    assert.equal(core.isVideoPage(url), false, url);
  }
  for (const url of ['https://live.bilibili.com/', 'https://live.bilibili.com/p/eden/area-tags', 'https://live.bilibili.com/0',
    'https://www.bilibili.com/13308358', 'https://live.bilibili.com.evil.test/13308358', 'http://live.bilibili.com/13308358',
    'https://live.bilibili.com/13308358/more', 'invalid']) assert.equal(core.isLivePage(url), false, url);
});
test("empty and oversize data leave video loading independent", () => {
  assert.equal(core.rewriteProtobuf(new Uint8Array()).error, null);
  const huge = new Uint8Array(16 * 1024 * 1024 + 1);
  assert.equal(core.rewriteProtobuf(huge).data, huge);
  assert.ok(core.rewriteProtobuf(huge).error);
});
