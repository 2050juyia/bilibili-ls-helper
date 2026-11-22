const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('Chromium manifest stays warning-free while derived Firefox manifest satisfies AMO MV3 rules', () => {
  const chromium = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  assert.equal(chromium.manifest_version, 3);
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
