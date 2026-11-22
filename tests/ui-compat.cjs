'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const asar = require('@electron/asar');
const { patch, revert } = require('../patch.js');
const { applyIfNeeded } = require('../localizer.cjs');
const { checkUiBaseline } = require('../ui-compat.cjs');

const expectedPristine = '8934adef0622c9271c92eea950a71848764a66f7b10023ccbd82e54b959adb0e';
const testVersion = '2.99.0';
const preload = 'dist/preload.js';
const inArchive = name => name.replaceAll('/', path.sep);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const digest = file => hash(fs.readFileSync(file));

function archiveSnapshot(archive) {
  asar.uncache(archive);
  const files = new Map();
  for (const entry of asar.listPackage(archive)) {
    const name = entry.replaceAll(path.sep, '/').replace(/^\/+/, '');
    const stat = asar.statFile(archive, inArchive(name), false);
    if (stat.files) continue;
    if (stat.link) files.set(name, { link: stat.link });
    else files.set(name, {
      unpacked: Boolean(stat.unpacked),
      hash: hash(asar.extractFile(archive, inArchive(name))),
    });
  }
  return files;
}

async function repack(source, root, name, unpack) {
  const installDir = path.join(root, name);
  const assets = path.join(installDir, 'resources');
  fs.mkdirSync(assets, { recursive: true });
  const archive = path.join(assets, 'app.asar');
  const writer = await asar.createPackageWithOptions(source, archive, { unpack });
  // ASAR 3.4.1 resolves after calling end(), before Windows closes the descriptor.
  if (writer && !writer.closed) await once(writer, 'close');
  asar.uncache(archive);
  return { installDir, archive };
}

