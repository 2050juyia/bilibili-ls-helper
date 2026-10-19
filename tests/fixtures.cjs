const encode = n => {
  const bytes = [];
  do { const part = n & 127; n = Math.floor(n / 128); bytes.push(part | (n ? 128 : 0)); } while (n);
  return bytes;
};
const field = (number, wire, bytes) => [...encode(number * 8 + wire), ...bytes];
const sized = (number, bytes) => field(number, 2, [...encode(bytes.length), ...bytes]);
const number = (tag, value) => field(tag, 0, encode(value));
const text = (tag, value) => sized(tag, [...Buffer.from(value)]);
function element(mode, content = "测试弹幕", extra = []) {
  return [...number(1, 1234), ...number(2, 2100), ...number(3, mode),
    ...number(4, 25), ...number(5, 0x123456), ...text(7, content), ...extra];
}
function packet(modes, extra = []) {
  return new Uint8Array([...modes.flatMap((mode, index) => sized(1, element(mode, "中文 & <测试> " + index))), ...extra]);
}
function modesFrom(bytes) {
  // Independent fixture decoder uses BigInt rather than production traversal.
  let pos = 0;
  function read() {
    let result = 0n, shift = 0n, b;
    do { b = bytes[pos++]; result |= BigInt(b & 127) << shift; shift += 7n; } while (b & 128);
    return Number(result);
  }
  function skip(wire) {
    if (wire === 0) read();
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else { const size = read(); pos += size; }
  }
  const result = [];
  while (pos < bytes.length) {
    const tag = read();
    if (tag !== 10) { skip(tag % 8); continue; }
    const size = read(), end = pos + size;
    let mode = 0;
    while (pos < end) {
      const tag2 = read();
      if (tag2 === 24) mode = read(); else skip(tag2 % 8);
    }
    result.push(mode);
  }
  return result;
}
module.exports = { encode, field, sized, number, text, element, packet, modesFrom };

const dmPath = 'bilibili.broadcast.message.main.DanmukuEvent';
const any = (name, payload) => [...text(1, 'type.googleapis.com/' + name.replace(/^\//, '')), ...sized(2, payload)];
function broadcast(payload, options = {}) {
  let target = options.target || dmPath, value = any(dmPath, payload);
  if (options.room !== false) {
    const message = [...text(1, target), ...sized(2, value)];
    value = any('bilibili.broadcast.v1.RoomResp', [...text(1, options.id || 'video://80433022/137649199'), ...sized(5, message)]);
    target = '/bilibili.broadcast.v1.BroadcastRoom/Enter';
  }
  return new Uint8Array([...sized(1, number(1, 123)), ...text(2, target), ...sized(3, value), ...text(99, 'unknown')]);
}
function bytesField(bytes, number) {
  let at = 0;
  const read = () => { let result = 0n, shift = 0n, b; do { b = bytes[at++]; result |= BigInt(b & 127) << shift; shift += 7n; } while (b & 128); return Number(result); };
  let found;
  while (at < bytes.length) {
    const tag = read(), wire = tag % 8;
    if (wire === 0) read(); else if (wire === 1) at += 8; else if (wire === 5) at += 4;
    else if (wire === 2) { const length = read(); const value = bytes.subarray(at, at + length); at += length; if (Math.floor(tag / 8) === number) found = value; }
    else throw new Error('fixture wire');
  }
  return found;
}
function broadcastPayload(frame, room = true) {
  let value = bytesField(bytesField(frame, 3), 2);
  if (room) value = bytesField(bytesField(bytesField(value, 5), 2), 2);
  return value;
}
Object.assign(module.exports, { dmPath, broadcast, bytesField, broadcastPayload });
