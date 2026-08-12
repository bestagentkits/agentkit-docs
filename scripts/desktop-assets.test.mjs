import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlatformMap, classifyAsset, syncDesktopAssets } from './lib/desktop-assets.mjs';

const FROM_TAG = 'v2.12.1-beta.6';
const TO_TAG = 'v2.12.1-beta.8';

const OLD_ASSETS = {
  darwin_amd64: { size: 12921725, sha256: '61088a9c1764f12fabf93258aadfc3e3b0b87a6f231d606d2dba08533ed03d65' },
  darwin_arm64: { size: 11940582, sha256: '9d25a29ed78e193826c1ee315b26a3f08fc81a90417418299c9f8687b57545c9' },
  linux_amd64: { size: 84810232, sha256: '4b8496aca5a9c049b0e5091227887cf3ed34979e79456780f543f22dc7881ecc' },
  windows_amd64: { size: 13026067, sha256: '82b4e0469dea581a1e87e1a6636ef9e727db6f16210fff78a2e52657d0982e55' },
};

const NEW_ASSETS = [
  { name: 'ak-gui_2.12.1-beta.8_darwin_amd64.zip', size: 12920008, sha256: '1e106fdfeea218310f18104c6990605efd4036729a30a0da2d6c84e4d359ff91' },
  { name: 'ak-gui_2.12.1-beta.8_darwin_arm64.zip', size: 11940163, sha256: 'da083e8bb1c994adf818249e3e01ef7d68b3544bf155b94aab3c4513f014c11f' },
  { name: 'ak-gui_2.12.1-beta.8_linux_amd64.AppImage', size: 90003960, sha256: '3a9650190fa12c557e4933be42f0bd134413560e576324e4f2c4f4ce9af27336' },
  { name: 'ak-gui_2.12.1-beta.8_windows_amd64.zip', size: 13024094, sha256: 'b5ba1d9594ea215916ac77439acc0fe515b2edaaeacc3c5a3e9644d30458e759' },
];

const PLATFORM_LABELS = {
  darwin_amd64: 'macOS Intel',
  darwin_arm64: 'macOS Apple silicon',
  linux_amd64: 'Linux x64',
  windows_amd64: 'Windows x64',
};

function fmtSize(n) {
  return n.toLocaleString('en-US');
}

function betaInstallationFixture(version) {
  const rows = ['darwin_amd64', 'darwin_arm64', 'linux_amd64', 'windows_amd64'].map((key) => {
    const meta = OLD_ASSETS[key];
    const ext = key === 'linux_amd64' ? 'AppImage' : 'zip';
    const filename = `ak-gui_${version}_${key}.${ext}`;
    return `| ${PLATFORM_LABELS[key]} | \`${filename}\` | ${fmtSize(meta.size)} | \`${meta.sha256}\` |`;
  });
  return [
    '---',
    `title: Install the Desktop app`,
    `description: Install AgentKit Desktop v${version}.`,
    '---',
    '',
    `AgentKit Desktop v${version} package.`,
    '',
    '| Platform | Artifact | Bytes | SHA-256 |',
    '| --- | --- | ---: | --- |',
    ...rows,
    '',
  ].join('\n');
}

function troubleshootingFixture(version) {
  return `# Troubleshooting v${version}\n\nRun \`chmod +x ak-gui_${version}_linux_amd64.AppImage\`.\n`;
}

let repoRoot;
let desktopDir;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'desktop-assets-'));
  desktopDir = join(repoRoot, 'content', 'docs', 'beta', 'desktop-app');
  await mkdir(desktopDir, { recursive: true });
  await writeFile(join(desktopDir, 'installation.en.mdx'), betaInstallationFixture('2.12.1-beta.6'));
  await writeFile(join(desktopDir, 'installation.vi.mdx'), betaInstallationFixture('2.12.1-beta.6'));
  await writeFile(join(desktopDir, 'troubleshooting.en.mdx'), troubleshootingFixture('2.12.1-beta.6'));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

