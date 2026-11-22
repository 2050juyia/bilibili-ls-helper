# -*- coding: utf-8 -*-
"""Render the three Chinese installation guides (Edge, Chrome, Firefox).

Requires Pillow; no browser automation.
Run: python scripts/render-install-guides.py
Optional font overrides: --font, --bold-font, --mono-font (TTF/TTC paths).
Browser screenshots for Edge/Chrome are kept verbatim under docs/assets/reference/.
Folder, Firefox install paths, and popup illustrations are labeled diagrams.
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
RELEASES = REPO + "/releases/latest"
VERSION = json.loads((ROOT / "extension" / "manifest.json").read_text(encoding="utf-8"))["version"]
EDITION = 3
DATE = "2026-11-21"

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
    """A labeled tutorial diagram following the actual popup.html / popup.css layout."""
    im = Image.new("RGB", (804, 748), "white")
    d = ImageDraw.Draw(im)

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
    t(20, 184, "播放图标、顶部与直播外围 · 立即生效", 11, "#667184")
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


def render_settings_and_footer(d, im, icon, y, menu_tip, source_note):
    cy = card(d, y, 325, 4, "从工具栏的扩展菜单打开插件")
    d.rounded_rectangle((86, cy + 7, W - 86, cy + 105), radius=17, fill=SOFT)
    text(d, (116, cy + 38), "扩展菜单", 33, bold=True)
    arrow(d, 310, cy + 56, 392)
    small_icon = icon.resize((52, 52), Image.Resampling.LANCZOS)
    im.paste(small_icon, (426, cy + 30), small_icon)
    text(d, (504, cy + 38), "B站小黄鸭插帧助手", 34, bold=True)
    paragraph(d, 86, cy + 140, menu_tip, 1268, 30)
    y += 349

    cy = card(d, y, 697, 5, "先打开 B站视频或直播页，再应用设置")
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
    paragraph(d, 86, cy + 500, "第一次安装需要手动选滚动模式。若刷新按钮灰色，先切到B站普通视频、番剧或直播页。", 1268, 27, SUB, gap=10)
    y += 721

    cy = card(d, y, 352, 6, "另行运行小黄鸭，并启动插帧")
    paragraph(d, 86, cy + 7, "本插件需配合 Lossless Scaling 使用，本身不生成中间帧。请按小黄鸭说明启动插帧；仅打开软件还不够。播放后移开鼠标，等待控制栏消失。", 1268, 30)
    paragraph(d, 86, cy + 163, "独立播放窗口也要刷新；帧数计数器升高不等于实际补帧成功。", 1268, 27, ACCENT, True)
    y += 376

    d.rounded_rectangle((48, y, W - 48, y + 153), radius=23, fill="#dcebe0")
    text(d, (86, y + 25), "固定弹幕是可选功能", 31, bold=True)
    paragraph(d, 86, y + 78, "会把滚动弹幕转换为固定文字，密集时可能漏显示；无此需求直接用滚动弹幕。", 1268, 25)
    y += 180
    text(d, (58, y), source_note, 22, SUB)
    text(d, (58, y + 39), "详细文字步骤与图源见配套教程。教程第 " + str(EDITION) + " 版 · 插件 " + VERSION + " · " + DATE, 22, SUB)
    return y + 88


def render_chromium(browser):
    is_edge = browser == "edge"
    name = "Microsoft Edge" if is_edge else "Google Chrome"
    address = "edge://extensions" if is_edge else "chrome://extensions"
    dev = "开发人员模式" if is_edge else "开发者模式"
    load = "加载解压缩的扩展" if is_edge else "加载已解压的扩展程序"
    im = Image.new("RGB", (W, 5200), BG)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, 242), fill=FG)
    text(d, (66, 34), "B站小黄鸭插帧助手", 31, "#d5eddb")
    text(d, (62, 88), ("Edge" if is_edge else "Chrome") + " 安装教程", 65, "white", True)
    text(d, (66, 180), "Windows 电脑 · 从 ZIP 安装 · 适用插件 " + VERSION, 29, "#d5eddb")
    icon = Image.open(ROOT / "extension" / "icons" / "icon128.png").convert("RGBA")
    icon = icon.resize((135, 135), Image.Resampling.LANCZOS)
    im.paste(icon, (W - 217, 53), icon)
    y = 270

    cy = card(d, y, 640, 1, "选择获取方式，下载并解压")
    text(d, (86, cy), "GitHub Releases · 最新版安装包（推荐）", 27, SUB)
    d.rounded_rectangle((86, cy + 43, W - 86, cy + 111), radius=13, fill=SOFT)
    text(d, (108, cy + 59), RELEASES, 28, ACCENT, mono=True)
    text(d, (86, cy + 139), "GitHub 源码与说明（备用网盘见文字教程）", 27, SUB)
    d.rounded_rectangle((86, cy + 182, W - 86, cy + 250), radius=13, fill=SOFT)
    text(d, (108, cy + 199), REPO, 30, ACCENT, mono=True)
    text(d, (86, cy + 278), "下载 bilibili-danmaku-assistant-v" + VERSION + ".zip（不要误选 -firefox.zip）。", 28)
    d.rounded_rectangle((86, cy + 334, 605, cy + 411), radius=13, fill="#f7f8fa")
    text(d, (109, cy + 356), "右键 ZIP → 全部解压缩", 31, bold=True)
    arrow(d, 632, cy + 373, 717)
    folder(d, 755, cy + 348)
    text(d, (846, cy + 356), "放在固定目录", 31, bold=True)
    text(d, (86, cy + 448), "例如 D:\\BrowserExtensions；安装后保留文件夹，不随意移动或删除。", 26, SUB)
    y += 664

    reference_name = "edge-official.png" if is_edge else "chrome-user-1.3.13.png"
    ref = Image.open(ASSETS / "reference" / reference_name).convert("RGB")
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
    text(d, (86, cy + 157), "下方为微软官方界面截图；英文按钮对应以上中文名称。" if is_edge else
         "下方为用户提供的 Chrome 实际截图，显示历史版本已加载。", 25, SUB)
    im.paste(ref.resize((refw, refh), Image.Resampling.LANCZOS), (120, cy + 211))
    text(d, (86, cy + 233 + refh), "按钮位置可能随版本变化；Edge 部分版本会显示不同的中文译名。" if is_edge else
         "开发者模式在右上角；开启后，再点击左侧出现的加载按钮。", 25, SUB)
    y += h + 24

    cy = card(d, y, 740, 3, "选对文件夹：直接包含 manifest.json")
    paragraph(d, 86, cy, "Release 安装包选 bilibili-fixed-danmaku；GitHub 源码包选 extension。先在资源管理器核对，所选目录要直接包含 manifest.json。", 1268, 31)
    d.rounded_rectangle((86, cy + 115, W - 86, cy + 375), radius=19, fill=SOFT, outline=LINE, width=2)
    text(d, (112, cy + 135), "以 Release 安装包为例；GitHub 源码包对应的目录名为 extension：", 27, SUB)
    folder(d, 122, cy + 194, 49, 35)
    text(d, (190, cy + 194), "bilibili-fixed-danmaku", 35, FG, True, mono=True)
    text(d, (870, cy + 199), "← 选择这一层", 31, ACCENT, True)
    text(d, (194, cy + 258), "├─ manifest.json", 32, FG, mono=True)
    text(d, (194, cy + 309), "└─ icons / ...", 30, SUB, mono=True)
    paragraph(d, 86, cy + 413, "核对后复制资源管理器地址栏路径，在浏览器的文件夹选择窗口中粘贴，点击「选择文件夹」确认加载。", 1268, 30)
    d.rounded_rectangle((86, cy + 513, W - 86, cy + 600), radius=13, fill="#fff5df")
    paragraph(d, 108, cy + 530, "选择窗口可能只显示 icons 子目录，这是正常的。留在当前目录确认，不要进入 icons。", 1216, 27, "#73591f", gap=9)
    y += 764

    menu_tip = "可选择「在工具栏中显示」，方便下次打开。" if is_edge else "Chrome 的菜单图标像拼图；点击插件旁的图钉，可固定到工具栏。"
    source_note = "图源：" + ("Microsoft Learn 官方截图" if is_edge else "用户提供的 Chrome 截图") + "；文件夹与设置面板为教学示意。"
    y = render_settings_and_footer(d, im, icon, y, menu_tip, source_note)
    if y > im.height:
        raise RuntimeError("Canvas exceeded: " + str(y))
    result = im.crop((0, 0, W, y))
    dest = ASSETS / ("install-" + browser + ".png")
    result.save(dest, optimize=True)
    return {"browser": name, "path": dest.relative_to(ROOT).as_posix(), "width": W,
            "height": y, "bytes": dest.stat().st_size,
            "sha256": hashlib.sha256(dest.read_bytes()).hexdigest()}


def render_firefox():
    name = "Mozilla Firefox"
    im = Image.new("RGB", (W, 5200), BG)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, 242), fill=FG)
    text(d, (66, 34), "B站小黄鸭插帧助手", 31, "#d5eddb")
    text(d, (62, 88), "Firefox 安装教程", 65, "white", True)
    text(d, (66, 180), "Windows 电脑 · Firefox 140+ 适用 · 插件版本 " + VERSION, 29, "#d5eddb")
    icon = Image.open(ROOT / "extension" / "icons" / "icon128.png").convert("RGBA")
    icon = icon.resize((135, 135), Image.Resampling.LANCZOS)
    im.paste(icon, (W - 217, 53), icon)
    y = 270

    cy = card(d, y, 560, 1, "推荐方式：Firefox 商店或签名 .xpi 永久安装")
    paragraph(d, 86, cy, "正式版 Firefox 要求扩展带有 Mozilla 签名才能长期保留。普通用户推荐使用以下任一永久安装途径：", 1268, 30)
    d.rounded_rectangle((86, cy + 104, W - 86, cy + 236), radius=16, fill=SOFT, outline=LINE, width=2)
    text(d, (112, cy + 124), "途径 A · Firefox 官方附加组件商店（AMO）", 30, FG, True)
    text(d, (112, cy + 174), "打开插件商店主页，点击「添加到 Firefox」即可一键安装并支持后续自动更新。", 26, SUB)
    d.rounded_rectangle((86, cy + 258, W - 86, cy + 412), radius=16, fill="#f7faf8", outline=LINE, width=2)
    text(d, (112, cy + 278), "途径 B · 从 GitHub Releases 安装已签名 .xpi 文件", 30, FG, True)
    text(d, (112, cy + 328), "地址栏打开 about:addons → 点击右上角齿轮图标 →「从文件安装附加组件…」→ 选 .xpi 文件。", 26, SUB)
    text(d, (112, cy + 368), "发布页：", 25, SUB)
    text(d, (218, cy + 368), RELEASES, 25, ACCENT, mono=True)
    y += 584

    cy = card(d, y, 540, 2, "开发调试备选：about:debugging 临时载入 ZIP")
    paragraph(d, 86, cy, "若在本地调试源码或使用未签名的 -firefox.zip 包，可在 Firefox 临时加载（无需解压）：", 1268, 30)
    d.rounded_rectangle((86, cy + 96, W - 86, cy + 172), radius=12, fill="#f5f7f8", outline=LINE, width=2)
    text(d, (107, cy + 118), "地址栏输入", 29, SUB)
    text(d, (295, cy + 116), "about:debugging#/runtime/this-firefox", 32, ACCENT, True, mono=True)
    text(d, (86, cy + 202), "① 点击「临时载入附加组件…」", 30, bold=True)
    text(d, (640, cy + 202), "② 直接选择 -firefox.zip（或内含 manifest.json）", 29, bold=True)
    d.rounded_rectangle((86, cy + 272, W - 86, cy + 394), radius=13, fill="#fff5df")
    paragraph(d, 108, cy + 290, "注意：Firefox 正式版的「临时载入」在关闭浏览器后会自动移除，日常使用请优先选择步骤 1 的商店或已签名 .xpi 包；注意不要误选 Chromium 版的普通 ZIP。", 1216, 26, "#73591f", gap=10)
    y += 564

    cy = card(d, y, 470, 3, "检查 Firefox 站点权限与硬件加速")
    d.rounded_rectangle((86, cy + 6, W - 86, cy + 150), radius=16, fill=SOFT, outline=LINE, width=2)
    text(d, (112, cy + 26), "确认允许访问 B站页面（默认安装时自动勾选）", 30, FG, True)
    paragraph(d, 112, cy + 74, "若面板提示「未授予当前B站站点访问权限」，直接点击面板下方按钮授权并刷新页面即可。", 1216, 26, SUB, gap=9)
    d.rounded_rectangle((86, cy + 174, W - 86, cy + 322), radius=16, fill="#f7faf8", outline=LINE, width=2)
    text(d, (112, cy + 194), "减少画中画悬浮图标干扰（可选）", 30, FG, True)
    paragraph(d, 112, cy + 242, "Firefox 鼠标移过视频时可能显示蓝色「画中画」小图标；可在 Firefox 设置中取消勾选「启用画中画视频控制器」，并保持「使用推荐的性能设置 / 硬件加速」开启。", 1216, 25, SUB, gap=9)
    y += 494

    menu_tip = "点击 Firefox 右上角拼图形「扩展」按钮，右键插件选择「固定到工具栏」。"
    source_note = "图源：流程卡片与推荐设置面板均为本项目制作的教学示意，对应插件实际界面。"
    y = render_settings_and_footer(d, im, icon, y, menu_tip, source_note)
    if y > im.height:
        raise RuntimeError("Canvas exceeded: " + str(y))
    result = im.crop((0, 0, W, y))
    dest = ASSETS / "install-firefox.png"
    result.save(dest, optimize=True)
    return {"browser": name, "path": dest.relative_to(ROOT).as_posix(), "width": W,
            "height": y, "bytes": dest.stat().st_size,
            "sha256": hashlib.sha256(dest.read_bytes()).hexdigest()}


def preview():
    page = f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>B站小黄鸭插帧助手 · 安装图解</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#edf5ed;color:#173b32;font:16px/1.7 'Microsoft YaHei',system-ui,sans-serif}}
header{{max-width:1040px;margin:32px auto 0;padding:0 24px}}h1{{font-size:29px;margin:0 0 8px}}p{{margin:8px 0 18px;color:#4d695f}}
nav{{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}}button,.action{{border:1px solid #bdd4c3;border-radius:10px;padding:9px 18px;font:inherit;background:white;color:#173b32;text-decoration:none;cursor:pointer}}
button[aria-selected=true]{{background:#23745a;color:white;border-color:#23745a}}.downloads{{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px}}main{{max-width:1040px;margin:auto;padding:0 24px}}img{{display:block;width:100%;height:auto;border-radius:14px;box-shadow:0 8px 26px #163c3214}}
footer{{max-width:1040px;margin:24px auto;padding:0 24px 48px;color:#4d695f}}a{{color:#23745a}}button:focus-visible,a:focus-visible{{outline:3px solid #d8ae43;outline-offset:4px}}
</style><header><h1>安装图解 · Edge / Chrome / Firefox</h1><p>当前版本 {VERSION}，支持B站视频、番剧与直播。Windows 电脑适用。先选浏览器，再按图操作；三份安装长图均可保存。插件需配合 Lossless Scaling 使用。</p>
<nav role="tablist" aria-label="选择浏览器"><button role="tab" aria-selected="true" data-browser="edge">Microsoft Edge</button><button role="tab" aria-selected="false" data-browser="chrome">Google Chrome</button><button role="tab" aria-selected="false" data-browser="firefox">Mozilla Firefox</button></nav>
<div class="downloads"><a class="action" id="png-download" href="assets/install-edge.png" download>保存 Edge 安装长图</a><a class="action" href="{RELEASES}" target="_blank" rel="noreferrer">GitHub · 最新版发布页</a><a class="action" href="{REPO}" target="_blank" rel="noreferrer">GitHub · 源码与说明</a><a class="action" href="{QUARK}" target="_blank" rel="noreferrer">网盘 · 备用旧入口</a></div></header>
<p style="max-width:992px;margin:0 auto 18px;padding:0 24px">Edge / Chrome 请下载普通 Release ZIP 并解压加载 bilibili-fixed-danmaku 文件夹；Firefox（140+）推荐从 Firefox 附加组件商店或已签名 .xpi 永久安装，调试时可在 about:debugging 临时载入 -firefox.zip。</p>
<main><img id="guide" src="assets/install-edge.png" alt="Edge 从ZIP安装B站小黄鸭插帧助手：下载、解压、加载文件夹与推荐设置"></main>
<footer><p>Edge界面采用微软官方截图；Chrome界面采用用户提供的1.3.13实际截图；Firefox流程卡片、文件夹和推荐设置面板为教学示意。按钮位置、译名可能随浏览器版本变化。</p>
<p>推荐设置：打开总开关 → 弹幕显示方式选“滚动弹幕” → 打开“减少页面动画” → 刷新实际播放窗口。更新时还需先在浏览器扩展管理页重新加载或更新扩展。</p>
<p>直播文字与静态／GIF／APNG／WebP表情随视频帧合成；资源或解码条件不足会显示占位或静帧。全屏时可隔离已识别的直播外围区域，退出全屏或关闭对应设置后恢复。插件不生成中间帧，也不保证消除小黄鸭文字伪影；完整支持范围见仓库说明。</p>
<p>完整文字教程：<a href="install-edge.zh-CN.md">Edge</a> · <a href="install-chrome.zh-CN.md">Chrome</a> · <a href="install-firefox.zh-CN.md">Firefox</a> · <a href="assets/SOURCES.md">图源与复现说明</a></p>
<p>Edge/Chrome 找不到 manifest？先在文件资源管理器核对目录；浏览器的文件夹选择窗口可能只显示 icons，这是正常的。加载后应保留解压目录。</p></footer>
<script>const labels={{edge:'Edge',chrome:'Chrome',firefox:'Firefox'}};for(const b of document.querySelectorAll('[data-browser]'))b.addEventListener('click',()=>{{let n=b.dataset.browser,label=labels[n]||n;for(const x of document.querySelectorAll('[data-browser]'))x.setAttribute('aria-selected',String(x===b));let img=document.getElementById('guide');img.src='assets/install-'+n+'.png';img.alt=label+' 安装教程';let a=document.getElementById('png-download');a.href=img.src;a.textContent='保存 '+label+' 安装长图';}});</script></html>"""
    (ROOT / "docs" / "install.html").write_text(page, encoding="utf-8")


