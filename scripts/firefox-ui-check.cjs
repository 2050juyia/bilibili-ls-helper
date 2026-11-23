// End-to-end verification of the packaged Firefox MV3 extension in real Firefox via Marionette.
// Zero third-party npm dependencies; all temporary files stay under work/ on drive E:.
'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8')).version;
const out = path.join(root, 'work', `firefox-ui-${version}`);
const profile = path.join(out, 'firefox-profile');
const extBuildDir = path.join(out, 'firefox-extension');
const tlsDir = path.join(out, 'tls');

const pixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGP8z8DAwMDAxAAHCgL9c2f5nQAAAABJRU5ErkJggg==',
  'base64'
);

function findExecutable(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(err => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
}

function generateLoopbackCert(opensslBin) {
  fs.mkdirSync(tlsDir, { recursive: true });
  const keyPath = path.join(tlsDir, 'key.pem');
  const certPath = path.join(tlsDir, 'cert.pem');
  execFileSync(opensslBin, [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1',
    '-subj', '/CN=bilibili.com'
  ], { stdio: 'ignore' });
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
}

const vodHtml = `<!doctype html><meta charset="utf-8"><title>Firefox VOD Composite Check</title>
<style>
  body { font: 15px/1.6 system-ui, sans-serif; margin: 20px; background: #f4f5f7; color: #18191c; }
  img, .playing-gif { display: inline-block !important; width: 18px; height: 18px; background: #00aeec; }
  .bpx-player-container { position: relative; width: 640px; height: 360px; background: #000; overflow: hidden; }
  .bpx-player-video-perch { position: relative; width: 100%; height: 100%; }
  video { width: 100%; height: 100%; display: block; }
  .bpx-player-row-dm-wrap { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
  .bili-danmaku-x-dm { position: absolute; left: 520px; top: 36px; font: 700 24px "Microsoft YaHei", sans-serif; color: #fff; text-shadow: 1px 1px 2px #000; white-space: nowrap; }
</style>
<div>
  <span id="legacy" class="playing-gif"></span>
  <img id="modern" class="PlayingIcon_playIcon__fxTest" src="https://activity.hdslb.com/blackboard/static/dir/playing.png">
  <img id="unrelated" src="https://www.bilibili.com/keep.png">
</div>
<div class="bpx-player-container">
  <div class="bpx-player-video-perch"><video id="video" muted playsinline></video></div>
  <div id="dm-container" class="bpx-player-row-dm-wrap">
    <div id="dm-item" class="bili-danmaku-x-dm bili-danmaku-x-roll">Firefox 60fps 帧同步弹幕验证</div>
  </div>
</div>
<script>
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = 640; srcCanvas.height = 360;
  const ctx = srcCanvas.getContext('2d');
  let tick = 0;
  function drawSource() {
    tick++;
    ctx.fillStyle = '#1b2b44';
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#4ad295';
    ctx.fillRect((tick * 6) % 580, 140, 60, 60);
  }
  drawSource();
  const timer = setInterval(drawSource, 33);
  const video = document.getElementById('video');
  const stream = srcCanvas.captureStream ? srcCanvas.captureStream(30) : srcCanvas.mozCaptureStream(30);
  video.srcObject = stream;

  const dmNode = document.getElementById('dm-item');
  const dmContainer = document.getElementById('dm-container');
  const item = {
    textData: { mode: 1, color: 0xffffff, border: true, borderColor: 0x66ffff },
    text: dmNode.textContent,
    element: dmNode,
    showed: true,
    isHide: false,
    duration: 8,
    endTime: 8,
    moveDistance: 640
  };
  const clock = {
    renderTime: 0,
    currentTime: 0,
    updateTime() { this.currentTime = video.currentTime || 0; this.renderTime = this.currentTime; }
  };
  const scheduler = {
    running: true,
    start() { this.running = true; },
    stop() { this.running = false; },
    startImmediate() { clock.updateTime(); renderer.renderTime = clock.renderTime; }
  };
  const renderer = {
    container: dmContainer,
    frameScheduler: scheduler,
    timeController: clock,
    manager: { visualArray: [item] },
    isRunning: true,
    renderTime: 0,
    setSetting() {}
  };
  window.player = { danmaku: { getDanmakuX: () => renderer } };
  window.__startFixturePlayback = () => video.play();
</script>`;

const liveHtml = `<!doctype html><meta charset="utf-8"><title>Firefox Live Composite Check</title>
<style>
  body { margin: 20px; background: #11161f; color: #fff; font: 15px system-ui, sans-serif; }
  .live-room-app { position: relative; }
  #live-player { position: relative; width: 640px; height: 360px; background: #000; overflow: hidden; }
  video { width: 100%; height: 100%; display: block; }
  .web-player-danmaku { position: absolute; inset: 0; z-index: 2; }
  .bili-danmaku-x-dm { position: absolute; left: 180px; top: 42px; font: 700 24px "Microsoft YaHei", sans-serif; color: #fff; text-shadow: 1px 1px 2px #000; }
</style>
<div class="live-room-app">
  <div class="head-info-vm" id="periphery-head">直播间头部外围</div>
  <div id="live-player">
    <video id="live-video" muted playsinline></video>
    <div class="web-player-danmaku">
      <div class="bili-danmaku-x-dm bili-danmaku-x-show">Firefox 直播弹幕合成 <img src="https://live.bilibili.com/bfs/emote/test.png" width="24" height="24" alt="[doge]"></div>
    </div>
  </div>
</div>
<script>
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = 640; srcCanvas.height = 360;
  const ctx = srcCanvas.getContext('2d');
  let tick = 0;
  setInterval(() => {
    tick++;
    ctx.fillStyle = '#241b3b';
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#ff8a65';
    ctx.beginPath(); ctx.arc(80 + ((tick * 5) % 480), 180, 28, 0, Math.PI * 2); ctx.fill();
  }, 33);
  const video = document.getElementById('live-video');
  const stream = srcCanvas.captureStream ? srcCanvas.captureStream(30) : srcCanvas.mozCaptureStream(30);
  video.srcObject = stream;
  window.livePlayer = { getVideoEl: () => video };
  window.__startLivePlayback = () => video.play();
</script>`;

function startFixtureServers(tlsOptions) {
  return new Promise(resolve => {
    const httpsServer = https.createServer(tlsOptions, (req, res) => {
      const host = String(req.headers.host || '');
      if (req.url.endsWith('.png')) {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(pixelPng);
        return;
      }
      if (host.startsWith('live.bilibili.com')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(liveHtml);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(vodHtml);
    });

    httpsServer.listen(0, '127.0.0.1', () => {
      const targetPort = httpsServer.address().port;
      const proxyServer = http.createServer((_req, res) => {
        res.writeHead(405);
        res.end();
      });
      proxyServer.on('connect', (_req, clientSocket, head) => {
        const upstream = net.connect(targetPort, '127.0.0.1', () => {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head && head.length) upstream.write(head);
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
        });
        upstream.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => upstream.destroy());
      });
      proxyServer.listen(0, '127.0.0.1', () => {
        resolve({
          proxyPort: proxyServer.address().port,
          close: () => {
            proxyServer.close();
            httpsServer.close();
          }
        });
      });
    });
  });
}

