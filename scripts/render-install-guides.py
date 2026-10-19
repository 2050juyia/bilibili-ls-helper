"""Render the two Chinese installation guides. Requires Pillow; no browser automation.

Run: python scripts/render-install-guides.py
Optional font overrides: --font, --bold-font, --mono-font (TTF/TTC paths).
Official browser references are kept verbatim under docs/assets/reference/.
Folder and popup illustrations are labeled diagrams, not captured browser UI.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "assets"
W = 1440
BG = "#edf5ed"
FG = "#173b32"
SUB = "#4d695f"
ACCENT = "#23745a"
SOFT = "#f0f6f2"
LINE = "#d6e6da"
QUARK = "https://pan.quark.cn/s/4603da61b708"
REPO = "https://github.com/2050juyia/bilibili-ls-helper"
VERSION = "1.3.13"

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--font", default="C:/Windows/Fonts/msyh.ttc")
parser.add_argument("--bold-font", default="C:/Windows/Fonts/msyhbd.ttc")
parser.add_argument("--mono-font", default="C:/Windows/Fonts/consola.ttf")
parser.add_argument("--export-dir", type=Path, help="Optional folder for shareable PNGs and an offline tutorial ZIP")
args = parser.parse_args()
for p in (args.font, args.bold_font, args.mono_font):
    if not Path(p).is_file():
        raise SystemExit("Font not found; supply a TTF/TTC font override: " + p)


def font(size, bold=False, mono=False):
    return ImageFont.truetype(args.mono_font if mono else args.bold_font if bold else args.font, size)


def text(draw, xy, value, size=32, color=FG, bold=False, mono=False):
    draw.text(xy, value, font=font(size, bold, mono), fill=color, anchor="lt")


def paragraph(draw, x, y, value, width, size=30, color=SUB, bold=False, gap=13):
    face = font(size, bold)
    start = y
    for raw in value.split("\n"):
        line = ""
        for ch in raw:
            if line and draw.textlength(line + ch, font=face) > width:
                text(draw, (x, y), line, size, color, bold)
                y += size + gap
                line = ch
            else:
                line += ch
        if line:
            text(draw, (x, y), line, size, color, bold)
        y += size + gap
    return max(y - start, 0)


def badge(draw, x, y, label, fill=ACCENT, radius=24, size=26):
    draw.ellipse((x, y, x + radius * 2, y + radius * 2), fill=fill)
    box = draw.textbbox((0, 0), label, font=font(size, True))
    draw.text((x + radius - (box[2] - box[0]) / 2, y + radius - (box[3] - box[1]) / 2 - box[1]), label,
              font=font(size, True), fill="white")


def folder(draw, x, y, width=66, height=47):
    draw.rounded_rectangle((x, y, x + width * .47, y + height * .30), radius=5, fill="#e2ad43")
    draw.rounded_rectangle((x, y + height * .18, x + width, y + height), radius=5, fill="#f5c763")


def card(draw, y, height, number, title):
    draw.rounded_rectangle((48, y, W - 48, y + height), radius=26, fill="white", outline=LINE, width=2)
    badge(draw, 84, y + 34, str(number))
    text(draw, (148, y + 34), title, 39, bold=True)
    return y + 112


def arrow(draw, x1, y, x2, color=ACCENT):
    draw.line((x1, y, x2, y), fill=color, width=5)
    draw.polygon([(x2, y), (x2 - 15, y - 10), (x2 - 15, y + 10)], fill=color)


def popup_diagram():
    """A labeled tutorial diagram following the actual 1.3.13 popup labels/layout."""
    im = Image.new("RGB", (804, 748), "white")
    d = ImageDraw.Draw(im)
    # Work at 2x source CSS pixels for legible illustration.
    def t(x, y, s, n=13, c="#222c3c", b=False):
        text(d, (x * 2, y * 2), s, n * 2, c, b)
    def toggle(x, y):
        d.rounded_rectangle((x * 2, y * 2, (x + 36) * 2, (y + 21) * 2), radius=21, fill="#4268c5")
        d.ellipse(((x + 18) * 2, (y + 3) * 2, (x + 33) * 2, (y + 18) * 2), fill="white")
    icon = Image.open(ROOT / "extension" / "icons" / "icon128.png").convert("RGBA")
    icon.thumbnail((72, 72), Image.Resampling.LANCZOS)
    im.paste(icon, (40, 28), icon)
    t(67, 26, "B站小黄鸭插帧助手", 17)
    t(306, 29, "已开启", 11, "#667184")
    toggle(345, 24)
    d.line((0, 130, 804, 130), fill="#e9ecf1", width=2)
    t(20, 95, "弹幕显示方式")
    d.rounded_rectangle((478, 164, 764, 230), radius=14, outline="#dfe5ef", width=2)
    t(250, 95, "滚动弹幕", 12)
    d.line((728, 196, 736, 204, 744, 196), fill="#222c3c", width=3)
    d.line((40, 276, 764, 276), fill="#e9ecf1", width=2)
    t(20, 160, "减少页面动画")
    t(20, 184, "选集图标与顶部轮播 · 立即生效", 11, "#667184")
    toggle(345, 161)
    d.polygon([(40, 438), (40, 451), (50, 445)], fill="#667184")
    t(29, 219, "使用说明", 11, "#667184")
    t(20, 249, "设置已保存，请刷新视频应用。", 11, "#946016")
    d.rounded_rectangle((40, 548, 764, 642), radius=18, fill="#4268c5")
    d.arc((196, 578, 220, 602), 40, 320, fill="white", width=3)
    d.polygon([(220, 580), (220, 589), (211, 583)], fill="white")
    t(119, 290, "刷新视频，应用设置", 14, "white")
    d.line((0, 678, 804, 678), fill="#e9ecf1", width=2)
    t(20, 350, "设置自动保存到本机", 11, "#667184")
    t(346, 350, VERSION, 11, "#667184")
    return im


def render(browser):
    is_edge = browser == "edge"
    name = "Microsoft Edge" if is_edge else "Google Chrome"
    address = "edge://extensions" if is_edge else "chrome://extensions"
    dev = "开发人员模式" if is_edge else "开发者模式"
    load = "加载解压缩的扩展" if is_edge else "加载已解压的扩展程序"
    im = Image.new("RGB", (W, 5000), BG)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, 242), fill=FG)
    text(d, (66, 34), "B站小黄鸭插帧助手", 31, "#d5eddb")
    text(d, (62, 88), ("Edge" if is_edge else "Chrome") + " 安装教程", 65, "white", True)
    text(d, (66, 180), "Windows 电脑 · 从 ZIP 安装 · 适用插件 " + VERSION, 29, "#d5eddb")
    icon = Image.open(ROOT / "extension" / "icons" / "icon128.png").convert("RGBA")
    icon = icon.resize((135, 135), Image.Resampling.LANCZOS)
    im.paste(icon, (W - 217, 53), icon)
    y = 270

    cy = card(d, y, 460, 1, "下载 ZIP，并全部解压")
    text(d, (86, cy), "获取地址", 27, SUB)
    d.rounded_rectangle((86, cy + 43, W - 86, cy + 111), radius=13, fill=SOFT)
    text(d, (108, cy + 57), QUARK, 33, ACCENT, mono=True)
    text(d, (86, cy + 139), "下载 bilibili-danmaku-assistant-v1.3.13.zip", 31)
    d.rounded_rectangle((86, cy + 193, 605, cy + 270), radius=13, fill="#f7f8fa")
    text(d, (109, cy + 215), "右键 ZIP → 全部解压缩", 31, bold=True)
    arrow(d, 632, cy + 232, 717)
    folder(d, 755, cy + 207)
    text(d, (846, cy + 215), "放在固定目录", 31, bold=True)
    text(d, (86, cy + 299), "例如 D:\\BrowserExtensions；安装后保留文件夹，不随意移动或删除。", 26, SUB)
    y += 484

    ref = Image.open(ASSETS / "reference" / (browser + "-official.png")).convert("RGB")
    if not is_edge:
        # Crop out the official Hello Extensions example card, retaining real controls.
        ref = ref.crop((0, 0, ref.width, 219))
    refw = 1200
    refh = round(ref.height * refw / ref.width)
    h = 350 + refh + 73
    cy = card(d, y, h, 2, "打开扩展管理页，开启开发模式")
    d.rounded_rectangle((86, cy, W - 86, cy + 75), radius=12, fill="#f5f7f8", outline=LINE, width=2)
    text(d, (107, cy + 22), "地址栏输入", 29, SUB)
    text(d, (297, cy + 20), address, 36, ACCENT, True, mono=True)
    text(d, (W - 202, cy + 23), "按回车", 27, SUB)
    text(d, (86, cy + 104), "① 开启「" + dev + "」", 30, bold=True)
    text(d, (650, cy + 104), "② 点击「" + load + "」", 30, bold=True)
    text(d, (86, cy + 157), "下方为官方界面截图；英文按钮对应以上中文名称。", 25, SUB)
    im.paste(ref.resize((refw, refh), Image.Resampling.LANCZOS), (120, cy + 211))
    text(d, (86, cy + 233 + refh), "按钮位置可能随版本变化；Edge 部分版本会显示不同的中文译名。" if is_edge else
         "开发者模式在右上角；开启后，再点击左侧出现的加载按钮。", 25, SUB)
    y += h + 24

    cy = card(d, y, 740, 3, "选对文件夹：先在资源管理器核对")
    paragraph(d, 86, cy, "进入解压后的文件夹，找到 manifest.json。浏览器要加载的就是直接包含它的这一层。", 1268, 31)
    d.rounded_rectangle((86, cy + 115, W - 86, cy + 375), radius=19, fill=SOFT, outline=LINE, width=2)
    text(d, (112, cy + 135), "解压工具可能另加一层外部目录；继续往里找：", 27, SUB)
    folder(d, 122, cy + 194, 49, 35)
    text(d, (190, cy + 194), "bilibili-fixed-danmaku", 35, FG, True, mono=True)
    text(d, (870, cy + 199), "← 选择这一层", 31, ACCENT, True)
    text(d, (194, cy + 258), "├─ manifest.json", 32, FG, mono=True)
    text(d, (194, cy + 309), "└─ icons / ...", 30, SUB, mono=True)
    paragraph(d, 86, cy + 413, "核对后复制资源管理器地址栏路径，在浏览器的文件夹选择窗口中粘贴，点击「选择文件夹」确认加载。", 1268, 30)
    d.rounded_rectangle((86, cy + 513, W - 86, cy + 600), radius=13, fill="#fff5df")
    paragraph(d, 108, cy + 530, "选择窗口可能只显示 icons 子目录，这是正常的。留在当前目录确认，不要进入 icons。", 1216, 27, "#73591f", gap=9)
    y += 764

    cy = card(d, y, 325, 4, "从工具栏的扩展菜单打开插件")
    d.rounded_rectangle((86, cy + 7, W - 86, cy + 105), radius=17, fill=SOFT)
    text(d, (116, cy + 38), "扩展菜单", 33, bold=True)
    arrow(d, 310, cy + 56, 392)
    small_icon = icon.resize((52, 52), Image.Resampling.LANCZOS)
    im.paste(small_icon, (426, cy + 30), small_icon)
    text(d, (504, cy + 38), "B站小黄鸭插帧助手", 34, bold=True)
    paragraph(d, 86, cy + 140, "可选择「在工具栏中显示」，方便下次打开。" if is_edge else
              "Chrome 的菜单图标像拼图；点击插件旁的图钉，可固定到工具栏。", 1268, 30)
    y += 349

    cy = card(d, y, 697, 5, "先打开 B站视频页，再应用设置")
    states = [("顶部开关", "保持「已开启」"), ("弹幕显示方式", "手动选择「滚动弹幕」"),
              ("减少页面动画", "开启"), ("最后点击", "刷新视频，应用设置")]
    for i, (label, value) in enumerate(states):
        yy = cy + 42 + i * 108
        badge(d, 92, yy, str(i + 1), radius=20, size=23)
        text(d, (151, yy), label, 29, SUB)
        text(d, (151, yy + 43), value, 32, bold=True)
    text(d, (863, cy + 8), "推荐设置示意 · " + VERSION, 24, SUB)
    panel = popup_diagram()
    panel = panel.resize((455, round(panel.height * 455 / panel.width)), Image.Resampling.LANCZOS)
    im.paste(panel, (856, cy + 54))
    d.rounded_rectangle((853, cy + 51, 1315, cy + 58 + panel.height), radius=8, outline=LINE, width=3)
    paragraph(d, 86, cy + 500, "第一次安装需要手动选滚动模式。若刷新按钮灰色，先切到B站普通视频页或番剧播放页。", 1268, 27, SUB, gap=10)
    y += 721

    cy = card(d, y, 352, 6, "另行运行小黄鸭，并启动插帧")
    paragraph(d, 86, cy + 7, "本插件需配合 Lossless Scaling 使用，本身不生成中间帧。请按小黄鸭说明启动插帧；仅打开软件还不够。播放后移开鼠标，等待控制栏消失。", 1268, 30)
    paragraph(d, 86, cy + 163, "独立播放窗口也要刷新；帧数计数器升高不等于实际补帧成功。", 1268, 27, ACCENT, True)
    y += 376

    d.rounded_rectangle((48, y, W - 48, y + 153), radius=23, fill="#dcebe0")
    text(d, (86, y + 25), "固定弹幕是可选功能", 31, bold=True)
    paragraph(d, 86, y + 78, "会把滚动弹幕转换为固定文字，密集时可能漏显示；无此需求直接用滚动弹幕。", 1268, 25)
    y += 180
    text(d, (58, y), "图源：" + ("Microsoft Learn" if is_edge else "Chrome for Developers") + " 官方截图；文件夹与设置面板为教学示意。", 22, SUB)
    text(d, (58, y + 39), "详细文字步骤、问题排查与图源链接见配套教程。制作日期：2026-10-19", 22, SUB)
    y += 88
    if y > im.height:
        raise RuntimeError("Canvas exceeded: " + str(y))
    result = im.crop((0, 0, W, y))
    dest = ASSETS / ("install-" + browser + ".png")
    result.save(dest, optimize=True)
    return {"browser": name, "path": dest.relative_to(ROOT).as_posix(), "width": W,
            "height": y, "bytes": dest.stat().st_size,
            "sha256": hashlib.sha256(dest.read_bytes()).hexdigest()}


def preview():
    page = """<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>B站小黄鸭插帧助手 · 安装图解</title><style>
