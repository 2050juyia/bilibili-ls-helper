/* Pure, dependency-free transformations. No video decoding or animation loop. */
(function (root) {
  "use strict";
  const MAX_BYTES = 16 * 1024 * 1024;
  const defaults = Object.freeze({ enabled: true, position: "top", motion: "fixed" });
  const rolling = new Set([1, 2, 3, 6]);

  function normalizeSettings(value) {
    return {
      enabled: typeof value?.enabled === "boolean" ? value.enabled : defaults.enabled,
      motion: value?.motion === "video-sync" ? "video-sync" : "fixed",
      position: ["top", "bottom", "alternate"].includes(value?.position)
        ? value.position : defaults.position
    };
  }
  function pageKey(url) {
    const u = new URL(url);
    return u.pathname + "?p=" + (u.searchParams.get("p") || "1");
  }
  function isVideoPage(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && u.hostname === 'www.bilibili.com' && /^\/(?:video\/|bangumi\/play\/)/.test(u.pathname);
    }
    catch { return false; }
  }
  function isLivePage(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && u.hostname === 'live.bilibili.com' && /^\/(?:blanc\/)?[1-9]\d*\/?$/.test(u.pathname);
    } catch { return false; }
  }
  function endpointKind(value, base) {
    try {
      const u = new URL(value, base);
      if (u.protocol !== "https:") return null;
      if (u.hostname === "api.bilibili.com") {
        if (/^\/x\/v2\/dm\/(?:wbi\/)?web\/(?:history\/)?seg\.so$/.test(u.pathname))
          return "protobuf";
        if (["/x/v1/dm/list.so", "/x/v2/dm/history"].includes(u.pathname))
          return "xml";
      }
      if (u.hostname === "comment.bilibili.com" && /^\/\d+\.xml$/.test(u.pathname))
        return "xml";
    } catch { /* Ignore other URLs. */ }
    return null;
  }
  function targetMode(position, ordinal) {
    return position === "bottom" || (position === "alternate" && ordinal % 2 === 1)
      ? 4 : 5;
  }
  function rewriteSelf(input, settings = defaults, ordinal = 0) {
    const options = normalizeSettings(settings);
    if (!options.enabled || options.motion === "video-sync" || !input || typeof input !== 'object' ||
        (input.isMine !== true && input.border !== true) || !rolling.has(input.mode))
      return { data: input, converted: 0 };
    const mode = targetMode(options.position, ordinal);
    return { data: { ...input, mode, rawMode: mode }, converted: 1 };
  }
  function broadcastEndpoint(value, protocols, base) {
    try {
      const u = new URL(value, base), list = Array.isArray(protocols) ? protocols : [protocols];
      return u.protocol === 'wss:' && (u.hostname === 'broadcast.chat.bilibili.com' || u.hostname.endsWith('.broadcast.chat.bilibili.com')) && u.pathname === '/sub' && list.includes('proto');
    } catch { return false; }
  }

  // Decode only tags, sizes and the small mode value. 64-bit IDs are skipped
  // byte-for-byte so JavaScript number precision cannot corrupt them.
  function readSmall(bytes, cursor, end) {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      if (cursor.pos >= end) throw new Error("截断的 varint");
      const byte = bytes[cursor.pos++];
      value += (byte & 127) * 2 ** (7 * i);
      if (!(byte & 128)) return value;
    }
    throw new Error("过长的 tag、长度或 mode");
  }
  function skipField(bytes, cursor, end, wire) {
    if (wire === 0) {
      for (let i = 0; i < 10; i++) {
        if (cursor.pos >= end) throw new Error("截断的字段");
        if (!(bytes[cursor.pos++] & 128)) return;
      }
      throw new Error("过长的 varint");
    }
    if (wire === 1) cursor.pos += 8;
    else if (wire === 2) { const length = readSmall(bytes, cursor, end); cursor.pos += length; }
    else if (wire === 5) cursor.pos += 4;
    else throw new Error("不支持的 wire type");
    if (cursor.pos > end) throw new Error("字段超出消息边界");
  }
  function readTag(bytes, cursor, end) {
    const tag = readSmall(bytes, cursor, end);
    const field = Math.floor(tag / 8);
    if (!field) throw new Error("非法 field number");
    return { field, wire: tag % 8 };
  }
  function rewriteProtobuf(input, settings = defaults) {
    const options = normalizeSettings(settings);
    if (!options.enabled || options.motion === "video-sync") return { data: input, converted: 0, total: 0, error: null };
    try {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      if (bytes.length > MAX_BYTES) throw new Error("弹幕包超过16MB");
      const cursor = { pos: 0 }, edits = [];
      let total = 0, ordinal = 0;
      while (cursor.pos < bytes.length) {
        const tag = readTag(bytes, cursor, bytes.length);
        if (tag.field !== 1 || tag.wire !== 2) {
          skipField(bytes, cursor, bytes.length, tag.wire);
          continue;
        }
        const size = readSmall(bytes, cursor, bytes.length);
        const end = cursor.pos + size;
        if (end > bytes.length) throw new Error("截断的弹幕条目");
        let lastMode = null;
        while (cursor.pos < end) {
          const itemTag = readTag(bytes, cursor, end);
          if (itemTag.field === 3 && itemTag.wire === 0) {
            const offset = cursor.pos;
            const mode = readSmall(bytes, cursor, end);
            lastMode = { offset, size: cursor.pos - offset, mode };
          } else skipField(bytes, cursor, end, itemTag.wire);
        }
        total++;
        if (lastMode && rolling.has(lastMode.mode)) {
          if (lastMode.size !== 1) throw new Error("非标准mode编码，保留原包");
          edits.push([lastMode.offset, targetMode(options.position, ordinal++)]);
        }
      }
      // Apply edits only after validating the entire packet. On an unknown
      // schema or malformed packet, return the original body without partial edits.
      if (!edits.length) return { data: input, converted: 0, total, error: null };
      const output = bytes.slice();
      for (const [offset, mode] of edits) output[offset] = mode;
      return {
        data: input instanceof Uint8Array ? output : output.buffer,
        converted: edits.length, total, error: null
      };
    } catch (error) {
      return { data: input, converted: 0, total: 0, error: error.message };
    }
  }
  function rewriteXml(input, settings = defaults) {
    const options = normalizeSettings(settings);
    if (!options.enabled || options.motion === "video-sync" || typeof input !== "string")
      return { data: input, converted: 0, total: 0, error: null };
    if (input.length > MAX_BYTES)
      return { data: input, converted: 0, total: 0, error: "弹幕包超过16MB" };
    if (!/<i(?:\s|>)/.test(input))
      return { data: input, converted: 0, total: 0, error: "不是弹幕XML" };
    let total = 0, converted = 0;
    const data = input.replace(/(<d\b[^>]*?\s+p\s*=\s*)(["'])([^"']*)\2/g,
      (whole, prefix, quote, value) => {
        total++;
        const parts = value.split(",");
        if (parts.length < 8 || !/^\d+$/.test(parts[1]) || !rolling.has(Number(parts[1])))
          return whole;
        parts[1] = String(targetMode(options.position, converted++));
        return prefix + quote + parts.join(",") + quote;
      });
    return { data, converted, total, error: null };
  }
  // Bilibili's VOD real-time broadcast is protobuf, not the live-room JSON protocol.
  // Rebuild only changed length-delimited fields; IDs and unknown fields stay as bytes.
  function fields(bytes) {
    const cursor = { pos: 0 }, result = [];
    while (cursor.pos < bytes.length) {
      const start = cursor.pos, tag = readTag(bytes, cursor, bytes.length), tagEnd = cursor.pos;
      let payload = tagEnd;
      if (tag.wire === 2) {
        const size = readSmall(bytes, cursor, bytes.length); payload = cursor.pos; cursor.pos += size;
        if (cursor.pos > bytes.length) throw new Error('截断的广播字段');
      } else skipField(bytes, cursor, bytes.length, tag.wire);
      result.push({ ...tag, start, tagEnd, payload, end: cursor.pos });
    }
    return result;
  }
  function varint(value) {
    const output = [];
    do { const part = value % 128; value = Math.floor(value / 128); output.push(part | (value ? 128 : 0)); } while (value);
    return Uint8Array.from(output);
  }
  function join(chunks) {
    const result = new Uint8Array(chunks.reduce((sum, part) => sum + part.length, 0));
    let at = 0; for (const part of chunks) { result.set(part, at); at += part.length; }
    return result;
  }
  function replace(bytes, field, data) {
    return join([bytes.subarray(0, field.start), bytes.subarray(field.start, field.tagEnd), ...(field.wire === 2 ? [varint(data.length)] : []), data, bytes.subarray(field.end)]);
  }
  const DM_PATH = 'bilibili.broadcast.message.main.DanmukuEvent';
  const ROOM_PATH = '/bilibili.broadcast.v1.BroadcastRoom/Enter';
  function rewriteBroadcast(input, settings = defaults) {
    const options = normalizeSettings(settings);
    const unchanged = { data: input, converted: 0, total: 0, matched: false, error: null };
    if (!options.enabled || options.motion === "video-sync") return unchanged;
    try {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      if (bytes.length > MAX_BYTES) throw new Error('广播包超过16MB');
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const last = (list, number, wire = 2) => list.filter(f => f.field === number && f.wire === wire).at(-1);
      const text = (data, f) => f ? decoder.decode(data.subarray(f.payload, f.end)) : '';
      let converted = 0, total = 0, matched = false;
      function event(data) {
        matched = true;
        return join(fields(data).map(f => {
          if (f.field !== 1 || f.wire !== 2) return data.subarray(f.start, f.end);
          const elem = data.subarray(f.payload, f.end), modeField = last(fields(elem), 3, 0);
          const mode = modeField ? readSmall(elem, { pos: modeField.payload }, modeField.end) : 0;
          total++;
          // The native broadcast consumer treats omitted/zero mode as ordinary scrolling (1).
          if (mode !== 0 && !rolling.has(mode)) return data.subarray(f.start, f.end);
          const target = targetMode(options.position, converted++);
          const rewritten = modeField ? replace(elem, modeField, varint(target)) : join([elem, Uint8Array.of(24, target)]);
          return join([data.subarray(f.start, f.tagEnd), varint(rewritten.length), rewritten]);
        }));
      }
      function any(data, transform) {
        const value = last(fields(data), 2);
        if (!value) return data;
        return replace(data, value, transform(data.subarray(value.payload, value.end)));
      }
      function frame(data) {
        const list = fields(data), target = text(data, last(list, 2)), body = last(list, 3);
        if (!body || (target !== DM_PATH && target !== ROOM_PATH)) return data;
        const rewritten = any(data.subarray(body.payload, body.end), target === DM_PATH ? event : room);
        return replace(data, body, rewritten);
      }
      function room(data) {
        const list = fields(data), id = text(data, last(list, 1)), message = last(list, 5);
        if (!/^video:\/\/\d+\/\d+(?:\?.*)?$/.test(id) || !message) return data;
        const msg = data.subarray(message.payload, message.end), msgFields = fields(msg);
        if (text(msg, last(msgFields, 1)) !== DM_PATH) return data;
        const body = last(msgFields, 2);
        if (!body) return data;
        return replace(data, message, replace(msg, body, any(msg.subarray(body.payload, body.end), event)));
      }
      const output = frame(bytes);
      if (!converted) return { ...unchanged, total, matched };
      return { data: input instanceof Uint8Array ? output : output.buffer, converted, total, matched, error: null };
    } catch (error) { return { ...unchanged, error: error.message }; }
  }
  const api = Object.freeze({
    defaults, normalizeSettings, pageKey, isVideoPage, isLivePage, endpointKind,
    rewriteProtobuf, rewriteXml, broadcastEndpoint, rewriteBroadcast, rewriteSelf
  });
  if (typeof module === "object" && module.exports) module.exports = api;
  else Object.defineProperty(root, "BFDFixedCore", { value: api, configurable: true });
})(globalThis);
