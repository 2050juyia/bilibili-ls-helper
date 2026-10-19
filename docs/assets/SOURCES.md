# 安装图解来源与复现

## 图片与示意图

- `reference/edge-official.png`：微软官方 Edge 本地安装文档中的真实界面截图。来源页面：<https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading>；原图：<https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading-images/developermode-toggle.png>。
- `reference/chrome-official.png`：Google 官方 Hello World 教程中的真实扩展管理页截图。来源页面：<https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world>；原图：<https://developer.chrome.com/static/docs/extensions/get-started/tutorial/hello-world/image/extensions-page-e0d64d89a6acf.png>。教学长图只截取上方开发者模式和加载按钮，未保留示例扩展卡片。
- 官方截图保留原始字节；长图中仅缩放展示或截取控件区域，中文步骤标注位于截图外部。官方示例为英文，教程给出对应中文按钮名。
- 文件夹结构、菜单路径与设置面板为本项目制作的教学示意。推荐设置面板的标签和布局按1.3.13的 `popup.html`、`popup.css` 核对；展示推荐设置，不是声称捕获到了实际安装成功后的状态。
- 项目鸭子图标来自 `extension/icons/icon128.png`。

第三方官方截图的权利属于对应权利人，不因本仓库MIT源码许可而重新许可。项目自己的文字、标注和绘图脚本采用本仓库许可。

## 适用范围

教程针对Windows桌面版Edge、Chrome及1.3.13安装包。后续浏览器的按钮位置、译名、Windows解压菜单可能不同，应按名称核对。图解不是本轮在用户电脑重新安装插件的实拍记录。

## 复现

需要Python 3.9+、Pillow（`scripts/requirements-docs.txt`）。在仓库根目录运行：

```sh
python scripts/render-install-guides.py
```

如需同时生成便于放进网盘的两张独立长图和离线教程ZIP，可以追加 `--export-dir <输出目录>`。离线ZIP仅为教程，不包含插件运行文件，也不会覆盖插件安装包。

默认读取Windows微软雅黑和Consolas字体；其他系统可以用 `--font`、`--bold-font`、`--mono-font` 指定本机具有中文字符的TTF/TTC字体。脚本输出两张PNG与 `docs/install.html`，不控制浏览器、不下载依赖、不改插件运行文件。

文档图片是必要的教程资产，保留在Git中；临时审阅缩略图、导出副本、日志与视频工程内的核验记录不放进公开源码仓库。
