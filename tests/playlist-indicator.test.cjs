const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../extension/playlist-indicator.js'), 'utf8');
async function harness(initial = true) {
  const stored = initial === 'empty' ? {} : { bfdSettings: { hidePlaylistIndicator: initial } };
  const observers = [], pending = new Set(), listeners = new Map(); let change, textWrites = 0;
  function notify(target, type, attributeName) {
    for (const observer of observers) for (const [node, options] of observer.targets) {
      let descendant = target;
      while (descendant && descendant !== node) descendant = descendant.parentNode;
      if (target !== node && !(options.subtree && descendant === node)) continue;
      if (!options[type] || (type === 'attributes' && options.attributeFilter && !options.attributeFilter.includes(attributeName))) continue;
      pending.add(observer);
    }
  }
  class Node {
    constructor(tagName) { this.tagName = tagName.toUpperCase(); this.children = []; this.parentNode = null; this.attributes = new Map(); this.text = ''; this.sheet = { disabled: false }; }
    append(node) {
      if (node.parentNode) node.remove();
      node.parentNode = this; this.children.push(node); notify(this, 'childList');
    }
    remove() {
      const parent = this.parentNode; if (!parent) return;
      parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; notify(parent, 'childList');
    }
    get textContent() { return this.text; }
    set textContent(value) { this.text = value; textWrites++; notify(this, 'childList'); }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { this.attributes.set(name, value); notify(this, 'attributes', name); }
    removeAttribute(name) { this.attributes.delete(name); notify(this, 'attributes', name); }
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.targets = new Map(); observers.push(this); }
    observe(node, options) { this.targets.set(node, options); }
    disconnect() { this.targets.clear(); pending.delete(this); }
  }
  const root = new Node('html'), head = new Node('head'); root.append(head);
  const all = node => [node, ...node.children.flatMap(all)];
  const document = { documentElement: root, createElement: tagName => new Node(tagName),
    getElementById: id => all(root).find(node => node.id === id) || null,
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); } };
  const chrome = { storage: { local: { get: async () => stored },
    onChanged: { addListener(callback) { change = callback; } } } };
  const forbidden = () => { throw new Error('Animation suppression must not poll or request animation frames'); };
  const context = vm.createContext({ document, chrome, MutationObserver,
    setInterval: forbidden, setTimeout: forbidden, requestAnimationFrame: forbidden });
  vm.runInContext(source, context); await Promise.resolve();
  function flush() {
    let turns = 0;
    while (pending.size) {
      assert(++turns < 20, 'self-repair must converge without a mutation loop');
      const batch = [...pending]; pending.clear(); for (const observer of batch) observer.callback([]);
    }
  }
  flush();
  return { context, document, root, head, observers, pending, flush,
    style: () => document.getElementById('bfd-playlist-indicator-style'), writes: () => textWrites,
    emit: name => { for (const callback of listeners.get(name) || []) callback({ type: name }); flush(); },
    enable(value) { change({ bfdSettings: { newValue: { hidePlaylistIndicator: value } } }, 'local'); flush(); } };
}
test('removed or moved playlist stylesheet repairs itself using only root-direct and own-style observation', async () => {
  const h = await harness(), original = h.style(), css = original.textContent;
  assert.match(css, /\.playing-gif/); assert.match(css, /\.loc-moveclip \.loc-mc-box/);
  original.remove(); h.flush();
  assert(h.style()); assert.notEqual(h.style(), original); assert.equal(h.style().parentNode, h.root);
  assert.equal(h.style().textContent, css);
  const current = h.style(); h.head.append(current); h.flush();
  assert.equal(h.style(), current); assert.equal(current.parentNode, h.root);
  for (const observer of h.observers) for (const [node, options] of observer.targets) {
    if (node === h.root) assert.equal(options.subtree, undefined);
    else assert.equal(node, current, 'subtree observation must be confined to the owned style');
  }
});

