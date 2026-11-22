'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readDictionaryLayers, refreshDictionary } = require('../dictionary-update.cjs');

const repoUrl = 'https://github.com/haha997123/antigravity-chinese-expanded';
const latestUrl = 'https://api.github.com/repos/haha997123/antigravity-chinese-expanded/releases/latest';
const assetName = 'antigravity-chinese-dictionary.json';
const redirectUrl = 'https://release-assets.githubusercontent.com/github-production-release-asset/test';
const baseTag = 'v1.1.0';
const uiProfiles = [{ preloadSha256: 'a'.repeat(64), utilsSha256: 'b'.repeat(64) }];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = data => Buffer.from(JSON.stringify(data));
const response = (status, body = Buffer.alloc(0), headers = {}) => ({ status, body, headers });

function release(tag, payload, assetOverride = {}) {
  const browser_download_url = repoUrl + '/releases/download/' + tag + '/' + assetName;
  return {
    tag_name: tag, draft: false, prerelease: false,
    assets: payload ? [{
      name: assetName, state: 'uploaded', browser_download_url,
      size: payload.length, digest: 'sha256:' + sha256(payload), ...assetOverride,
    }] : [],
  };
}

function payloadFor(version) {
  return json({ schemaVersion: 1, version, dictionary: { Search: '查找', 'New hint': '新提示' }, uiProfiles });
}

function transport(metadata, payload, redirect = redirectUrl) {
  const seen = [];
  const request = async (url, options) => {
    seen.push(url.href);
    assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 5000);
    assert.ok(options.maxBytes > 0);
    if (url.href === latestUrl) {
      assert.equal(options.accept, 'application/vnd.github+json');
      return response(200, json(metadata));
    }
    if (url.href.startsWith(repoUrl + '/releases/download/')) {
      assert.equal(options.accept, 'application/octet-stream');
      return response(302, undefined, { location: redirect });
    }
    if (url.href === redirectUrl) return response(200, payload);
    assert.fail('Requested an unexpected URL: ' + url.href);
  };
  return { request, seen };
}

