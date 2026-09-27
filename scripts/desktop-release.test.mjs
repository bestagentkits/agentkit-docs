import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandDesktopRelease, readDesktopRelease, remarkDesktopRelease } from './lib/desktop-release.mjs';
import { syncDesktopAssets } from './lib/desktop-assets.mjs';

const assets = (version) => ['darwin_amd64', 'darwin_arm64', 'linux_amd64', 'windows_amd64'].map((p) => ({
  name: `ak-gui_${version}_${p}.${p === 'linux_amd64' ? 'AppImage' : 'zip'}`, size: 123, sha256: 'a'.repeat(64),
}));
test('release-only bump keeps MDX bytes and resolves exact channel data into Markdown nodes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-release-'));
  try {
    await mkdir(join(root, 'content/docs/beta/desktop-app'), { recursive: true });
    const path = join(root, 'content/docs/beta/desktop-app/installation.en.mdx');
    const source = '<DesktopDownloads />\nAK_DESKTOP_VERSION\nScreenshot verified on 1.0.0\n';
    await writeFile(path, source);
    for (const version of ['2.0.0-beta.1', '2.0.0-beta.2']) {
      await writeFile(join(root, 'channels.json'), JSON.stringify({ beta: { tag: `v${version}`, version } }));
      await syncDesktopAssets({ repoRoot: root, channel: 'beta', fromTag: 'v1.0.0', toTag: `v${version}`, assets: assets(version) });
      assert.equal(await readFile(path, 'utf8'), source);
      const evidencePath = join(root, `release-evidence/desktop/v${version}.json`);
      const evidenceBefore = await readFile(evidencePath, 'utf8');
      await syncDesktopAssets({ repoRoot: root, channel: 'beta', fromTag: `v${version}`, toTag: `v${version}`, assets: assets(version) });
      assert.equal(await readFile(evidencePath, 'utf8'), evidenceBefore);
      const dependencies = [];
      remarkDesktopRelease({ root })({ type: 'root', children: [{ type: 'text', value: 'AK_DESKTOP_VERSION' }] }, { path, data: { _compiler: { addDependency: p => dependencies.push(p) } } });
      assert.deepEqual(dependencies, [join(root, 'channels.json'), join(root, `release-evidence/desktop/v${version}.json`)]);
      const release = readDesktopRelease(root, 'beta');
      for (const locale of ['en', 'vi']) {
        const tree = { type: 'root', children: [{ type: 'mdxJsxFlowElement', name: 'DesktopDownloads' }, { type: 'code', value: 'sha256sum AK_DESKTOP_FILE_linux_amd64' }, { type: 'text', value: 'AK_DESKTOP_VERSION; verified 1.0.0' }] };
        expandDesktopRelease(tree, release, locale);
        assert.equal(tree.children[0].type, 'table');
        assert.equal(tree.children[0].children.length, 5);
        assert.match(tree.children[1].value, new RegExp(version.replaceAll('.', '\\.')));
        assert.equal(tree.children[2].value, `${version}; verified 1.0.0`);
        assert.doesNotMatch(JSON.stringify(tree), /AK_DESKTOP_|DesktopDownloads/);
      }
    }
    assert.throws(() => readDesktopRelease(root, 'stable'), /missing published/);
    await assert.rejects(syncDesktopAssets({ repoRoot: root, channel: 'beta', fromTag: 'v1.0.0', toTag: 'v2.0.0-beta.2', assets: assets('2.0.0-beta.2').map(a => ({ ...a, size: 999 })) }), /Conflicting/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