test('shared playback indicator rules cover module hashes and asset hashes without page or layout scoping', async () => {
  const h = await harness();
  const css = h.style().textContent;
  assert(css.includes('[class*="PlayingIcon_playIcon__"]'));
  assert(css.includes('img[src*="activity.hdslb.com/blackboard/static/"][src*="/playing.png"]'));
  assert(!css.includes('.right-container .playing-gif'));
  assert(!css.includes('ooOtS'));
  assert(!css.includes('810d5436e67392680ff778b83aa33b46'));
});
test('text and disabled-attribute tampering is repaired, and repeated lifecycle checks do not rewrite stable CSS', async () => {
  const h = await harness(), style = h.style(), css = style.textContent;
  style.textContent = ''; h.flush(); assert.equal(style.textContent, css);
  style.setAttribute('disabled', ''); style.disabled = true; style.sheet.disabled = true;
  h.flush(); assert.equal(style.hasAttribute('disabled'), false);
  assert.equal(style.disabled, false); assert.equal(style.sheet.disabled, false);
  const writes = h.writes();
  for (const name of ['play', 'fullscreenchange', 'play']) h.emit(name);
  assert.equal(h.writes(), writes); assert.equal(h.pending.size, 0);
});
test('play and fullscreenchange repair sheet.disabled even without any DOM mutation', async () => {
  const h = await harness();
  for (const name of ['play', 'fullscreenchange']) {
    const style = h.style(); style.sheet.disabled = true;
    assert.equal(h.pending.size, 0); h.emit(name); assert.equal(style.sheet.disabled, false);
  }
});
test('disabling removes the stylesheet and observers do not resurrect it; re-enabling restores repair', async () => {
  const h = await harness(); h.style().textContent = 'changed before disable';
  h.enable(false); assert.equal(h.style(), null);
  assert(h.observers.every(observer => observer.targets.size === 0));
  h.emit('play'); h.emit('fullscreenchange'); assert.equal(h.style(), null);
  h.enable(true); assert(h.style());
  h.style().remove(); h.flush(); assert(h.style());
});
test('an initially disabled setting does not install a stylesheet or start observers', async () => {
  const h = await harness(false); assert.equal(h.style(), null); assert.equal(h.observers.length, 0);
  h.emit('play'); assert.equal(h.style(), null);
  h.enable(true); assert(h.style()); assert(h.observers.length > 0);
});
test('unset hidePlaylistIndicator defaults to enabled and suppresses player cmd-dm and live-ring animations', async () => {
  const h = await harness('empty');
  assert(h.style(), 'fresh install with undefined hidePlaylistIndicator must enable animation suppression by default');
  assert(h.style().textContent.includes('.bpx-player-cmd-dm-wrap *'));
  assert(h.style().textContent.includes('.bili-dyn-live-ani'));
});
test('playlist indicator CSS hides bottom shadow progress bar only when cursor controls auto-hide', async () => {
  const h = await harness();
  const css = h.style().textContent;
  assert(
    css.includes('.bpx-state-no-cursor .bpx-player-shadow-progress-area{visibility:hidden!important}'),
    'bottom shadow progress bar must be hidden with visibility:hidden!important in .bpx-state-no-cursor'
  );
  assert(!/(?:^|\}|\n)\s*\.bpx-player-shadow-progress-area\s*\{/.test(css), 'must stay scoped to .bpx-state-no-cursor');
  assert(!css.includes('.bpx-player-progress-area'), 'full control progress bar must remain untouched when controls are visible');
});

