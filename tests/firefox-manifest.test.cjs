const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('Chromium manifest stays warning-free while derived Firefox manifest satisfies AMO MV3 rules', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const chromium = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  assert.equal(chromium.manifest_version, 3);
  assert.equal(chromium.version, '1.5.3');
  assert.equal(pkg.version, chromium.version);
  assert.equal(chromium.minimum_chrome_version, '111');
  assert.equal(chromium.browser_specific_settings, undefined);

  const output = execFileSync('python', [path.join(root, 'scripts', 'firefox_manifest.py')], { encoding: 'utf8' });
  const firefox = JSON.parse(output);
  assert.equal(firefox.manifest_version, 3);
  assert.equal(firefox.version, chromium.version);
  assert.equal(firefox.name, chromium.name);
  assert.equal(firefox.minimum_chrome_version, undefined, 'Firefox manifest must strip minimum_chrome_version');
  assert.deepEqual(firefox.permissions, chromium.permissions);
  assert.deepEqual(firefox.content_scripts, chromium.content_scripts);
  assert.deepEqual(firefox.icons, chromium.icons);
  assert.deepEqual(firefox.browser_specific_settings, {
    gecko: {
      id: 'bilibili-ls-helper@2050juyia.github.io',
      strict_min_version: '140.0',
      data_collection_permissions: {
        required: ['none']
      }
    }
  });
});

test('Firefox unpacked build places manifest.json at the archive root with identical runtime script bytes', () => {
  const outDir = path.join(root, 'work', 'firefox-manifest-test-build');
  const raw = execFileSync('python', [path.join(root, 'scripts', 'package.py'), '--firefox-unpacked', outDir], { encoding: 'utf8' });
  const result = JSON.parse(raw.trim());
  assert(fs.existsSync(path.join(outDir, 'manifest.json')));
  assert(fs.existsSync(result.archive));
  const derived = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(derived.browser_specific_settings.gecko.id, 'bilibili-ls-helper@2050juyia.github.io');
  for (const block of derived.content_scripts) {
    for (const file of block.js) {
      assert.deepEqual(
        fs.readFileSync(path.join(outDir, file)),
        fs.readFileSync(path.join(root, 'extension', file)),
        `runtime script must match extension/${file}`
      );
    }
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(result.archive, { force: true });
});

test('package.py --working-tree builds release Chromium and Firefox ZIPs with working-tree v1.5.3 bytes', () => {
  const outDir = path.join(root, 'work', 'firefox-working-tree-release-test');
  fs.rmSync(outDir, { recursive: true, force: true });
  const raw = execFileSync('python', [path.join(root, 'scripts', 'package.py'), '--working-tree', outDir], { encoding: 'utf8' });
  const result = JSON.parse(raw.trim());
  assert(fs.existsSync(result.archive));
  assert(fs.existsSync(result.firefoxArchive));
  const releaseMeta = JSON.parse(fs.readFileSync(path.join(outDir, 'release-manifest.json'), 'utf8'));
  assert.equal(releaseMeta.version, '1.5.3');
  assert.equal(releaseMeta.firefox.archive, 'bilibili-danmaku-assistant-v1.5.3-firefox.zip');
  assert.equal(releaseMeta.firefox.addonId, 'bilibili-ls-helper@2050juyia.github.io');
  assert.equal(releaseMeta.firefox.strictMinVersion, '140.0');
  const crypto = require('node:crypto');
  for (const rel of Object.keys(releaseMeta.firefox.files)) {
    if (rel === 'manifest.json' || rel === 'LICENSE' || rel === 'THIRD_PARTY_NOTICES.md') continue;
    const expected = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'extension', rel))).digest('hex');
    assert.equal(releaseMeta.firefox.files[rel], expected, `Firefox ZIP hash mismatch for ${rel}`);
    assert.equal(releaseMeta.files[rel], expected, `Chromium ZIP hash mismatch for ${rel}`);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
});
