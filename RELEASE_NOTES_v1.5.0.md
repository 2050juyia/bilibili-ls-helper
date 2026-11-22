# B站小黄鸭插帧助手 1.5.0

本版新增桌面端 **Mozilla Firefox（140+）** 完整适配与双端分流构建，并包含 1.4.6 的新版番剧/影视共用播放指示图标屏蔽规则。

## 主要更新

- **Firefox（140+）完整适配：**
  - 统一支持 WebExtensions `browser.*` 与 `chrome.*` 命名空间及 `browser.runtime.onMessage` Promise 异步响应。
  - 针对 Firefox（Gecko）渲染管线，点播与直播均采用 `alpha: true` 透明脏矩形弹幕叠加层（`danmaku-overlay`），完全不回读或遮挡底层原生硬件 `<video>`，消除 2K/4K 高分屏下 `OffscreenCanvas` 跨进程回读与不透明遮挡裁剪导致的原视频掉帧问题；Edge / Chrome 继续保持既有单画布路径不变。
  - 点播与直播同步控制器新增后台标签页挂起保护：切至后台期间（Firefox 默认挂起视频解码、仅保留音频推进）不再误触发帧回调停滞或耗尽 3 次恢复预算，切回前台后自动接续视频帧回调。
  - 弹窗新增当前B站域名访问权限自检与同步请求授权入口，并消除展开说明时的横向滚动条。
- **共用播放指示图标屏蔽（自 1.4.6 合入）：**
  - 「减少页面动画」统一匹配旧版 `.playing-gif`、新版 `PlayingIcon_playIcon__` 组件前缀及播放指示动态素材路径，覆盖新版番剧、电影等布局与组件哈希后缀变化。
- **双端零警告安装包与教程：**
  - `scripts/package.py` 同时构建面向 Edge / Chrome 的目录结构包 `bilibili-danmaku-assistant-v1.5.0.zip`，以及面向 Firefox / AMO 的根目录结构包 `bilibili-danmaku-assistant-v1.5.0-firefox.zip`（内置固定扩展 ID `bilibili-ls-helper@2050juyia.github.io`、`strict_min_version: "140.0"` 与 `data_collection_permissions` 零数据收集声明）。
  - 新增 [Firefox 安装图文教程](docs/install-firefox.zh-CN.md) 与 [AMO 公开上架指南](docs/amo-submission-guide.zh-CN.md)。

## 下载与安装

- **Edge / Chrome 用户：** 下载 `bilibili-danmaku-assistant-v1.5.0.zip`，解压后在扩展管理页开启开发者模式，加载直接包含 `manifest.json` 的 `bilibili-fixed-danmaku` 文件夹。
- **Firefox（140+）用户：** 推荐通过 Firefox 官方附加组件商店（AMO）或下载已签名 `.xpi` 文件在 `about:addons` 永久安装；开发调试可在 `about:debugging#/runtime/this-firefox` 临时载入 `bilibili-danmaku-assistant-v1.5.0-firefox.zip`（重启浏览器失效）。
- 更新扩展后请完整刷新实际播放视频或直播的窗口。推荐使用「滚动弹幕」并开启「减少页面动画」。

## 验证范围

- 257 项 Node.js 单元测试、11 个扩展脚本语法检查全部通过。
- 本机 Mozilla Firefox 160.0.1 受控 Marionette 端到端验收通过 5 组检查（根目录 `-firefox.zip` 载入、弹窗存储保存、点播连续视频帧回调合成、跨世界 Promise 消息往返、直播文字与表情 `ImageDecoder` 合成）。
- 既有 Edge 播放指示图标与存储事件受控验收保持通过。

受控自动化检查用于验证扩展功能与生命周期，不代替所有硬件、系统配置及片源下的 Lossless Scaling 实机补帧效果承诺。详细边界见 `TEST-REPORT.md`。
