# 检查说明

## 1.5.0检查（2026-11-22）

本轮基于已验收的 1.4.6 基线（`b2f2818`）完成桌面端 Mozilla Firefox（140+）适配与双端分流构建。当前扩展文件哈希见 `SOURCE-MANIFEST.json`。

- `npm test` 通过 **259 项** 检查（0 失败、0 跳过、0 取消），新增覆盖：
  - Firefox `browser.*` WebExtensions 命名空间及 `browser.runtime.onMessage` Promise 异步响应（无 `chrome` 全局变量环境）；
  - 弹窗站点访问权限检查（`permissions.contains`）及用户手势同步请求（`permissions.request`）；
  - Firefox Gecko 零回读 WebGL 单画布呈现器（`BFDWebGLSurface`，`webgl2`/`webgl` 回退、Y 轴裁剪框转换、共享动态画布子区域 UV 裁剪、精灵纹理上传/释放及上下文丢失恢复）；
  - Firefox Gecko 下点播 `BFDCompositor` 与直播 `BFDLiveCompositor` 采用 WebGL 单画布 GPU 合成（`surface: "webgl-single-canvas", backend: "webgl"`），消除 2D `OffscreenCanvas` 视频回读卡顿，并隐藏/透明化底层 `<video>` 以禁用独立 DirectComposition 视频叠加层交换链（避免 WGC 双交换链翻转干扰小黄鸭插帧）；
  - 点播与直播在后台标签页（`document.hidden === true`）持续推进音频 `timeupdate` 20 秒不误判 `stale`、零恢复预算消耗，切回前台自动接续；
  - Firefox 派生 `manifest.json` 满足 AMO 规范（无 `minimum_chrome_version`、含 `gecko.id`、`strict_min_version: "140.0"`、`data_collection_permissions.required: ["none"]` 且 `manifest.json` 位于 ZIP 根目录）。
- `npm run check` 通过全部 12 个扩展脚本语法检查。
- `node scripts/firefox-ui-check.cjs` 使用本机 **Mozilla Firefox 160.0.1** 与内置 Marionette 协议执行端到端验收，5 组真机检查全部通过：
  1. `AddonManager.installTemporaryAddon` 成功安装根目录结构的 `-firefox.zip`（`isActive: true`）；
  2. `moz-extension://.../popup.html` 正常读取/写入 `browser.storage.local`，且无横向溢出；
  3. 点播页面连续运行 >2.6 秒（跨越 2000ms 停滞检测阈值），`webgl-single-canvas` 持续随 `requestVideoFrameCallback` 呈现、底层 `<video>` 处于 `visibility: hidden`、恢复尝试次数为 0，新旧播放指示图标正常隐藏；
  4. `ISOLATED` 世界 `bridge.js` 与 `MAIN` 世界 `hook.js` 通过 `browser.tabs.sendMessage` 完成 Promise 状态往返（`fetch`/`xhr`/`socket` 钩子全部就绪）；
  5. 直播房间页 `BFDLiveSync` + `BFDLiveCompositor` 以 `webgl-single-canvas` 连续触发帧合成（底层 `<video>` `opacity: 0`），并通过 Firefox `ImageDecoder` 成功解码与缓存表情纹理（`assets: 1, imageFailures: 0`）。
- 另在本机 Firefox 160.0.1 真实 B 站视频页（`BV1GJ411x7h7`，同屏 45 条弹幕）执行连续 12.5 秒前台播放与 11.5 秒后台标签切换实测：`droppedVideoFrames: 0`（零视频掉帧），GPU 文字纹理缓存命中率 99.0%，切回前台后 `recovery.attempts: 0`。

Firefox 测试配置与截图保存在忽略目录 `work/firefox-ui-1.5.0/`（位于 E 盘工作区）。受控浏览器验收不代替各显卡、窗口模式下的 Lossless Scaling 实机运动画面对比。

## 1.4.6检查（2026-11-15）

本轮基于公开1.4.5提交 `f168acf` 移植共用播放指示图标修复。其扩展文件树与E盘、D盘的本地1.4.5开发快照一致，来源与当前哈希见 `SOURCE_PROVENANCE.md`、`SOURCE-MANIFEST.json`。

- `npm test` 通过249项检查，包含1.4.5的直播、表情、画质保护、呈现恢复、容器重绑和设置保存回归。`npm run check` 通过11个扩展脚本语法检查。
- `scripts/playing-indicator-ui.cjs` 使用实际MV3扩展与真实存储事件，在Edge中覆盖普通视频、番剧与首页路径、新旧组件、动态插入、类名哈希变化、素材目录变化、开关恢复、弹幕总开关独立性及全屏。
- 设置 `BFD_LIVE=1` 时同时访问用户指定的 `ep5389730` 页面，检查实际组件由 `inline-block` 变为 `none`，选集文字与链接一致。

