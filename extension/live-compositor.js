// Live comments retain Bilibili's queue/layout; only the completed video frame is presented.
(function (root) {
  'use strict';
  const MAX_BYTES = 48 * 1024 * 1024, MAX_IMAGE_BYTES = 16 * 1024 * 1024;
  let sequence = 0;
  function create({ video, host, layer, mode = 'video-sync', position = 'top' }) {
    if (!video || !host || !layer) throw new Error('直播播放器尚未准备好');
    const canvas = document.createElement('canvas'), mask = document.createElement('style');
    const token = 'live-' + (++sequence), attribute = 'data-bfd-live-mask';
    canvas.className = 'bfd-live-composite'; canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;visibility:hidden;z-index:5;';
    // Ancestor clipping cannot be escaped by a newly inserted descendant with
    // inline visibility:visible!important between two video callbacks. It leaves
    // layout rectangles and native opacity available for video-frame sampling.
    mask.textContent = '[' + attribute + '="' + token + '"]{clip-path:inset(50%)!important}' +
      '[' + attribute + '="' + token + '"],[' + attribute + '="' + token + '"] *{visibility:hidden!important;pointer-events:none!important}';
    const buffer = new OffscreenCanvas(1, 1), context = buffer.getContext('2d', { alpha: false });
    const scratch = new OffscreenCanvas(1, 1), scratchContext = scratch.getContext('2d');
    const output = canvas.getContext('bitmaprenderer', { alpha: false });
    if (!context || !scratchContext || !output) throw new Error('浏览器不支持直播合成画布');
    const previous = [], assets = new Map(), sprites = new Map(), lifetimes = new Map(), forcedHidden = new Map();
    let disposed = false, committed = false, presents = 0, comments = 0, skipped = 0, bytes = 0, layout = '', activeLoads = 0;
    let cacheHits = 0, cacheBuilds = 0, builds = 0, placeholders = 0, imageFailures = 0, staticFallbacks = 0, unsupported = 0, fixedOverflow = 0;
    let presentationRefresh = null;
    let styles = new WeakMap();
    function cssOf(node) { let css = styles.get(node); if (!css) { css = getComputedStyle(node); styles.set(node, css); } return css; }
    const fallbackReasons = new Set();
    function remember(node, name, value) {
      const old = [node, name, node.style.getPropertyValue(name), node.style.getPropertyPriority(name), value];
      previous.push(old); return old;
    }
    // Keep the native video rendered beneath the opaque output. Hiding it can
    // halve frame callbacks for a 60 FPS live stream even while decode stays 60.
    // The completed alpha:false bitmap covers it without changing player state.
    if (getComputedStyle(host).position === 'static') { remember(host, 'position', 'relative'); host.style.setProperty('position', 'relative'); }
    const oldAttribute = layer.getAttribute(attribute);
    function setStyle(node, name, value) {
      if (node.style.getPropertyValue(name) !== value || node.style.getPropertyPriority(name) !== 'important') node.style.setProperty(name, value, 'important');
    }
    function ownMask() {
      if (layer.getAttribute(attribute) !== token) layer.setAttribute(attribute, token);
      if (mask.textContent !== maskText) mask.textContent = maskText;
      if (!mask.parentNode) (document.head || document.documentElement).appendChild(mask);
      if (mask.disabled) mask.disabled = false;
      if (mask.sheet?.disabled) mask.sheet.disabled = false;
      // Inline !important visibility beats even the descendant mask. Correct only
      // those exceptional overrides; ordinary nodes need no per-element writes.
      const descendants = [layer, ...layer.querySelectorAll('*')], current = new Set(descendants);
      for (const [node, old] of forcedHidden) if (!current.has(node)) { restoreHidden(node, old); forcedHidden.delete(node); }
      for (const node of descendants) if (node.style.getPropertyValue('visibility') === 'visible' && node.style.getPropertyPriority('visibility') === 'important') {
        if (!forcedHidden.has(node)) forcedHidden.set(node, ['visible', 'important']);
        setStyle(node, 'visibility', 'hidden');
      }
      setStyle(canvas, 'visibility', 'visible');
      if (canvas.parentElement !== host && host.isConnected !== false) host.appendChild(canvas);
    }
    const maskText = mask.textContent;
    function restoreHidden(node, old) {
      if (node.style.getPropertyValue('visibility') === 'hidden' && node.style.getPropertyPriority('visibility') === 'important') node.style.setProperty('visibility', old[0], old[1]);
    }
    function cancelPresentationRefresh() {
      const record = presentationRefresh; presentationRefresh = null;
      if (!record) return false;
      if (canvas.style.getPropertyValue('opacity') === '0.999' && canvas.style.getPropertyPriority('opacity') === 'important') {
        if (record.value) canvas.style.setProperty('opacity', record.value, record.priority);
        else canvas.style.removeProperty('opacity');
      }
      return true;
    }
    function refreshPresentation() {
      if (disposed || !committed || presentationRefresh) return false;
      const css = getComputedStyle(canvas);
      if (Number(css.opacity) !== 1) return false;
      // This is a bounded compositor invalidation, never a new animation clock.
      const properties = String(css.transitionProperty || 'all').split(',').map(value => value.trim());
      const durations = String(css.transitionDuration || '0s').split(',').map(parseFloat);
      const delays = String(css.transitionDelay || '0s').split(',').map(parseFloat);
      if (properties.some((property, index) => ['all', 'opacity'].includes(property) &&
          (durations[index % durations.length] > 0 || delays[index % delays.length] > 0))) return false;
      if (String(css.animationName || 'none').split(',').some(value => value.trim() !== 'none')) return false;
      try {
        if ((canvas.getAnimations?.() || []).some(animation => !['finished', 'idle'].includes(animation.playState) &&
            animation.effect?.getKeyframes?.().some(frame => Object.prototype.hasOwnProperty.call(frame, 'opacity')))) return false;
      } catch { return false; }
      presentationRefresh = { value: canvas.style.getPropertyValue('opacity'), priority: canvas.style.getPropertyPriority('opacity'), remaining: 2 };
      canvas.style.setProperty('opacity', '0.999', 'important');
      return true;
    }
    function close(value) { try { value?.close?.(); } catch (_) {} }
    function dropSprite(key) { const entry = sprites.get(key); if (!entry) return; bytes -= entry.bytes; entry.canvas.width = entry.canvas.height = 1; sprites.delete(key); }
    function dropAsset(key) {
      const entry = assets.get(key); if (!entry) return;
      entry.cancelled = true; entry.controller?.abort(); close(entry.decoder);
      for (const frame of entry.frames) close(frame.image);
      bytes -= entry.bytes; assets.delete(key);
    }
    function space(required) {
      // Never evict a tile used in this frame. Expired resources are disposable.
      for (const [key, entry] of sprites) { if (bytes + required <= MAX_BYTES) break; if (entry.seen < presents) dropSprite(key); }
      for (const [key, entry] of assets) { if (bytes + required <= MAX_BYTES) break; if (entry.seen < presents - 1 && entry.state !== 'loading') dropAsset(key); }
      return bytes + required <= MAX_BYTES;
    }
    function fallback(entry, reason) { if (!entry.fallback) { entry.fallback = reason; staticFallbacks++; fallbackReasons.add(reason); } }
    async function boundedData(response) {
      if (Number(response.headers?.get('content-length')) > 8 * 1024 * 1024) throw new Error('encoded-size-limit');
      if (!response.body?.getReader) { const data = await response.arrayBuffer(); if (data.byteLength > 8 * 1024 * 1024) throw new Error('encoded-size-limit'); return data; }
      const reader = response.body.getReader(), chunks = []; let length = 0;
      try { for (;;) { const result = await reader.read(); if (result.done) break; length += result.value.byteLength; if (length > 8 * 1024 * 1024) throw new Error('encoded-size-limit'); chunks.push(result.value); } }
      catch (error) { try { await reader.cancel(); } catch (_) {} throw error; }
      const data = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; } return data.buffer;
    }
    function sniff(data, type) {
      const b = new Uint8Array(data), ascii = (a, z) => String.fromCharCode(...b.slice(a, z));
      if (ascii(0, 3) === 'GIF') return 'image/gif';
      if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
      if (b[0] === 137 && ascii(1, 4) === 'PNG') return 'image/png';
      return String(type || '').split(';')[0];
    }
    function addFrame(entry, image, duration) {
      const w = image.displayWidth || image.width || image.codedWidth, h = image.displayHeight || image.height || image.codedHeight, size = w * h * 4;
      if (!(w > 0 && h > 0) || w > 4096 || h > 4096 || size > 4 * 1024 * 1024 || entry.bytes + size > MAX_IMAGE_BYTES || !space(size)) { close(image); return false; }
      entry.frames.push({ image, start: entry.duration, duration }); entry.duration += duration; entry.bytes += size; bytes += size; return true;
    }
    async function load(entry) {
      activeLoads++; entry.state = 'loading';
      try {
        const response = await root.fetch(entry.url, { mode: 'cors', credentials: 'omit', cache: 'force-cache', signal: entry.controller?.signal });
        if (!response.ok || response.type === 'opaque') throw new Error('image-cors-or-http');
        const data = await boundedData(response), type = sniff(data, response.headers?.get('content-type'));
        if (disposed || entry.cancelled) return;
        if (!/^image\/(png|gif|webp|jpeg|avif|bmp|x-icon)$/.test(type)) throw new Error('unsupported-image-type');
        let decoded = false;
        const supported = root.ImageDecoder && (!root.ImageDecoder.isTypeSupported || await root.ImageDecoder.isTypeSupported(type));
        if (disposed || entry.cancelled) return;
        if (supported) {
          try {
            const decoder = entry.decoder = new root.ImageDecoder({ data, type, preferAnimation: true }); await decoder.tracks.ready;
            if (disposed || entry.cancelled) return;
            const track = decoder.tracks.selectedTrack, count = Math.max(1, track.frameCount || 1);
            entry.animated = !!track.animated || count > 1; entry.repetitions = track.repetitionCount;
            const limit = count > 120 ? 1 : count;
            if (count > 120) fallback(entry, 'animation-frame-limit');
            for (let i = 0; i < limit; i++) {
              const result = await decoder.decode({ frameIndex: i, completeFramesOnly: true });
              if (disposed || entry.cancelled) { close(result.image); return; }
              if (!addFrame(entry, result.image, Math.max(10000, result.image.duration || 100000) / 1000000)) { fallback(entry, 'decoded-memory-limit'); break; }
            }
            decoded = entry.frames.length > 0;
            if (entry.frames.length !== count && entry.animated) {
              // A partial cycle is misleading; keep a clearly reported static first frame.
              while (entry.frames.length > 1) { const frame = entry.frames.pop(), size = (frame.image.displayWidth || frame.image.width || frame.image.codedWidth) * (frame.image.displayHeight || frame.image.height || frame.image.codedHeight) * 4; close(frame.image); entry.bytes -= size; bytes -= size; }
              entry.duration = entry.frames[0]?.duration || 0;
            }
          } catch (_) { if (entry.frames.length) { decoded = true; fallback(entry, 'animation-decode-failed'); } }
          finally { close(entry.decoder); entry.decoder = null; }
        }
        if (!decoded) {
          if (disposed || entry.cancelled) return;
          if (!root.createImageBitmap) throw new Error('image-decoder-unavailable');
          const bitmap = await root.createImageBitmap(new Blob([data], { type }));
          if (disposed || entry.cancelled) { close(bitmap); return; }
          if (!addFrame(entry, bitmap, 1)) throw new Error('decoded-memory-limit');
          // Bitmap decoding deliberately uses the default/first animation frame.
          if (type === 'image/gif' || type === 'image/webp' || type === 'image/png') fallback(entry, 'static-bitmap-fallback');
        }
        if (!entry.frames.length) throw new Error('image-decode-failed');
        entry.state = 'ready';
      } catch (error) {
        if (!disposed && !entry.cancelled) { entry.state = 'failed'; imageFailures++; const reason = ['encoded-size-limit', 'image-cors-or-http', 'unsupported-image-type', 'image-decoder-unavailable', 'decoded-memory-limit', 'image-decode-failed'].includes(error.message) ? error.message : 'image-load-failed'; fallbackReasons.add(reason); }
      } finally { activeLoads--; pump(); }
    }
    function pump() { if (disposed) return; for (const entry of assets.values()) { if (activeLoads >= 4) break; if (entry.state === 'queued') void load(entry); } }
    function assetFor(image) {
      const raw = image.currentSrc || image.src || image.getAttribute?.('src'); if (!raw) return null;
      let url; try {
        const parsed = new URL(raw, root.location?.href || 'https://live.bilibili.com/');
        if (parsed.protocol === 'http:') parsed.protocol = 'https:';
        if (parsed.protocol !== 'https:' || (!/(^|\.)(hdslb\.com|biliimg\.com|bilibili\.com)$/.test(parsed.hostname) && parsed.origin !== root.location?.origin)) return null;
        url = parsed.href;
      } catch (_) { return null; }
      let entry = assets.get(url);
      if (!entry) {
        if (assets.size >= 128) for (const [key, value] of assets) { if (value.seen < presents - 1 && value.state !== 'loading') { dropAsset(key); break; } }
        if (assets.size >= 128) return null;
        entry = { url, frames: [], bytes: 0, duration: 0, seen: presents, state: 'queued', controller: root.AbortController ? new root.AbortController() : null };
        assets.set(url, entry); pump();
      }
      entry.seen = presents; return entry;
    }
    function selectedImage(entry, elapsed) {
      if (!entry?.frames.length) return null;
      if (entry.frames.length === 1 || entry.fallback) return entry.frames[0].image;
      let time = Math.max(0, elapsed);
      if (Number.isFinite(entry.repetitions) && entry.repetitions >= 0 && time >= entry.duration * (entry.repetitions + 1)) return entry.frames[entry.frames.length - 1].image;
      time %= entry.duration;
      return (entry.frames.find(frame => time < frame.start + frame.duration) || entry.frames[entry.frames.length - 1]).image;
    }
    function visible(node) {
      for (let current = node; current && current !== host; current = current.parentElement) {
        const style = cssOf(current);
        const ownedHidden = forcedHidden.has(current) && current.style.getPropertyValue('visibility') === 'hidden' && current.style.getPropertyPriority('visibility') === 'important';
        if (current.hidden || style.display === 'none' || Number(style.opacity || 1) === 0 || (!ownedHidden && current.style?.getPropertyValue('visibility') === 'hidden')) return false;
        if (!committed && style.visibility === 'hidden') return false;
      }
      return true;
    }
    function opacity(node, stop) { let alpha = 1; for (let current = node; current && current !== stop; current = current.parentElement) alpha *= Math.max(0, Math.min(1, Number(cssOf(current).opacity || 1))); return alpha; }
    function boxOf(node) { const b = node.getBoundingClientRect(); return { x: b.x ?? b.left, y: b.y ?? b.top, width: b.width, height: b.height }; }
    function paintBox(node, known, dx, dy, hostBox) {
      // A locally sent native comment can carry a solid CSS outline rather than
      // a text-data border flag. Sample its style; do not infer authorship or
      // invent a frame around ordinary comments. Unframed nodes need no new
      // geometry read, and the decoration shares the existing video commit.
      const css = cssOf(node);
      const outline = css.outlineStyle === 'solid' ? Math.max(0, parseFloat(css.outlineWidth) || 0) : 0;
      if (!outline && css.borderTopStyle !== 'solid' && css.borderRightStyle !== 'solid' && css.borderBottomStyle !== 'solid' && css.borderLeftStyle !== 'solid') return;
      const sides = ['Top', 'Right', 'Bottom', 'Left'];
      const widths = sides.map(side => css['border' + side + 'Style'] === 'solid' ? Math.max(0, parseFloat(css['border' + side + 'Width']) || 0) : 0);
      if (!outline && !widths.some(Boolean)) return;
      const rect = known || boxOf(node); if (!(rect.width > 0 && rect.height > 0)) return;
      const x = rect.x + dx - hostBox.x, y = rect.y + dy - hostBox.y, w = rect.width, h = rect.height;
      context.globalAlpha = opacity(node, host);
      const [top, right, bottom, left] = widths;
      const strips = [[x, y, w, Math.min(top, h)], [x + Math.max(0, w - right), y + top, Math.min(right, w), Math.max(0, h - top - bottom)],
        [x, y + Math.max(0, h - bottom), w, Math.min(bottom, h)], [x, y + top, Math.min(left, w), Math.max(0, h - top - bottom)]];
      strips.forEach((strip, index) => {
        if (!widths[index] || !(strip[2] > 0 && strip[3] > 0)) return;
        context.fillStyle = css['border' + sides[index] + 'Color'] || css.color || '#fff'; context.fillRect(...strip);
      });
      if (outline) {
        const offset = parseFloat(css.outlineOffset) || 0, inset = offset + outline / 2;
        if (w + inset * 2 <= 0 || h + inset * 2 <= 0) return;
        context.strokeStyle = css.outlineColor || css.color || '#fff'; context.lineWidth = outline;
        context.strokeRect(x - inset, y - inset, w + inset * 2, h + inset * 2);
      }
    }
    function textRect(node, parent) {
      try { const range = document.createRange(); range.selectNodeContents(node); const rect = boxOf(range); range.detach?.(); if (rect.width > 0 && rect.height > 0) return rect; } catch (_) {}
      return boxOf(parent);
    }
    function paintText(target, text, css, x, y) {
      const size = parseFloat(css.fontSize) || 25;
      target.font = css.font || [css.fontStyle || 'normal', css.fontWeight || 'normal', size + 'px', css.fontFamily || 'sans-serif'].join(' ');
      target.textBaseline = 'top'; target.textAlign = 'left'; target.lineJoin = 'round';
      target.fillStyle = css.color || '#fff';
      // Native text shadows usually form a thin outline; combine it with the fill before opacity.
      const lineHeight = parseFloat(css.lineHeight) || size * 1.2;
      String(text).split(/\r?\n/).forEach((line, index) => {
        if (css.textShadow && css.textShadow !== 'none') { target.lineWidth = Math.max(1, size / 12); target.strokeStyle = '#000'; target.strokeText(line, x, y + index * lineHeight); }
        target.fillText(line, x, y + index * lineHeight);
      });
    }
    function textTile(text, css, rect, dpr) {
      const pad = Math.ceil((parseFloat(css.fontSize) || 25) / 8 + 2);
      const width = Math.ceil((rect.width + pad * 2) * dpr), height = Math.ceil((Math.max(rect.height, parseFloat(css.lineHeight) || 0) + pad * 2) * dpr);
      const key = JSON.stringify([text, css.font, css.fontSize, css.fontWeight, css.fontFamily, css.fontStyle, css.color, css.textShadow, width, height, dpr]);
      let entry = sprites.get(key); if (entry) {
        if (entry.target.isContextLost?.()) throw new Error('文字画布上下文丢失');
        entry.seen = presents; cacheHits++; return entry;
      }
      const size = width * height * 4;
      if (!(width > 0 && height > 0) || width > 16384 || height > 16384 || size > 4 * 1024 * 1024) return null;
      const cached = builds < 16 && sprites.size < 256 && space(size), tile = cached ? new OffscreenCanvas(width, height) : scratch;
      if (!cached) { tile.width = width; tile.height = height; }
      const target = cached ? tile.getContext('2d') : scratchContext;
      if (!target || target.isContextLost?.()) {
        if (cached) tile.width = tile.height = 1;
        throw new Error('文字画布上下文丢失');
      }
      target.setTransform(dpr, 0, 0, dpr, 0, 0); target.globalAlpha = 1; target.clearRect(0, 0, width / dpr, height / dpr); paintText(target, text, css, pad, pad);
      if (target.isContextLost?.()) {
        if (cached) tile.width = tile.height = 1;
        throw new Error('文字画布上下文丢失');
      }
      entry = { canvas: tile, target, bytes: size, pad, seen: presents };
      if (cached) { sprites.set(key, entry); bytes += size; cacheBuilds++; builds++; }
      return entry;
    }
    function layoutKey() { const b = boxOf(host), v = boxOf(video), l = boxOf(layer); return [b.x, b.y, b.width, b.height, v.x, v.y, v.width, v.height, l.x, l.y, l.width, l.height, root.devicePixelRatio || 1].join(','); }
    function signature(item) {
      const content = []; function visit(n) { if (n.nodeType === 3) content.push(n.textContent); else { if (n.tagName?.toLowerCase() === 'img') content.push(n.currentSrc || n.src || ''); for (const child of n.childNodes || []) visit(child); } } visit(item);
      // A recycled node can reappear with identical text. A new native CSS animation
      // start time distinguishes that lifetime even when it changed between video frames.
      let animation = ''; try { animation = (item.getAnimations?.() || []).map(a => a.startTime).join(','); } catch (_) {}
      return JSON.stringify([content, animation]);
    }
    function draw(now, metadata = {}) {
      try {
        const painted = drawFrame(now, metadata);
        if (presentationRefresh && (!painted || --presentationRefresh.remaining <= 0)) cancelPresentationRefresh();
        return painted;
      } catch (error) { cancelPresentationRefresh(); throw error; }
    }
    function drawFrame(now, metadata = {}) {
      if (disposed) return false;
      if (context.isContextLost?.()) throw new Error('直播合成画布上下文丢失');
      styles = new WeakMap();
      const box = boxOf(host), source = boxOf(video), dmBox = boxOf(layer), dpr = Math.max(0.25, Math.min(4, root.devicePixelRatio || 1));
      if (!(box.width > 0 && box.height > 0 && video.videoWidth > 0 && video.videoHeight > 0)) return false;
      const width = Math.max(1, Math.round(box.width * dpr)), height = Math.max(1, Math.round(box.height * dpr));
      if (buffer.width !== width || buffer.height !== height) { buffer.width = canvas.width = width; buffer.height = canvas.height = height; for (const key of sprites.keys()) dropSprite(key); }
      builds = 0; comments = skipped = placeholders = unsupported = fixedOverflow = 0;
      context.setTransform(dpr, 0, 0, dpr, 0, 0); context.globalAlpha = 1; context.fillStyle = '#000'; context.fillRect(0, 0, box.width, box.height);
      const css = cssOf(video), fit = css.objectFit || 'contain'; let w = source.width, h = source.height;
      if (fit !== 'fill') { let scale = (fit === 'cover' ? Math.max : Math.min)(w / video.videoWidth, h / video.videoHeight); if (fit === 'none') scale = 1; if (fit === 'scale-down') scale = Math.min(1, scale); w = video.videoWidth * scale; h = video.videoHeight * scale; }
      context.save(); context.beginPath(); context.rect(source.x - box.x, source.y - box.y, source.width, source.height); context.clip();
      context.drawImage(video, source.x - box.x + (source.width - w) / 2, source.y - box.y + (source.height - h) / 2, w, h); context.restore();
      context.save(); context.beginPath(); context.rect(dmBox.x - box.x, dmBox.y - box.y, dmBox.width, dmBox.height); context.clip();
      const mediaTime = Number.isFinite(metadata.mediaTime) ? metadata.mediaTime : Number(video.currentTime) || 0;
      const active = [...layer.querySelectorAll('.bili-danmaku-x-dm')].filter(item => {
        const on = item.classList.contains('bili-danmaku-x-show') && visible(item); if (!on) skipped++; return on;
      }), activeSet = new Set(active), occupied = [];
      for (const item of lifetimes.keys()) if (!activeSet.has(item)) lifetimes.delete(item);
      for (const item of active) {
        const itemBox = boxOf(item); if (!(itemBox.width > 0 && itemBox.height > 0)) { skipped++; continue; }
        if (itemBox.y >= dmBox.y + dmBox.height || itemBox.y + itemBox.height <= dmBox.y) { skipped++; continue; }
        const identity = signature(item); let life = lifetimes.get(item);
        if (!life || life.identity !== identity || mediaTime < life.start) { life = { identity, start: mediaTime }; lifetimes.set(item, life); }
        const start = life.start;
        const dx = mode === 'fixed' ? dmBox.x + (dmBox.width - itemBox.width) / 2 - itemBox.x : 0;
        let dy = 0;
        if (mode === 'fixed') {
          if (life.bottom === undefined) life.bottom = position === 'bottom' || (position === 'alternate' && comments % 2 === 1);
          const fits = y => y >= 0 && y + itemBox.height <= dmBox.height && occupied.every(o => y + itemBox.height + 4 <= o.y || y >= o.y + o.height + 4);
          let y = life.height === itemBox.height && life.area === dmBox.height && fits(life.y) ? life.y : null;
          if (y === null) {
            const candidates = life.bottom ? [dmBox.height - itemBox.height, ...occupied.map(o => o.y - itemBox.height - 4).sort((a, b) => b - a)] : [0, ...occupied.map(o => o.y + o.height + 4).sort((a, b) => a - b)];
            y = candidates.find(fits);
          }
          if (y === undefined) { fixedOverflow++; skipped++; continue; }
          life.y = y; life.height = itemBox.height; life.area = dmBox.height; occupied.push({ y, height: itemBox.height }); dy = dmBox.y + y - itemBox.y;
        }
        let painted = false;
        function walk(node) {
          if (node.nodeType === 3) {
            const text = node.textContent; if (!text || !text.trim()) return;
            const parent = node.parentElement || item; if (!visible(parent)) return;
            const rect = textRect(node, parent), style = cssOf(parent), entry = textTile(text, style, rect, dpr); if (!entry) { unsupported++; return; }
            context.globalAlpha = opacity(parent, host);
            context.drawImage(entry.canvas, Math.round((rect.x + dx - box.x - entry.pad) * dpr) / dpr, Math.round((rect.y + dy - box.y - entry.pad) * dpr) / dpr, entry.canvas.width / dpr, entry.canvas.height / dpr); painted = true; return;
          }
          if (node.nodeType !== 1 || !visible(node)) return;
          const tag = node.tagName?.toLowerCase();
          if (tag === 'img') {
            const rect = boxOf(node); if (!(rect.width > 0 && rect.height > 0)) return;
            paintBox(node, rect, dx, dy, box);
            const entry = assetFor(node), image = selectedImage(entry, mediaTime - start), x = Math.round((rect.x + dx - box.x) * dpr) / dpr, y = Math.round((rect.y + dy - box.y) * dpr) / dpr;
            context.globalAlpha = opacity(node, host);
            if (image) { try { context.drawImage(image, x, y, rect.width, rect.height); } catch (_) { if (entry) { entry.state = 'failed'; imageFailures++; fallbackReasons.add('image-draw-failed'); for (const frame of entry.frames) close(frame.image); bytes -= entry.bytes; entry.bytes = 0; entry.frames = []; } } }
            if (!image || entry?.state === 'failed') {
              const label = node.alt || '[表情]', size = Math.max(6, Math.min(parseFloat(cssOf(item).fontSize) || 25, rect.height, rect.width / Math.max(2, [...label].length)));
              context.save(); context.beginPath(); context.rect(x, y, rect.width, rect.height); context.clip();
              const native = cssOf(item);
              paintText(context, label, { font: '', color: '#fff', fontSize: size + 'px', lineHeight: size + 'px', fontFamily: native.fontFamily, fontWeight: native.fontWeight, textShadow: native.textShadow }, x, y); context.restore(); placeholders++;
            }
            painted = true; return;
          }
          if (tag === 'svg' || tag === 'canvas' || tag === 'video') { unsupported++; return; }
          paintBox(node, node === item ? itemBox : null, dx, dy, box);
          for (const child of node.childNodes || []) walk(child);
        }
        walk(item); if (painted) comments++;
      }
      context.restore(); context.globalAlpha = 1;
      const bitmap = buffer.transferToImageBitmap(); try { output.transferFromImageBitmap(bitmap); } finally { close(bitmap); }
      presents++; committed = true; ownMask(); layout = layoutKey();
      for (const [key, entry] of sprites) if (entry.seen < presents - 2) dropSprite(key);
      // Expired in-flight images must release their loading slots too.
      for (const [key, entry] of assets) if (entry.seen < presents - 240) dropAsset(key);
      return true;
    }
    function restore() {
      if (disposed) return; cancelPresentationRefresh(); disposed = true; canvas.remove(); mask.remove();
      if (layer.getAttribute(attribute) === token) { if (oldAttribute === null) layer.removeAttribute(attribute); else layer.setAttribute(attribute, oldAttribute); }
      for (const [node, old] of forcedHidden) restoreHidden(node, old); forcedHidden.clear();
      for (const [node, name, value, priority, owned] of previous) if (node.style.getPropertyValue(name) === owned) { if (value) node.style.setProperty(name, value, priority); else node.style.removeProperty(name); }
      for (const key of sprites.keys()) dropSprite(key); for (const key of assets.keys()) dropAsset(key); lifetimes.clear();
      buffer.width = buffer.height = scratch.width = scratch.height = canvas.width = canvas.height = 1;
    }
    function status() { return { committed: committed && !disposed, presents, comments, skipped, placeholders, unsupported, fixedOverflow, imageFailures, staticFallbacks, fallbackReasons: [...fallbackReasons], assets: assets.size, pendingImages: [...assets.values()].filter(e => e.state === 'loading' || e.state === 'queued').length, animatedImages: [...assets.values()].filter(e => e.frames.length > 1 && !e.fallback).length, cacheBytes: bytes, textCache: sprites.size, cacheHits, cacheBuilds, presentationRefresh: { active: !!presentationRefresh, remaining: presentationRefresh?.remaining || 0 }, scope: 'ordinary-native-dom-and-emoticons', specialEffectsSupported: false, nativeSpecialEffects: 'suppressed-in-danmaku-layer' }; }
    return { draw, restore, status, refreshPresentation, cancelPresentationRefresh, needsResize: () => !disposed && layoutKey() !== layout };
  }
  root.BFDLiveCompositor = { create };
})(typeof globalThis === 'object' ? globalThis : this);