*{box-sizing:border-box}body{margin:0;background:#edf5ed;color:#173b32;font:16px/1.7 'Microsoft YaHei',system-ui,sans-serif}
header{max-width:1040px;margin:32px auto 0;padding:0 24px}h1{font-size:29px;margin:0 0 8px}p{margin:8px 0 18px;color:#4d695f}
nav{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}button,.action{border:1px solid #bdd4c3;border-radius:10px;padding:9px 18px;font:inherit;background:white;color:#173b32;text-decoration:none;cursor:pointer}
button[aria-selected=true]{background:#23745a;color:white;border-color:#23745a}.downloads{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px}main{max-width:1040px;margin:auto;padding:0 24px}img{display:block;width:100%;height:auto;border-radius:14px;box-shadow:0 8px 26px #163c3214}
footer{max-width:1040px;margin:24px auto;padding:0 24px 48px;color:#4d695f}a{color:#23745a}button:focus-visible,a:focus-visible{outline:3px solid #d8ae43;outline-offset:4px}
</style><header><h1>从安装包安装 · Edge / Chrome</h1><p>Windows 电脑适用。先选浏览器，再按图操作；两份长图均可保存。插件需配合 Lossless Scaling 使用。</p>
<nav role="tablist" aria-label="选择浏览器"><button role="tab" aria-selected="true" data-browser="edge">Microsoft Edge</button><button role="tab" aria-selected="false" data-browser="chrome">Google Chrome</button></nav>
<div class="downloads"><a class="action" id="png-download" href="assets/install-edge.png" download>保存 Edge 安装长图</a><a class="action" href="https://pan.quark.cn/s/4603da61b708" target="_blank" rel="noreferrer">获取插件安装包</a></div></header>
<main><img id="guide" src="assets/install-edge.png" alt="Edge 从ZIP安装B站小黄鸭插帧助手：下载、解压、加载文件夹与推荐设置"></main>
<footer><p>浏览器界面采用官方文档截图；文件夹和推荐设置面板为教学示意，并非本轮实机安装截图。按钮位置、译名可能随浏览器版本变化。</p>
<p>完整文字教程：<a href="install-edge.zh-CN.md">Edge</a> · <a href="install-chrome.zh-CN.md">Chrome</a> · <a href="assets/SOURCES.md">图源与复现说明</a></p>
<p>找不到 manifest？先在文件资源管理器核对目录；浏览器的文件夹选择窗口可能只显示 icons，这是正常的。加载后应保留解压目录。</p></footer>
<script>for(const b of document.querySelectorAll('[data-browser]'))b.addEventListener('click',()=>{let n=b.dataset.browser,label=n==='edge'?'Edge':'Chrome';for(const x of document.querySelectorAll('[data-browser]'))x.setAttribute('aria-selected',String(x===b));let img=document.getElementById('guide');img.src='assets/install-'+n+'.png';img.alt=label+' 从ZIP安装教程';let a=document.getElementById('png-download');a.href=img.src;a.textContent='保存 '+label+' 安装长图';});</script></html>"""
    (ROOT / "docs" / "install.html").write_text(page, encoding="utf-8")


ASSETS.mkdir(parents=True, exist_ok=True)
rows = [render("edge"), render("chrome")]
preview()
manifest = {"version": VERSION, "date": "2026-10-19", "outputs": rows,
            "references": [{"path": p.relative_to(ROOT).as_posix(), "bytes": p.stat().st_size,
                            "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                           for p in sorted((ASSETS / "reference").glob("*.png"))]}
(ROOT / "docs" / "install-guide-manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
if args.export_dir:
    args.export_dir.mkdir(parents=True, exist_ok=True)
    for browser, label in [("edge", "Edge"), ("chrome", "Chrome")]:
        shutil.copy2(ASSETS / ("install-" + browser + ".png"), args.export_dir / (label + "_安装教程_v1.png"))
    archive = args.export_dir / "安装教程_Edge与Chrome_v1.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for p in sorted((ROOT / "docs").rglob("*")):
            if p.is_file():
                bundle.write(p, "安装图文教程/" + p.relative_to(ROOT / "docs").as_posix())
        bundle.writestr("先读我.txt", "这是安装图文教程文件包，不包含插件运行文件。\n解压后打开“安装图文教程/install.html”查看。\n插件安装包：" + QUARK + "\n源码与更新：" + REPO + "\n")
    with zipfile.ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise SystemExit("Offline tutorial ZIP failed its integrity check")
    print("Offline tutorial ZIP: " + str(archive))
print(json.dumps({"version": VERSION, "outputs": rows}, ensure_ascii=False, indent=2))