test('live cross-room broadcast banner, effect overlays, web-fullscreen background roots, and idle gift bar are suppressed without touching controls', async () => {
  const h = await harness();
  const css = h.style().textContent;
  const rules = [...css.matchAll(/([^{}\n]+)\{([^}]+)\}/g)].map(([, sel, decl]) => ({
    selectors: sel.split(',').map(s => s.trim()).filter(Boolean),
    decl: decl.trim()
  }));
  assert(rules.length >= 6, 'all stylesheet rule blocks must parse cleanly');

  const hideRule = rules.find(r => r.decl === 'display:none!important;background-image:none!important;animation:none!important;transition:none!important');
  assert(hideRule, 'liveHiddenOverlays rule must hide and stop transitions/animations');
  for (const expected of [
    '#businessContainerElement > div:has(.announcement-wrapper)',
    '.web-player-inject-wrap > div:not(#businessContainerElement):has(.announcement-wrapper)',
    '.web-player-inject-wrap div:has(> .announcement-wrapper)',
    '#live-player div:has(> .announcement-wrapper)',
    '.announcement-wrapper',
    '#businessContainerElement > #like-moment-animation-vm',
    '#live-player .like-moment-animation',
    '#businessContainerElement > #player-like-so-hot-vm',
    '#businessContainerElement > #full-screen-components-vm',
    '#live-player .pk-cards-animation-root',
    '#live-player .pk-animation-box',
    '#live-player .anchor-team-pk-player__animation-layer',
    'body.player-full-win #head-info-vm',
    'body.player-full-win #sections-vm',
    'body.player-full-win #sidebar-vm',
    'body.player-full-win #room-ssr-vm',
    'body.player-full-win #room-background-vm',
    'body.player-full-win #background-manage-vm',
    'body.player-full-win #player-effect-vm',
    'body.player-full-win footer.link-footer'
  ]) {
    assert(hideRule.selectors.includes(expected), `missing hidden overlay selector: ${expected}`);
  }

  const rhythmRule = rules.find(r => r.selectors.includes('#player-effect-vm .rhythm-storm'));
  assert(rhythmRule && rhythmRule.decl === 'background-image:none!important;animation:none!important');

  const animRule = rules.find(r => r.decl === 'animation:none!important;transition:none!important');
  assert(animRule, 'suppressedAnimations rule must exist');
  for (const expected of [
    '.announcement-wrapper *',
    '#animation-mask-wrapper',
    '#animation-mask-wrapper *',
    '#LiveRoomHotrankEntries *',
    '.count-down-bg-root .animation-path',
    '.is-marquee',
    '#gift-animation-tip',
    '.anchor-team-pk-bar *',
    '.ripple-content .ripple'
  ]) {
    assert(animRule.selectors.includes(expected), `missing suppressed animation selector: ${expected}`);
  }

  const giftRule = rules.find(r => r.selectors.includes('body.fullscreen-fix #fullscreen-container .gift-control-section[style*="opacity: 0"]'));
  assert(giftRule && giftRule.decl === 'visibility:hidden!important');
  assert(giftRule.selectors.includes('body.fullscreen-fix #fullscreen-container .gift-control-section[style*="opacity:0"]'));
  assert(giftRule.selectors.includes('body.player-full-win #fullscreen-container .gift-control-section[style*="opacity: 0"]'));
  assert(giftRule.selectors.includes('body.player-full-win #fullscreen-container .gift-control-section[style*="opacity:0"]'));

  // Ensure player controls, danmaku input/layer, info panel, aside chat, and captcha are never referenced
  for (const forbidden of [
    'web-player-controller',
    'fullscreen-danmaku-vm',
    'web-player-video-info-panel',
    'web-player-danmaku',
    'aside-area',
    'geetest'
  ]) {
    assert(!css.includes(forbidden), `playlist-indicator CSS must never target ${forbidden}`);
  }

  // Structural selector evaluation on a realistic Bilibili Live DOM tree
  class El {
    constructor(tag, id = '', cls = '', style = '') {
      this.tag = tag.toLowerCase(); this.id = id;
      this.classes = new Set(cls.split(/\s+/).filter(Boolean));
      this.styleText = style; this.parent = null; this.children = [];
    }
    append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } return this; }
    descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
  }
  function splitTop(str, sep) {
    const out = []; let depth = 0, cur = '';
    for (const ch of str) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function matchSimple(el, sel) {
    if (sel.includes('::')) return false;
    if (sel === '*') return true;
    let rest = sel;
    for (const m of [...rest.matchAll(/:has\(([^()]+)\)/g)]) {
      const inner = m[1].trim();
      const ok = inner.startsWith('>')
        ? el.children.some(c => matchChain(c, inner.slice(1).trim()))
        : el.descendants().some(d => matchChain(d, inner));
      if (!ok) return false;
      rest = rest.replace(m[0], '');
    }
    for (const m of [...rest.matchAll(/:not\(([^()]+)\)/g)]) {
      if (matchSimple(el, m[1].trim())) return false;
      rest = rest.replace(m[0], '');
    }
    for (const m of [...rest.matchAll(/\[([\w-]+)\*="([^"]*)"\]/g)]) {
      const val = m[1] === 'style' ? el.styleText : m[1] === 'class' ? [...el.classes].join(' ') : '';
      if (!val.includes(m[2])) return false;
      rest = rest.replace(m[0], '');
    }
    const tag = rest.match(/^[a-z0-9-]+/i)?.[0];
    if (tag && el.tag !== tag.toLowerCase()) return false;
    const ids = [...rest.matchAll(/#([\w-]+)/g)].map(m => m[1]);
    if (ids.some(id => el.id !== id)) return false;
    const classes = [...rest.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    if (classes.some(c => !el.classes.has(c))) return false;
    return true;
  }
  function matchChain(el, sel) {
    const tokens = [];
    let depth = 0, cur = '';
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (depth === 0 && (ch === '>' || /\s/.test(ch))) {
        if (cur.trim()) { tokens.push(cur.trim()); cur = ''; }
        if (ch === '>') {
          if (tokens.at(-1) === ' ') tokens.pop();
          tokens.push('>');
        } else if (tokens.length && tokens.at(-1) !== '>' && tokens.at(-1) !== ' ') {
          tokens.push(' ');
        }
      } else cur += ch;
    }
    if (cur.trim()) tokens.push(cur.trim());
    while (tokens.at(-1) === ' ' || tokens.at(-1) === '>') tokens.pop();
    function step(node, idx) {
      if (!node) return false;
      if (!matchSimple(node, tokens[idx])) return false;
      if (idx === 0) return true;
      const comb = tokens[idx - 1];
      if (comb === '>') return step(node.parent, idx - 2);
      for (let p = node.parent; p; p = p.parent) if (step(p, idx - 2)) return true;
      return false;
    }
    return step(el, tokens.length - 1);
  }
  const matchesAny = (el, list) => list.some(s => splitTop(s, ',').some(one => matchChain(el, one)));

  const body = new El('body', '', 'fullscreen-fix');
  const fsContainer = new El('div', 'fullscreen-container');
  const livePlayer = new El('div', 'live-player', 'live-player-mounter');
  const video = new El('video');
  const danmaku = new El('div', '', 'web-player-danmaku');
  const composite = new El('canvas', '', 'bfd-live-composite');
  const injectWrap = new El('div', '', 'web-player-inject-wrap', 'z-index: 9');
  const biz = new El('div', 'businessContainerElement');
  const fsDanmaku = new El('div', 'fullscreen-danmaku-vm');
  const positionCtnr = new El('div', '', '', 'position:absolute;top:0;left:0;width:100%;height:100px');
  const wrapperDom = new El('div', '', '', 'will-change:transform;transition:transform 20s linear');
  const aw = new El('div', '', 'announcement-wrapper clearfix no-select');
  const headIcon = new El('div', '', 'gift-prefix head-icon notice-62-icon');
  const tailIcon = new El('span', '', 'tail-icon dp-i-block');
  const ctrlWrap = new El('div', 'web-player-controller-wrap-el', 'web-player-controller-wrap');
  const ctrlBtn = new El('button', '', 'volume-control');
  const menuUl = new El('ul', '', 'web-player-context-menu');
  const infoPanel = new El('div', '', 'web-player-video-info-panel');
  const giftVm = new El('div', 'gift-control-vm');
  const giftSection = new El('div', '', 'gift-control-section', 'opacity: 0; pointer-events: none;');
  const geetest = new El('div', '', 'geetest_panel geetest_wind');

  aw.append(headIcon, tailIcon);
  wrapperDom.append(aw);
  positionCtnr.append(wrapperDom);
  biz.append(fsDanmaku, positionCtnr);
  injectWrap.append(biz);
  ctrlWrap.append(ctrlBtn);
  livePlayer.append(video, danmaku, composite, injectWrap, ctrlWrap, menuUl, infoPanel);
  giftVm.append(giftSection);
  fsContainer.append(livePlayer, giftVm);
  body.append(fsContainer, geetest);

  // Banner containers and inner icons are hidden/suppressed
  for (const bannerNode of [positionCtnr, wrapperDom, aw]) {
    assert(matchesAny(bannerNode, hideRule.selectors), 'banner wrapper/element must be hidden');
  }
  for (const iconNode of [headIcon, tailIcon]) {
    assert(matchesAny(iconNode, animRule.selectors), 'banner sprite child must have animations suppressed');
  }
  assert(matchesAny(giftSection, giftRule.selectors), 'idle opacity:0 gift-control-section must be visibility:hidden');
  giftSection.styleText = '';
  assert(!matchesAny(giftSection, giftRule.selectors), 'hovered gift-control-section must remain visible');

  // Protected player controls, video, composite canvas, danmaku input, menus, and geetest are NEVER hidden or suppressed
  const allSelectors = rules.flatMap(r => r.selectors);
  for (const safeNode of [fsContainer, livePlayer, video, danmaku, composite, injectWrap, biz, fsDanmaku, ctrlWrap, ctrlBtn, menuUl, infoPanel, giftVm, giftSection, geetest]) {
    assert(!matchesAny(safeNode, allSelectors), `must never match protected element ${safeNode.tag}#${safeNode.id}.${[...safeNode.classes].join('.')}`);
  }

  // Disabling removes stylesheet cleanly
  h.context.BFDPlaylistIndicator.set(false);
  assert.equal(h.style(), null);
});