async function main() {
  assert.equal(process.platform, 'win32', 'The integration test uses the Windows Antigravity 2.34.0 archive.');
  const [sample = path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources', 'app.asar.bak'),
    sidecar = path.join(path.dirname(sample), 'app.asar.unpacked')] = process.argv.slice(2);
  assert.equal(digest(sample), expectedPristine, 'Provide the exact pristine Windows x64 Antigravity 2.34.0 sample.');

  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'antigravity-ui-compat-test-'));
  try {
    const copiedArchive = path.join(root, 'app.asar');
    fs.copyFileSync(sample, copiedArchive);
    await fs.promises.cp(sidecar, copiedArchive + '.unpacked', { recursive: true });
    const unpackedPaths = [...archiveSnapshot(copiedArchive)]
      .filter(([, entry]) => entry.unpacked)
      .map(([name]) => '**/' + name);
    assert.ok(unpackedPaths.length > 0, 'Fixture must cover genuine external resources.');
    const unpack = unpackedPaths.length === 1 ? unpackedPaths[0] : '{' + unpackedPaths.join(',') + '}';

    const source = path.join(root, 'extracted');
    asar.extractAll(copiedArchive, source);
    const manifest = path.join(source, 'package.json');
    const manifestData = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    manifestData.version = testVersion;
    fs.writeFileSync(manifest, JSON.stringify(manifestData, null, 2) + '\n');

    const clean = await repack(source, root, 'known-preload', unpack);
    const originalHash = digest(clean.archive);
    const originalFiles = archiveSnapshot(clean.archive);
    const originalPreload = asar.extractFile(clean.archive, inArchive(preload));
    assert.equal(checkUiBaseline(asar, clean.archive), testVersion);

    await assert.rejects(patch({ installDir: clean.installDir, noKill: true }), /2\.99\.0/);
    assert.equal(digest(clean.archive), originalHash, 'The full path still rejects the future fixture.');
    assert.equal(fs.existsSync(clean.archive + '.bak'), false);

    let checkedAtCommit = false;
    const options = {
      installDir: clean.installDir,
      noKill: true,
      uiOnly: true,
      expectedAppSha256: originalHash,
      beforeCommit() { checkedAtCommit = true; },
    };
    const applied = await patch(options);
    assert.equal(checkedAtCommit, true);
    assert.equal(applied.version, testVersion);
    assert.equal(applied.backupSha256, originalHash);
    assert.equal(digest(clean.archive + '.bak'), originalHash);
    assert.equal(applied.sha256, digest(clean.archive));
    assert.notEqual(applied.sha256, originalHash);

    const rebuiltFiles = archiveSnapshot(clean.archive);
    assert.deepEqual([...rebuiltFiles.keys()].sort(), [...originalFiles.keys()].sort());
    for (const [name, entry] of originalFiles) {
      if (name !== preload) assert.deepEqual(rebuiltFiles.get(name), entry, 'Changed unexpected file: ' + name);
    }
    assert.equal(rebuiltFiles.get(preload).unpacked, false);
    const modifiedPreload = asar.extractFile(clean.archive, inArchive(preload));
    assert.ok(modifiedPreload.subarray(0, originalPreload.length).equals(originalPreload),
      'Future fallback must preserve the original preload bytes as a prefix.');
    const addition = modifiedPreload.subarray(originalPreload.length).toString('utf8');
    assert.match(addition, /\bMutationObserver\b/, 'The fallback must contain the DOM translator.');
    assert.doesNotMatch(addition, /ipcRenderer|contextBridge|window\.electronNative|_agTranslateContextMenuItems/,
      'The fallback must leave Electron and context menu bridges alone.');
    new vm.Script(modifiedPreload.toString('utf8'), { filename: preload });

    const reapplied = await patch({ ...options, expectedAppSha256: applied.sha256 });
    assert.equal(reapplied.sha256, applied.sha256, 'Repeated fallback must not stack injected code.');
    await revert({ installDir: clean.installDir, noKill: true });
    assert.equal(digest(clean.archive), originalHash, 'Restore must reproduce the exact future original.');
    assert.deepEqual(archiveSnapshot(clean.archive), originalFiles);

    const preloadSource = path.join(source, inArchive(preload));
    fs.appendFileSync(preloadSource, '\n// Incompatible upstream preload change.\n');
    const changed = await repack(source, root, 'changed-preload', unpack);
    const changedHash = digest(changed.archive);
    assert.throws(() => checkUiBaseline(asar, changed.archive), /preload|兼容|结构|校验|完整性/i);
    await assert.rejects(patch({
      installDir: changed.installDir,
      noKill: true,
      uiOnly: true,
      expectedAppSha256: changedHash,
    }), /preload|兼容|结构|校验|完整性/i);
    assert.equal(digest(changed.archive), changedHash, 'Rejected preload must remain exactly as installed.');
    assert.equal(fs.existsSync(changed.archive + '.bak'), false);
    assert.equal(fs.existsSync(changed.archive + '.bak.json'), false);
    const receipt = path.join(root, 'local-receipt.json');
    const stopped = () => {};
    const mismatch = await applyIfNeeded(clean.installDir, stopped, () => '2.99.1', receipt);
    assert.equal(mismatch.status, 'waiting');
    assert.match(mismatch.message, /版本不一致/);
    assert.equal(digest(clean.archive), originalHash);
    assert.equal(fs.existsSync(receipt), false);
    const result = await applyIfNeeded(clean.installDir, stopped, () => testVersion, receipt);
    assert.equal(result.status, 'partial');
    assert.match(result.message, /已补回已有译文/);
    assert.equal(digest(clean.archive), applied.sha256);
    const cached = await applyIfNeeded(clean.installDir, () => { throw new Error('Unexpected second write'); }, () => testVersion, receipt);
    assert.equal(cached.status, 'partial');
    assert.match(cached.message, /已有译文已应用/);
    const dictionary = require('../dictionary.json');
    const updatedDictionary = { ...dictionary, 'Search Hosts…': '搜索远程主机…' };
    const updated = await applyIfNeeded(clean.installDir, stopped, () => testVersion, receipt, {
      dictionary: updatedDictionary, uiProfiles: [],
    });
    assert.equal(updated.status, 'partial');
    asar.uncache(clean.archive);
    assert.match(asar.extractFile(clean.archive, preload).toString('utf8'), /搜索远程主机…/);
    assert.notEqual(digest(clean.archive), applied.sha256, 'A new dictionary must invalidate the prior receipt.');
    const waiting = await applyIfNeeded(changed.installDir, stopped, () => testVersion, receipt);
    assert.equal(waiting.status, 'waiting');
    assert.match(waiting.message, /等待汉化适配更新/);
    assert.equal(digest(changed.archive), changedHash);
    await revert({ installDir: clean.installDir, noKill: true });
    assert.equal(digest(clean.archive), originalHash);
    assert.equal(digest(sample), expectedPristine, 'The real 2.34.0 sample is read-only.');
    console.log('UI compatibility passed: future version, standalone status/skip, changed preload refusal, unchanged external resources, repeatable patch, exact revert.');
  } finally {
    if (path.dirname(fs.realpathSync(root)) !== temporaryRoot || fs.lstatSync(root).isSymbolicLink()) {
      throw new Error('UI compatibility test cleanup containment check failed.');
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