test('classifyAsset returns the platform key for recognised ak-gui filenames', () => {
  assert.equal(classifyAsset('ak-gui_2.12.1-beta.8_darwin_amd64.zip'), 'darwin_amd64');
  assert.equal(classifyAsset('ak-gui_2.12.1-beta.8_linux_amd64.AppImage'), 'linux_amd64');
  assert.equal(classifyAsset('ak_2.12.1-beta.8_darwin_amd64.tar.gz'), null);
  assert.equal(classifyAsset('checksums.txt'), null);
});

test('buildPlatformMap throws when any supported platform is missing', () => {
  assert.throws(() => buildPlatformMap(NEW_ASSETS.slice(0, 2)), /missing for platforms/);
});

test('buildPlatformMap throws on duplicate platform', () => {
  assert.throws(
    () => buildPlatformMap([...NEW_ASSETS, NEW_ASSETS[0]]),
    /duplicate ak-gui asset/,
  );
});

test('syncDesktopAssets rewrites every ak-gui page in one pass', async () => {
  const res = await syncDesktopAssets({
    repoRoot,
    channel: 'beta',
    fromTag: FROM_TAG,
    toTag: TO_TAG,
    assets: NEW_ASSETS,
  });
  assert.equal(res.platforms, 4);
  assert.equal(res.changed.length, 3);

  const en = await readFile(join(desktopDir, 'installation.en.mdx'), 'utf8');
  assert.match(en, /Install AgentKit Desktop v2\.12\.1-beta\.8\./);
  assert.match(en, /`ak-gui_2\.12\.1-beta\.8_darwin_amd64\.zip` \| 12,920,008 \| `1e106fdfeea218310f18104c6990605efd4036729a30a0da2d6c84e4d359ff91`/);
  assert.match(en, /`ak-gui_2\.12\.1-beta\.8_linux_amd64\.AppImage` \| 90,003,960 \| `3a9650190fa12c557e4933be42f0bd134413560e576324e4f2c4f4ce9af27336`/);
  assert.doesNotMatch(en, /2\.12\.1-beta\.6/);
  assert.doesNotMatch(en, /61088a9c/);

  const vi = await readFile(join(desktopDir, 'installation.vi.mdx'), 'utf8');
  assert.match(vi, /`ak-gui_2\.12\.1-beta\.8_windows_amd64\.zip` \| 13,024,094 \| `b5ba1d9594ea215916ac77439acc0fe515b2edaaeacc3c5a3e9644d30458e759`/);

  const trouble = await readFile(join(desktopDir, 'troubleshooting.en.mdx'), 'utf8');
  assert.match(trouble, /ak-gui_2\.12\.1-beta\.8_linux_amd64\.AppImage/);
});

test('syncDesktopAssets is idempotent when fromTag equals toTag', async () => {
  const before = await readFile(join(desktopDir, 'installation.en.mdx'), 'utf8');
  const res = await syncDesktopAssets({
    repoRoot,
    channel: 'beta',
    fromTag: FROM_TAG,
    toTag: FROM_TAG,
    assets: NEW_ASSETS,
  });
  assert.deepEqual(res.changed, []);
  const after = await readFile(join(desktopDir, 'installation.en.mdx'), 'utf8');
  assert.equal(after, before);
});

test('re-running syncDesktopAssets with the same target is a no-op', async () => {
  await syncDesktopAssets({
    repoRoot,
    channel: 'beta',
    fromTag: FROM_TAG,
    toTag: TO_TAG,
    assets: NEW_ASSETS,
  });
  const snapshot = await readFile(join(desktopDir, 'installation.en.mdx'), 'utf8');
  const res = await syncDesktopAssets({
    repoRoot,
    channel: 'beta',
    fromTag: FROM_TAG,
    toTag: TO_TAG,
    assets: NEW_ASSETS,
  });
  assert.deepEqual(res.changed, []);
  const after = await readFile(join(desktopDir, 'installation.en.mdx'), 'utf8');
  assert.equal(after, snapshot);
});

test('syncDesktopAssets refuses when an asset is missing', async () => {
  await assert.rejects(
    () => syncDesktopAssets({
      repoRoot,
      channel: 'beta',
      fromTag: FROM_TAG,
      toTag: TO_TAG,
      assets: NEW_ASSETS.slice(0, 3),
    }),
    /missing for platforms/,
  );
});
