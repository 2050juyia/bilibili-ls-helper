// Developer-only MAIN-world audit. Inject before navigation; never load in the extension.
// Passive: no fetch, timer, rAF, extra rVFC, pixel readback, or media/URL export.
(function (root) {
  'use strict';
  if (root.__bfdMSEAudit?.version === 1 && root.__bfdMSEAudit.snapshot().running) return;
  const MAX_SEGMENTS = 240, MAX_FRAMES = 7200, MAX_HEADER = 512 * 1024, MAX_SOURCES = 16, MAX_BUFFERS = 32;
  const sources = new WeakMap(), buffers = new WeakMap(), videoIds = new WeakMap(), urls = new Map();
  const sourceList = [], bufferList = [], segments = [], frames = [], patches = [], listeners = [], pending = new Map();
  const unsupported = new Set(), errors = {}, counters = { appends: 0, appendThrows: 0, updateEnds: 0, callbacks: 0, maxPending: 0, cancels: 0 };
  let running = true, nextSource = 0, nextBuffer = 0, nextVideo = 0, nextSegment = 0;
  const clock = () => root.performance.now();
  function note(reason) { errors[reason] = (errors[reason] || 0) + 1; }
  function safe(fn) { try { return fn(); } catch (_) { note('audit-exception'); } }
  function patch(object, name, make) {
    if (!object || typeof object[name] !== 'function') { unsupported.add(name); return; }
    const descriptor = Object.getOwnPropertyDescriptor(object, name), original = object[name], wrapped = make(original);
    try { object[name] = wrapped; if (object[name] !== wrapped) throw Error(); patches.push({ object, name, descriptor, original, wrapped }); }
    catch (_) { unsupported.add(name); }
  }
  function listen(object, name, fn) { object.addEventListener(name, fn); listeners.push({ object, name, fn }); }
  function videoId(video) { if (!videoIds.has(video)) videoIds.set(video, ++nextVideo); return videoIds.get(video); }
  function sourceFor(object) {
    let state = sources.get(object);
    if (!state) {
      if (sourceList.length >= MAX_SOURCES) { unsupported.add('media-source-limit'); return null; }
      state = { id: ++nextSource, buffers: [] }; sources.set(object, state); sourceList.push(state);
    }
    return state;
  }
  function ranges(object) {
    try { const result = [], value = object.buffered; for (let i = 0; i < Math.min(value.length, 32); i++) result.push([value.start(i), value.end(i)]); return result; }
    catch (_) { return []; }
  }
  function settings(object) { return { mode: object.mode === 'sequence' ? 'sequence' : 'segments', offset: Number(object.timestampOffset) || 0,
    windowStart: Number.isFinite(object.appendWindowStart) ? object.appendWindowStart : 0,
    windowEnd: Number.isFinite(object.appendWindowEnd) ? object.appendWindowEnd : null, before: ranges(object) }; }
  function covers(all, start, end) { return Number.isFinite(start) && Number.isFinite(end) && all.some(r => r[0] <= start + 0.002 && r[1] >= end - 0.002); }
  function overlap(all, start, end) { return Number.isFinite(start) && Number.isFinite(end) && all.some(r => r[0] < end && r[1] > start); }
  function completed(state) {
    if (!running) return;
    counters.updateEnds++;
    const accepted = ranges(state.object), batch = state.batch;
    if (batch) for (const record of batch) { record.appendCompleted = true; record.appendFailed = state.batchFailed; }
    state.batch = null;
    for (const record of segments) if (record.bufferId === state.id && record.appendCompleted && !record.appendFailed) {
      record.buffered = covers(accepted, record.start, record.end) ? 'full' : overlap(accepted, record.start, record.end) ? 'partial' : 'none';
      record.acceptance = record.ambiguous ? 'overlap-ambiguous' : record.buffered === 'full' && record.mdatObserved ? 'fresh-buffered-range' : record.buffered === 'partial' ? 'partial-buffered-range' : 'unverified';
    }
    state.accepted = accepted;
  }
  function bufferFor(object, source, mime) {
    let state = buffers.get(object); if (state) return state;
    if (bufferList.length >= MAX_BUFFERS) { unsupported.add('source-buffer-limit'); return null; }
    state = { id: ++nextBuffer, source, object, tracks: new Map(), defaults: new Map(), decodeEnds: new Map(), generation: 0,
      stream: { head: [], skip: 0, carry: null }, awaitingData: [], accepted: [], batch: null, batchFailed: false,
      mime: /^(?:video|audio)\/(?:mp4|webm)/i.exec(String(mime || ''))?.[0].toLowerCase() || 'unknown' };
    buffers.set(object, state); bufferList.push(state); if (source) source.buffers.push(state);
    listen(object, 'updateend', () => safe(() => completed(state)));
    for (const name of ['error', 'abort']) listen(object, name, () => { if (running) {
      state.batchFailed = true; note('append-' + name);
      if (name === 'abort') {
        state.stream = { head: [], skip: 0, carry: null }; state.awaitingData = [];
        state.tracks.clear(); state.defaults.clear(); state.decodeEnds.clear(); state.disabled = false;
        for (const record of segments) if (record.bufferId === state.id) { record.ambiguous = true; record.acceptance = 'abort-unverified'; }
      }
    } });
    return state;
  }
  function u32(bytes, at) { if (at < 0 || at + 4 > bytes.length) throw Error('truncated-box'); return new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0); }
  function u64(bytes, at) { const value = u32(bytes, at) * 4294967296 + u32(bytes, at + 4); if (!Number.isSafeInteger(value)) throw Error('unsafe-integer'); return value; }
  function four(bytes, at) { if (at + 4 > bytes.length) throw Error('truncated-box'); return String.fromCharCode(...bytes.subarray(at, at + 4)); }
  function boxes(bytes, from = 0, to = bytes.length) {
    const result = []; let at = from;
    while (at < to) {
      if (result.length >= 1024 || at + 8 > to) throw Error('box-limit-or-truncated');
      const small = u32(bytes, at), header = small === 1 ? 16 : 8, size = small === 0 ? to - at : small === 1 ? u64(bytes, at + 8) : small;
      if (size < header || at + size > to) throw Error('invalid-box-size');
      result.push({ type: four(bytes, at + 4), at, p: at + header, end: at + size }); at += size;
    }
    return result;
  }
  const child = (bytes, box, type) => boxes(bytes, box.p, box.end).find(value => value.type === type);
  function requireSize(box, length) { if (!box || box.p + length > box.end) throw Error('truncated-box'); }
  function parseInit(state, bytes, box) {
    const tracks = new Map(), defaults = new Map();
    for (const trak of boxes(bytes, box.p, box.end).filter(value => value.type === 'trak').slice(0, 64)) {
      const tkhd = child(bytes, trak, 'tkhd'), mdia = child(bytes, trak, 'mdia'); if (!tkhd || !mdia) continue;
      requireSize(tkhd, bytes[tkhd.p] === 1 ? 24 : 16); const id = u32(bytes, tkhd.p + (bytes[tkhd.p] === 1 ? 20 : 12));
      const mdhd = child(bytes, mdia, 'mdhd'), hdlr = child(bytes, mdia, 'hdlr'); if (!mdhd || !hdlr) continue;
      requireSize(mdhd, bytes[mdhd.p] === 1 ? 24 : 16); requireSize(hdlr, 12);
      const scale = u32(bytes, mdhd.p + (bytes[mdhd.p] === 1 ? 20 : 12)), type = four(bytes, hdlr.p + 8);
      let codec = 'unknown'; const minf = child(bytes, mdia, 'minf'), stbl = minf && child(bytes, minf, 'stbl'), stsd = stbl && child(bytes, stbl, 'stsd');
      if (stsd) { requireSize(stsd, 16); if (u32(bytes, stsd.p + 4)) codec = four(bytes, stsd.p + 12); }
      if (type === 'vide' && !scale) note('invalid-track-timescale');
      if (id && scale && ['vide', 'soun'].includes(type)) tracks.set(id, { id, scale, type, codec: /^[a-zA-Z0-9]{4}$/.test(codec) ? codec : 'unknown' });
    }
    const mvex = child(bytes, box, 'mvex');
    if (mvex) for (const trex of boxes(bytes, mvex.p, mvex.end).filter(value => value.type === 'trex')) { requireSize(trex, 24); defaults.set(u32(bytes, trex.p + 4), u32(bytes, trex.p + 12)); }
    for (const record of state.awaitingData) { record.ambiguous = true; record.acceptance = 'init-before-media-unverified'; }
    state.awaitingData = []; state.tracks = tracks; state.defaults = defaults; state.decodeEnds.clear(); state.generation++;
  }
  function parseTraf(state, bytes, traf, cfg) {
    const all = boxes(bytes, traf.p, traf.end), tfhd = all.find(box => box.type === 'tfhd'); if (!tfhd) return;
    requireSize(tfhd, 8); const flags = u32(bytes, tfhd.p) & 0xffffff, id = u32(bytes, tfhd.p + 4), track = state.tracks.get(id);
    if (track?.type !== 'vide') return;
    let at = tfhd.p + 8;
    if (flags & 1) at += 8; if (flags & 2) at += 4;
    let defaultDuration = state.defaults.get(id); if (flags & 8) { if (at + 4 > tfhd.end) throw Error('truncated-box'); defaultDuration = u32(bytes, at); at += 4; }
    if (flags & 16) at += 4; if (flags & 32) at += 4; if (at > tfhd.end) throw Error('truncated-box');
    const tfdt = all.find(box => box.type === 'tfdt');
    let base = state.decodeEnds.get(id) ?? null;
    if (tfdt) { requireSize(tfdt, bytes[tfdt.p] === 1 ? 12 : 8); base = bytes[tfdt.p] === 1 ? u64(bytes, tfdt.p + 4) : u32(bytes, tfdt.p + 4); }
    let elapsed = 0, samples = 0, minPTS = Infinity, maxPTS = -Infinity, minDuration = Infinity, maxDuration = 0, reason = '', hasCTO = false;
    const durations = {};
    for (const trun of all.filter(box => box.type === 'trun')) {
      requireSize(trun, 8); const version = bytes[trun.p], bits = u32(bytes, trun.p) & 0xffffff, count = u32(bytes, trun.p + 4);
      if (count > 10000 || samples + count > 10000) throw Error('sample-limit');
      let cursor = trun.p + 8; if (bits & 1) cursor += 4; if (bits & 4) cursor += 4;
      if (cursor > trun.end) throw Error('truncated-box');
      for (let i = 0; i < count; i++) {
        const fields = (bits & 0x100 ? 4 : 0) + (bits & 0x200 ? 4 : 0) + (bits & 0x400 ? 4 : 0) + (bits & 0x800 ? 4 : 0);
        if (cursor + fields > trun.end) throw Error('truncated-box');
        let duration = defaultDuration;
        if (bits & 0x100) { duration = u32(bytes, cursor); cursor += 4; }
        if (bits & 0x200) cursor += 4; if (bits & 0x400) cursor += 4;
        let cto = 0;
        if (bits & 0x800) { cto = u32(bytes, cursor); if (version === 1 && cto >= 2147483648) cto -= 4294967296; cursor += 4; hasCTO = true; }
        samples++;
        if (!(duration > 0)) { reason = 'missing-sample-duration'; continue; }
        minDuration = Math.min(minDuration, duration); maxDuration = Math.max(maxDuration, duration);
        if (Object.keys(durations).length < 16 || durations[duration]) durations[duration] = (durations[duration] || 0) + 1;
        if (base !== null) { minPTS = Math.min(minPTS, base + elapsed + cto); maxPTS = Math.max(maxPTS, base + elapsed + cto + duration); }
        elapsed += duration;
      }
    }
    if (!samples) return;
    if (base === null && !reason) reason = 'unanchored-tfdt';
    if (cfg.mode === 'sequence' && !reason) reason = 'sequence-mode-unmapped';
    const valid = !reason, rawStart = valid ? minPTS / track.scale + cfg.offset : null, rawEnd = valid ? maxPTS / track.scale + cfg.offset : null;
    const start = valid ? Math.max(rawStart, cfg.windowStart) : null, end = valid ? Math.min(rawEnd, cfg.windowEnd ?? Infinity) : null;
    const record = { id: ++nextSegment, sourceId: state.source?.id ?? null, bufferId: state.id, generation: state.generation, trackId: id, codec: track.codec,
      timescale: track.scale, samples, durationTicks: elapsed, sampleDurationHistogram: durations, minDuration: Number.isFinite(minDuration) ? minDuration : null, maxDuration,
      sampleFPS: !reason || reason === 'unanchored-tfdt' || reason === 'sequence-mode-unmapped' ? samples * track.scale / elapsed : null,
      baseDecodeTime: base, hasCTO, rawStart, rawEnd, start, end, mode: cfg.mode, timestampOffset: cfg.offset,
      appendWindowStart: cfg.windowStart, appendWindowEnd: cfg.windowEnd, reason,
      overlappedBefore: valid && overlap(cfg.before, start, end), ambiguous: false, mdatObserved: false,
      appendCompleted: false, appendFailed: false, buffered: 'none', acceptance: 'unverified', appendedAt: clock() };
    record.ambiguous = record.overlappedBefore;
    if (valid) for (const previous of segments) if (previous.bufferId === state.id && !previous.reason && previous.start < end - 0.000001 && previous.end > start + 0.000001) {
      previous.ambiguous = record.ambiguous = true; previous.acceptance = 'overlap-ambiguous';
    }
    segments.push(record); if (segments.length > MAX_SEGMENTS) segments.shift(); state.batch.push(record); state.awaitingData.push(record);
    if (state.awaitingData.length > MAX_SEGMENTS) state.awaitingData.shift();
    if (base !== null && !reason) state.decodeEnds.set(id, base + elapsed); else state.decodeEnds.delete(id);
  }
  function parseBox(state, bytes, cfg) {
    const box = boxes(bytes)[0];
    if (box.type === 'moov') parseInit(state, bytes, box);
    else if (box.type === 'moof') for (const traf of boxes(bytes, box.p, box.end).filter(value => value.type === 'traf')) parseTraf(state, bytes, traf, cfg);
  }
  function consume(state, input, cfg) {
    const bytes = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
    const stream = state.stream; let at = 0, boxesSeen = 0, copied = 0;
    while (at < bytes.length) {
      if (stream.skip) {
        const skip = Math.min(stream.skip, bytes.length - at); at += skip; stream.skip -= skip;
        if (!stream.skip && stream.mediaRecords) { for (const record of stream.mediaRecords) record.mdatObserved = true; stream.mediaRecords = null; }
        continue;
      }
      if (stream.carry) {
        const carry = stream.carry, count = Math.min(carry.bytes.length - carry.used, bytes.length - at);
        copied += count; if (copied > MAX_HEADER * 2) throw Error('header-work-limit');
        carry.bytes.set(bytes.subarray(at, at + count), carry.used); carry.used += count; at += count;
        if (carry.used === carry.bytes.length) { stream.carry = null; parseBox(state, carry.bytes, carry.cfg); }
        continue;
      }
      if (++boxesSeen > 1024) throw Error('box-limit');
      while (stream.head.length < 8 && at < bytes.length) stream.head.push(bytes[at++]);
      if (stream.head.length < 8) break;
      let header = new Uint8Array(stream.head), size = u32(header, 0), headerSize = size === 1 ? 16 : 8;
      while (stream.head.length < headerSize && at < bytes.length) stream.head.push(bytes[at++]);
      if (stream.head.length < headerSize) break;
      header = new Uint8Array(stream.head); if (size === 1) size = u64(header, 8); if (size === 0) size = headerSize + bytes.length - at;
      if (size < headerSize) throw Error('invalid-box-size');
      const type = four(header, 4); stream.head = [];
      if (type === 'moov' || type === 'moof') {
        if (size > MAX_HEADER) { note('metadata-size-limit'); stream.skip = size - headerSize; }
        else { const data = new Uint8Array(size); data.set(header); stream.carry = { bytes: data, used: headerSize, cfg }; }
      } else {
        stream.skip = size - headerSize;
        if (type === 'mdat' && stream.skip) { stream.mediaRecords = state.awaitingData; state.awaitingData = []; }
      }
    }
  }
  function parseAppend(state, input) {
    if (state.disabled) return;
    state.batch = []; state.batchFailed = false;
    try { consume(state, input, settings(state.object)); }
    catch (error) { const allowed = ['truncated-box', 'unsafe-integer', 'box-limit-or-truncated', 'invalid-box-size', 'sample-limit', 'header-work-limit', 'box-limit']; note(allowed.includes(error.message) ? error.message : 'parse-error'); state.stream = { head: [], skip: 0, carry: null }; state.awaitingData = []; state.disabled = true; }
  }
  for (const prototype of new Set([root.MediaSource?.prototype, root.ManagedMediaSource?.prototype].filter(Boolean))) patch(prototype, 'addSourceBuffer', original => function (...args) {
    const result = Reflect.apply(original, this, args); if (running) safe(() => bufferFor(result, sourceFor(this), args[0])); return result;
  });
  patch(root.URL, 'createObjectURL', original => function (...args) {
    const result = Reflect.apply(original, this, args);
    if (running) safe(() => { const object = args[0]; if ((root.MediaSource && object instanceof root.MediaSource) || (root.ManagedMediaSource && object instanceof root.ManagedMediaSource)) {
      urls.set(result, sourceFor(object)); if (urls.size > 128) urls.delete(urls.keys().next().value);
    } });
    return result;
  });
  patch(root.SourceBuffer?.prototype, 'appendBuffer', original => function (...args) {
    let result;
    try { result = Reflect.apply(original, this, args); }
    catch (error) { if (running) counters.appendThrows++; throw error; }
    if (running) safe(() => { counters.appends++; const state = bufferFor(this, null, ''); if (state) parseAppend(state, args[0]); });
    return result;
  });
  patch(root.HTMLVideoElement?.prototype, 'requestVideoFrameCallback', original => function (...args) {
    const fn = args[0]; let official = false;
    if (running && typeof fn === 'function') safe(() => { official = /paint\(\s*s\s*,\s*now\s*,\s*metadata\s*,\s*true\s*\)/.test(Function.prototype.toString.call(fn)); });
    if (!official) return Reflect.apply(original, this, args);
    const video = this, id = videoId(video); let key;
    args[0] = function (...callbackArgs) {
      if (!running) return Reflect.apply(fn, this, callbackArgs);
      pending.delete(key); const started = clock(), meta = callbackArgs[1] || {};
      try { return Reflect.apply(fn, this, callbackArgs); }
      finally { safe(() => { counters.callbacks++; frames.push({ videoId: id, now: callbackArgs[0], enteredAt: started,
        mediaTime: Number.isFinite(meta.mediaTime) ? meta.mediaTime : null, presentedFrames: Number.isFinite(meta.presentedFrames) ? meta.presentedFrames : null,
        expectedDisplayTime: Number.isFinite(meta.expectedDisplayTime) ? meta.expectedDisplayTime : null,
        presentationTime: Number.isFinite(meta.presentationTime) ? meta.presentationTime : null,
        costMs: clock() - started }); if (frames.length > MAX_FRAMES) frames.shift(); }); }
    };
    const result = Reflect.apply(original, video, args); key = id + ':' + result;
    pending.set(key, id); counters.maxPending = Math.max(counters.maxPending, pending.size); return result;
  });
  patch(root.HTMLVideoElement?.prototype, 'cancelVideoFrameCallback', original => function (...args) {
    const result = Reflect.apply(original, this, args); if (running) safe(() => { pending.delete(videoId(this) + ':' + args[0]); counters.cancels++; }); return result;
  });
  function stats(values) { const data = values.filter(Number.isFinite).sort((a, b) => a - b); return { count: data.length, mean: data.length ? data.reduce((a, b) => a + b, 0) / data.length : null,
    p95: data.length ? data[Math.min(data.length - 1, Math.ceil(data.length * 0.95) - 1)] : null, max: data.length ? data.at(-1) : null }; }
  function frameSummary(id, lastSeconds = null) {
    const all = frames.filter(row => row.videoId === id), lastAt = all.at(-1)?.enteredAt;
    const data = lastSeconds === null ? all : all.filter(row => row.enteredAt >= lastAt - lastSeconds * 1000);
    const first = data[0], last = data.at(-1), span = last && first ? (last.enteredAt - first.enteredAt) / 1000 : 0;
    const steps = {}, mediaSteps = []; let resets = 0;
    for (let i = 1; i < data.length; i++) { if (data[i].presentedFrames !== null && data[i - 1].presentedFrames !== null) { const delta = data[i].presentedFrames - data[i - 1].presentedFrames; if (delta >= 0 && delta <= 1000) steps[delta] = (steps[delta] || 0) + 1; else resets++; }
      if (data[i].mediaTime !== null && data[i - 1].mediaTime !== null) mediaSteps.push(data[i].mediaTime - data[i - 1].mediaTime); }
    return { retainedFrames: data.length, windowSeconds: span, callbackFPS: span > 0 ? (data.length - 1) / span : null,
      presentedFPS: span > 0 && !resets && first.presentedFrames !== null && last.presentedFrames !== null ? (last.presentedFrames - first.presentedFrames) / span : null,
      presentedStepHistogram: steps, counterResets: resets, mediaSteps: stats(mediaSteps), callbackCostMs: stats(data.map(row => row.costMs)),
      latenessMs: stats(data.map(row => row.expectedDisplayTime === null ? null : row.enteredAt - row.expectedDisplayTime)), lastMediaTime: last?.mediaTime ?? null };
  }
  function snapshot() {
    let video = null; safe(() => { video = root.livePlayer?.getVideoEl?.(); if (!video || video.isConnected === false) video = root.document.querySelector('#live-player video'); });
    const source = video && urls.get(video.currentSrc || video.src), id = video && videoId(video), summary = frameSummary(id), bufferIds = new Set(source?.buffers.map(state => state.id) || []);
    const media = summary.lastMediaTime ?? (video && Number.isFinite(video.currentTime) ? video.currentTime : null);
    const matches = segments.filter(record => bufferIds.has(record.bufferId) && !record.reason && record.appendCompleted && !record.appendFailed && !record.ambiguous && record.acceptance === 'fresh-buffered-range' && media !== null && record.start <= media + 0.002 && media < record.end + 0.002 &&
      covers(bufferList.find(state => state.id === record.bufferId)?.accepted || [], media, media)).slice(-2).map(record => ({ ...record, sampleDurationHistogram: { ...record.sampleDurationHistogram } }));
    let quality = null; if (video) safe(() => { const q = video.getVideoPlaybackQuality?.(); if (q) quality = { totalVideoFrames: q.totalVideoFrames, droppedVideoFrames: q.droppedVideoFrames }; });
    const own = segments.filter(record => bufferIds.has(record.bufferId)), latest = own.at(-1);
    return { version: 1, running, limits: { videoSegments: MAX_SEGMENTS, callbackFrames: MAX_FRAMES, headerBytes: MAX_HEADER, mediaSources: MAX_SOURCES, sourceBuffers: MAX_BUFFERS },
      boundary: 'Passive MAIN-world MSE append timing; buffered ranges do not prove a frame was decoded. Overlapping/replaced data and partial coverage are excluded from matches. Callback FPS covers the retained current-video window; recent5Seconds is separate. No fetch, extra callback loop, pixels, URLs or original media bytes are exported. Unbound/worker MSE and sequence-mode timelines are not inferred.',
      binding: { bound: !!source, reason: source ? 'createObjectURL-and-addSourceBuffer' : 'current-video-media-source-unbound-or-worker',
        videoId: id || null, sourceId: source?.id ?? null, bufferIds: [...bufferIds], sourceKind: video ? video.srcObject ? 'src-object' : String(video.currentSrc || video.src || '').startsWith('blob:') ? 'blob' : 'other' : 'no-video',
        width: video?.videoWidth || 0, height: video?.videoHeight || 0, currentTime: video?.currentTime ?? null, paused: video?.paused ?? null },
      mse: { trackedSources: sourceList.length, trackedBuffers: bufferList.length, retainedVideoSegments: segments.length, boundVideoSegments: own.length,
        latestSampleFPS: latest?.sampleFPS ?? null, latestReason: latest?.reason ?? null, rawAppendTimingOnly: true,
        ambiguousSegments: own.filter(record => record.ambiguous).length, partialSegments: own.filter(record => record.buffered === 'partial').length, quality },
      callbacks: { ...counters, pending: pending.size, ...summary, recent5Seconds: frameSummary(id, 5) }, matchedMediaTime: media, matches, errors: { ...errors }, unsupported: [...unsupported] };
  }
  function restore() {
    if (!running) return; running = false;
    for (const item of listeners) safe(() => item.object.removeEventListener(item.name, item.fn)); listeners.length = 0;
    for (const item of patches.reverse()) safe(() => { if (item.object[item.name] !== item.wrapped) return; if (item.descriptor) Object.defineProperty(item.object, item.name, item.descriptor); else { delete item.object[item.name]; if (item.object[item.name] !== item.original) item.object[item.name] = item.original; } });
    patches.length = 0; pending.clear(); urls.clear();
    for (const state of bufferList) { state.stream = { head: [], skip: 0, carry: null }; state.batch = null; state.awaitingData = []; }
    sourceList.length = bufferList.length = 0;
  }
  root.__bfdMSEAudit = { version: 1, snapshot, restore };
})(globalThis);
