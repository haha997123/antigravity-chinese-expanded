'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkUiBaseline } = require('./ui-compat.cjs');
const { readDictionaryLayers, refreshDictionary } = require('./dictionary-update.cjs');

const cachePath = path.join(__dirname, 'cache', 'dictionary-online.json');

class ClientBusy extends Error {}

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
    '$busy = Get-Process -Name installer,Antigravity-x64 -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($env:AG_ZH_UPDATE_CACHE, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1',
    'if ($busy) { "updating"; exit }',
    '$app = Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:AG_ZH_EXECUTABLE } | Select-Object -First 1',
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
  asar.uncache(archive);
  const version = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8')).version;
  const waiting = detail => ({
    status: 'waiting',
    version,
    message: detail + '。请等待汉化适配更新。',
  });

  const executableVersion = getVersion();
  if (executableVersion !== version) return waiting('客户端程序和界面资源版本不一致');
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
    const baseline = hasUiOnlyPatch(asar, archive) ? archive + '.bak' : archive;
    try {
      if (checkUiBaseline(asar, baseline, uiProfiles) !== version) return waiting('无法核对界面资源版本');
      original = sha256(baseline);
    } catch (error) {
      if (error.code && error.code !== 'ENOENT') throw error;
      return waiting('此版本的界面结构暂未通过兼容检查');
    }
  }
  if (installed !== original) {
    const preload = asar.extractFile(archive, 'dist/preload.js').toString('utf8');
    if (!preload.includes('ANTIGRAVITY CHINESE LOCALIZATION PATCH') ||
        !fs.existsSync(archive + '.bak') || sha256(archive + '.bak') !== original) {
      return waiting('未找到可验证的同版本原版文件');
    }
    if (receipt?.version === version && receipt.original === original &&
        (receipt.mode || 'full') === mode && receipt.revision === revision && receipt.patched === installed) {
      return uiOnly
        ? { status: 'partial', version, message: '已有译文已应用。此版本暂未完整适配，新增文案保留原文。' }
        : { status: 'already-applied', version, message: '当前汉化已是最新。可直接打开 Antigravity。' };
    }
  }

  const beforeCommit = () => {
    checkStopped();
    if (getVersion() !== version) throw new ClientBusy('客户端版本正在变化，请在更新完成后重试。');
  };
  checkStopped();
  const applied = await patch({ installDir, noKill: true, uiOnly, dictionary, uiProfiles, expectedAppSha256: installed, beforeCommit });
  if (applied.version !== version || applied.backupSha256 !== original) throw new Error('原版备份校验失败。');
  writeReceipt(receiptFile, { version, mode, original, revision, patched: applied.sha256 });
  return uiOnly
    ? { status: 'partial', version, message: '已补回已有译文。此版本暂未完整适配，新增文案保留原文。' }
    : { status: 'applied', version, message: '汉化已应用。请通过原来的快捷方式打开 Antigravity。' };
}

async function runLocalizer() {
  const local = process.env.LOCALAPPDATA;
  if (process.platform !== 'win32' || !local) throw new Error('此汉化器适用于 Windows。');
  const installDir = path.join(local, 'Programs', 'antigravity');
  const executable = path.join(installDir, 'Antigravity.exe');
  if (!fs.existsSync(executable)) throw new Error('未找到 Antigravity 安装。');
  const version = clientVersion(executable);
  const updaterCache = path.join(local, 'antigravity-updater');
  // Older copies use the same mutex to protect the same app.asar.
  const lock = '\\\\.\\pipe\\antigravity-chinese-' + hash(installDir.toLowerCase()).slice(0, 24);
  const server = net.createServer(connection => connection.destroy());
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(lock, resolve);
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
      return { status: 'busy', version, message: '另一个汉化器正在处理此安装。请稍后重试。' };
    }
    throw error;
  }

  const checkStopped = () => {
    const status = clientStatus(executable, updaterCache);
    if (status === 'updating') throw new ClientBusy('Antigravity 正在安装更新。请等待更新完成后重试。');
    if (status === 'running') throw new ClientBusy('请保存工作并正常退出 Antigravity，再点击重试。');
  };
  try {
    const update = await refreshDictionary({ cachePath, force: true });
    checkStopped();
    const result = await applyIfNeeded(installDir, checkStopped, () => clientVersion(executable));
    if (update.status === 'updated') result.message += ' 已下载 GitHub 词典 ' + update.releaseTag + '。';
    if (update.status === 'unavailable') result.message += ' 在线词典暂时不可用，已沿用本地数据。';
    return result;
  } catch (error) {
    if (error instanceof ClientBusy) return { status: 'busy', version, message: error.message };
    console.error(error.stack || error.message);
    return { status: 'error', version, message: error.message };
  } finally {
    server.close();
  }
}

module.exports = { applyIfNeeded };

if (require.main === module) {
  // Patch diagnostics go to stderr. The desktop window reads one JSON line on stdout.
  console.log = console.error;
  const output = result => {
    if (result.status === 'error') process.exitCode = 1;
    process.stdout.write(JSON.stringify(result) + '\n');
  };
  runLocalizer().then(output, error => output({ status: 'error', message: error.message }));
}