async function main() {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'antigravity-dictionary-update-test-'));
  try {
    const bundledPath = path.join(root, 'dictionary.json');
    const cachePath = path.join(root, 'cache', 'dictionary-online.json');
    fs.writeFileSync(bundledPath, json({ Search: '搜索', 'Bundled only': '内置词条' }));
    const layers = (bundledTag = baseTag) => readDictionaryLayers({ bundledPath, cachePath, bundledTag });
    const refresh = request => refreshDictionary({ cachePath, request, force: true });

    const before = layers();
    assert.equal(before.source, 'bundled');
    assert.equal(before.releaseTag, baseTag);
    assert.equal(before.version, '1.1.0');
    assert.deepEqual(before.uiProfiles, []);
    assert.equal(before.dictionary.Search, '搜索');

    const missing = transport(release('v1.0.9'));
    assert.deepEqual(await refresh(missing.request), { status: 'no-asset', releaseTag: 'v1.0.9' });
    assert.deepEqual(missing.seen, [latestUrl]);
    assert.equal(fs.existsSync(cachePath), false);
    assert.deepEqual(await refreshDictionary({ cachePath, request: () => assert.fail('Throttled call used the network') }),
      { status: 'throttled' });

    const valid = payloadFor('1.1.1');
    const good = transport(release('v1.1.1', valid), valid);
    assert.deepEqual(await refresh(good.request), { status: 'updated', releaseTag: 'v1.1.1' });
    assert.deepEqual(good.seen, [latestUrl, repoUrl + '/releases/download/v1.1.1/' + assetName, redirectUrl]);
    const after = layers();
    assert.equal(after.source, 'online');
    assert.equal(after.releaseTag, 'v1.1.1');
    assert.equal(after.version, '1.1.1');
    assert.deepEqual(after.uiProfiles, uiProfiles);
    assert.equal(Object.getPrototypeOf(after.dictionary), null);
    assert.equal(after.dictionary.Search, '查找');
    assert.equal(after.dictionary['New hint'], '新提示');
    assert.equal(after.dictionary['Bundled only'], '内置词条');
    assert.equal(layers('v1.2.0').dictionary.Search, '搜索', 'An older online dictionary cannot replace the newer bundle.');

    const previous = fs.readFileSync(cachePath);
    const current = transport(release('v1.1.1', valid), valid);
    assert.deepEqual(await refresh(current.request), { status: 'unchanged', releaseTag: 'v1.1.1' });
    assert.deepEqual(current.seen, [latestUrl]);
    const stale = transport(release('v1.0.10', payloadFor('1.0.10')));
    assert.deepEqual(await refresh(stale.request), { status: 'unchanged', releaseTag: 'v1.1.1' });
    assert.deepEqual(stale.seen, [latestUrl]);

    const newer = payloadFor('1.1.2');
    const mismatchedVersion = payloadFor('1.1.3');
    const badDictionary = Buffer.from('{"schemaVersion":1,"version":"1.1.2","dictionary":{"__proto__":"无效"}}');
    const nonStrings = json({ schemaVersion: 1, version: '1.1.2', dictionary: { Search: { code: 'ignored' } } });
    const badProfile = json({ schemaVersion: 1, version: '1.1.2', dictionary: { Search: '查询' },
      uiProfiles: [{ preloadSha256: '123', utilsSha256: 'b'.repeat(64) }] });
    const untrusted = 'https://example.com/malicious-dictionary.json';
    const signedDownlevel = 'http://release-assets.githubusercontent.com/github-production-release-asset/test';
    const unsafeRedirect = transport(release('v1.1.2', newer), newer, untrusted);
    const wrongScheme = transport(release('v1.1.2', newer), newer, signedDownlevel);
    const wrongAsset = transport(release('v1.1.2', newer, { browser_download_url: untrusted }), newer);
    const failedTransports = [
      unsafeRedirect,
      wrongScheme,
      wrongAsset,
      transport(release('v1.1.1', payloadFor('1.1.1'), { digest: 'sha256:' + '0'.repeat(64) })),
      transport(release('v1.1.2', newer, { digest: 'sha256:' + '0'.repeat(64) }), newer),
      transport(release('v1.1.2', newer, { digest: null }), newer),
      transport(release('v1.1.2', newer, { size: 3 * 1024 * 1024 }), newer),
      transport(release('v1.1.2', mismatchedVersion), mismatchedVersion),
      transport(release('v1.1.2', badDictionary), badDictionary),
      transport(release('v1.1.2', nonStrings), nonStrings),
      transport(release('v1.1.2', badProfile), badProfile),
      transport({ ...release('v1.1.2', newer), prerelease: true }, newer),
    ];
    for (const { request } of failedTransports) {
      assert.equal((await refresh(request)).status, 'unavailable');
      assert.ok(fs.readFileSync(cachePath).equals(previous), 'Rejected assets must not change the last verified cache.');
    }
    assert.equal(unsafeRedirect.seen.includes(untrusted), false);
    assert.equal(wrongScheme.seen.includes(signedDownlevel), false);
    assert.deepEqual(wrongAsset.seen, [latestUrl]);

    assert.equal((await refresh(async () => { throw new Error('offline'); })).status, 'unavailable');
    assert.equal(layers().dictionary.Search, '查找');
    const damagedCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    damagedCache.sha256 = '0'.repeat(64);
    fs.writeFileSync(cachePath, json(damagedCache));
    assert.equal(layers().source, 'bundled');
    assert.equal(layers().dictionary.Search, '搜索');
    assert.deepEqual(layers().uiProfiles, []);
    console.log('Dictionary update passed: stable GitHub asset, verified cache, timed network, version protection and offline fallback.');
  } finally {
    if (path.dirname(fs.realpathSync(root)) !== temporaryRoot || fs.lstatSync(root).isSymbolicLink()) {
      throw new Error('Dictionary test cleanup containment check failed.');
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