ASSETS.mkdir(parents=True, exist_ok=True)
rows = [render_chromium("edge"), render_chromium("chrome"), render_firefox()]
preview()
manifest = {"version": VERSION, "edition": EDITION, "date": DATE, "outputs": rows,
            "references": [{"path": p.relative_to(ROOT).as_posix(), "bytes": p.stat().st_size,
                            "used_in_current_edition": p.name in ("edge-official.png", "chrome-user-1.3.13.png"),
                            "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                           for p in sorted((ASSETS / "reference").glob("*.png"))]}
(ROOT / "docs" / "install-guide-manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
if args.export_dir:
    args.export_dir.mkdir(parents=True, exist_ok=True)
    for browser, label in [("edge", "Edge"), ("chrome", "Chrome"), ("firefox", "Firefox")]:
        shutil.copy2(ASSETS / ("install-" + browser + ".png"), args.export_dir / (label + "_安装教程_v" + str(EDITION) + ".png"))
    archive = args.export_dir / ("安装教程_Edge_Chrome_Firefox_v" + str(EDITION) + ".zip")
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for p in sorted((ROOT / "docs").rglob("*")):
            if p.is_file():
                bundle.write(p, "安装图文教程/" + p.relative_to(ROOT / "docs").as_posix())
        bundle.writestr("先读我.txt", "这是安装图文教程文件包，不包含插件运行文件。\n解压后打开“安装图文教程/install.html”查看。\n最新版发布页：" + RELEASES + "\n源码与更新：" + REPO + "\n")
    with zipfile.ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise SystemExit("Offline tutorial ZIP failed its integrity check")
    print("Offline tutorial ZIP: " + str(archive))
print(json.dumps({"version": VERSION, "outputs": rows}, ensure_ascii=False, indent=2))
