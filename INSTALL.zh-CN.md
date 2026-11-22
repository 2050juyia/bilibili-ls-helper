# B站小黄鸭插帧助手：安装与使用

当前版本为 **1.5.0**，包含桌面端 Mozilla Firefox（140+）完整适配，以及新版番剧、电影等页面的共用播放指示图标屏蔽规则。更新后重载扩展、完整刷新视频或直播页，打开“减少页面动画”即可生效。

公开已发布版本可在 [GitHub Releases](https://github.com/2050juyia/bilibili-ls-helper/releases/latest) 查找。[夸克网盘](https://pan.quark.cn/s/4603da61b708)为备用旧入口。插件需配合 Lossless Scaling（小黄鸭）使用。

Windows 桌面版 Edge、Chrome、Firefox（160.0.1 受控自动化验收）已有验证记录；不同浏览器版本、片源与硬件配置仍以实际效果为准。

配套图文教程：[Edge](https://github.com/2050juyia/bilibili-ls-helper/blob/main/docs/install-edge.zh-CN.md) / [Chrome](https://github.com/2050juyia/bilibili-ls-helper/blob/main/docs/install-chrome.zh-CN.md) / [Firefox](https://github.com/2050juyia/bilibili-ls-helper/blob/main/docs/install-firefox.zh-CN.md)。

## Edge / Chrome 安装

1. 下载普通安装包 `bilibili-danmaku-assistant-v1.5.0.zip`（不要误选带 `-firefox` 后缀的包），解压到固定目录。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启「开发者模式」，点击「加载已解压的扩展程序」。
4. 选择直接包含 `manifest.json` 的 `bilibili-fixed-danmaku` 文件夹（源码包则选 `extension`）。
5. 刷新已经打开的B站视频或直播页，在扩展菜单打开「B站小黄鸭插帧助手」。

选择文件夹时应直接看到 `manifest.json`，不要选择 ZIP 或上一级目录，加载后仍需保留解压目录。

## Firefox（140+）安装

- **正式版永久安装（推荐）：** 从 Firefox 官方附加组件商店（AMO）一键「添加到 Firefox」，或从 GitHub Releases 下载经 Mozilla 签名的 `.xpi` 文件，在 `about:addons` 右上角齿轮菜单选择「从文件安装附加组件…」。
- **开发调试 / 临时体验：** 在地址栏打开 `about:debugging#/runtime/this-firefox`，点击「临时载入附加组件…」，直接选择 `bilibili-danmaku-assistant-v1.5.0-firefox.zip`（无需解压；注意临时载入在关闭 Firefox 后会自动移除）。

若面板提示「未授予当前B站站点访问权限」，直接点击面板底部按钮授权并刷新页面即可。

## 按视频演示设置

打开总开关 →「弹幕显示方式」选「滚动弹幕」→ 开启「减少页面动画」→「刷新视频，应用设置」。

鼠标移开并等待播放器控制栏消失，再在相同片段比较小黄鸭的实际运动效果。计数器升高不等于补帧成功。

## 从旧版更新

Edge / Chrome 替换原扩展目录文件后，在扩展管理页点击「重新加载」；Firefox 商店版支持自动更新（或重新安装新版 `.xpi` / 重新载入临时包）。更新后务必完整刷新实际播放视频的窗口，独立播放器窗口也要完整刷新；只切换选集不能保证新脚本已加载。

## 范围

适用于电脑浏览器中的B站普通视频、番剧及数字房间号直播页。点播滚动模式主要支持普通文字；直播还支持静态表情及资源、解码能力允许的GIF／APNG／WebP动图，随视频帧更新。加载或解码失败显示占位；动态图片过大或解码能力不足时使用静帧。渐变、其他特效和弹幕悬停等交互暂不支持，直播弹幕层内其他互动特效会暂时不显示，礼物等独立动画不在同步保证范围内。

「减少页面动画」会处理新旧版选集/播放动态图标与顶部部分轮播；在直播播放器全屏时还隔离已识别的B站外围区域，退出全屏或关闭该设置后恢复。自己发送弹幕的原生蓝框会随内容合成。直播启用期间，手动画质切换使用完整切流以刷新备用线路，可能短暂重新缓冲，不强制更改所选画质。

直播呈现异常存在一次短暂合成状态恢复尝试：同一视频实例最多一次，开关助手或切换模式不重置，不保证恢复。插件不消除所有网络缓冲、显卡负载或小黄鸭文字伪影，也不保证所有设备或故障都能恢复补帧。

推荐选择「滚动弹幕」，它也保留原有固定弹幕。只有想把滚动弹幕转换成固定文字时，才选择「固定弹幕」，并在B站允许显示对应位置的固定弹幕。密集场景可能漏显示部分内容；没有这个需求，直接使用滚动模式。初次安装请手动确认模式。停用或卸载后要刷新已有视频页。

若仍无效，记录浏览器/插件/小黄鸭版本、捕获方式与倍数、视频及时间点、弹幕模式和具体表现，再通过仓库 Issues 反馈。不要上传Cookie、账号凭据或完整浏览器配置。
