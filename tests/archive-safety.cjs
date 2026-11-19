'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const { patch, revert } = require('../patch.js');

function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
async function fixture(root, label, version = '2.32.1') {
  const installDir = path.join(root, label);
  const source = path.join(installDir, 'source');
  const resources = path.join(installDir, 'resources');
  fs.mkdirSync(path.join(source, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(source, 'native'), { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'synthetic-antigravity-fixture', version }));
  for (const name of ['preload', 'main', 'menu', 'tray', 'updater', 'provisionSplash', 'ipcHandlers']) {
    fs.writeFileSync(path.join(source, 'dist', name + '.js'), "'use strict';\nconst fixtureValue = 1;\n");
  }
  fs.writeFileSync(path.join(source, 'native', 'fixture.node'), Buffer.from([0, 1, 2, 255, 42]));
  const app = path.join(resources, 'app.asar');
  await asar.createPackageWithOptions(source, app, { unpack: '**/*.node' });
  return { installDir, resources, app, backup: app + '.bak', metadata: app + '.bak.json', native: app + '.unpacked/native/fixture.node' };
}

async function main() {
  if (process.platform !== 'win32') {
    await assert.rejects(patch({ noKill: true }), /仅支持 Windows/);
    await assert.rejects(revert({ noKill: true }), /仅支持 Windows/);
    console.log('Platform guards passed; Windows archive fixtures skipped.');
    return;
  }
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'antigravity-patch-test-'));
  try {
    const initial = await fixture(root, 'repeat');
    const original = digest(initial.app), native = digest(initial.native);
    await patch({ installDir: initial.installDir, noKill: true });
    const first = digest(initial.app);
    assert.notEqual(first, original);
    assert.equal(digest(initial.backup), original);
    assert.equal(JSON.parse(fs.readFileSync(initial.metadata)).sha256, original);
    assert.equal(digest(initial.native), native);
    await patch({ installDir: initial.installDir, noKill: true });
    assert.equal(digest(initial.app), first, 'Repeated patch must rebuild from the original, without accumulating changes');
    assert.equal(digest(initial.backup), original);
    assert.equal(digest(initial.native), native);
    await revert({ installDir: initial.installDir, noKill: true });
    assert.equal(digest(initial.app), original, 'Revert must restore the exact original bytes');
    assert.equal(digest(initial.native), native);

    // Upstream legacy backups have no hash record; accept only the exact
    // supported version and patch-free layout, then create the record.
    await patch({ installDir: initial.installDir, noKill: true });
    fs.unlinkSync(initial.metadata);
    await patch({ installDir: initial.installDir, noKill: true });
    assert.equal(digest(initial.app), first);
    assert.equal(JSON.parse(fs.readFileSync(initial.metadata)).sha256, original);
    const metadata = JSON.parse(fs.readFileSync(initial.metadata));
    metadata.sha256 = '0'.repeat(64);
    fs.writeFileSync(initial.metadata, JSON.stringify(metadata));
    await assert.rejects(patch({ installDir: initial.installDir, noKill: true }), /校验失败/);
    await assert.rejects(revert({ installDir: initial.installDir, noKill: true }), /校验失败/);
    assert.equal(digest(initial.app), first);

    const missing = await fixture(root, 'missing-backup');
    await patch({ installDir: missing.installDir, noKill: true });
    const missingHash = digest(missing.app);
    fs.unlinkSync(missing.backup);
    await assert.rejects(patch({ installDir: missing.installDir, noKill: true }), /不能从已汉化客户端创建英文备份/);
    assert.equal(digest(missing.app), missingHash);
    assert.equal(fs.existsSync(missing.backup), false);

    const updated = await fixture(root, 'updated-2.32.2', '2.32.2');
    const updatedOriginal = digest(updated.app);
    await patch({ installDir: updated.installDir, noKill: true });
    assert.equal(JSON.parse(fs.readFileSync(updated.metadata)).version, '2.32.2');
    await revert({ installDir: updated.installDir, noKill: true });
    assert.equal(digest(updated.app), updatedOriginal, '2.32.2 must restore its own original archive');

    const unsupported = await fixture(root, 'unsupported', '2.34.0');
    const unknownHash = digest(unsupported.app);
    await assert.rejects(patch({ installDir: unsupported.installDir, noKill: true }), /不支持 Antigravity 2.34.0/);
    await assert.rejects(revert({ installDir: unsupported.installDir, noKill: true }), /不支持 Antigravity 2.34.0/);
    assert.equal(digest(unsupported.app), unknownHash);
    assert.equal(fs.existsSync(unsupported.backup), false);

    const invalidBackup = await fixture(root, 'invalid-backup');
    await patch({ installDir: invalidBackup.installDir, noKill: true });
    const invalidHash = digest(invalidBackup.app);
    fs.copyFileSync(invalidBackup.app, invalidBackup.backup);
    await assert.rejects(patch({ installDir: invalidBackup.installDir, noKill: true }), /备份已包含汉化补丁/);
    await assert.rejects(revert({ installDir: invalidBackup.installDir, noKill: true }), /备份已包含汉化补丁/);
    assert.equal(digest(invalidBackup.app), invalidHash);
    console.log('Archive safety passed: repeatable rebuild, exact revert, native preservation, legacy metadata, corrupted/missing/patched backup rejection, unsupported version rejection.');
  } finally {
    if (path.dirname(fs.realpathSync(root)) !== temporaryRoot || fs.lstatSync(root).isSymbolicLink()) throw new Error('Test cleanup containment check failed');
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
