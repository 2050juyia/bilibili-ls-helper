# Edge：从ZIP安装B站小黄鸭插帧助手

适用于Windows电脑上的Microsoft Edge。本插件需要配合Lossless Scaling（小黄鸭）使用，本身不生成中间帧。

当前版本为 **1.4.5**，支持视频、番剧与直播。下方长图保留原教程与图源，安装基本操作不变；图中旧版本、旧下载入口以本文的Release说明为准。

![Edge从ZIP安装与设置图解](assets/install-edge.png)

浏览器部分使用官方文档的真实界面截图；文件夹和推荐设置面板为教学示意，并非本轮在用户电脑重新安装的截图。浏览器版本不同，按钮文字和位置可能略有变化。[图源与复现说明](assets/SOURCES.md)

## 1. 下载并解压

推荐使用Release安装包，也可从源码安装：

- **Release安装包（推荐）：**打开[最新版发布页](https://github.com/2050juyia/bilibili-ls-helper/releases/latest)，或直接下载 [bilibili-danmaku-assistant-v1.4.5.zip](https://github.com/2050juyia/bilibili-ls-helper/releases/download/v1.4.5/bilibili-danmaku-assistant-v1.4.5.zip)。
- **GitHub源码包：**打开[2050juyia/bilibili-ls-helper](https://github.com/2050juyia/bilibili-ls-helper)，点击 **Code → Download ZIP**。解压后加载里面的 `extension` 文件夹，不要选择整个源码目录。
- **备用旧入口：**[夸克网盘](https://pan.quark.cn/s/4603da61b708)可能仍是旧版，未确认已同步更新；以Release版本为准。

在Windows文件资源管理器中右键点击ZIP，选择「全部解压缩／全部解压」。解压到以后不会随手清理的固定目录，例如 `D:\BrowserExtensions`。安装后仍要保留解压出的文件夹；不能只留下ZIP，也不要随意移动文件夹。

## 2. 在Edge加载文件夹

1. 把 `edge://extensions` 复制到Edge地址栏，按回车。
2. 开启「开发人员模式」。
3. 点击「加载解压缩的扩展」（部分版本显示「加载已解压的扩展程序」）。
4. 根据下载来源选择目录：**Release安装包选 `bilibili-fixed-danmaku`；GitHub源码包选解压目录里的 `extension`**。确认选中的文件夹直接包含 `manifest.json`。

```text
Release包：bilibili-fixed-danmaku/    ← 选择这一层
GitHub源码包：源码解压目录/extension/  ← 选择这一层

所选目录内应直接包含：manifest.json、popup.html、icons/ 等
```

不是选择ZIP，也不是选择外层下载目录。若解压工具又套了一层同名文件夹，请继续往里找，直到能直接看到 `manifest.json`。

Windows若隐藏扩展名，文件可能显示为 `manifest`；这里只用它核对目录，不需要双击或修改这个文件。

建议先在资源管理器核对目录并复制地址栏路径，再到浏览器的文件夹选择窗口粘贴路径并确认。**文件夹选择窗口可能只显示 `icons` 子目录，不显示 `manifest.json` 等文件，这是正常的；留在当前插件目录确认，不要再进入 `icons`。**

## 3. 找到插件并应用设置

Edge出现「B站小黄鸭插帧助手」卡片后，先打开一个B站视频或直播页。点击浏览器工具栏的「扩展」菜单，找到这个名称并打开；可选择「在工具栏中显示」，方便以后使用。

在插件面板中依次操作：

1. 打开总开关。
2. 「弹幕显示方式」选择**滚动弹幕**。
3. 开启**减少页面动画**。
4. 点击**刷新视频，应用设置**，等待视频页重新加载。

然后另行运行Lossless Scaling，并按其说明启动插帧；仅打开软件不等于已开始插帧。播放视频、移开鼠标并等待控制栏消失，再观察实际运动画面。计数器升高不代表补帧已经成功。

「固定弹幕」是可选显示方式，会把普通滚动弹幕改成固定文字；密集时可能有部分漏显示。没有这个需求，直接使用滚动弹幕。

直播选择「滚动弹幕」可让文字和图片表情随视频帧更新；动图依赖浏览器解码与资源限额，失败显示占位或降级静帧。「减少页面动画」还会在直播播放器全屏时隔离已识别的B站外围区域，退出全屏或关闭设置后恢复。自己发送的弹幕保留原生蓝框。直播其他互动特效及小黄鸭产生的文字伪影不在保证范围内，完整限制见[README](../README.md#支持范围与限制)。

## 常见问题

**提示找不到或无法加载清单？** 多数是选错目录。Release包选 `bilibili-fixed-danmaku`，GitHub的 **Code → Download ZIP** 源码包选其中的 `extension`；两者都要选直接包含 `manifest.json` 的那一层。

**装好却找不到图标？** 在Edge的「扩展」菜单中找「B站小黄鸭插帧助手」，设置为在工具栏显示；图标没固定不代表没安装。

**改完设置或更新后没变化？** 刷新实际播放视频的窗口。更新文件后还需先在扩展管理页点击「重新加载」；独立播放器窗口也要完整刷新，只切选集不够。

**仍然不流畅怎么办？** 确认小黄鸭已运行，暂时关闭其他弹幕或播放器增强扩展进行对照。插件不处理网络缓冲，也不保证适用于所有设备和故障；可带浏览器、插件与小黄鸭版本及复现步骤到[Issues](https://github.com/2050juyia/bilibili-ls-helper/issues)反馈。
