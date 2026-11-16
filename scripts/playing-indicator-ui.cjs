// Exercise the actual MV3 animation script in an isolated Edge profile.
const { chromium } = require(process.env.BFD_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'extension');
const version = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8')).version;
const out = path.join(root, 'work', `playing-indicator-ui-${version}`);
const profile = path.join(out, 'edge-profile');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+XcAAAAASUVORK5CYII=', 'base64');
const fixture = `<!doctype html><meta charset="utf-8"><title>播放动态图标覆盖检查</title>
<style>body{font:16px/2 system-ui;margin:30px}img,.playing-gif{display:inline-block!important;width:20px;height:20px;background:#00aeec}a{display:block}.active{background:#e6f6ff}video{width:320px;height:180px;background:#172136}.right-container{padding:10px}</style>
<div class="right-container"><span id="legacy" class="playing-gif">旧版</span></div>
<span id="outside" class="playing-gif">其他布局</span>
<a id="episode" class="active" href="/bangumi/play/ep5389731"><picture><source srcset="https://i0.hdslb.com/test-animated.webp" type="image/webp"><img id="modern" class="extra PlayingIcon_playIcon__ooOtS" src="https://activity.hdslb.com/blackboard/static/original/playing.png"></picture>下一集</a>
<img id="asset" src="https://activity.hdslb.com/blackboard/static/new-directory/playing.png?cache=2">
<img id="unrelated" src="https://example.org/playing.png"><span>其他图片</span>
<div class="bpx-player-container"><video id="video"></video><button id="control">播放控制</button></div>
<button id="fullscreen">全屏检查</button>
<script>document.querySelector('#fullscreen').onclick=()=>document.documentElement.requestFullscreen();document.querySelector('#episode').onclick=event=>{event.preventDefault();document.querySelector('#episode').dataset.clicked='yes'};</script>`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  process.env.TEMP = out;
  process.env.TMP = out;
  const options = {
    channel: 'msedge', headless: true, viewport: { width: 1000, height: 800 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    downloadsPath: out
  };
  let browser;
  const report = { checks: [], boundary: 'Actual MV3 and storage events in Edge with controlled DOM and image responses.' };
  try {
    browser = await chromium.launchPersistentContext(profile, options);
    await browser.close();
    const preferences = JSON.parse(fs.readFileSync(path.join(profile, 'Default', 'Secure Preferences'), 'utf8'));
    const entry = Object.entries(preferences.extensions.settings).find(([, value]) => value.path === extension);
    assert(entry, 'isolated extension registration');
    browser = await chromium.launchPersistentContext(profile, options);
    report.browser = browser.browser()?.version();
    const ui = await browser.newPage();
    await ui.goto(`chrome-extension://${entry[0]}/popup.html`);
    await ui.waitForFunction(() => !document.querySelector('#hide-playlist-indicator').disabled);
    await ui.locator('#hide-playlist-indicator').check();
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture })
      : route.fulfill({ contentType: 'image/png', body: pixel }));
    const hidden = async ids => {
      for (const id of ids) await page.locator(`#${id}`).waitFor({ state: 'hidden' });
    };
    for (const pathname of ['/video/BVfixture', '/bangumi/play/ep5389730', '/']) {
      await page.goto(`https://www.bilibili.com${pathname}`);
      await hidden(['legacy', 'outside', 'modern', 'asset']);
      assert(await page.locator('#unrelated').isVisible());
      assert(await page.locator('#video').isVisible());
      assert(await page.locator('#control').isVisible());
      await page.locator('#episode').click();
      assert.equal(await page.locator('#episode').getAttribute('data-clicked'), 'yes');
      assert.equal(await page.locator('#episode').getAttribute('href'), '/bangumi/play/ep5389731');
      report.checks.push({ name: 'page-independent new and legacy rules', pathname });
    }
    await page.evaluate(() => {
      const image = document.createElement('img');
      image.id = 'late';
      image.className = 'PlayingIcon_playIcon__futureBuildHash extra';
      document.body.append(image);
    });
    await hidden(['late']);
    await page.locator('#unrelated').evaluate(image => { image.className = 'extra PlayingIcon_playIcon__anotherHash'; });
    await hidden(['unrelated']);
    report.checks.push({ name: 'late inserted and changed module hashes apply automatically' });
    await ui.locator('#enabled').uncheck();
    await hidden(['legacy', 'outside', 'modern', 'asset', 'late']);
    await ui.locator('#enabled').check();
    report.checks.push({ name: 'shared indicator suppression stays independent of the danmaku master switch' });
    await ui.locator('#hide-playlist-indicator').uncheck();
    for (const id of ['legacy', 'outside', 'modern', 'asset', 'late', 'unrelated']) assert(await page.locator(`#${id}`).isVisible());
    await page.screenshot({ path: path.join(out, 'disabled.png') });
    await ui.locator('#hide-playlist-indicator').check();
    await hidden(['legacy', 'outside', 'modern', 'asset', 'late', 'unrelated']);
    report.checks.push({ name: 'live storage disable and re-enable restore only the shared indicators' });
    await page.locator('#fullscreen').click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    await hidden(['modern', 'late']);
    assert(await page.locator('#video').isVisible());
    await page.screenshot({ path: path.join(out, 'enabled-fullscreen.png') });
    report.checks.push({ name: 'fullscreen retains shared suppression and video controls' });
    if (process.env.BFD_LIVE === '1') {
      report.boundary += ' Includes an anonymous visit to the specified real bangumi page.';
      const live = await browser.newPage();
      await live.goto('https://www.bilibili.com/bangumi/play/ep5389730?from_spmid=666.25.episode.0', { waitUntil: 'domcontentloaded', timeout: 45000 });
      const icon = live.locator('[class*="PlayingIcon_playIcon__"]').first();
      await icon.waitFor({ state: 'attached', timeout: 30000 });
      await icon.waitFor({ state: 'hidden' });
      await ui.locator('#hide-playlist-indicator').uncheck();
      await icon.waitFor({ state: 'visible' });
      const before = await icon.evaluate(node => ({
        display: getComputedStyle(node).display,
        className: node.className,
        src: node.getAttribute('src'),
        currentSrc: node.currentSrc,
        link: node.closest('a').getAttribute('href'),
        text: node.closest('a').textContent
      }));
      const item = live.locator('[class*="EpisodeVirtualList_activeItem__"]').first();
      await item.scrollIntoViewIfNeeded();
      await item.screenshot({ path: path.join(out, 'bangumi-item-before.png') });
      await ui.locator('#hide-playlist-indicator').check();
      await icon.waitFor({ state: 'hidden' });
      const after = await icon.evaluate(node => ({
        display: getComputedStyle(node).display,
        link: node.closest('a').getAttribute('href'),
        text: node.closest('a').textContent
      }));
      assert.equal(before.link, after.link);
      assert.equal(before.text, after.text);
      assert.equal(after.display, 'none');
      await item.screenshot({ path: path.join(out, 'bangumi-item-after.png') });
      report.checks.push({ name: 'specified real bangumi page and live settings toggle', before, after });
    }
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = error.stack;
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
