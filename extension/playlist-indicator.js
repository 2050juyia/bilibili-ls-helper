(() => {
  'use strict';
  if (globalThis.BFDPlaylistIndicator) return;
  const STYLE = 'bfd-playlist-indicator-style', KEY = 'bfdSettings';
  // Shared playback indicators appear in different layouts. CSS module hashes
  // and activity asset directory hashes can change independently of the component.
  const playingIndicators = [
    '.playing-gif',
    '.living-gif',
    '[class*="PlayingIcon_playIcon__"]',
    'img[src*="activity.hdslb.com/blackboard/static/"][src*="/playing.png"]',
    'img[src*="/live.gif"]',
    'img[src*="/living.gif"]'
  ].join(',');
  // Cross-room broadcast notices (DanmakuAnnouncementController mounts classless
  // positionCtnr > wrapperDom[will-change:transform] > .announcement-wrapper inside
  // #live-player > .web-player-inject-wrap > #businessContainerElement at z-index: 9)
  // and unsolicited full-player effect overlays / occluded web-fullscreen branches.
  const liveHiddenOverlays = [
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
  ].join(',');
  const suppressedAnimations = [
    '.bili-dyn-live-ani',
    '.bili-live-ani',
    '[class*="live-ani"]',
    '.bpx-player-cmd-dm-wrap *',
    '.bpx-player-electric-wrap *',
    '.announcement-wrapper *',
    '#animation-mask-wrapper',
    '#animation-mask-wrapper *',
    '#LiveRoomHotrankEntries *',
    '.heat-index-scroll-content',
    '.count-down-bg-root .animation-path',
    '.is-marquee',
    '.is-marquee *',
    '.stars-wrap *',
    '.live-title-mask',
    '.a-splashing',
    '.side-bar-red-dot::after',
    '.brush-prompt-item',
    '#gift-animation-tip',
    '#gift-animation-tip *',
    '.universal-pk-bar-box *',
    '.process-bar-animation',
    '.thirty-capsule .animation-arrow',
    '.thirty-capsule-stage3 .animation-arrow',
    '.player-area .pk-result',
    '.anchor-team-pk-bar *',
    '.anchor-team-sprint-bar__fill',
    '.anchor-team-sprint-bar__particles',
    '.ripple-content .ripple'
  ].join(',');
  // This header carousel keeps animating behind the fullscreen player. Like
  // the playlist GIF, it can drive capture above the video's own frame rate.
  const CSS = playingIndicators + '{display:none!important;background-image:none!important;animation:none!important}\n' +
    liveHiddenOverlays + '{display:none!important;background-image:none!important;animation:none!important;transition:none!important}\n' +
    '#player-effect-vm .rhythm-storm{background-image:none!important;animation:none!important}\n' +
    '.bili-header__bar .loc-moveclip .loc-mc-box{animation:none!important;transform:translateY(0)!important}\n' +
    suppressedAnimations + '{animation:none!important;transition:none!important}\n' +
    '.bpx-state-no-cursor .bpx-player-shadow-progress-area{visibility:hidden!important}\n' +
    'body.fullscreen-fix #fullscreen-container .gift-control-section[style*="opacity: 0"],' +
    'body.fullscreen-fix #fullscreen-container .gift-control-section[style*="opacity:0"],' +
    'body.player-full-win #fullscreen-container .gift-control-section[style*="opacity: 0"],' +
    'body.player-full-win #fullscreen-container .gift-control-section[style*="opacity:0"]{visibility:hidden!important}';
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
  const ext = typeof browser === 'object' && browser?.storage ? browser : chrome;
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) { revision++; apply(changes[KEY].newValue?.hidePlaylistIndicator !== false); }
  });
  const initial = revision;
  ext.storage.local.get(KEY).then(value => { if (revision === initial) apply(value?.[KEY]?.hidePlaylistIndicator !== false); }).catch(() => {});
})();
