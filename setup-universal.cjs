'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const INSTALL_FOLDER = 'AntigravityChinesePatch';
const SOURCE_FILES = [
  'configure-chinese-titles.cjs', 'dictionary.json', 'dictionary-update.cjs',
  'disable-chinese-titles.cmd', 'enable-chinese-titles.cmd',
  'features/chinese-title-service.js', 'features/chinese-title-worker.js',
  'install.cmd', 'launch-local.cmd', 'localizer.cjs', 'localizer.cmd', 'localizer-ui.ps1', 'patch.js',
  'package.json', 'package-lock.json', 'restore.cmd', 'setup-universal.cjs',
  'ui-compat.cjs', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
];

function getEntry(file) {
  try { return fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function requireDirectory(directory) {
  if (!getEntry(directory)?.isDirectory()) throw new Error('安装目录无效或指向其他位置：' + directory);
}

function ensureParent(root, relative) {
  let directory = root;
  for (const segment of relative.split('/').slice(0, -1)) {
    directory = path.join(directory, segment);
    if (!getEntry(directory)) fs.mkdirSync(directory);
    requireDirectory(directory);
  }
}

function installFiles(source, local, npmCli) {
  requireDirectory(source);
  requireDirectory(local);
  const realLocal = fs.realpathSync.native(local);
  const destination = path.join(realLocal, INSTALL_FOLDER);
  if (getEntry(destination)) requireDirectory(destination);
  const installedInPlace = fs.realpathSync.native(source).toLowerCase() === destination.toLowerCase();
  const stage = fs.mkdtempSync(path.join(realLocal, '.AntigravityChinesePatch-setup-'));
  let keepStage = false;
  try {
    for (const relative of SOURCE_FILES) {
      const input = path.join(source, relative);
      const inputDirectory = path.dirname(input);
      if (inputDirectory !== source) requireDirectory(inputDirectory);
      if (!getEntry(input)?.isFile()) throw new Error('安装包缺少文件或使用了文件链接：' + relative);
      ensureParent(stage, relative);
      fs.copyFileSync(input, path.join(stage, relative), fs.constants.COPYFILE_EXCL);
    }

    execFileSync(process.execPath, [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: stage, stdio: 'inherit',
    });
    requireDirectory(path.join(stage, 'node_modules'));
    if (!getEntry(destination)) {
      fs.renameSync(stage, destination);
      return destination;
    }

    const stagedEntries = installedInPlace ? ['node_modules'] : [...SOURCE_FILES, 'node_modules'];
    for (const relative of stagedEntries) {
      ensureParent(destination, relative);
      const old = getEntry(path.join(destination, relative));
      if (old && !(relative === 'node_modules' ? old.isDirectory() : old.isFile())) {
        throw new Error('现有安装中有同名目录或链接：' + relative);
      }
    }

    const changes = [];
    try {
      for (const relative of stagedEntries) {
        const input = path.join(stage, relative);
        const output = path.join(destination, relative);
        const saved = path.join(stage, '.previous', String(changes.length));
        const change = { input, output, saved, hadOriginal: false, replaced: false };
        changes.push(change);
        if (getEntry(output)) {
          fs.mkdirSync(path.dirname(saved), { recursive: true });
          fs.renameSync(output, saved);
          change.hadOriginal = true;
        }
        fs.renameSync(input, output);
        change.replaced = true;
      }
    } catch (error) {
      try {
        for (const change of changes.reverse()) {
          if (change.replaced) fs.renameSync(change.output, change.input);
          if (change.hadOriginal) fs.renameSync(change.saved, change.output);
        }
      } catch {
        keepStage = true;
        throw new Error('无法恢复旧安装。原有文件保存在：' + stage);
      }
      throw error;
    }
    return destination;
  } finally {
    if (!keepStage && getEntry(stage) && path.dirname(fs.realpathSync.native(stage)) === realLocal &&
        path.basename(stage).startsWith('.AntigravityChinesePatch-setup-') && getEntry(stage).isDirectory()) {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
}

function createShortcut(directory) {
  const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    "$desktop = [Environment]::GetFolderPath('DesktopDirectory')",
    "if (-not $desktop -or -not [IO.Directory]::Exists($desktop)) { throw '找不到桌面目录。' }",
    '$shell = New-Object -ComObject WScript.Shell',
    "$target = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -STA -File \"' + (Join-Path $env:AG_ZH_SETUP_DIRECTORY 'localizer-ui.ps1') + '\"'",
    'for ($index = 1; $index -le 100; $index++) {',
    "  $name = if ($index -eq 1) { 'Antigravity 汉化器' } else { 'Antigravity 汉化器 (' + $index + ')' }",
    "  $result = Join-Path $desktop ($name + '.lnk')",
    '  if (Test-Path -LiteralPath $result) {',
    '    if (-not (Test-Path -LiteralPath $result -PathType Leaf)) { continue }',
    '    try {',
    '      $existing = $shell.CreateShortcut($result)',
    '      if ($existing.TargetPath -eq $target -and $existing.Arguments -ceq $arguments) { $name; exit }',
    '    } catch {}',
    '    continue',
    '  }',
    "  $temporary = Join-Path $desktop ('.antigravity-chinese-' + [Guid]::NewGuid().ToString() + '.lnk')",
    '  try {',
    '    $link = $shell.CreateShortcut($temporary)',
    '    $link.TargetPath = $target',
    '    $link.Arguments = $arguments',
    '    $link.WorkingDirectory = $env:AG_ZH_SETUP_DIRECTORY',
    "    $link.Description = '检查 Antigravity 版本、更新词典并应用兼容的汉化补丁'",
    "    $icon = Join-Path $env:LOCALAPPDATA 'Programs\\antigravity\\Antigravity.exe'",
    "    if (Test-Path -LiteralPath $icon -PathType Leaf) { $link.IconLocation = $icon + ',0' }",
    '    $link.Save()',
    '    try { [IO.File]::Move($temporary, $result) }',
    '    catch { if (Test-Path -LiteralPath $result) { continue }; throw }',
    '    $name; exit',
    '  } finally {',
    '    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }',
    '  }',
    '}',
    "throw '没有可用的中文桌面快捷方式名称。'",
  ].join('\n');
  // Windows PowerShell 5.1 expects UTF-16LE for -EncodedCommand.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execFileSync(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, AG_ZH_SETUP_DIRECTORY: directory },
  }).trim();
}

function main() {
  const local = process.env.LOCALAPPDATA;
  if (process.platform !== 'win32' || !local || !path.isAbsolute(local)) throw new Error('此安装包仅支持 Windows。');
  if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('请先安装 Node.js 18 或更新版本。');
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!getEntry(npmCli)?.isFile()) throw new Error('找不到 npm。请安装包含 npm 的 Node.js 后重试。');
  if (!getEntry(path.join(local, 'Programs', 'antigravity', 'Antigravity.exe'))?.isFile()) {
    throw new Error('未找到默认路径中的 Antigravity。请先安装 Windows 版 Antigravity。');
  }
  const directory = installFiles(__dirname, local, npmCli);
  const shortcut = createShortcut(directory);
  console.log('已安装独立汉化器。请正常退出 Antigravity，然后双击桌面「' + shortcut + '」。');
}

module.exports = { installFiles, createShortcut };
if (require.main === module) {
  try { main(); }
  catch (error) { console.error('安装失败：' + error.message); process.exitCode = 1; }
}