class MarionetteClient {
  constructor(port) {
    this.port = port;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.handshakeDone = false;
    this.onHandshake = null;
  }

  async connect(timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        await this._tryConnectOnce();
        return;
      } catch {
        await new Promise(r => setTimeout(r, 250));
      }
    }
    throw new Error(`Timed out connecting to Firefox Marionette on port ${this.port}`);
  }

  _tryConnectOnce() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: this.port });
      let settled = false;
      const fail = err => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(err);
      };
      socket.once('error', fail);
      socket.on('data', chunk => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this._drain();
      });
      this.onHandshake = () => {
        if (settled) return;
        settled = true;
        this.socket = socket;
        resolve();
      };
    });
  }

  _drain() {
    while (this.buffer.length > 0) {
      const colon = this.buffer.indexOf(0x3a); // ':'
      if (colon === -1) return;
      const byteLength = Number(this.buffer.subarray(0, colon).toString('ascii'));
      if (!Number.isFinite(byteLength) || this.buffer.length < colon + 1 + byteLength) return;
      const body = this.buffer.subarray(colon + 1, colon + 1 + byteLength).toString('utf8');
      this.buffer = this.buffer.subarray(colon + 1 + byteLength);
      const message = JSON.parse(body);
      if (!this.handshakeDone && message.marionetteProtocol) {
        this.handshakeDone = true;
        this.onHandshake?.();
        continue;
      }
      if (Array.isArray(message) && message[0] === 1) {
        const [, id, error, result] = message;
        const waiter = this.pending.get(id);
        if (waiter) {
          this.pending.delete(id);
          if (error) waiter.reject(new Error(`${error.error}: ${error.message}`));
          else waiter.resolve(result);
        }
      }
    }
  }

  send(command, params = {}) {
    const id = this.nextId++;
    const payload = Buffer.from(JSON.stringify([0, id, command, params]), 'utf8');
    const framed = Buffer.concat([Buffer.from(`${payload.length}:`, 'ascii'), payload]);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(framed);
    });
  }

  close() {
    this.socket?.destroy();
  }
}

