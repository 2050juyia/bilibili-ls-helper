"use strict";
const ext = typeof browser === "object" && browser?.runtime ? browser : chrome;
const $ = id => document.getElementById(id);
const enabled = $("enabled"), motion = $("motion"), position = $("position");
const hidePlaylistIndicator = $("hide-playlist-indicator"), reload = $("reload");
const controls = [enabled, hidePlaylistIndicator, motion, position];
let tab = null, isVideo = false, isLive = false, loaded = false, needsRefresh = false;
let siteOrigin = "", sitePermitted = true;
let storedSettings = {}, animationSaved = false;
let pendingSave = Promise.resolve(), saveError = false, saving = 0, saveRevision = 0;
$("version").textContent = ext.runtime.getManifest().version;

function notice(title, detail = "", tone = "normal") {
  $("status-title").textContent = title;
  $("status-detail").textContent = detail;
  $("status").dataset.tone = tone;
  $("status").hidden = !title;
  $("status-detail").hidden = !detail;
}
function updateControls() {
  enabled.disabled = hidePlaylistIndicator.disabled = !loaded;
  $("danmaku-options").disabled = !loaded || !enabled.checked;
  $("position-options").hidden = motion.value === "video-sync";
  $("enabled-label").textContent = loaded ? (enabled.checked ? "已开启" : "已关闭") : "未就绪";
  $("reload-label").textContent = sitePermitted ? "刷新视频，应用设置" : "授权当前B站页面并刷新";
  reload.disabled = !loaded || !isVideo || saving > 0 || saveError;
}
function updateNotice() {
  updateControls();
  if (saveError) return notice("设置保存失败", "请重试刚才的设置，或重新打开面板。", "error");
  if (saving) return notice("正在保存设置…");
  if (!isVideo) return notice("请打开B站视频、番剧或直播间。", "", "warning");
  if (!sitePermitted) return notice("未授予当前B站站点访问权限", "点击下方按钮授权并刷新页面，使插件脚本生效。", "warning");
  if (needsRefresh) return notice("设置已保存，请刷新视频应用。", "", "warning");
  if (isLive && enabled.checked && !animationSaved)
    return notice("直播支持文字与表情同步。", "弹幕层内的其他互动特效暂不显示；礼物等独立动画不在同步范围内。");
  notice(animationSaved ? "页面动画设置已保存，立即生效。" : "");
}
async function save(event) {
  if (!loaded) return;
  const settings = { ...storedSettings, enabled: enabled.checked, hidePlaylistIndicator: hidePlaylistIndicator.checked, motion: motion.value, position: position.value };
  storedSettings = settings;
  if (event.target !== hidePlaylistIndicator) needsRefresh = true;
  const revision = ++saveRevision;
  saving++; saveError = false; updateNotice();
  // Submit every snapshot while the popup is alive. Waiting for the previous
  // acknowledgement can lose later changes when the popup closes mid-save.
  let write;
  try { write = Promise.resolve(ext.storage.local.set({ bfdSettings: settings })); }
  catch (error) { write = Promise.reject(error); }
  pendingSave = Promise.allSettled([pendingSave, write]).then(() => {});
  try {
    await write;
    if (revision === saveRevision) {
      saveError = false;
      animationSaved = event.target === hidePlaylistIndicator;
      $("save-result").textContent = event.target === hidePlaylistIndicator ? "页面动画设置已保存，立即生效。" : "设置已保存，刷新后完整应用。";
    }
  } catch { if (revision === saveRevision) { saveError = true; $("save-result").textContent = "设置保存失败，请重试。"; } }
  finally { saving--; updateNotice(); }
}
async function init() {
  try {
    const stored = await Promise.resolve(ext.storage.local.get("bfdSettings"));
    storedSettings = stored?.bfdSettings || {};
    enabled.checked = storedSettings.enabled !== false;
    hidePlaylistIndicator.checked = storedSettings.hidePlaylistIndicator === true;
    motion.value = storedSettings.motion === "video-sync" ? "video-sync" : "fixed";
    position.value = ["top", "bottom", "alternate"].includes(storedSettings.position) ? storedSettings.position : "top";
    loaded = true;
  } catch {
    updateControls(); notice("读取设置失败", "请重新打开面板，避免覆盖已有设置。", "error"); return;
  }
  try { [tab] = await Promise.resolve(ext.tabs.query({ active: true, currentWindow: true })); }
  catch { tab = null; }
  isLive = /^https:\/\/live\.bilibili\.com\/(?:blanc\/)?[1-9]\d*\/?(?:[?#]|$)/.test(tab?.url || "");
  isVideo = /^https:\/\/www\.bilibili\.com\/(?:video\/|bangumi\/play\/)/.test(tab?.url || "") || isLive;
  try { siteOrigin = isVideo && tab?.url ? new URL(tab.url).origin + "/*" : ""; }
  catch { siteOrigin = ""; }
  if (siteOrigin && typeof ext.permissions?.contains === "function") {
    try { sitePermitted = (await Promise.resolve(ext.permissions.contains({ origins: [siteOrigin] }))) !== false; }
    catch { sitePermitted = true; }
  }
  updateControls();
  updateNotice();
}
controls.forEach(control => control.addEventListener("change", save));
reload.addEventListener("click", async () => {
  reload.disabled = true;
  // Firefox requires permissions.request to be invoked synchronously inside the click handler.
  let permissionTask = null;
  if (!sitePermitted && siteOrigin && typeof ext.permissions?.request === "function") {
    try { permissionTask = Promise.resolve(ext.permissions.request({ origins: [siteOrigin] })); }
    catch (error) { permissionTask = Promise.reject(error); }
  }
  try {
    if (permissionTask) {
      const granted = await permissionTask;
      if (!granted) { notice("未完成站点授权", "请在扩展设置中允许访问当前B站域名后再刷新。", "warning"); return; }
      sitePermitted = true;
    }
    await pendingSave;
    if (saveError || saving || !isVideo || !tab?.id) return;
    await Promise.resolve(ext.tabs.reload(tab.id));
    window.close();
  } catch { notice("刷新失败", "请手动刷新视频页。", "error"); }
  finally { updateControls(); }
});
init();
