'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { checkUiBaseline } = require('./ui-compat.cjs');
const { readDictionaryLayers, refreshDictionary } = require('./dictionary-update.cjs');

const cachePath = path.join(__dirname, 'cache', 'dictionary-online.json');

const originals = new Map([
  ['2.32.2', '056ba838faf9b75c1382a6a0ae003c4b051a3c3e50060a9e5b34987313492d77'],
  ['2.33.0', 'b33c81600e82e65593aa8430ef01b37d6b28d9d98f0faf45e25957783b71e64b'],
  ['2.34.0', '8934adef0622c9271c92eea950a71848764a66f7b10023ccbd82e54b959adb0e'],
]);
const inputs = ['patch.js', 'features/chinese-title-worker.js', 'features/chinese-title-service.js', 'package-lock.json'];

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sha256 = (file) => hash(fs.readFileSync(file));
function readReceipt(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    return null;
  }
}
function writeReceipt(file, value) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function runPowerShell(script, env) {
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function clientVersion(executable) {
  const version = runPowerShell(
    "$ErrorActionPreference='Stop'; (Get-Item -LiteralPath $env:AG_ZH_EXECUTABLE).VersionInfo.FileVersion",
    { AG_ZH_EXECUTABLE: executable },
  );
  return /^(\d+\.\d+\.\d+)(?:\.0)?$/.exec(version)?.[1];
}

function clientStatus(executable, cache) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$busy = Get-Process -Name installer -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($env:AG_ZH_UPDATE_CACHE, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1',
    'if ($busy) { "updating"; exit }',
    '$recent = (Get-Date).AddSeconds(-20)',
    '$app = Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:AG_ZH_EXECUTABLE -and ($_.MainWindowHandle -ne 0 -or $_.StartTime -gt $recent) } | Select-Object -First 1',
    'if ($app) { "running" } else { "idle" }',
  ].join('; ');
  const status = runPowerShell(script, {
    AG_ZH_EXECUTABLE: executable,
    AG_ZH_UPDATE_CACHE: cache + path.sep,
  });
  if (!['idle', 'running', 'updating'].includes(status)) throw new Error('无法确认客户端状态。');
  return status;
}

function patchInputs() {
  const bundledPath = path.join(__dirname, 'dictionary.json');
  const bundledTag = 'v' + require('./package.json').version;
  const layers = readDictionaryLayers({ bundledPath, cachePath, bundledTag });
  const localPath = path.join(__dirname, 'local-dictionary.json');
  let local = {};
  if (fs.existsSync(localPath)) {
    try {
      if (fs.statSync(localPath).size > 2 * 1024 * 1024) throw new Error('文件过大');
      local = JSON.parse(fs.readFileSync(localPath, 'utf8').replace(/^\uFEFF/, ''));
      if (!local || typeof local !== 'object' || Array.isArray(local) ||
          Object.entries(local).some(([key, value]) => !key.trim() || typeof value !== 'string' || !value.trim())) {
        throw new Error('需要使用原文和译文组成的 JSON 对象');
      }
    } catch (error) {
      console.warn('本地补充词典无法读取，继续使用可用词典：' + error.message);
      local = {};
    }
  }
  return { dictionary: { ...layers.dictionary, ...local }, uiProfiles: layers.uiProfiles };
}

