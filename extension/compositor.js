// Build the complete video + ordinary danmaku image off-screen, then present once.
(function (root) {
  'use strict';
  function create(renderer, video) {
    const container = renderer.container;
    const host = video.closest('.bpx-player-video-perch') || video.parentElement;
    const canvas = document.createElement('canvas');
    canvas.className = 'bfd-video-composite';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;visibility:hidden;';
    const buffer = new OffscreenCanvas(1, 1);
    const context = buffer.getContext('2d', { alpha: false });
    // Reuse one transparent tile, rather than keeping a bitmap per comment.
    const textBuffer = new OffscreenCanvas(1, 1);
    const textContext = textBuffer.getContext('2d', { alpha: true });
    const output = canvas.getContext('bitmaprenderer', { alpha: false });
    if (!context || !textContext || !output) throw new Error('浏览器不支持合成画布');
    const previous = ['visibility', 'pointer-events'].map(name => [container, name, container.style.getPropertyValue(name), container.style.getPropertyPriority(name)]);
    previous.push([video, 'visibility', video.style.getPropertyValue('visibility'), video.style.getPropertyPriority('visibility')]);
    const position = getComputedStyle(host).position;
    if (position === 'static') {
      previous.push([host, 'position', host.style.getPropertyValue('position'), host.style.getPropertyPriority('position')]);
      host.style.setProperty('position', 'relative');
    }
    let frames = 0, comments = 0, skipped = 0, committed = false, lastLayout = '';
    function layoutKey() {
      const hostBox = host.getBoundingClientRect(), videoBox = video.getBoundingClientRect(), dmBox = container.getBoundingClientRect();
      return [hostBox.width, hostBox.height, videoBox.x - hostBox.x, videoBox.y - hostBox.y, videoBox.width, videoBox.height,
        dmBox.x - hostBox.x, dmBox.y - hostBox.y, dmBox.width, dmBox.height, root.devicePixelRatio || 1].join(',');
    }
    const textCache = new WeakMap();
    // Reuse costly text rasters. Bound both backing pixels and object
    // count, and fall back to the existing painter rather than dropping text.
    const sprites = new Map(), maxSpriteBytes = 48 * 1024 * 1024, maxSprites = 256, maxEntryBytes = 4 * 1024 * 1024;
    let spriteBytes = 0, spriteHits = 0, spriteBuilds = 0, newSprites = 0;
    function releaseSprite(cached) {
      const entry = sprites.get(cached);
      if (!entry) return;
      spriteBytes -= entry.bytes;
      entry.canvas.width = 1; entry.canvas.height = 1;
      sprites.delete(cached);
    }
    function clearSprites() { for (const cached of sprites.keys()) releaseSprite(cached); }
    function restore() {
      canvas.remove();
      for (const [node, name, value, priority] of previous) {
        const owned = name === 'position' ? 'relative' : name === 'pointer-events' ? 'none' : 'hidden';
        if (node.style.getPropertyValue(name) !== owned) continue;
        if (value) node.style.setProperty(name, value, priority); else node.style.removeProperty(name);
      }
      // Release full-resolution backing stores after a mode/route change.
      buffer.width = 1; buffer.height = 1; canvas.width = 1; canvas.height = 1;
      textBuffer.width = 1; textBuffer.height = 1;
      clearSprites();
    }
    host.appendChild(canvas);
    function paintText(target, cached, item, left, top) {
      if (target.font !== cached.font) target.font = cached.font;
      target.textBaseline = 'top'; target.textAlign = 'left';
      target.fillStyle = cached.color;
      target.lineJoin = 'round'; target.lineWidth = cached.lineWidth;
      target.strokeStyle = item.textData.color === 0 ? '#fff' : '#000';
      cached.lines.forEach((line, index) => {
        if (cached.shadow) target.strokeText(line, left + cached.paddingX, top + cached.paddingY + index * cached.lineHeight);
        target.fillText(line, left + cached.paddingX, top + cached.paddingY + index * cached.lineHeight);
      });
      if (item.textData.border) {
        target.strokeStyle = item.textData.borderColor || cached.color; target.lineWidth = 1;
        target.strokeRect(left, top, cached.width, cached.height);
      }
    }
    function textBounds(cached) {
      if (!cached.bounds) {
        textContext.font = cached.font; textContext.textBaseline = 'top'; textContext.textAlign = 'left';
        const bounds = { left: 0, top: 0, right: cached.width, bottom: cached.height };
        cached.lines.forEach((line, index) => {
          const m = textContext.measureText(line), y = cached.paddingY + index * cached.lineHeight;
          bounds.left = Math.min(bounds.left, cached.paddingX - (m.actualBoundingBoxLeft || 0));
          bounds.right = Math.max(bounds.right, cached.paddingX + (m.actualBoundingBoxRight ?? m.width));
          bounds.top = Math.min(bounds.top, y - (m.actualBoundingBoxAscent || 0));
          bounds.bottom = Math.max(bounds.bottom, y + (m.actualBoundingBoxDescent ?? cached.lineHeight));
        });
        cached.bounds = bounds;
      }
      return cached.bounds;
    }
    function paintSprite(cached, item, left, top, dpr, width, height) {
      const b = textBounds(cached), pad = Math.ceil(cached.lineWidth + 2);
      const x = Math.floor((left + b.left - pad) * dpr), y = Math.floor((top + b.top - pad) * dpr);
      const w = Math.ceil((left + b.right + pad) * dpr) - x, h = Math.ceil((top + b.bottom + pad) * dpr) - y;
      if (x >= width || y >= height || x + w <= 0 || y + h <= 0) return true;
      let entry = sprites.get(cached);
      if (!entry) {
        const bytes = w * h * 4;
        if (newSprites >= 16 || !Number.isFinite(bytes) || !(w > 0 && h > 0) || w > 16384 || h > 16384 || bytes > maxEntryBytes ||
            sprites.size >= maxSprites || spriteBytes + bytes > maxSpriteBytes) return false;
        const tile = new OffscreenCanvas(w, h), target = tile.getContext('2d', { alpha: true });
        if (!target || target.isContextLost?.()) { tile.width = 1; tile.height = 1; return false; }
        target.setTransform(dpr, 0, 0, dpr, -x, -y);
        target.globalAlpha = 1;
        paintText(target, cached, item, left, top);
        entry = { canvas: tile, target, bytes, x: x / dpr - left, y: y / dpr - top, lastSeen: frames };
        sprites.set(cached, entry); spriteBytes += bytes; spriteBuilds++; newSprites++;
      } else { spriteHits++; entry.lastSeen = frames; }
      if (entry.target.isContextLost?.()) throw new Error('文字画布上下文丢失');
      // Opacity still applies once to the combined outline/fill/border. Only
      // the bitmap position changes, and presentation remains video-driven.
      // Align cached rasters to physical pixels instead of filtering text a
      // second time as it moves. Position rounding is at most half a pixel.
      context.drawImage(entry.canvas, Math.round((left + entry.x) * dpr) / dpr,
        Math.round((top + entry.y) * dpr) / dpr, entry.canvas.width / dpr, entry.canvas.height / dpr);
      return true;
    }
    function paintGroup(cached, item, left, top, dpr, width, height) {
      if (textContext.isContextLost?.()) throw new Error('文字画布上下文丢失');
      textBounds(cached);
      const b = cached.bounds, pad = Math.ceil(cached.lineWidth + 2);
      // Align the tile to the destination's physical pixels; do not rescale or
      // lose glyph overhangs. Long/offscreen comments cannot allocate huge tiles.
      const x = Math.max(0, Math.floor((left + b.left - pad) * dpr));
      const y = Math.max(0, Math.floor((top + b.top - pad) * dpr));
      const w = Math.min(width, Math.ceil((left + b.right + pad) * dpr)) - x;
      const h = Math.min(height, Math.ceil((top + b.bottom + pad) * dpr)) - y;
      if (w <= 0 || h <= 0) return;
      if (textBuffer.width < w) textBuffer.width = w;
      if (textBuffer.height < h) textBuffer.height = h;
      textContext.setTransform(1, 0, 0, 1, 0, 0);
      textContext.clearRect(0, 0, w, h);
      textContext.setTransform(dpr, 0, 0, dpr, -x, -y);
      textContext.globalAlpha = 1;
      paintText(textContext, cached, item, left, top);
      // CSS opacity applies to the whole element, including its outline. Apply
      // it once here, after the opaque outline and text have been combined.
      context.drawImage(textBuffer, 0, 0, w, h, x / dpr, y / dpr, w / dpr, h / dpr);
    }
    function draw() {
      if (context.isContextLost?.()) throw new Error('合成画布上下文丢失');
      const box = host.getBoundingClientRect(), source = video.getBoundingClientRect(), dmBox = container.getBoundingClientRect();
      if (!(box.width > 0 && box.height > 0 && video.videoWidth > 0 && video.videoHeight > 0)) return false;
      const dpr = root.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(box.width * dpr)), height = Math.max(1, Math.round(box.height * dpr));
      if (buffer.width !== width || buffer.height !== height) {
        buffer.width = width; buffer.height = height; canvas.width = width; canvas.height = height;
        textBuffer.width = 1; textBuffer.height = 1;
        clearSprites();
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.globalAlpha = 1; context.fillStyle = '#000'; context.fillRect(0, 0, box.width, box.height);
      const style = getComputedStyle(video), fit = style.objectFit;
      let w = source.width, h = source.height;
      if (fit !== 'fill') {
        let scale = (fit === 'cover' ? Math.max : Math.min)(w / video.videoWidth, h / video.videoHeight);
        if (fit === 'none') scale = 1;
        if (fit === 'scale-down') scale = Math.min(1, scale);
        w = video.videoWidth * scale; h = video.videoHeight * scale;
      }
      const x = source.x - box.x + (source.width - w) / 2, y = source.y - box.y + (source.height - h) / 2;
      context.save(); context.beginPath(); context.rect(source.x - box.x, source.y - box.y, source.width, source.height); context.clip();
      context.drawImage(video, x, y, w, h); context.restore();
      comments = 0; skipped = 0;
      newSprites = 0;
      context.save(); context.beginPath(); context.rect(dmBox.x - box.x, dmBox.y - box.y, dmBox.width, dmBox.height); context.clip();
      const layout = `${box.width},${box.height},${dmBox.width},${dmBox.height},${dpr}`;
      const visibleItems = renderer.config?.setting?.visible === false || renderer.visible === false ? [] : renderer.manager.visualArray;
      const dense = visibleItems.length >= 32;
      for (const [cached, entry] of sprites) if (!visibleItems.length || frames - entry.lastSeen > 1) releaseSprite(cached);
      for (const item of visibleItems) {
        const node = item.element, mode = item.textData?.mode;
        if (!node || !item.showed || item.isHide || node.classList.contains('bili-danmaku-x-disable')) continue;
        if (![1, 2, 3, 6, 4, 5].includes(mode) || node.querySelector('img,svg,canvas,video') || item.textData.colorful || item.textData.isHighLike) { skipped++; continue; }
        const text = node.textContent || item.text || item.textData.text;
        if (!text) continue;
        let cached = textCache.get(item);
        const signature = (node.style?.cssText || '') + node.className +
          `|${item.textData.color === 0}|${!!item.textData.border}|${item.textData.borderColor || ''}`;
        if (!cached || cached.node !== node || cached.signature !== signature || cached.layout !== layout || cached.text !== text) {
          if (cached) releaseSprite(cached);
          const css = getComputedStyle(node), rect = node.getBoundingClientRect();
          cached = { node, signature, layout, text, lines: text.split(/\r?\n/),
            font: `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`, display: css.display, opacity: +css.opacity,
            color: css.color, shadow: css.textShadow !== 'none', lineWidth: Math.max(1, parseFloat(css.fontSize) / 12),
            lineHeight: parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.125,
            paddingX: parseFloat(css.paddingLeft) || 0, paddingY: parseFloat(css.paddingTop) || 0,
            x: rect.x - dmBox.x, y: rect.y - dmBox.y, width: rect.width, height: rect.height };
          textCache.set(item, cached);
        }
        if (cached.display === 'none' || cached.opacity === 0) continue;
        let left = dmBox.x - box.x + cached.x, top = dmBox.y - box.y + cached.y;
        if ([1, 2, 3, 6].includes(mode)) {
          const elapsed = item.duration - (item.endTime - renderer.renderTime);
          const progress = Math.max(0, Math.min(1, elapsed / item.duration));
          if (!Number.isFinite(progress) || !Number.isFinite(item.moveDistance)) continue;
          const reverse = node.classList.contains('bili-danmaku-x-reverse') || node.classList.contains('bili-danmaku-x-bidirection-reverse');
          left += (reverse ? 1 : -1) * item.moveDistance * progress;
        }
        context.globalAlpha = Math.max(0, Math.min(1, cached.opacity));
        // Even a few long, translucent comments can force expensive copies
        // from the shared mutable tile. Reuse those rasters at every density.
        const cacheText = dense || (context.globalAlpha < 1 && (cached.shadow || item.textData.border));
        if (cacheText && paintSprite(cached, item, left, top, dpr, width, height)) { /* reused complete text */ }
        else if (context.globalAlpha < 1 && (cached.shadow || item.textData.border)) paintGroup(cached, item, left, top, dpr, width, height);
        else paintText(context, cached, item, left, top);
        comments++;
      }
      context.restore();
      // No visible DOM text moves. This is the only presentation of this image.
      const bitmap = buffer.transferToImageBitmap();
      try { output.transferFromImageBitmap(bitmap); } finally { bitmap.close(); }
      // Player UI actions can rewrite inline visibility or detach the output.
      // Reassert ownership only after a complete image was presented. Stable
      // frames do not mutate the DOM or produce an additional presentation.
      if (host.isConnected && canvas.parentElement !== host) host.appendChild(canvas);
      for (const node of [video, container]) {
        if (node.style.getPropertyValue('visibility') !== 'hidden' || node.style.getPropertyPriority('visibility') !== 'important') {
          node.style.setProperty('visibility', 'hidden', 'important');
        }
      }
      if (container.style.getPropertyValue('pointer-events') !== 'none' || container.style.getPropertyPriority('pointer-events') !== 'important') {
        container.style.setProperty('pointer-events', 'none', 'important');
      }
      if (canvas.style.getPropertyValue('visibility') !== 'visible' || canvas.style.getPropertyPriority('visibility') !== 'important') {
        canvas.style.setProperty('visibility', 'visible', 'important');
      }
      committed = true;
      frames++;
      lastLayout = layoutKey();
      return true;
    }
    return { draw, restore, host, needsResize: () => layoutKey() !== lastLayout,
      status: () => ({ surface: 'single-canvas', presents: frames, comments, skipped, committed,
        textCache: { entries: sprites.size, bytes: spriteBytes, hits: spriteHits, builds: spriteBuilds,
          maxBytes: maxSpriteBytes, maxEntries: maxSprites, maxEntryBytes } }) };
  }
  root.BFDCompositor = { create };
})(globalThis);
