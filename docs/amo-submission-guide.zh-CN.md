# Firefox 官方商店（AMO）公开上架与签名导出指南

本清单用于将 `B站小黄鸭插帧助手` 提交至 Mozilla 官方附加组件商店（[AMO Developer Hub](https://addons.mozilla.org/developers/)）进行**公开上架（Public Listed）**，并同时获取可在正式版 Firefox 永久安装的 `.xpi` 数字签名文件。

---

## 一、提交前准备（已由打包脚本自动就绪）

运行仓库打包命令（基于已提交的 Git `HEAD`）：

```powershell
python scripts/package.py
```

在 `dist/` 目录下会生成两份不同结构的压缩包，**上传 Mozilla 后台时请务必选择带 `-firefox.zip` 后缀的专用包**：

- **上传文件：** `dist/bilibili-danmaku-assistant-v1.5.0-firefox.zip`
- **已内置合规项：**
  - `manifest.json` 位于压缩包根目录（无外层子文件夹）
  - 已剔除 Chromium 专属字段 `minimum_chrome_version`，零 Linter 警告
  - 唯一扩展 ID：`bilibili-ls-helper@2050juyia.github.io`
  - 最低桌面版要求：`strict_min_version: "140.0"`
  - 隐私与数据收集声明：`data_collection_permissions: { "required": ["none"] }`（声明零数据收集与外传，免填隐私政策）
- **是否需要额外上传“源代码包（Source Code）”？**
  - **不需要**，在询问 *“Do you need to submit source code?”* 时选择 **No（否）**。因为本扩展全部 11 个 `.js` 文件均为未经 Webpack/Rollup 打包、未压缩混淆的原生可读 JavaScript 源码。

---

## 二、上传与分发渠道步骤

1. 打开 [https://addons.mozilla.org/developers/](https://addons.mozilla.org/developers/)，使用 Firefox 账号免费登录（首次登录按提示确认开发者协议，完全免费）。
2. 点击 **Submit a New Add-on（提交新附加组件）**。
3. 在 *How to Distribute this Version（如何分发此版本）* 页面：
   - 选择 **On this site（在此网站上分发）** —— 即公开上架 Firefox 商店，支持用户搜索、一键安装与自动更新。
4. 在上传页面选择 `dist/bilibili-danmaku-assistant-v1.5.0-firefox.zip`，等待自动静态验证（Validation）变为绿色通过，点击 **Continue**。
5. 当询问 *Do you need to submit source code?* 时，选择 **No** 并继续。

---

## 三、可直接复制粘贴的商店表单文案

### 1. 名称（Name）
```text
B站小黄鸭插帧助手
```

### 2. 附加组件网址后缀（Add-on URL slug）
```text
bilibili-ls-helper
```
*(最终商店地址形如：`https://addons.mozilla.org/zh-CN/firefox/addon/bilibili-ls-helper/`)*

### 3. 一句话摘要（Summary，限 250 字符以内）
```text
配合桌面端 Lossless Scaling（小黄鸭）使用的B站辅助扩展：支持B站视频、番剧与直播文字及表情弹幕随视频帧同步合成，并提供播放动态图标与页面外围动画抑制，减少网页无关刷新对补帧采样的干扰。
```

### 4. 详细介绍（Description，支持基础 Markdown / 纯文本）
```markdown
给桌面端 Firefox 浏览器使用的 Lossless Scaling（小黄鸭）配套辅助扩展，支持哔哩哔哩（bilibili.com）普通视频、番剧播放页以及数字房间号直播间（live.bilibili.com）。

【核心作用】
网页中独立于视频帧刷新的弹幕动画、选集播放动态图标与页面轮播，容易干扰窗口补帧软件的帧率判断。本扩展通过两项机制改善观看体验（插件本身不生成中间帧，需配合 Lossless Scaling 使用）：

1. 滚动弹幕随视频帧同步合成：在视频帧回调（requestVideoFrameCallback）中将视频画面与普通文字弹幕（直播另支持静态及 GIF/APNG/WebP 表情）统一合成到单张画布呈现，暂停时停止刷新。
2. 固定弹幕可选转换：可将普通滚动弹幕转换为顶部、底部或上下分配的固定文字显示。
3. 减少页面动画（立即生效）：统一隐藏新旧版播放指示动态图标、停用顶部轮播，并在直播播放器全屏时隔离已识别的外围页面更新，退出全屏或关闭开关后自动恢复。

【推荐设置】
1. 打开B站视频、番剧或直播间，点击工具栏中的「B站小黄鸭插帧助手」图标。
2. 开启顶部总开关，将「弹幕显示方式」设为「滚动弹幕」，并开启「减少页面动画」。
3. 点击「刷新视频，应用设置」，随后启动 Lossless Scaling 并移开鼠标等待播放器控制栏隐藏。

【隐私与权限说明】
- 仅使用 storage（在本地保存开关设置）与 activeTab，并在 www.bilibili.com 与 live.bilibili.com 运行内容脚本。
- 不读取 Cookie 或账号信息，不收集、不上传任何浏览记录、弹幕或遥测数据。
```

### 5. 分类（Categories）与许可证（License）
- **分类（任选最多 2 项）：** `照片、音乐与视频（Photos, Music & Videos）`、`外观（Appearance）`（或 `其他（Other）`）
- **开源许可证（License）：** 选择内置的 **`MIT License`**
- **主页 / 支持网址（Homepage / Support site）：**
  - 主页：`https://github.com/2050juyia/bilibili-ls-helper`
  - 问题反馈：`https://github.com/2050juyia/bilibili-ls-helper/issues`
- **隐私政策（Privacy Policy）：** 留空不勾选（已在 `manifest.json` 声明 `required: ["none"]`，完全不收集外部数据）
- **商店截图建议：** 可直接上传 `work/firefox-ui-1.5.0/popup-firefox.png` 或 `docs/assets/install-firefox.png`。

---

## 四、致审核员说明（Notes to Reviewers，强烈建议粘贴）

AMO 人工抽检审核员通常使用英文界面且没有B站账号。在提交页的 **Notes to Reviewers** 填入以下中英说明，可帮助审核员 1 分钟内免登录验证所有权限与 `world: "MAIN"` 的合法用途：

```text
Testing instructions (No account or login required):
1. Open any public Bilibili video page, e.g. https://www.bilibili.com/video/BV1GJ411x7h7 or any live room at https://live.bilibili.com/ .
2. Click the toolbar action icon ("B站小黄鸭插帧助手"), set the dropdown ("弹幕显示方式") to the second option ("滚动弹幕" / video-sync), toggle on the second switch ("减少页面动画"), and click the blue reload button.
3. Play the video: ordinary danmaku comments are composited synchronously per video frame via HTMLVideoElement.requestVideoFrameCallback + OffscreenCanvas.

Technical notes on manifest choices:
- content_scripts with world: "MAIN" at document_start are used strictly on https://www.bilibili.com/* and https://live.bilibili.com/* to synchronize with Bilibili's page-world player instance (window.player / window.livePlayer) and rewrite danmaku display mode bytes locally when fixed-danmaku mode is selected.
- All JavaScript files in the archive are human-readable, unminified ES2022 source files with zero build/transpile step, zero remote code execution, and zero external network telemetry (data_collection_permissions: none).
```

---

## 五、过审后导出签名 `.xpi` 与回填链接

1. **下载 `.xpi` 放入 GitHub Releases：**
   - 登录 AMO 开发者后台 → 进入该扩展的 **Manage Status & Versions（管理状态与版本）** → 点开 `1.5.0` 版本详情页。
   - 点击文件链接下载签好名的 `.xpi` 文件（可重命名为 `bilibili-danmaku-assistant-v1.5.0-firefox.xpi`），作为附件一并上传至 GitHub Releases，方便不便访问商店的用户离线永久安装。
2. **回填商店链接（可选）：**
   - 公开审核通过后，可将商店正式 URL 补充到 `README.md` 与 `docs/install-firefox.zh-CN.md` 的「Firefox 官方商店」条目中。
