# 公开版本来源

## 1.5.3（2026-11-24）

基于 1.5.0 提交 `9efe9829122ccc10eddd767d3ec75a880e2a7618`（其公开主干基线为 1.4.5 提交 `f168acfc95374cfcdc9245ea3e3d214cb6c82cba`）合入 1.5.1–1.5.3 的默认设置调整、点播 SPA 连播重绑与 Chromium 60fps 帧率修复、AI 智能防挡弹幕蒙版与底部阴影进度条抑制，以及直播跨房广播横幅与全屏／网页全屏外围隔离。

相对于 1.4.5 公开基线，`extension/` 目录的修改与新增涉及 `bridge.js`、`compositor.js`、`core.js`、`hook.js`、`live-compositor.js`、`live-periphery.js`、`live-sync.js`、`manifest.json`、`playlist-indicator.js`、`popup.css`、`popup.html`、`popup.js`、`video-sync.js` 与 `webgl-surface.js`，全部 19 个扩展运行文件的当前 SHA256 记录于 `SOURCE-MANIFEST.json`。双端安装包由已提交 `HEAD` 通过 `scripts/package.py` 构建，产物的精确字节数与 SHA256 记录于 `RELEASE-ARTIFACT.json`。

## 1.5.0（2026-11-21）

基于已验收的 1.4.6 提交 `b2f28183ad43e777f4e56de4e99a28be1f1d224f`（其上游公开基线为 1.4.5 提交 `f168acfc95374cfcdc9245ea3e3d214cb6c82cba`）增加桌面端 Mozilla Firefox（140+）适配与双端分流构建。

本次扩展目录 `extension/` 修改涉及 `bridge.js`、`playlist-indicator.js`、`live-periphery.js`、`popup.js`、`popup.css`、`compositor.js`、`video-sync.js`、`live-sync.js` 与版本号 `manifest.json`，全部 18 个文件的当前 SHA256 记录于 `SOURCE-MANIFEST.json`。打包脚本 `scripts/package.py` 从已提交 `HEAD` 同时生成 Chromium 目录结构 ZIP 与 Firefox/AMO 根目录结构 `-firefox.zip`（Firefox 包内 `manifest.json` 由 `scripts/firefox_manifest.py` 确定性派生，其余脚本与图标字节一致）。

## 1.4.6（2026-11-15，本地交付）

基于公开1.4.5提交 `f168acfc95374cfcdc9245ea3e3d214cb6c82cba` 增加共用播放指示图标规则。该基线的扩展文件树为 `9005679e0f66be2b2ea57b8de9871760b33b55ed`，与本地交付快照 `ba0c8edfdf9caaec8b2e7cb53c34fba6fc25ea19` 一致。

本次扩展文件修改涉及 `playlist-indicator.js`、面板说明 `popup.html` 和版本号 `manifest.json`，当前扩展哈希记录在 `SOURCE-MANIFEST.json`。1.4.5的历史来源清单可从该公开提交读取。

此前基于旧发布副本制作的1.3.14播放图标包采用了1.3.13基线，遗漏后续直播与可靠性更新，已作废。此次1.4.6重新从上述1.4.5基线实现并验收。

## 1.4.5（2026-10-22）

本次在现有公开仓库历史上更新源码快照，对应本地已提交版本：

```text
本地交付快照：ba0c8edfdf9caaec8b2e7cb53c34fba6fc25ea19
运行代码来源：77014907f5dd4ebd9c6be0fbc8f15b1195d44d2f
```

1.4.5提交中 `extension/` 的18个运行文件、manifest与图标逐字节对应本地1.4.5，并更新了Node.js回归测试和必要的被动检查工具。该版本保留公开仓库的许可、图文安装指南和原有提交历史，来源记录对应已提交快照。历史逐文件哈希见 [1.4.5来源清单](https://github.com/2050juyia/bilibili-ls-helper/blob/f168acfc95374cfcdc9245ea3e3d214cb6c82cba/SOURCE-MANIFEST.json)。

公开安装包由本仓库已提交HEAD使用 `scripts/package.py` 构建，包含公开安装说明、LICENSE与第三方说明。它与开发机安装包的说明文件及ZIP哈希不同，扩展运行文件完全相同；发布资产中的 `release-manifest.json` 记录公开构建提交和SHA256。未附带开发机路径清单、浏览器用户资料、缓存或现场日志。

## 首个公开版本1.3.13

本仓库首个公开版本是原私有／本地项目 **1.3.13** 的已提交快照，原提交为：

```text
2bb8be854d7076f5398e6828fd04780e73be4312
```

本次公开准备整理了 README、安装说明、更新摘要、MIT 许可、第三方说明、包元数据及打包脚本；选择保留复现 Node.js 测试所需的开发文件。`extension/` 内的运行代码、manifest、图标等文件与上述原提交逐字节一致。

旧开发机路径、浏览器用户资料、验证缓存和旧开发日志没有作为公开源码内容带入。公开仓库从这次快照建立新的版本历史，不声称包含原项目的全部开发历史，也不把本次首个公开提交伪装成原始开发提交。

本项目由 **2050juyia** 公开维护。原创源代码与项目自制图标采用 MIT 许可；第三方名称、商标、角色参考图和演示视频不因此获得授权，见 `THIRD_PARTY_NOTICES.md`。
