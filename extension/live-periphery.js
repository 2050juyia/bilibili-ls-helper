// Hide only recognized native branches outside the fullscreen live player.
(() => {
  'use strict';
  if (globalThis.BFDLivePeriphery) return;
  const KEY = 'bfdSettings';
  const appNames = ['head-info-vm', 'live-charge-vm', 'limit-boomman', 'aside-area-vm', 'sections-vm', 'sidebar-vm', 'room-ssr-vm'];
  const bodyNames = ['guard-store-vm', 'enter-failure', 'iframe-popup-area', 'multi-player', 'player-animation-vm', 'mars-switch-vm',
    'script-requirement', 'link-popup-ctnr', 'lite-pay-ctnr', 'recharge-stores-ctnr', 'user-title-using-cntr', 'user-title-sending-cntr'];
  const named = names => names.flatMap(name => ['.' + name, '#' + name]).join(',');
  const APP = named(appNames) + ',footer.link-footer,footer .link-footer', BODY = named(bodyNames);
  const PROTECTED = '#codex-agent-overlay-root,.codex-agent-overlay-root,#immersive-translate-browser-popup,.immersive-translate-browser-popup';
  const owned = new Map();
  let enabled = false, leaving = false, destroyed = false, revision = 0, currentFullscreen = null;
  let relinquished = new WeakSet(), observer = null, observed = new Set();
  function isRoom() {
    try { const url = new URL(location.href); return url.protocol === 'https:' && url.hostname === 'live.bilibili.com' && /^\/(?:blanc\/)?[1-9]\d*\/?$/.test(url.pathname); }
    catch (_) { return false; }
  }
  function protectedBranch(node) { return node.matches?.(PROTECTED) || !!node.querySelector?.(PROTECTED); }
  function restore(node, prior) {
    if (node.style.getPropertyValue('display') === 'none' && node.style.getPropertyPriority('display') === 'important') {
      if (prior.value) node.style.setProperty('display', prior.value, prior.priority);
      else node.style.removeProperty('display');
    } else relinquished.add(node);
    owned.delete(node);
  }
  function stop() {
    observer?.disconnect(); observed.clear();
    for (const [node, prior] of owned) restore(node, prior);
    currentFullscreen = null; relinquished = new WeakSet();
  }
  function watch(nodes) {
    if (typeof MutationObserver !== 'function') return;
    if (nodes.size === observed.size && [...nodes].every(node => observed.has(node))) return;
    observer ||= new MutationObserver(refresh);
    observer.disconnect(); observed = nodes;
    for (const node of nodes) observer.observe(node, { childList: true });
  }
  function refresh() {
    if (destroyed) return;
    const fullscreen = document.fullscreenElement;
    const player = fullscreen?.matches?.('#live-player') ? fullscreen : fullscreen?.querySelector?.('#live-player');
    const app = player?.closest?.('.live-room-app');
    if (!enabled || leaving || !isRoom() || !fullscreen || fullscreen.isConnected === false || !player || !app ||
        player.isConnected === false || !fullscreen.contains(player)) { stop(); return; }
    if (currentFullscreen !== fullscreen) { stop(); currentFullscreen = fullscreen; }
    const wanted = new Set(), watches = new Set();
    const safe = node => !!node?.style && node !== fullscreen && !node.contains(fullscreen) && !fullscreen.contains(node) && !protectedBranch(node);
    function nativeBranch(node) {
      if (!safe(node)) return;
      if (node.matches?.(APP)) { wanted.add(node); watches.add(node); return; }
      // Unknown wrappers remain visible. Only their recognized native child
      // roots are eligible; foreign extension content is never a hide target.
      if (/^(IFRAME|VIDEO|CANVAS|SCRIPT|STYLE|LINK|OBJECT|EMBED)$/.test(node.tagName)) return;
      watches.add(node);
      for (const candidate of node.querySelectorAll?.(APP) || []) {
        if (!safe(candidate) || [...wanted].some(parent => parent.contains(candidate))) continue;
        wanted.add(candidate); watches.add(candidate);
        for (let parent = candidate.parentElement; parent && parent !== node; parent = parent.parentElement) watches.add(parent);
      }
    }
    // Watching this exact path also detects player/container replacement. No
    // subtree or attribute observation sees per-frame danmaku/style changes.
    for (let branch = player; branch; branch = branch.parentElement) {
      watches.add(branch);
      const parent = branch.parentElement;
      if (parent && (parent === app || app.contains(parent)) && !fullscreen.contains(parent)) {
        for (const sibling of parent.children) if (sibling !== branch) nativeBranch(sibling);
      }
      if (branch === document.documentElement) break;
    }
    if (document.body) {
      watches.add(document.body);
      for (const node of document.body.children) if (safe(node) && node.matches?.(BODY)) { wanted.add(node); watches.add(node); }
    }
    // Compute the complete new path before restoring old branches, so a moved
    // fullscreen player is never hidden by an out-of-date branch list.
    for (const [node, prior] of owned) if (!wanted.has(node)) restore(node, prior);
    for (const node of wanted) {
      const prior = owned.get(node);
      if (prior) {
        if (node.style.getPropertyValue('display') !== 'none' || node.style.getPropertyPriority('display') !== 'important') {
          owned.delete(node); relinquished.add(node);
        }
        continue;
      }
      if (relinquished.has(node)) continue;
      const value = node.style.getPropertyValue('display'), priority = node.style.getPropertyPriority('display');
      if (value === 'none' && priority === 'important') continue;
      owned.set(node, { value, priority }); node.style.setProperty('display', 'none', 'important');
    }
    watch(watches);
  }
  function apply(value) { if (destroyed) return; revision++; enabled = value === true; refresh(); }
  function storageChanged(changes, area) { if (area === 'local' && changes[KEY]) apply(changes[KEY].newValue?.hidePlaylistIndicator); }
  function hidePage() { leaving = true; stop(); }
  function showPage() { leaving = false; refresh(); }
  function destroy() {
    if (destroyed) return;
    destroyed = true; stop();
    document.removeEventListener('fullscreenchange', refresh);
    document.removeEventListener('DOMContentLoaded', refresh);
    globalThis.removeEventListener('pagehide', hidePage);
    globalThis.removeEventListener('pageshow', showPage);
    globalThis.removeEventListener('popstate', refresh);
    chrome.storage.onChanged.removeListener(storageChanged);
  }
  globalThis.BFDLivePeriphery = { set: apply, destroy,
    readStatus: () => ({ enabled, active: !!currentFullscreen, hiddenBranches: owned.size, observedNodes: observed.size, destroyed }) };
  document.addEventListener('fullscreenchange', refresh);
  document.addEventListener('DOMContentLoaded', refresh);
  globalThis.addEventListener('pagehide', hidePage);
  globalThis.addEventListener('pageshow', showPage);
  globalThis.addEventListener('popstate', refresh);
  chrome.storage.onChanged.addListener(storageChanged);
  const initial = revision;
  chrome.storage.local.get(KEY).then(value => { if (!destroyed && initial === revision) { enabled = value[KEY]?.hidePlaylistIndicator === true; refresh(); } }).catch(() => {});
})();
