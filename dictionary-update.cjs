'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const repository = 'haha997123/antigravity-chinese-expanded';
const latestUrl = 'https://api.github.com/repos/' + repository + '/releases/latest';
const assetName = 'antigravity-chinese-dictionary.json';
const deliveryHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const defaultBundle = path.join(__dirname, 'dictionary.json');
const defaultCache = path.join(__dirname, 'cache', 'dictionary-online.json');
const assetLimit = 2 * 1024 * 1024;
const metadataLimit = 512 * 1024;
const cacheLimit = Math.ceil(assetLimit / 3) * 4 + 512;
const checkInterval = 12 * 60 * 60 * 1000;
const requestBudget = 5000;
const decoder = new TextDecoder('utf-8', { fatal: true });
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const shaPattern = /^[0-9a-f]{64}$/i;

function releaseVersion(tag) {
  if (typeof tag !== 'string' || !/^v(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})$/.test(tag)) {
    throw new Error('词库发行版本无效。');
  }
  return tag.slice(1).split('.').map(Number);
}

function compareTags(left, right) {
  const a = releaseVersion(left), b = releaseVersion(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function readBounded(file, limit) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > limit || stat.size === 0) throw new Error('词库文件大小无效。');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) throw new Error('词库文件读取不完整。');
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (fs.readSync(descriptor, extra, 0, 1, null) !== 0) throw new Error('词库文件在读取期间变化。');
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateDictionary(data) {
  if (!isObject(data)) throw new Error('词库必须是 JSON 键值对象。');
  const entries = Object.entries(data);
  if (entries.length === 0 || entries.length > 30000) throw new Error('词条数量超出支持范围。');
  for (const [key, value] of entries) {
    const normalized = key.trim();
    if (!normalized || normalized === '__proto__' || normalized === 'constructor' || normalized === 'prototype' ||
        key.length > 8192 || typeof value !== 'string' || value.length > 8192 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(key + value)) {
      throw new Error('词库包含无效键或译文。');
    }
  }
  return data;
}

function validatePayload(bytes, releaseTag) {
  const data = JSON.parse(decoder.decode(bytes));
  if (!isObject(data) || data.schemaVersion !== 1 || typeof data.version !== 'string' ||
      releaseTag !== 'v' + data.version ||
      Object.keys(data).some(key => !['schemaVersion', 'version', 'dictionary', 'uiProfiles'].includes(key))) {
    throw new Error('在线词库的格式或发行版本不匹配。');
  }
  const dictionary = validateDictionary(data.dictionary);
  const profiles = Object.hasOwn(data, 'uiProfiles') ? data.uiProfiles : [];
  if (!Array.isArray(profiles) || profiles.length > 64) throw new Error('界面兼容档案数量无效。');
  const uiProfiles = profiles.map(profile => {
    if (!isObject(profile) || Object.keys(profile).length !== 2 ||
        typeof profile.preloadSha256 !== 'string' || !shaPattern.test(profile.preloadSha256) ||
        typeof profile.utilsSha256 !== 'string' || !shaPattern.test(profile.utilsSha256)) {
      throw new Error('界面兼容档案指纹无效。');
    }
    return { preloadSha256: profile.preloadSha256.toLowerCase(), utilsSha256: profile.utilsSha256.toLowerCase() };
  });
  return { dictionary, uiProfiles };
}

function readCache(cachePath) {
  try {
    const cache = JSON.parse(decoder.decode(readBounded(cachePath, cacheLimit)));
    if (!isObject(cache) || cache.schemaVersion !== 1 || typeof cache.body !== 'string' ||
        typeof cache.sha256 !== 'string' || !shaPattern.test(cache.sha256)) return null;
    releaseVersion(cache.releaseTag);
    const bytes = Buffer.from(cache.body, 'base64');
    if (!bytes.length || bytes.length > assetLimit || bytes.toString('base64') !== cache.body ||
        sha256(bytes) !== cache.sha256.toLowerCase()) return null;
    return { releaseTag: cache.releaseTag, sha256: cache.sha256.toLowerCase(), ...validatePayload(bytes, cache.releaseTag) };
  } catch {
    return null;
  }
}

function readDictionaryLayers({ bundledPath = defaultBundle, cachePath = defaultCache,
  bundledTag = 'v' + require('./package.json').version } = {}) {
  releaseVersion(bundledTag);
  const bundle = validateDictionary(JSON.parse(decoder.decode(readBounded(bundledPath, assetLimit))));
  const online = readCache(cachePath);
  const useOnline = online && compareTags(online.releaseTag, bundledTag) >= 0;
  const releaseTag = useOnline ? online.releaseTag : bundledTag;
  return {
    dictionary: Object.assign(Object.create(null), bundle, useOnline ? online.dictionary : {}),
    source: useOnline ? 'online' : 'bundled',
    releaseTag,
    version: releaseTag.slice(1),
    uiProfiles: useOnline ? online.uiProfiles : [],
  };
}

function atomicJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(data) + '\n', { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function requestBytes(url, { maxBytes, timeoutMs, accept }) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      rejectUnauthorized: true,
      headers: {
        'User-Agent': 'antigravity-chinese-dictionary',
        Accept: accept,
        'Accept-Encoding': 'identity',
      },
    }, response => {
      const { statusCode: status, headers } = response;
      if (status !== 200) {
        clearTimeout(timer);
        resolve({ status, headers, body: Buffer.alloc(0) });
        response.destroy();
        return;
      }
      const chunks = [];
      let size = 0;
      if (Number(headers['content-length']) > maxBytes) {
        request.destroy(new Error('在线词库响应过大。'));
        return;
      }
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) request.destroy(new Error('在线词库响应过大。'));
        else chunks.push(chunk);
      });
      response.once('error', fail);
      response.once('end', () => {
        clearTimeout(timer);
        resolve({ status, headers, body: Buffer.concat(chunks, size) });
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('在线词库检查超时。')), timeoutMs);
    function fail(error) {
      clearTimeout(timer);
      reject(error);
    }
    request.once('error', fail);
  });
}

function trustedHttps(url) {
  return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash;
}

function selectAsset(metadata) {
  if (!isObject(metadata) || metadata.draft !== false || metadata.prerelease !== false || !Array.isArray(metadata.assets)) {
    throw new Error('无法确认词库来自正式发行。');
  }
  const releaseTag = metadata.tag_name;
  releaseVersion(releaseTag);
  const assets = metadata.assets.filter(asset => isObject(asset) && asset.name === assetName);
  if (assets.length === 0) return { releaseTag };
  if (assets.length !== 1) throw new Error('正式发行中的词库附件不唯一。');
  const asset = assets[0];
  const url = 'https://github.com/' + repository + '/releases/download/' + releaseTag + '/' + assetName;
  const declared = typeof asset.digest === 'string' && /^sha256:([0-9a-f]{64})$/i.exec(asset.digest);
  if (asset.state !== 'uploaded' || asset.browser_download_url !== url || !declared ||
      !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > assetLimit) {
    throw new Error('在线词库附件缺少有效的来源、大小或 SHA-256。');
  }
  return { releaseTag, url, sha256: declared[1].toLowerCase(), size: asset.size };
}

function recentlyChecked(stamp) {
  try {
    const checkedAt = Number(decoder.decode(readBounded(stamp, 40)));
    const elapsed = Date.now() - checkedAt;
    return Number.isSafeInteger(checkedAt) && elapsed >= 0 && elapsed < checkInterval;
  } catch {
    return false;
  }
}

async function refreshDictionary({ cachePath = defaultCache, force = false, request = requestBytes } = {}) {
  const stamp = cachePath + '.checked';
  if (!force && recentlyChecked(stamp)) return { status: 'throttled' };
  const deadline = Date.now() + requestBudget;
  const withinBudget = async (url, maxBytes, accept) => {
    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0) throw new Error('在线词库检查超时。');
    const response = await request(url, { maxBytes, timeoutMs, accept });
    if (Date.now() > deadline) throw new Error('在线词库检查超时。');
    if (!Buffer.isBuffer(response.body) || response.body.length > maxBytes) throw new Error('在线词库响应过大。');
    return response;
  };
  try {
    const metadata = await withinBudget(new URL(latestUrl), metadataLimit, 'application/vnd.github+json');
    if (metadata.status !== 200) throw new Error('GitHub 发行查询失败（HTTP ' + metadata.status + '）。');
    const asset = selectAsset(JSON.parse(decoder.decode(metadata.body)));
    const { releaseTag } = asset;
    if (!asset.url) return { status: 'no-asset', releaseTag };
    const current = readCache(cachePath);
    const order = current ? compareTags(releaseTag, current.releaseTag) : 1;
    if (order < 0) return { status: 'unchanged', releaseTag: current.releaseTag };
    if (order === 0) {
      if (current.sha256 !== asset.sha256) throw new Error('同一发行标签的词库摘要已变化。');
      return { status: 'unchanged', releaseTag };
    }

    let url = new URL(asset.url);
    let response;
    for (let redirectCount = 0; ; redirectCount++) {
      response = await withinBudget(url, asset.size, 'application/octet-stream');
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers?.location;
      if (redirectCount >= 3 || typeof location !== 'string') throw new Error('在线词库的下载跳转无效。');
      url = new URL(location, url);
      if (!trustedHttps(url) || !deliveryHosts.has(url.hostname)) throw new Error('在线词库跳转到不受信任的下载地址。');
    }
    if (response.status !== 200 || response.body.length !== asset.size || sha256(response.body) !== asset.sha256) {
      throw new Error('在线词库的下载状态、大小或 SHA-256 校验失败。');
    }
    validatePayload(response.body, releaseTag);

    // Compare again after the network wait before replacing the local cache.
    const latest = readCache(cachePath);
    if (latest && compareTags(releaseTag, latest.releaseTag) <= 0) {
      if (latest.releaseTag === releaseTag && latest.sha256 !== asset.sha256) {
        throw new Error('同一发行标签的词库摘要已变化。');
      }
      return { status: 'unchanged', releaseTag: latest.releaseTag };
    }
    atomicJson(cachePath, { schemaVersion: 1, releaseTag, sha256: asset.sha256, body: response.body.toString('base64') });
    return { status: 'updated', releaseTag };
  } catch (error) {
    return { status: 'unavailable', message: error.message };
  } finally {
    try { atomicJson(stamp, Date.now()); } catch {}
  }
}

module.exports = { readDictionaryLayers, refreshDictionary };