浏览器报告与截图位于忽略目录 `work/playing-indicator-ui-1.4.6/`。测试通过环境变量 `BFD_PLAYWRIGHT` 使用已安装的Playwright。此次测量图标显示和页面交互，小黄鸭输入、输出帧节奏仍需实机对照。

## 1.4.5检查（2026-10-22）

本公开版本的18个扩展文件与已验证的本地1.4.5快照逐字节一致，来源和SHA256见SOURCE_PROVENANCE.md与SOURCE-MANIFEST.json。Node.js测试和必要脚本随本次公开源码更新，可用下文命令复现。

本地1.4.5回归已通过248项Node测试和11项扩展脚本语法检查。此次公开候选目录已重新运行 `npm test` 与 `npm run check`：248项通过、0失败、0跳过、0取消，11个扩展脚本语法检查全部通过。

本轮新增回归覆盖：4个挂起表情请求离场后释放加载名额、在屏慢资源保留、晚到图像释放；同一播放器更换弹幕容器后的播放/暂停重绑；面板每次更改立即保存、旧回执逆序、同步异常及刷新等待全部保存完成。

此前独立Edge155.0.4283.62的受控MV3验收通过18组直播检查、24组原生弹窗保存检查和4组呈现恢复检查。直播检查包含文字与静图/GIF/WebP/APNG、固定/滚动、暂停冻结、尺寸/全屏、播放器替换及资源失败。保存检查中20轮快速关闭均保存最后一项；另有2轮人为延迟回执和2组各20次快照检查。测试浏览器、页面及媒体均独立，未操作用户直播或小黄鸭设置。

呈现恢复验收使用明确标记的synthetic 2:1帧计数，只验证现有回调内的两次绘制还原和同VIDEO一次预算；不把模拟计数当作真实60帧解码或小黄鸭性能。直播1.4.4的同页现场短暂调整恢复观察，是另一类证据，也未把它认定为所有30/90或26/77的共同原因。

公开源码不包含依赖旧开发Git历史、特定浏览器配置的全部辅助脚本与原始采样产物。上述浏览器结果是此前本地版本的受控验证记录，不冒充本次上传时重新执行了所有浏览器测试。公开安装包构建时另核验脚本清单、18个扩展文件的来源SHA256与ZIP完整性。

## 1.3.13公开源码检查（历史记录）

开发者可使用 Node.js 22 或更新版本，在仓库根目录运行：

```sh
npm test
npm run check
```

`npm test` 使用 Node.js 内置测试框架，不需要下载 npm 依赖，覆盖数据解析、弹幕转换、合成器、同步生命周期、恢复预算、页面动画屏蔽和被动检查工具。`npm run check` 检查七个扩展 JavaScript 文件的语法。

这些检查主要使用受控数据与浏览器接口替身，不等于所有浏览器、硬件、B站页面和 Lossless Scaling 设置的实际效果验证。浏览器更新或B站页面变化后，仍应对同一运动片段进行实际比较。

2026-10-19，使用 Node.js **v22.23.1**、npm **11.9.0** 在公开候选目录实际运行：

| 命令 | 结果 |
| --- | --- |
| `npm test` | 95 项通过，0 失败、0 跳过、0 取消。 |
| `npm run check` | 七个扩展脚本全部通过语法检查，退出码为0。 |

本轮未启动浏览器自动化，也未重新测量 Lossless Scaling 的输入／输出帧数。

## 浏览器实际使用记录

- Microsoft Edge：已有实机验证记录。
- Google Chrome：2026-10-19，用户从公开源码的 `extension/` 目录加载1.3.13，实测后反馈正常使用。具体 Chrome 版本与硬件配置未记录，也未据此推断每项功能、每个版本或全部视频均已通过。
- 其他浏览器：尚未完成验证。

此次文档更新记录用户的实际使用反馈，没有将它描述为本轮重新执行了浏览器自动化或完整兼容性测试。

## 使用与验证边界

- 插件的同步或恢复状态，不能单独证明 Lossless Scaling 成功补帧。
- 计数器升高不能代替实际运动画面对比。
- 真实播放窗口可能仍保留旧脚本；更新扩展后必须完整刷新实际播放窗口。
- 固定模式由B站原生固定文字层承载，密集时可能漏显示；推荐选择滚动模式。

本公开仓库不附带旧开发日志、浏览器用户资料和现场采样产物，也未将原开发历史中的浏览器验证冒充本轮重新运行的结果。
