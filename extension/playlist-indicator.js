(() => {
  'use strict';
  if (globalThis.BFDPlaylistIndicator) return;
  const STYLE = 'bfd-playlist-indicator-style', KEY = 'bfdSettings';
  // This header carousel keeps animating behind the fullscreen player. Like
  // the playlist GIF, it can drive capture above the video's own frame rate.
  const CSS = '.right-container .playing-gif{display:none!important;background-image:none!important;animation:none!important}\n' +
    '.bili-header__bar .loc-moveclip .loc-mc-box{animation:none!important;transform:translateY(0)!important}';
  let enabled = false, revision = 0;
  let rootObserver = null, styleObserver = null, observedRoot = null, observedStyle = null;
  function watch(style) {
    if (typeof MutationObserver !== 'function') return;
    rootObserver ||= new MutationObserver(() => { if (enabled) apply(true); });
    styleObserver ||= new MutationObserver(() => { if (enabled) apply(true); });
    if (observedRoot !== document.documentElement) {
      rootObserver.disconnect();
      rootObserver.observe(document.documentElement, { childList: true });
      observedRoot = document.documentElement;
    }
    if (observedStyle !== style) {
      styleObserver.disconnect();
      styleObserver.observe(style, { childList: true, characterData: true, subtree: true,
        attributes: true, attributeFilter: ['disabled'] });
      observedStyle = style;
    }
  }
  function apply(value) {
    enabled = value === true;
    let style = document.getElementById(STYLE);
    if (!enabled) {
      rootObserver?.disconnect(); styleObserver?.disconnect();
      observedRoot = null; observedStyle = null;
      style?.remove(); return;
    }
    if (!document.documentElement) { document.addEventListener('DOMContentLoaded', () => apply(enabled), { once: true }); return; }
    if (!style) { style = document.createElement('style'); style.id = STYLE; }
    if (style.parentNode !== document.documentElement) document.documentElement.append(style);
    watch(style);
    if (style.textContent !== CSS) style.textContent = CSS;
    if (style.hasAttribute('disabled')) style.removeAttribute('disabled');
    if (style.disabled) style.disabled = false;
    if (style.sheet?.disabled) style.sheet.disabled = false;
  }
  // CSSStyleSheet.disabled does not produce a DOM mutation. Native lifecycle
  // events provide a bounded recheck without a polling or animation loop.
  for (const name of ['play', 'fullscreenchange']) {
    document.addEventListener(name, () => { if (enabled) apply(true); }, true);
  }
  globalThis.BFDPlaylistIndicator = { set: apply };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) { revision++; apply(changes[KEY].newValue?.hidePlaylistIndicator); }
  });
  const initial = revision;
  chrome.storage.local.get(KEY).then(value => { if (revision === initial) apply(value[KEY]?.hidePlaylistIndicator); }).catch(() => {});
})();
