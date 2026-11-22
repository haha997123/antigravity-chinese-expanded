'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { Script } = require('node:vm');

// Byte fingerprints from the clean Windows Antigravity 2.34.0 archive.
const PRELOAD_SHA256 = 'd9641f990029ef095b6e93e76579b59de67c1ba56ba4ce84cb0429ecc9b6556a';
const UTILS_SHA256 = 'b1a56e70e747389ee1143faba202ec4302fe6855cb77bc97d2c3a7fbbf372d1c';
const PATCH_MARKER = 'ANTIGRAVITY CHINESE LOCALIZATION PATCH';
const INVALID_NAME = /[\\/:*?"<>|\x00-\x1f\x7f]|[. ]$/;
const DEVICE_NAME = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function packedRange(entry, dataLength) {
  if (typeof entry.offset !== 'string' || !/^(0|[1-9]\d*)$/.test(entry.offset)) {
    throw new Error('ASAR 文件偏移无效。');
  }
  const start = Number(entry.offset);
  if (!Number.isSafeInteger(start) || start > dataLength || entry.size > dataLength - start) {
    throw new Error('ASAR 文件超出归档边界。');
  }
  return [start, start + entry.size];
}

function validateEntries(files, dataLength, ranges) {
  if (!isObject(files)) throw new Error('ASAR 文件列表无效。');
  const names = new Set();
  for (const [name, entry] of Object.entries(files)) {
    const foldedName = name.toUpperCase();
    if (!name || INVALID_NAME.test(name) || DEVICE_NAME.test(name.split('.')[0].trimEnd()) ||
        name === '__proto__' || names.has(foldedName)) {
      throw new Error('ASAR 含有不安全或重复的路径。');
    }
    names.add(foldedName);
    if (!isObject(entry) || Object.hasOwn(entry, 'link')) {
      throw new Error('ASAR 含有链接或无效条目。');
    }
    if (Object.hasOwn(entry, 'files')) {
      validateEntries(entry.files, dataLength, ranges);
      continue;
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 ||
        (entry.unpacked !== undefined && typeof entry.unpacked !== 'boolean')) {
      throw new Error('ASAR 文件元数据无效。');
    }
    if (!entry.unpacked) {
      const range = packedRange(entry, dataLength);
      if (entry.size) ranges.push(range);
    }
  }
}

function checkUiBaseline(asar, archive, profiles = []) {
  let bytes, files, dataStart;
  try {
    bytes = fs.readFileSync(archive);
    const headerSize = bytes.readUInt32LE(4);
    dataStart = 8 + headerSize;
    if (headerSize < 8 || headerSize % 4 !== 0 || dataStart > bytes.length) throw new Error();
    const raw = asar.getRawHeader(archive);
    const headerStringSize = bytes.readUInt32LE(12);
    if (raw.headerSize !== headerSize || 16 + headerStringSize > dataStart ||
        raw.headerString !== bytes.toString('utf8', 16, 16 + headerStringSize)) throw new Error();
    files = raw.header.files;
  } catch {
    throw new Error('无法读取 ASAR 文件列表。');
  }

  if (bytes.includes(PATCH_MARKER)) throw new Error('ASAR 已含汉化补丁，请使用原版。');
  const dataLength = bytes.length - dataStart;
  const ranges = [];
  validateEntries(files, dataLength, ranges);
  ranges.sort(([left], [right]) => left - right);
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index][0] < ranges[index - 1][1]) throw new Error('ASAR 文件范围重叠。');
  }

  function readPacked(entry) {
    if (!entry || entry.unpacked || entry.files) throw new Error('ASAR 缺少必需的内置文件。');
    const [start, end] = packedRange(entry, dataLength);
    return bytes.subarray(dataStart + start, dataStart + end);
  }

  let metadata;
  try {
    metadata = JSON.parse(readPacked(files['package.json']).toString('utf8'));
  } catch {
    throw new Error('无法读取 Antigravity 软件包信息。');
  }
  if (!isObject(metadata) || metadata.name !== 'antigravity' || metadata.main !== 'dist/main.js') {
    throw new Error('ASAR 不是预期的 Antigravity 软件包。');
  }
  const version = typeof metadata.version === 'string' &&
    metadata.version.match(/^2\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!version || Number(version[1]) < 34 || !version.slice(1).every(part => Number.isSafeInteger(Number(part)))) {
    throw new Error('客户端版本不符合界面汉化条件。');
  }

  const dist = files.dist?.files;
  readPacked(dist?.['main.js']);
  const preloadEntry = dist?.['preload.js'];
  const preload = readPacked(preloadEntry);
  const integrity = preloadEntry.integrity;
  const preloadSha256 = createHash('sha256').update(preload).digest('hex');
  if (preload.length >= 4 * 1024 * 1024 || integrity?.algorithm !== 'SHA256' ||
      integrity.blockSize !== 4 * 1024 * 1024 || integrity.hash !== preloadSha256 ||
      !Array.isArray(integrity.blocks) || integrity.blocks.length !== 1 ||
      integrity.blocks[0] !== preloadSha256) {
    throw new Error('客户端预加载文件的完整性记录不符合预期。');
  }
  const utils = readPacked(dist?.['utils.js']);
  const utilsSha256 = createHash('sha256').update(utils).digest('hex');
  const builtIn = preloadSha256 === PRELOAD_SHA256 && utilsSha256 === UTILS_SHA256;
  if (!builtIn && !profiles.some(profile => profile.preloadSha256 === preloadSha256 && profile.utilsSha256 === utilsSha256)) {
    throw new Error('客户端预加载或窗口结构已变化。');
  }
  try {
    new Script(preload.toString('utf8'), { filename: 'dist/preload.js' });
  } catch {
    throw new Error('客户端预加载脚本无法解析。');
  }
  return metadata.version;
}

module.exports = { checkUiBaseline };