async function applyIfNeeded(
  installDir,
  checkStopped,
  getVersion,
  receiptFile = path.join(__dirname, 'launcher-receipt.json'),
  { dictionary, uiProfiles } = patchInputs(),
) {
  const asar = require('@electron/asar');
  const { patch, hasUiOnlyPatch } = require('./patch.js');
  const archive = path.join(installDir, 'resources', 'app.asar');
  const version = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8')).version;
  const installed = sha256(archive);
  const receipt = readReceipt(receiptFile);
  const knownOriginal = originals.get(version);
  const uiOnly = !knownOriginal;
  const mode = uiOnly ? 'ui' : 'full';
  const revisionInputs = uiOnly ? [...inputs, 'ui-compat.cjs'] : inputs;
  const revision = hash(JSON.stringify([
    revisionInputs.map(file => [file, sha256(path.join(__dirname, file))]),
    dictionary,
  ]));

  let original = knownOriginal;
  if (uiOnly) {
    if (getVersion() !== version) throw new Error('客户端程序和界面资源的版本不一致，暂未应用汉化。');
    const baseline = hasUiOnlyPatch(asar, archive) ? archive + '.bak' : archive;
    if (checkUiBaseline(asar, baseline, uiProfiles) !== version) throw new Error('新版界面资源的版本校验失败。');
    original = sha256(baseline);
  }
  if (installed !== original) {
    const preload = asar.extractFile(archive, 'dist/preload.js').toString('utf8');
    if (!preload.includes('ANTIGRAVITY CHINESE LOCALIZATION PATCH') ||
        !fs.existsSync(archive + '.bak') || sha256(archive + '.bak') !== original) {
      throw new Error('当前客户端文件未通过校验，启动器没有替换它。');
    }
    if (receipt?.version === version && receipt.original === original &&
        (receipt.mode || 'full') === mode && receipt.revision === revision && receipt.patched === installed) {
      return '已使用当前汉化。';
    }
  }
  const beforeCommit = () => {
    checkStopped();
    if (uiOnly && getVersion() !== version) throw new Error('客户端程序在兼容检查期间发生变化。');
  };
  checkStopped();
  const applied = await patch({ installDir, noKill: true, uiOnly, dictionary, uiProfiles, expectedAppSha256: installed, beforeCommit });
  if (applied.version !== version || applied.backupSha256 !== original) throw new Error('原版备份校验失败。');
  writeReceipt(receiptFile, { version, mode, original, revision, patched: applied.sha256 });
  return uiOnly ? '已通过兼容检查并自动应用界面汉化。' : '已自动应用汉化。';
}

async function main() {
  const local = process.env.LOCALAPPDATA;
  if (process.platform !== 'win32' || !local) throw new Error('此启动器适用于 Windows。');
  const installDir = path.join(local, 'Programs', 'antigravity');
  const executable = path.join(installDir, 'Antigravity.exe');
  if (!fs.existsSync(executable)) throw new Error('未找到 Antigravity 安装。');
  const cache = path.join(local, 'antigravity-updater');
  const server = net.createServer((connection) => connection.destroy());
  const lock = '\\\\.\\pipe\\antigravity-chinese-' + hash(installDir.toLowerCase()).slice(0, 24);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(lock, resolve);
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
      console.log('另一个汉化启动器正在运行。');
      return;
    }
    throw error;
  }

  const checkStopped = () => {
    if (clientStatus(executable, cache) !== 'idle') throw new Error('客户端或更新器仍在运行，本次跳过汉化。');
  };
  try {
    try {
      const status = clientStatus(executable, cache);
      if (status === 'updating') throw new Error('Antigravity 正在安装更新，请完成后再使用桌面入口。');
      if (status === 'idle') {
        const update = await refreshDictionary({ cachePath });
        if (update.status === 'updated') console.log('已更新词典：' + update.releaseTag);
        console.log(await applyIfNeeded(installDir, checkStopped, () => clientVersion(executable)));
      }
      else console.log('Antigravity 已打开。若刚更新，请正常退出后再点此入口。');
    } catch (error) {
      console.warn(error.message);
      process.exitCode = 1;
      try {
        fs.writeFileSync(path.join(__dirname, 'launcher.log'), new Date().toISOString() + ' ' + error.message + '\n');
      } catch {}
    }
    if (clientStatus(executable, cache) === 'updating') return;
    const app = spawn(executable, [], { cwd: installDir, detached: true, stdio: 'ignore', windowsHide: false });
    app.once('error', (error) => { console.error('无法启动客户端：' + error.message); process.exitCode = 1; });
    app.unref();
  } finally {
    server.close();
  }
}

module.exports = { applyIfNeeded };

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
