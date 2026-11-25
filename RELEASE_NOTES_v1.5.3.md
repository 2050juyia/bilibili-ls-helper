# B站小黄鸭插帧助手 1.5.3

本版为 **1.5 系列首个 GitHub 正式发布版**（相较上一公开版 `v1.4.5`），完整带来桌面端 **Mozilla Firefox（140+）** 双端支持，并集中修复了点播 AI 智能防挡弹幕蒙版、SPA 推荐连播切换、Chromium 60fps 点播帧率，以及直播跨房广播横幅与全屏／网页全屏外围干扰问题。

## 主要更新

- **点播 AI 智能防挡蒙版与控制栏底部阴影进度条抑制（1.5.2）：**
  - 修复在开启B站智能防挡弹幕（人物/竖屏等片源的 `div.bpx-player-dm-mask-wrap`）时，网页脚本以约 25–30Hz 独立重写内联 SVG `mask-image` 导致 Edge / Chrome 在视频帧之外产生错位全屏合成提交、破坏小黄鸭光流插帧的问题：滚动弹幕同步期间自动隐藏蒙版与高级弹幕层（`.bpx-player-adv-dm-wrap`）并移除遮罩图像，同时保留元素布局盒模型。
  - 「减少页面动画」在播放器控制栏自动隐藏（`.bpx-state-no-cursor`）时收起底部 2px 阴影进度条（`.bpx-player-shadow-progress-area`），消除常规窗口与网页全屏下的底部边缘额外刷新。
- **直播跨房广播横幅与全屏／网页全屏外围隔离（1.5.3）：**
  - 「减少页面动画」新增B站直播跨房广播横幅（`NOTICE_MSG`，含 `#businessContainerElement` 下无类名 `positionCtnr`／`wrapperDom` 线性位移动画及 `.announcement-wrapper` 首尾精灵帧动画）与全屏无交互特效浮层抑制。
  - 补齐直播网页全屏（`body.player-full-win`）与原生全屏（`body.fullscreen-fix`）被遮挡外围背景分支隔离，并对自动渐隐态（`opacity: 0`）的底部礼花栏做 `visibility: hidden` 合成裁剪，同时完整保留播放器控制栏、全屏弹幕输入、菜单与验证组件交互。
- **默认开启推荐组合、推荐连播重绑与 Chromium 60fps 修复（1.5.1）：**
  - 全新安装默认启用「滚动弹幕」（`video-sync`）与「减少页面动画」；已有用户显式保存的「固定弹幕」或关闭状态保持不变。
  - 支持点播页点击右侧推荐视频（`router-related`）等 SPA 路由切换自动重置就绪预算并重绑新播放器与弹幕容器。
  - Chromium（Edge / Chrome）点播滚动模式保留底层 `<video>` 可见（由不透明画布覆盖），避免隐藏原生 `<video>` 将部分 60fps 点播帧回调限制到约 30fps，并补充同一 `<video>` 最多一次的有界呈现恢复；全屏外围隔离同时支持普通视频与番剧页。
- **Mozilla Firefox（140+）适配与共用播放指示图标屏蔽（1.4.6–1.5.0）：**
  - 统一兼容 `browser.*` 与 `chrome.*` WebExtensions 命名空间及 Promise 消息通信，弹窗支持当前B站站点访问权限自检与一键请求授权。
  - Firefox 点播与直播采用零回读 WebGL 单画布 GPU 合成后端（`webgl-surface.js`）与 `video.mozPresentedFrames` 按帧同步驱动，抑制独立视频叠加交换链双翻转，兼顾原视频 60fps 零掉帧与小黄鸭单交换链捕获；内置后台标签页视频挂起保护。
  - 统一屏蔽新旧版选集/番剧/电影播放指示动态图标（`.playing-gif`、`PlayingIcon_playIcon__` 及动态素材路径）。

## 下载与安装

- **Edge / Chrome 用户：** 下载 [`bilibili-danmaku-assistant-v1.5.3.zip`](https://github.com/2050juyia/bilibili-ls-helper/releases/download/v1.5.3/bilibili-danmaku-assistant-v1.5.3.zip)，解压后在 `edge://extensions` 或 `chrome://extensions` 开启开发者模式，加载直接包含 `manifest.json` 的 `bilibili-fixed-danmaku` 文件夹（源码包则加载 `extension`）。
- **Firefox（140+）用户：** 推荐通过 Firefox 官方附加组件商店（AMO）或下载已签名 `.xpi` 文件在 `about:addons` 永久安装；开发调试可在 `about:debugging#/runtime/this-firefox` 临时载入 [`bilibili-danmaku-assistant-v1.5.3-firefox.zip`](https://github.com/2050juyia/bilibili-ls-helper/releases/download/v1.5.3/bilibili-danmaku-assistant-v1.5.3-firefox.zip)（无需解压，关闭浏览器后自动移除）。
- **从旧版更新：** 替换扩展文件后，请先在浏览器扩展管理页点击「重新加载」（或重新安装／载入新版），再对**实际正在播放视频或直播的窗口**完整刷新一次。推荐使用「滚动弹幕」并开启「减少页面动画」。

## 验证范围

- **274 项** Node.js 单元测试、**12 个**扩展脚本语法检查全部通过（0 失败）。
- Chrome / Edge 受控 DirectComposition 帧提交追踪验证通过（开启 AI 智能防挡视频全屏额外重复提交清零、网页全屏阴影进度条额外提交抑制）。
- 本机 Mozilla Firefox 160.0.1 受控 Marionette 验收（5 组检查）及真实 B 站点播与直播间（含常规／网页全屏／原生全屏触发跨房广播横幅 `0` 运行动画）端到端验证通过。

受控自动化与合成器追踪用于验证扩展功能、样式规则与生命周期，不代替所有硬件、驱动、显示器及片源组合下的 Lossless Scaling 实机补帧效果承诺。详细说明见 [TEST-REPORT.md](https://github.com/2050juyia/bilibili-ls-helper/blob/v1.5.3/TEST-REPORT.md) 与 [CHANGELOG.md](https://github.com/2050juyia/bilibili-ls-helper/blob/v1.5.3/CHANGELOG.md)。