(async () => {
  const firefoxBin = findExecutable([
    process.env.FIREFOX_BIN,
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
    'D:\\Program Files\\Mozilla Firefox\\firefox.exe',
    'E:\\Program Files\\Mozilla Firefox\\firefox.exe'
  ]);
  assert(firefoxBin, 'Firefox executable not found');

  const opensslBin = findExecutable([
    process.env.OPENSSL_BIN,
    'E:\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'D:\\Git\\usr\\bin\\openssl.exe'
  ]);
  assert(opensslBin, 'OpenSSL executable not found for loopback TLS fixture');

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });

  const buildRaw = execFileSync(
    'python',
    [path.join(root, 'scripts', 'package.py'), '--firefox-unpacked', extBuildDir],
    { encoding: 'utf8' }
  );
  const buildInfo = JSON.parse(buildRaw.trim());

  const tlsOptions = generateLoopbackCert(opensslBin);
  const fixture = await startFixtureServers(tlsOptions);
  const marionettePort = await getFreePort();

  const prefs = [
    `user_pref("marionette.port", ${marionettePort});`,
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.aboutConfig.showWarning", false);',
    'user_pref("media.autoplay.default", 0);',
    'user_pref("media.autoplay.blocking_policy", 0);',
    'user_pref("network.proxy.type", 1);',
    'user_pref("network.proxy.ssl", "127.0.0.1");',
    `user_pref("network.proxy.ssl_port", ${fixture.proxyPort});`,
    'user_pref("network.proxy.allow_hijacking_localhost", true);'
  ].join('\n');
  fs.writeFileSync(path.join(profile, 'user.js'), prefs, 'utf8');

  const firefoxEnv = {
    ...process.env,
    TEMP: out,
    TMP: out,
    MOZ_CRASHREPORTER_DISABLE: '1',
    MOZ_NO_REMOTE: '1',
    MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1'
  };

  const report = {
    version,
    firefoxBinary: firefoxBin,
    archive: buildInfo.archive,
    checks: []
  };

  let proc = null;
  const client = new MarionetteClient(marionettePort);
  try {
    const verOut = execFileSync(firefoxBin, ['--version'], { encoding: 'utf8' }).trim();
    report.browser = verOut;

    proc = spawn(firefoxBin, ['-headless', '-no-remote', '-marionette', '-profile', profile], {
      env: firefoxEnv,
      stdio: 'ignore'
    });

    await client.connect();
    await client.send('WebDriver:NewSession', { acceptInsecureCerts: true });

    // 1. Install the packaged Firefox ZIP via AddonManager in chrome context
    await client.send('Marionette:SetContext', { value: 'chrome' });
    const addonRes = await client.send('WebDriver:ExecuteAsyncScript', {
      script: `
        const [zipPath, done] = arguments;
        const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
        const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        file.initWithPath(zipPath);
        AddonManager.installTemporaryAddon(file).then(addon => {
          const policy = WebExtensionPolicy.getByID(addon.id);
          done({
            id: addon.id,
            version: addon.version,
            isActive: addon.isActive,
            uuid: policy?.mozExtensionHostname || ""
          });
        }, err => done({ error: String(err) }));
      `,
      args: [buildInfo.archive]
    });
    const addon = addonRes.value;
    assert(!addon.error, `Firefox rejected temporary ZIP install: ${addon.error}`);
    assert.equal(addon.id, 'bilibili-ls-helper@2050juyia.github.io');
    assert.equal(addon.version, version);
    assert.equal(addon.isActive, true);
    assert(addon.uuid, 'Expected moz-extension UUID hostname');
    report.checks.push({ name: 'packaged root-level Firefox ZIP installs cleanly via AddonManager', addon });

    await client.send('Marionette:SetContext', { value: 'content' });
    await client.send('WebDriver:SetWindowRect', { width: 1100, height: 820 });

    // 2. Open popup.html in tab 1 and configure video-sync + hidePlaylistIndicator
    const handleRes = await client.send('WebDriver:GetWindowHandle');
    const popupHandle = handleRes.value ?? handleRes;
    await client.send('WebDriver:Navigate', { url: `moz-extension://${addon.uuid}/popup.html` });
    const popupState = await client.send('WebDriver:ExecuteAsyncScript', {
      script: `
        const [done] = arguments;
        (async () => {
          for (let i = 0; i < 50 && document.getElementById('enabled').disabled; i++) {
            await new Promise(r => setTimeout(r, 40));
          }
          const motion = document.getElementById('motion');
          motion.value = 'video-sync';
          motion.dispatchEvent(new Event('change', { bubbles: true }));
          const anim = document.getElementById('hide-playlist-indicator');
          anim.checked = true;
          anim.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 120));
          const stored = await browser.storage.local.get('bfdSettings');
          done({
            versionText: document.getElementById('version').textContent,
            enabledLabel: document.getElementById('enabled-label').textContent,
            stored: stored.bfdSettings,
            hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          });
        })();
      `,
      args: []
    });
    assert.equal(popupState.value.versionText, version);
    assert.equal(popupState.value.enabledLabel, '已开启');
    assert.equal(popupState.value.stored.motion, 'video-sync');
    assert.equal(popupState.value.stored.hidePlaylistIndicator, true);
    assert.equal(popupState.value.hasHorizontalOverflow, false);
    const popupShot = (await client.send('WebDriver:TakeScreenshot')).value;
    fs.writeFileSync(path.join(out, 'popup-firefox.png'), Buffer.from(popupShot, 'base64'));
    report.checks.push({ name: 'popup UI renders, saves via browser.storage.local, and avoids overflow', popup: popupState.value });

    // 3. Open tab 2 for VOD fixture: verify playlist-indicator + video-sync > 2.5s + bridge Promise status
    const newTabRes = await client.send('WebDriver:NewWindow', { type: 'tab' });
    const contentHandle = newTabRes.handle ?? newTabRes.value?.handle;
    await client.send('WebDriver:SwitchToWindow', { handle: contentHandle });
    await client.send('WebDriver:Navigate', { url: 'https://www.bilibili.com/video/BVfixture?p=1' });

    const vodResult = await client.send('WebDriver:ExecuteAsyncScript', {
      script: `
        const [done] = arguments;
        (async () => {
          await window.__startFixturePlayback();
          // Run past the 2000ms stale threshold to prove Gecko rVFC stays continuous!
          await new Promise(r => setTimeout(r, 2600));
          const video = document.getElementById('video');
          const syncStatus = window.BFDVideoSync?.readStatus?.();
          const diagnostics = window.BFDVideoSync?.readDiagnostics?.() || [];
          done({
            legacyDisplay: getComputedStyle(document.getElementById('legacy')).display,
            modernDisplay: getComputedStyle(document.getElementById('modern')).display,
            unrelatedDisplay: getComputedStyle(document.getElementById('unrelated')).display,
            videoVisibility: getComputedStyle(video).visibility,
            dmVisibility: getComputedStyle(document.getElementById('dm-container')).visibility,
            syncStatus,
            diagnostics
          });
        })();
      `,
      args: []
    });
    const vod = vodResult.value;
    assert.equal(vod.legacyDisplay, 'none');
    assert.equal(vod.modernDisplay, 'none');
    assert.notEqual(vod.unrelatedDisplay, 'none');
    assert.equal(vod.videoVisibility, 'hidden', 'Firefox WebGL single-canvas hides <video> to disable separate DComp video swapchain');
    assert.equal(vod.dmVisibility, 'hidden');
    assert.equal(vod.syncStatus.active, true, `VOD sync inactive: ${vod.syncStatus?.reason}`);
    assert(vod.syncStatus.frames >= 25, `Expected >=25 rVFC frames in Firefox, got ${vod.syncStatus.frames}`);
    assert.equal(vod.syncStatus.composite.surface, 'webgl-single-canvas');
    assert.equal(vod.syncStatus.composite.backend, 'webgl');
    assert.equal(vod.syncStatus.composite.committed, true);
    assert.equal(vod.syncStatus.recovery.attempts, 0);
    assert.equal(vod.diagnostics.length, 0);
    const vodShot = (await client.send('WebDriver:TakeScreenshot')).value;
    fs.writeFileSync(path.join(out, 'vod-composite-firefox.png'), Buffer.from(vodShot, 'base64'));
    report.checks.push({
      name: 'VOD WebGL single-canvas stays continuous >2.6s with hidden <video> DComp swapchain and indicator suppression',
      frames: vod.syncStatus.frames,
      fps: vod.syncStatus.fps,
      surface: vod.syncStatus.composite.surface,
      comments: vod.syncStatus.composite.comments
    });

    // 4. Verify ISOLATED <-> MAIN bridge roundtrip via browser.tabs.sendMessage from popup tab
    await client.send('WebDriver:SwitchToWindow', { handle: popupHandle });
    const bridgeRoundtrip = await client.send('WebDriver:ExecuteAsyncScript', {
      script: `
        const [done] = arguments;
        (async () => {
          const tabs = await browser.tabs.query({});
          const vodTab = tabs.find(t => (t.url || '').includes('www.bilibili.com/video/'));
          const status = await browser.tabs.sendMessage(vodTab.id, { type: 'bfd-get-status' });
          // Toggle hidePlaylistIndicator off dynamically and verify live storage event propagation
          const current = (await browser.storage.local.get('bfdSettings')).bfdSettings;
          await browser.storage.local.set({ bfdSettings: { ...current, hidePlaylistIndicator: false } });
          await new Promise(r => setTimeout(r, 80));
          await browser.storage.local.set({ bfdSettings: { ...current, hidePlaylistIndicator: true } });
          done({ foundTab: !!vodTab, status });
        })();
      `,
      args: []
    });
    assert.equal(bridgeRoundtrip.value.foundTab, true);
    assert.equal(bridgeRoundtrip.value.status?.supportedPage, true);
    assert.equal(bridgeRoundtrip.value.status?.motion, 'video-sync');
    assert.equal(bridgeRoundtrip.value.status?.videoSync?.active, true);
    report.checks.push({ name: 'ISOLATED bridge.js <-> MAIN hook.js Promise messaging roundtrip succeeds', status: bridgeRoundtrip.value.status });

    // 5. Navigate content tab to Live room fixture and verify BFDLiveSync + BFDLiveCompositor + ImageDecoder
    await client.send('WebDriver:SwitchToWindow', { handle: contentHandle });
    await client.send('WebDriver:Navigate', { url: 'https://live.bilibili.com/12345' });
    const liveResult = await client.send('WebDriver:ExecuteAsyncScript', {
      script: `
        const [done] = arguments;
        (async () => {
          await window.__startLivePlayback();
          await new Promise(r => setTimeout(r, 1500));
          done({
            liveStatus: window.BFDLiveSync?.readStatus?.(),
            videoOpacity: document.getElementById('live-video')?.style.getPropertyValue('opacity'),
            layerMasked: document.querySelector('.web-player-danmaku')?.hasAttribute('data-bfd-live-mask')
          });
        })();
      `,
      args: []
    });
    const live = liveResult.value;
    assert.equal(live.liveStatus?.active, true, `Live sync inactive: ${live.liveStatus?.reason}`);
    assert(live.liveStatus.frames >= 15, `Expected >=15 live rVFC frames, got ${live.liveStatus.frames}`);
    assert.equal(live.liveStatus.composite.surface, 'webgl-single-canvas');
    assert.equal(live.liveStatus.composite.backend, 'webgl');
    assert.equal(live.liveStatus.composite.committed, true);
    assert.equal(live.liveStatus.composite.comments >= 1, true);
    assert.equal(live.liveStatus.composite.assets, 1);
    assert.equal(live.liveStatus.composite.imageFailures, 0);
    assert.equal(live.videoOpacity, '0', 'Firefox Live WebGL must mute <video> opacity to disable DComp swapchain');
    assert.equal(live.layerMasked, true);
    const liveShot = (await client.send('WebDriver:TakeScreenshot')).value;
    fs.writeFileSync(path.join(out, 'live-composite-firefox.png'), Buffer.from(liveShot, 'base64'));
    report.checks.push({
      name: 'Live room compositor, emoji ImageDecoder, and native layer masking run cleanly in Firefox',
      frames: live.liveStatus.frames,
      comments: live.liveStatus.composite.comments,
      assets: live.liveStatus.composite.assets,
      imageFailures: live.liveStatus.composite.imageFailures
    });

    await client.send('WebDriver:DeleteSession').catch(() => {});
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    client.close();
    if (proc && !proc.killed) {
      try { proc.kill(); } catch {}
    }
    fixture.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(report, null, 2));
  }
})();
