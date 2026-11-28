'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const SUPPORTED_VERSION = '2.32.1';
const SUPPORTED_VERSIONS = ['2.32.1', '2.32.2', '2.33.0', '2.34.0', '2.35.1', '2.35.2', '2.36.0'];
const PATCH_MARKER = 'ANTIGRAVITY CHINESE LOCALIZATION PATCH';
const UI_PATCH_MARKER = '// ANTIGRAVITY CHINESE UI-ONLY PATCH';
const EXPECTED_MODULES = ['preload', 'main', 'menu', 'tray', 'updater', 'provisionSplash', 'ipcHandlers'];

function requireWindows() {
  if (process.platform !== 'win32') throw new Error(`本补丁仅支持 Windows Antigravity ${SUPPORTED_VERSIONS.join(' / ')}。`);
}

function loadAsar() {
  try { return require('@electron/asar'); }
  catch { throw new Error('缺少 @electron/asar，请先在补丁目录执行 npm ci。'); }
}

function getPaths(installDirectory) {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const installDir = path.resolve(installDirectory || process.env.ANTIGRAVITY_INSTALL_DIR || path.join(localAppData, 'Programs', 'antigravity'));
  const resourcesDir = path.join(installDir, 'resources');
  return {
    installDir, resourcesDir,
    app: path.join(resourcesDir, 'app.asar'),
    backup: path.join(resourcesDir, 'app.asar.bak'),
    metadata: path.join(resourcesDir, 'app.asar.bak.json'),
    executable: path.join(installDir, 'Antigravity.exe')
  };
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function containsMarker(file) { return fs.readFileSync(file).includes(PATCH_MARKER); }
function readVersion(asar, archive) {
  try {
    asar.uncache(archive);
    return JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8')).version;
  } catch (error) { throw new Error(`无法读取 ASAR 版本：${error.message}`); }
}
function validateArchive(asar, archive) {
  if (!fs.existsSync(archive)) throw new Error(`找不到文件：${archive}`);
  const version = readVersion(asar, archive);
  if (!SUPPORTED_VERSIONS.includes(version)) throw new Error(`不支持 Antigravity ${version || '未知版本'}；本补丁仅验证了 ${SUPPORTED_VERSIONS.join(' / ')}。`);
  for (const module of EXPECTED_MODULES) {
    try { asar.statFile(archive, path.join('dist', module + '.js')); }
    catch { throw new Error(`客户端结构不匹配：缺少 dist/${module}.js，未修改安装文件。`); }
  }
  return version;
}

function readReleaseTarget() {
  const manifest = path.join(__dirname, 'runtime', 'manifest.json');
  if (!fs.existsSync(manifest)) return undefined;
  const { clientVersion } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (clientVersion !== undefined && !SUPPORTED_VERSIONS.includes(clientVersion)) {
    throw new Error('安装包的目标客户端版本无效，请重新下载对应版本的 ZIP。');
  }
  return clientVersion;
}

function requireReleaseTarget(version, expectedVersion) {
  if (expectedVersion && version !== expectedVersion) {
    throw new Error(`此安装包适配 Antigravity ${expectedVersion}，当前客户端为 ${version}。请下载对应版本的 ZIP。`);
  }
}

// Write next to the destination, flush, then replace in one rename operation.
// A failed copy never truncates the installed archive or its original backup.
function atomicCopy(from, to) {
  const temporary = path.join(path.dirname(to), '.' + path.basename(to) + '.' + crypto.randomUUID() + '.tmp');
  try {
    fs.copyFileSync(from, temporary, fs.constants.COPYFILE_EXCL);
    const descriptor = fs.openSync(temporary, 'r+');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, to);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function writeMetadata(paths, version) {
  const temporary = path.join(paths.resourcesDir, '.antigravity-backup-meta.' + crypto.randomUUID() + '.tmp');
  try {
    fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, version, sha256: sha256(paths.backup) }, null, 2) + '\n', { flag: 'wx' });
    atomicCopy(temporary, paths.metadata);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function validateBackup(asar, paths, currentVersion, allowLegacyMetadata, validate = validateArchive) {
  if (!fs.existsSync(paths.backup)) throw new Error('缺少原始 app.asar.bak；不能从已汉化客户端创建英文备份。请先重新安装同版本官方客户端。');
  const backupVersion = validate(asar, paths.backup);
  if (backupVersion !== currentVersion) throw new Error('备份与当前客户端版本不一致，已停止。');
  if (containsMarker(paths.backup)) throw new Error('备份已包含汉化补丁，不能作为英文原版使用。');
  if (fs.existsSync(paths.metadata)) {
    let metadata;
    try { metadata = JSON.parse(fs.readFileSync(paths.metadata, 'utf8')); }
    catch { throw new Error('备份校验元数据损坏，已停止。'); }
    if (metadata.schemaVersion !== 1 || metadata.version !== backupVersion || !/^[0-9a-f]{64}$/.test(metadata.sha256 || '') || metadata.sha256 !== sha256(paths.backup)) {
      throw new Error('备份的版本或 SHA-256 校验失败，已停止。');
    }
  } else if (allowLegacyMetadata) {
    // A pre-existing upstream backup has no manifest. Accept it only after
    // checking the exact supported version, expected layout, and absence of the patch.
    console.warn('发现旧版备份：已核对同版本和客户端结构，补建 SHA-256 校验记录。');
    writeMetadata(paths, backupVersion);
  } else throw new Error('备份缺少 SHA-256 校验记录。');
  return paths.backup;
}

function prepareBaseline(asar, paths, version) {
  if (containsMarker(paths.app)) return validateBackup(asar, paths, version, true);
  // A newly installed or updated official archive becomes the clean baseline.
  // Do not reuse an old archive merely because a .bak file already exists.
  if (!fs.existsSync(paths.backup) || sha256(paths.backup) !== sha256(paths.app)) {
    atomicCopy(paths.app, paths.backup);
    writeMetadata(paths, version);
  } else if (!fs.existsSync(paths.metadata)) writeMetadata(paths, version);
  return validateBackup(asar, paths, version, false);
}

function requireClosedClient(paths) {
  // A copied archive can be tested in isolation without a client executable.
  if (!fs.existsSync(paths.executable)) return;
  const query = [
    '$ErrorActionPreference = "Stop"',
    '$apps = Get-Process -Name Antigravity -ErrorAction SilentlyContinue',
    '$running = $apps | Where-Object { -not $_.Path -or $_.Path -eq $env:ANTIGRAVITY_PATCH_EXECUTABLE }',
    'if ($running) { "running" } else { "closed" }',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: { ...process.env, ANTIGRAVITY_PATCH_EXECUTABLE: paths.executable }
  });
  const state = result.stdout?.trim();
  if (result.error || result.status !== 0 || !['running', 'closed'].includes(state)) {
    throw new Error('无法确认客户端是否已退出，已停止操作。');
  }
  if (state === 'running') throw new Error('请先保存工作并正常退出 Antigravity，再运行安装或还原脚本。');
}

function archiveFiles(asar, archive) {
  asar.uncache(archive);
  const result = new Map();
  function visit(files, prefix) {
    for (const [name, entry] of Object.entries(files)) {
      if (entry.files) visit(entry.files, prefix + name + '/');
      else result.set(prefix + name, entry);
    }
  }
  visit(asar.getRawHeader(archive).header.files, '');
  return result;
}
function verifyRebuiltArchive(asar, baseline, rebuilt) {
  const before = archiveFiles(asar, baseline), after = archiveFiles(asar, rebuilt);
  if (before.size !== after.size || [...before.keys()].some(name => !after.has(name))) throw new Error('重新打包后的文件列表不一致。');
  for (const [name, entry] of before) {
    const next = after.get(name);
    if (Boolean(entry.unpacked) !== Boolean(next.unpacked) || entry.link !== next.link) throw new Error(`ASAR 资源属性发生变化：${name}`);
    if (entry.link) continue;
    const oldBytes = asar.extractFile(baseline, name.replaceAll('/', path.sep));
    const newBytes = asar.extractFile(rebuilt, name.replaceAll('/', path.sep));
    if (!oldBytes.equals(newBytes)) {
      if (!EXPECTED_MODULES.some(module => name === 'dist/' + module + '.js')) throw new Error(`非预期的资源变化：${name}`);
      new vm.Script(newBytes.toString('utf8'), { filename: name });
    }
  }
  if (!containsMarker(rebuilt)) throw new Error('重新打包后缺少汉化补丁标记。');
}
// Copy ordinary sidecar files only. Some Windows Node builds crash in fs.cpSync
// on this resource tree, and links could lead extraction outside the fixture.
function copyUnpackedDirectory(source, destination) {
  if (!fs.lstatSync(source).isDirectory()) throw new Error('外置资源目录不是普通目录。');

  function copy(from, to) {
    const entry = fs.lstatSync(from);
    if ((!entry.isDirectory() && !entry.isFile()) || path.relative(from, fs.realpathSync.native(from))) {
      throw new Error('外置资源含链接或特殊文件，已停止汉化。');
    }
    if (entry.isFile()) {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      return;
    }
    fs.mkdirSync(to);
    for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name));
  }

  copy(fs.realpathSync.native(source), destination);
}

function cleanupRun(directory, temporaryRoot) {
  // Never clean a sibling run or follow a substituted run-directory symlink.
  if (!directory || !fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || path.dirname(fs.realpathSync(directory)) !== temporaryRoot) throw new Error('临时目录路径校验失败，请手动检查残留文件。');
  fs.rmSync(directory, { recursive: true, force: true });
}

function readDictionary(override) {
  const dictionary = override === undefined ? JSON.parse(fs.readFileSync(path.join(__dirname, 'dictionary.json'), 'utf8')) : override;
  if (!dictionary || Array.isArray(dictionary) || typeof dictionary !== 'object' || Object.entries(dictionary).some(([key, value]) => !key || typeof value !== 'string')) throw new Error('汉化词典格式不正确。');
  return dictionary;
}

function hasUiOnlyPatch(asar, archive) {
  asar.uncache(archive);
  try { return asar.extractFile(archive, 'dist/preload.js').includes(UI_PATCH_MARKER); }
  catch { return false; }
}

async function patch(options = {}) {
  requireWindows();
  const asar = loadAsar(), paths = getPaths(options.installDir);
  requireClosedClient(paths);
  const version = validateArchive(asar, paths.app);
  requireReleaseTarget(version, options.clientVersion);
  const dictionary = readDictionary(options.dictionary);
  const originalAppHash = sha256(paths.app);
  const changedAppMessage = '客户端文件在汉化期间发生变化，请确认版本后重试。';
  if (options.expectedAppSha256 && options.expectedAppSha256 !== originalAppHash) throw new Error(changedAppMessage);
  const baseline = prepareBaseline(asar, paths, version);
  const baselineHash = sha256(baseline);
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(temporaryRoot, 'antigravity-chinese-'));
  const extractedDir = path.join(temporary, 'extracted');
  const workingBaseline = path.join(temporary, 'baseline', 'app.asar');
  const rebuilt = path.join(temporary, 'app.asar');
  try {
    // ASAR resolves native assets next to the archive filename. The original
    // backup is app.asar.bak, while the untouched native directory is still
    // app.asar.unpacked. Pair both under a normal temporary app.asar name.
    fs.mkdirSync(path.dirname(workingBaseline), { recursive: true });
    fs.copyFileSync(baseline, workingBaseline);
    if (fs.existsSync(paths.app + '.unpacked')) copyUnpackedDirectory(paths.app + '.unpacked', workingBaseline + '.unpacked');
    asar.extractAll(workingBaseline, extractedDir);
    transformFiles(extractedDir, dictionary);
    const unpacked = [...archiveFiles(asar, workingBaseline)].filter(([, entry]) => entry.unpacked).map(([name]) => '**/' + name);
    const unpack = unpacked.length > 1 ? '{' + unpacked.join(',') + '}' : unpacked[0];
    await asar.createPackageWithOptions(extractedDir, rebuilt, unpack ? { unpack } : {});
    verifyRebuiltArchive(asar, workingBaseline, rebuilt);
    // Recheck the baseline immediately before replacement.
    await options.beforeCommit?.();
    requireClosedClient(paths);
    if (sha256(paths.app) !== originalAppHash) throw new Error(changedAppMessage);
    validateBackup(asar, paths, version, false);
    if (sha256(baseline) !== baselineHash) throw new Error('原始备份在汉化期间发生变化，请重试。');
    atomicCopy(rebuilt, paths.app);
  } finally { cleanupRun(temporary, temporaryRoot); }
  console.log(`汉化补丁已应用：Antigravity ${version}，${Object.keys(dictionary).length} 条词条。`);
  return { version, sha256: sha256(paths.app), backupSha256: sha256(paths.backup) };
}

async function revert(options = {}) {
  requireWindows();
  const asar = loadAsar(), paths = getPaths(options.installDir);
  requireClosedClient(paths);
  const currentHash = sha256(paths.app);
  // Older builds could leave a UI-only patch in an otherwise unlisted version.
  // Restore just its verified same-version backup without offering a new patch.
  const uiOnly = hasUiOnlyPatch(asar, paths.app);
  const version = uiOnly ? readVersion(asar, paths.app) : validateArchive(asar, paths.app);
  requireReleaseTarget(version, options.clientVersion);
  const backup = validateBackup(asar, paths, version, !uiOnly, uiOnly ? readVersion : validateArchive);
  requireClosedClient(paths);
  if (sha256(paths.app) !== currentHash) throw new Error('客户端文件在还原期间发生变化，请确认版本后重试。');
  atomicCopy(backup, paths.app);
  console.log('已还原为同版本的英文原版，账号、会话和项目配置未修改。');
  return { version, sha256: sha256(paths.app) };
}

function transformFiles(extractedDir, dictionary) {
  // 8. 注入汉化代码
  console.log('正在注入汉化补丁...');

  // A. 注入 preload.js
  const preloadPath = path.join(extractedDir, 'dist', 'preload.js');
  if (fs.existsSync(preloadPath)) {
    console.log('正在注入 preload.js...');
    const injectCode = buildInjectScript(dictionary);
    // 先剥离之前注入的汉化代码块，避免重复打补丁时不断堆积
    let preloadContent = fs.readFileSync(preloadPath, 'utf8');
    const injectBlockRe = /\/\/ ==================== ANTIGRAVITY CHINESE LOCALIZATION PATCH ====================[\s\S]*?\/\/ ==================== END OF ANTIGRAVITY CHINESE LOCALIZATION PATCH ====================/g;
    const stripped = preloadContent.replace(injectBlockRe, '');
    if (stripped !== preloadContent) {
      preloadContent = stripped;
      console.log('检测到旧版汉化注入代码，已先移除（防止重复堆积）。');
    }
    const showContextMenuAnchor = "showContextMenu: (items) => electron_1.ipcRenderer.invoke('window:show-context-menu', items),";
    const showContextMenuReplacement = "showContextMenu: (items) => electron_1.ipcRenderer.invoke('window:show-context-menu', typeof globalThis._agTranslateContextMenuItems === 'function' ? globalThis._agTranslateContextMenuItems(items) : items),";
    if (preloadContent.includes('window:show-context-menu') && !preloadContent.includes(showContextMenuReplacement)) {
      if (preloadContent.split(showContextMenuAnchor).length !== 2) {
        throw new Error('preload.js 右键菜单接口与受支持版本不匹配，已停止修改。');
      }
      preloadContent = preloadContent.replace(showContextMenuAnchor, () => showContextMenuReplacement);
    }
    fs.writeFileSync(preloadPath, preloadContent.replace(/\s+$/, '\n'), 'utf8');
    fs.appendFileSync(preloadPath, '\n\n' + injectCode);
  } else {
    console.warn('警告: 未找到 dist/preload.js');
  }

  // B. 修改 main.js 中的弹窗和托盘
  const mainPath = path.join(extractedDir, 'dist', 'main.js');
  if (fs.existsSync(mainPath)) {
    console.log('正在汉化 main.js (弹窗与托盘默认项)...');
    let mainContent = fs.readFileSync(mainPath, 'utf8');
    
    // Replace quit confirmation strings with regex to match varying whitespace/formatting
    mainContent = mainContent.replace(/buttons:\s*\[\s*'Cancel'\s*,\s*'Quit'\s*\]/g, "buttons: ['取消', '退出']");
    mainContent = mainContent.replace(/title:\s*'Confirm Quit'/g, "title: '确认退出'");
    mainContent = mainContent.replace(/message:\s*'Are you sure you want to quit\?'/g, "message: '您确定要退出吗？'");
    mainContent = mainContent.replace(/detail:\s*'There may be agents or background tasks running\.'/g, "detail: '可能还有智能体或后台任务正在运行。'");
    
    // Replace default tray options
    mainContent = mainContent.replace(/label:\s*'No agents running'/g, "label: '没有运行中的智能体'");
    mainContent = mainContent.replace(/label:\s*`Open \${electron_1\.app\.getName\(\)}`/g, "label: `打开 ${electron_1.app.getName()}`");
    mainContent = mainContent.replace(/label:\s*'Quit'/g, "label: '退出'");

    // Replace WSL-related dialogs (2.23.0 新增)
    mainContent = mainContent.replace(/title:\s*'WSL distro not found'/g, "title: '未找到 WSL 发行版'");
    mainContent = mainContent.replace(/message:\s*`The WSL distro "\$\{WSL_DISTRO\}" is no longer installed\.`/g, 'message: `WSL 发行版“${WSL_DISTRO}”已不再安装。`');
    mainContent = mainContent.replace(/detail:\s*'Antigravity opened on Windows instead\.'/g, "detail: 'Antigravity 已在 Windows 中打开。'");

    // Replace error box titles
    mainContent = mainContent.replace(/showErrorBox\('Binary not found'/g, "showErrorBox('未找到二进制文件'");
    mainContent = mainContent.replace(/showErrorBox\('WSL setup failed'/g, "showErrorBox('WSL 设置失败'");
    mainContent = mainContent.replace(/showErrorBox\('Startup failed'/g, "showErrorBox('启动失败'");
    
    const titleStartAnchor = '    const url = `${constants_1.WINDOW_ORIGIN}:${handle.port}/`;';
    if (mainContent.includes(titleStartAnchor)) {
      if (mainContent.split(titleStartAnchor).length !== 2) throw new Error('自动中文标题启动位置不唯一，已停止。');
      const { startChineseTitleWorker } = require('./features/chinese-title-worker.js');
      const { bootstrapChineseTitles } = require('./features/chinese-title-service.js');
      const titleBootstrap = '\nfunction _agZhTitleBootstrap(options) {\n' + startChineseTitleWorker.toString() + '\n' + bootstrapChineseTitles.toString() + '\nreturn bootstrapChineseTitles({...options,startWorker:startChineseTitleWorker});\n}\n';
      const titleCall = '    try { _agZhTitleBootstrap({ app: electron_1.app, getPort: () => (0, languageServer_1.getLsPort)() || handle.port, csrf }); } catch { console.error("[chinese-title] initialization failed"); }\n';
      mainContent = mainContent.replace(titleStartAnchor, () => titleCall + titleStartAnchor) + titleBootstrap;
    }
    fs.writeFileSync(mainPath, mainContent, 'utf8');
  }

  // C. 修改 menu.js 中的窗口菜单 + Electron 原生角色菜单汉化
  const menuPath = path.join(extractedDir, 'dist', 'menu.js');
  if (fs.existsSync(menuPath)) {
    console.log('正在汉化 menu.js (应用窗口菜单)...');
    let menuContent = fs.readFileSync(menuPath, 'utf8');
    menuContent = menuContent.replace(/label:\s*'New Window'/g, "label: '新建窗口'");
    menuContent = menuContent.replace(/label:\s*'Docs'/g, "label: '文档'");
    // WSL 菜单项（2.23.0 新增，经 new MenuItem 直接构建，不走 buildFromTemplate）
    menuContent = menuContent.replace(/label:\s*'Connect to WSL'/g, "label: '连接到 WSL'");
    menuContent = menuContent.replace(/label:\s*'Reopen Locally'/g, "label: '重新在本地打开'");
    // 缩放菜单项（2.31.2 新增）
    menuContent = menuContent.replace(/label:\s*item\.label\s*\|\|\s*'Actual Size'/g, "label: item.label || '实际大小'");
    fs.writeFileSync(menuPath, menuContent, 'utf8');
  }
  // C2. 注入 Electron 原生菜单角色中文化（文件/编辑/视图/窗口等 + Reset Zoom/Zoom In/Out）
  // 需在 main.js 的 BrowserWindow 创建后拦截 Menu.buildFromTemplate / setApplicationMenu，或直接覆写 utils.js 的 hideDevTools 之后注入翻译
  // 采用在 main.js 末尾追加一个菜单翻译补丁的方式：劫持 Electron.Menu.buildFromTemplate
  const menuPatchTarget = path.join(extractedDir, 'dist', 'utils.js');
  // 备用：若 utils.js 存在，尝试注入菜单翻译钩子
  if (fs.existsSync(path.join(extractedDir, 'dist', 'main.js'))) {
    const mainPatchPath = path.join(extractedDir, 'dist', 'main.js');
    let mainPatchContent = fs.readFileSync(mainPatchPath, 'utf8');
    if (!mainPatchContent.includes('ANTIGRAVITY_MENU_I18N_PATCH')) {
      const menuI18nInject = `
/* ANTIGRAVITY_MENU_I18N_PATCH */
try {
  const _electron = require('electron');
  const _roleLabelMap = {
    'undo': '撤销', 'redo': '重做', 'cut': '剪切', 'copy': '复制', 'paste': '粘贴',
    'pasteAndMatchStyle': '粘贴并匹配样式', 'delete': '删除', 'selectAll': '全选',
    'reload': '重新加载', 'forceReload': '强制重新加载', 'toggleDevTools': '切换开发者工具',
    'resetZoom': '重置缩放', 'zoomIn': '放大', 'zoomOut': '缩小',
    'togglefullscreen': '切换全屏', 'window': '窗口', 'minimize': '最小化', 'close': '关闭',
    'help': '帮助', 'about': '关于', 'services': '服务', 'hide': '隐藏', 'hideOthers': '隐藏其他',
    'unhide': '显示全部', 'quit': '退出', 'fileMenu': '文件', 'editMenu': '编辑', 'viewMenu': '视图'
  };
  const _labelMap = Object.assign(Object.create(null), ${JSON.stringify(dictionary)}, {
    'Bring All to Front': '前置全部窗口',
    'New Window': '新建窗口', 'Docs': '文档', 'Check for Updates': '检查更新',
    'Checking for Updates...': '正在检查更新...', 'Downloading Update...': '正在下载更新...', 'Restart to Update': '重启以完成更新',
    'Connect to WSL': '连接到 WSL', 'Reopen Locally': '重新在本地打开', 'Actual Size': '实际大小'
  });
  function _normalizeMenuLabel(text) {
    return typeof text === 'string' ? text.replace(/\\s+/g, ' ').trim() : '';
  }
  function _translateMenuTimeText(text) {
    const source = _normalizeMenuLabel(text);
    if (/^(?:just\\s*now|now)$/i.test(source)) return '刚刚';
    const relative = source.match(/^(\\d+)\\s*(mo|s|m|h|d|w|y)(?:\\s+ago)?$/i);
    if (!relative) return null;
    const units = { s: '秒', m: '分钟', h: '小时', d: '天', w: '周', mo: '个月', y: '年' };
    return relative[1] + ' ' + units[relative[2].toLowerCase()] + '前';
  }
  function _isPreservedMenuItem(item, parentId, parentLabel) {
    const id = item && typeof item.id === 'string' ? item.id : '';
    if ((parentId === 'move-to-group' || id.startsWith('group-')) && id !== 'group-new' && id !== 'group-remove') return true;
    if (parentLabel === 'Connect to WSL' || parentLabel === '连接到 WSL') return true;
    return false;
  }
  function _translateMenuLabel(item, parentId, parentLabel) {
    if (!item || typeof item.label !== 'string') return;
    if (_isPreservedMenuItem(item, parentId, parentLabel)) return;
    const id = typeof item.id === 'string' ? item.id : '';
    const normalized = _normalizeMenuLabel(item.label);
    if (!normalized) return;
    if (id === 'message-timestamp') {
      const timeTranslated = _translateMenuTimeText(normalized);
      if (timeTranslated !== null) { item.label = timeTranslated; return; }
    }
    if (id === 'forward' && normalized === 'Forward') { item.label = '前进'; return; }
    if (Object.prototype.hasOwnProperty.call(_labelMap, normalized)) {
      item.label = _labelMap[normalized];
      return;
    }
    // Electron 原生菜单中 Zoom 相关无固定 role 时 label 为 Reset Zoom 等
    if (normalized === 'Reset Zoom') item.label = '重置缩放';
    else if (normalized === 'Zoom In') item.label = '放大';
    else if (normalized === 'Zoom Out') item.label = '缩小';
  }
  function _applyMenuItemLocalization(item, parentId, parentLabel, onlyRoleIfNoLabel) {
    if (!item || typeof item !== 'object') return { nextParentId: parentId, nextParentLabel: parentLabel };
    const originalLabel = item.label;
    if (item.role) {
      const key = String(item.role).toLowerCase();
      if (Object.prototype.hasOwnProperty.call(_roleLabelMap, key) && (!onlyRoleIfNoLabel || !item.label)) {
        item.label = _roleLabelMap[key];
      }
      if (key === 'resetzoom') item.label = '重置缩放';
      else if (key === 'zoomin') item.label = '放大';
      else if (key === 'zoomout') item.label = '缩小';
    }
    _translateMenuLabel(item, parentId, parentLabel);
    return {
      nextParentId: (typeof item.id === 'string' && item.id) || parentId,
      nextParentLabel: originalLabel || item.label || parentLabel
    };
  }
  function _translateMenuItem(item, parentId, parentLabel) {
    if (!item) return;
    const { nextParentId, nextParentLabel } = _applyMenuItemLocalization(item, parentId, parentLabel, false);
    if (item.submenu && item.submenu.items) {
      for (const sub of item.submenu.items) _translateMenuItem(sub, nextParentId, nextParentLabel);
    } else if (Array.isArray(item.submenu)) {
      for (const sub of item.submenu) _translateMenuItem(sub, nextParentId, nextParentLabel);
    }
  }
  function _translateMenu(menu) {
    if (!menu || !menu.items) return;
    for (const item of menu.items) _translateMenuItem(item, '', '');
  }
  const _origBuildFromTemplate = _electron.Menu.buildFromTemplate;
  _electron.Menu.buildFromTemplate = function(template) {
    // 先翻译 template 中的 role/label（浅拷贝以避免原地改动传入对象）
    function translateTemplate(items, parentId, parentLabel) {
      if (!Array.isArray(items)) return items;
      return items.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const it = { ...item };
        const { nextParentId, nextParentLabel } = _applyMenuItemLocalization(it, parentId, parentLabel, true);
        if (Array.isArray(it.submenu)) it.submenu = translateTemplate(it.submenu, nextParentId, nextParentLabel);
        else if (it.submenu && Array.isArray(it.submenu.items)) _translateMenuItem({ submenu: it.submenu }, nextParentId, nextParentLabel);
        return it;
      });
    }
    const translatedTemplate = translateTemplate(template, '', '');
    const menu = _origBuildFromTemplate.call(this, translatedTemplate);
    _translateMenu(menu);
    return menu;
  };
  const _origSetAppMenu = _electron.Menu.setApplicationMenu;
  _electron.Menu.setApplicationMenu = function(menu) {
    if (menu) _translateMenu(menu);
    return _origSetAppMenu.call(this, menu);
  };
} catch(e) { console.error('[i18n-menu] patch failed', e && e.message); }
`;
      mainPatchContent += '\n' + menuI18nInject;
      fs.writeFileSync(mainPatchPath, mainPatchContent, 'utf8');
      console.log('已注入 Electron 原生菜单中文化补丁 (Reset Zoom 等)');
    }
  }

  // D. 修改 tray.js 中的托盘动态状态
  const trayPath = path.join(extractedDir, 'dist', 'tray.js');
  if (fs.existsSync(trayPath)) {
    console.log('正在汉化 tray.js (系统托盘动态状态)...');
    let trayContent = fs.readFileSync(trayPath, 'utf8');
    
    // Use regex to robustly match dynamic string concat regardless of indentation and newlines
    const trayRegex = /\(count\s*>\s*0\s*\?\s*`\$\{count\}`\s*:\s*'No'\)\s*\+\s*' agent'\s*\+\s*\(count\s*===\s*1\s*\?\s*''\s*:\s*'s'\)\s*\+\s*' running'/g;
    trayContent = trayContent.replace(trayRegex, "(count > 0 ? `${count} 个智能体正在运行` : '没有运行中的智能体')");
    
    fs.writeFileSync(trayPath, trayContent, 'utf8');
  }

  
  // E. 修改 updater.js 中的更新菜单与弹窗 (2.11 新增完整汉化)
  const updaterPath = path.join(extractedDir, 'dist', 'updater.js');
  if (fs.existsSync(updaterPath)) {
    console.log('正在汉化 updater.js (更新菜单与弹窗)...');
    let updaterContent = fs.readFileSync(updaterPath, 'utf8');
    // MenuUpdateStep 四态
    updaterContent = updaterContent.replace(/MenuUpdateStep\["CheckForUpdates"\]\s*=\s*"Check for Updates"/g, 'MenuUpdateStep["CheckForUpdates"] = "检查更新"');
    updaterContent = updaterContent.replace(/MenuUpdateStep\["CheckingForUpdates"\]\s*=\s*"Checking for Updates\.\.\."/g, 'MenuUpdateStep["CheckingForUpdates"] = "正在检查更新..."');
    updaterContent = updaterContent.replace(/MenuUpdateStep\["DownloadingUpdate"\]\s*=\s*"Downloading Update\.\.\."/g, 'MenuUpdateStep["DownloadingUpdate"] = "正在下载更新..."');
    updaterContent = updaterContent.replace(/MenuUpdateStep\["RestartToUpdate"\]\s*=\s*"Restart to Update"/g, 'MenuUpdateStep["RestartToUpdate"] = "重启以完成更新"');
    // 弹窗 title/message/buttons
    updaterContent = updaterContent.replace(/title:\s*'Check for Updates'/g, "title: '检查更新'");
    updaterContent = updaterContent.replace(/message:\s*'No updates available'/g, "message: '暂无可用更新'");
    updaterContent = updaterContent.replace(/buttons:\s*\[\s*'OK'\s*\]/g, "buttons: ['确定']");
    fs.writeFileSync(updaterPath, updaterContent, 'utf8');
  }

  // F. 修改 provisionSplash.js 中的 WSL 设置提示（2.23.0 新增）
  const splashPath = path.join(extractedDir, 'dist', 'provisionSplash.js');
  if (fs.existsSync(splashPath)) {
    console.log('正在汉化 provisionSplash.js (WSL 设置提示)...');
    let splashContent = fs.readFileSync(splashPath, 'utf8');
    splashContent = splashContent.replace(/Setting up WSL: \$\{escapeHtml\(distro\)\}/g, '正在设置 WSL：${escapeHtml(distro)}');
    fs.writeFileSync(splashPath, splashContent, 'utf8');
  }

  // G. 修改 ipcHandlers.js 中的文件对话框标题
  const ipcPath = path.join(extractedDir, 'dist', 'ipcHandlers.js');
  if (fs.existsSync(ipcPath)) {
    console.log('正在汉化 ipcHandlers.js (文件对话框)...');
    let ipcContent = fs.readFileSync(ipcPath, 'utf8');
    ipcContent = ipcContent.replace(/title:\s*'Open workspace'/g, "title: '打开工作空间'");
    ipcContent = ipcContent.replace(/title:\s*'Open workspaces'/g, "title: '打开工作空间'");
    // 2.23.0 新增：WSL 路径相关对话框
    ipcContent = ipcContent.replace(/showErrorBox\('Cannot open folder'/g, "showErrorBox('无法打开文件夹'");
    ipcContent = ipcContent.replace(/message:\s*'Folder is on the Windows filesystem'/g, "message: '文件夹位于 Windows 文件系统中'");
    // 2.31.2 新增：下载目录选择对话框
    ipcContent = ipcContent.replace(/title:\s*'Select Download Folder'/g, "title: '选择下载文件夹'");
    // Native notifications: match the supported 2.32.1 handler exactly. Dynamic
    // questions, commands, URLs, summaries and remote host names stay intact.
    const notificationChannel = "electron_1.ipcMain.handle('notification:send'";
    if (ipcContent.includes('notification:send')) {
      const notificationAnchor = [
        "    electron_1.ipcMain.handle('notification:send', (event, options) => {",
        "        // Named by their host: an SSH window can't pose as the app.",
        "        const remote = (0, remoteWindowSecurity_1.isRemoteContents)(event?.sender);",
        "        const label = (0, windowBackends_1.remoteBackendOf)(event?.sender)?.label ?? 'SSH';",
        '        const remoteTitle = truncate(options?.title, MAX_NOTIFICATION_TITLE);',
        '        const notification = new electron_1.Notification({',
        '            title: remote',
        '                ? truncate(remoteTitle ? `${label}: ${remoteTitle}` : label, MAX_NOTIFICATION_TITLE)',
        '                : options.title,',
        '            body: remote',
        '                ? truncate(options?.body, MAX_NOTIFICATION_BODY)',
        '                : options.body,',
        '            silent: options?.silent ?? false,',
        '        });',
      ].join('\n');
      if (ipcContent.split(notificationChannel).length !== 2 || ipcContent.split(notificationAnchor).length !== 2) {
        throw new Error('系统通知处理器与受支持的 Antigravity 2.32.1 不匹配，已停止修改。');
      }
      const notificationHelper = [
        '        const _localizedNotification = (() => {',
        '            const title = options?.title;',
        '            const body = options?.body;',
        '            if (options?.payload?.type !== "request_action") return { title, body };',
        '            const titles = {',
        '                "Requesting your permission in Terminal:": "请求您授权终端操作：",',
        '                "Requesting your permission to open URL:": "请求您授权打开网址：",',
        '                "The agent has questions for you:": "智能体有一些问题需要您回答：",',
        '                "The agent has a question for you:": "智能体有一个问题需要您回答：",',
        '                "Requesting your permission:": "请求您的授权：",',
        '                "Action requires your attention": "有操作需要您处理",',
        '            };',
        '            const translatedTitle = Object.prototype.hasOwnProperty.call(titles, title) ? titles[title] : title;',
        '            let translatedBody = body;',
        '            if (typeof body === "string") {',
        '                if (title === "Antigravity" || title === "Jetski") {',
        '                    if (body === "Agent finished") translatedBody = "智能体已完成";',
        '                    else if (body.startsWith("Agent finished: ")) translatedBody = "智能体已完成任务，点击查看结果。";',
        '                } else if (title === "Requesting your permission in Terminal:" && body.startsWith("Command: ")) {',
        '                    translatedBody = "命令：" + body.slice("Command: ".length);',
        '                } else if (title === "Requesting your permission to open URL:" && body.startsWith("URL: ")) {',
        '                    translatedBody = "URL：" + body.slice("URL: ".length);',
        '                } else if (title === "Action requires your attention" && body === "The agent is waiting for your input.") {',
        '                    translatedBody = "智能体正在等待您的输入。";',
        '                }',
        '            }',
        '            return { title: translatedTitle, body: translatedBody };',
        '        })();',
        '',
      ].join('\n');
      const replaceNotificationOnce = (source, before, after) => {
        if (source.split(before).length !== 2) throw new Error('系统通知汉化替换校验失败，已停止修改。');
        return source.replace(before, () => after);
      };
      let localizedNotification = replaceNotificationOnce(notificationAnchor,
        '        const remoteTitle = truncate(options?.title, MAX_NOTIFICATION_TITLE);',
        notificationHelper + '        const remoteTitle = truncate(_localizedNotification.title, MAX_NOTIFICATION_TITLE);');
      localizedNotification = replaceNotificationOnce(localizedNotification, ': options.title,', ': _localizedNotification.title,');
      localizedNotification = replaceNotificationOnce(localizedNotification, 'truncate(options?.body, MAX_NOTIFICATION_BODY)', 'truncate(_localizedNotification.body, MAX_NOTIFICATION_BODY)');
      localizedNotification = replaceNotificationOnce(localizedNotification, ': options.body,', ': _localizedNotification.body,');
      ipcContent = replaceNotificationOnce(ipcContent, notificationAnchor, localizedNotification);
    }
    fs.writeFileSync(ipcPath, ipcContent, 'utf8');
  }


}

function buildInjectScript(dict) {
  return `
// ==================== ANTIGRAVITY CHINESE LOCALIZATION PATCH ====================
(function() {
  if (window.location.protocol !== 'https:' || !['127.0.0.1', 'localhost'].includes(window.location.hostname)) return;
  const dictionary = ${JSON.stringify(dict, null, 2)};

  // Pre-normalize dictionary keys for whitespace robustness
  const preservedAutomationNames = new WeakSet();
  const normalizedDict = Object.create(null);
  for (const key in dictionary) {
    normalizedDict[key.replace(/\\s+/g, ' ').trim()] = dictionary[key];
  }

  // Regions whose text content must never be translated (user code, editable input).
  const EXCLUDE_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
  const EXCLUDE_SELECTOR = '.monaco-editor, .cm-editor, [contenteditable]:not([contenteditable="false"]), [data-testid="user-message"], [data-testid="agent-response"], [data-testid="commentable-content"], [data-testid="live-user-turn"], [data-testid="live-agent-turn"]';

  function isExcludedElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (EXCLUDE_TAGS.has(el.tagName)) return true;
    if (typeof el.matches !== 'function') return false;
    return el.matches(EXCLUDE_SELECTOR) || (el.matches('.font-mono.leading-relaxed') &&
      el.parentElement?.previousElementSibling?.getAttribute('data-testid') === 'theme-code-preview-toggle');
  }

  function isInExcludedZone(node) {
    if (node && preservedAutomationNames.has(node)) return true;
    let el = node && node.nodeType === Node.ELEMENT_NODE ? node : (node ? node.parentElement : null);
    while (el) {
      if (preservedAutomationNames.has(el) || isPluginNameElement(el) || isExcludedElement(el)) return true;
      el = el.parentElement;
    }
    return false;
  }

  function hasAncestorTestId(element, testId) {
    for (let current = element; current; current = current.parentElement) {
      if (current.getAttribute && current.getAttribute('data-testid') === testId) return true;
    }
    return false;
  }

  function isPluginNameElement(element) {
    const testId = element.getAttribute && element.getAttribute('data-testid');
    if (['featured-carousel-headline', 'featured-carousel-member-tile', 'plugin-view-title-bar-title', 'custom-view-pane-title', 'permission-app-header'].includes(testId)) return true;
    if (typeof testId === 'string' && testId.startsWith('conversation-group-') && testId !== 'conversation-group-header') return true;
    if (element.tagName === 'H2' && element.parentElement && element.parentElement.getAttribute && element.parentElement.getAttribute('data-testid') === 'conversation-group-header') return true;
    if (element.tagName === 'H3' && hasAncestorTestId(element, 'featured-carousel')) return true;
    const classes = (element.getAttribute && element.getAttribute('class') || '').split(/\\s+/);
    if (hasAncestorTestId(element, 'customization-card') && ['font-medium', 'text-foreground', 'truncate'].every(name => classes.includes(name))) return true;
    if ((window.location.pathname || '').startsWith('/customizations') && /^H[1-6]$/.test(element.tagName) && ['text-lg', 'font-medium', 'text-foreground'].every(name => classes.includes(name)) && document.querySelector('[data-testid="doc-row-modal"]')) return true;
    if ((window.location.pathname || '').startsWith('/customizations') && element.tagName === 'SPAN' && ['font-medium', 'flex-shrink-0'].every(name => classes.includes(name))) {
      const parentClasses = (element.parentElement && element.parentElement.getAttribute('class') || '').split(/\\s+/);
      if (parentClasses.includes('items-baseline') && parentClasses.includes('gap-2.5')) return true;
    }
    return (window.location.pathname || '').startsWith('/customizations') && element.tagName === 'H1' && ['text-xl', 'font-medium', 'tracking-tight', 'leading-tight', 'text-foreground', 'truncate', 'min-w-0'].every(name => classes.includes(name));
  }

  function replaceDisplayText(element, translated) {
    const leaves = [];
    function collect(node) {
      if (isInExcludedZone(node)) return;
      if (node.nodeType === Node.TEXT_NODE) leaves.push(node);
      else for (const child of node.childNodes) collect(child);
    }
    collect(element);
    if (!leaves.length) return;
    for (let index = 0; index < leaves.length; index++) {
      const value = index === 0 ? translated : '';
      if (leaves[index].textContent !== value) leaves[index].textContent = value;
    }
  }

  function translateProjectDeleteDescription(element) {
    if (element.tagName !== 'SPAN' || isInExcludedZone(element)) return false;
    function hasClasses(node, names) {
      const classes = node && node.getAttribute && (node.getAttribute('class') || '').split(/\\s+/);
      return classes && names.every(name => classes.includes(name));
    }
    // The settings row has a dedicated delete-project button beside its description.
    // Match its shipped structure rather than translating "including" globally.
    const description = element.parentElement;
    const column = description && description.parentElement;
    const row = column && column.parentElement;
    if (!description || description.tagName !== 'SPAN' || !hasClasses(description, ['text-sm', 'text-muted-foreground', 'whitespace-pre-wrap']) ||
        !column || column.tagName !== 'DIV' || !hasClasses(column, ['flex-1', 'flex', 'flex-col', 'gap-0.5']) ||
        !row || row.tagName !== 'DIV' || !hasClasses(row, ['w-full', 'bg-transparent', 'flex', 'justify-between', 'gap-4'])) return false;
    const hasDeleteButton = Array.from(row.childNodes).some(container => container.tagName === 'DIV' && hasClasses(container, ['shrink-0']) &&
      Array.from(container.childNodes).some(button => button.tagName === 'BUTTON' && button.getAttribute('data-testid') === 'delete-project-button'));
    if (!hasDeleteButton) return false;
    const nodes = Array.from(element.childNodes);
    const strongs = nodes.filter(node => node.tagName === 'STRONG');
    if (strongs.length < 1 || strongs.length > 2 || nodes.some(node => node.nodeType !== Node.TEXT_NODE && node.tagName !== 'STRONG')) return false;
    const name = strongs[0];
    const first = nodes.indexOf(name);
    const last = nodes.indexOf(strongs[strongs.length - 1]);
    const prefix = nodes.slice(0, first);
    const suffix = nodes.slice(last + 1);
    const textOf = list => list.map(node => node.textContent).join('');
    if (!/^(?:Permanently delete|永久删除)$/.test(textOf(prefix).trim()) || !/^[.。]$/.test(textOf(suffix).trim())) return false;
    const including = nodes.slice(first + 1, last);
    if (strongs.length === 2 && !/^(?:including|，?包括)$/.test(textOf(including).trim())) return false;
    if (!prefix.length || !suffix.length || (strongs.length === 2 && !including.length)) return false;
    preservedAutomationNames.add(name); // Project names are data, even if named Settings or including.
    function writeFragments(fragments, value) {
      fragments.forEach((node, index) => {
        const next = index === 0 ? value : '';
        if (node.textContent !== next) node.textContent = next;
      });
    }
    writeFragments(prefix, '永久删除 ');
    writeFragments(suffix, '。');
    if (strongs.length === 2) {
      writeFragments(including, '，包括 ');
      const count = strongs[1];
      if (count.childNodes.length === 1 && count.childNodes[0].nodeType === Node.TEXT_NODE) {
        // MRb creates these exact active/archived count forms; keep numeric values and STRONG nodes.
        const counts = count.textContent.match(/^(\\d+) (active|archived) conversations?(?: and (\\d+) (active|archived) conversations?)?$/);
        if (counts) {
          const label = (number, kind) => number + (kind === 'active' ? ' 个进行中的对话' : ' 个已归档的对话');
          const next = label(counts[1], counts[2]) + (counts[3] ? '和 ' + label(counts[3], counts[4]) : '');
          if (count.childNodes[0].textContent !== next) count.childNodes[0].textContent = next;
        }
      }
    }
    return true;
  }

  function translateComposedDescription(element) {
    if (isInExcludedZone(element)) return;
    if (translateProjectDeleteDescription(element)) return;
    if (element.tagName === 'P' && hasAncestorTestId(element, 'sidecar-list-empty')) {
      const emptyText = element.textContent.replace(/\\s+/g, ' ').trim();
      if (/^(?:No|否)\\s*automations\\s+yet$/i.test(emptyText)) {
        replaceDisplayText(element, '暂无自动化任务');
        return;
      }
    }
    if (!(window.location.pathname || '').startsWith('/customizations')) return;
    const classes = (element.getAttribute('class') || '').split(/\\s+/);
    const description = element.getAttribute('data-testid') === 'featured-carousel-description' ||
      (hasAncestorTestId(element, 'customization-card') && ['text-sm', 'text-muted-foreground', 'truncate'].every(name => classes.includes(name))) ||
      (['plugin-detail', 'doc-row-modal'].some(id => hasAncestorTestId(element, id)) && element.tagName === 'P' && classes.includes('text-muted-foreground') && classes.includes('leading-relaxed'));
    if (!description) return;
    const text = element.textContent.replace(/\\s+/g, ' ').trim();
    if (normalizedDict[text] && normalizedDict[text] !== text) replaceDisplayText(element, normalizedDict[text]);
  }

  function translateAutomationNotice(element) {
    if (element.tagName !== 'SPAN' || isInExcludedZone(element)) return;
    const noticeText = element.textContent.replace(/\\s+/g, ' ').trim();
    const inheritedMatch = noticeText.match(/(?:Also includes|此外还包含)\\s*(?:Global Permissions|全局权限)\\s+when working (in this project|in these conversations)\\./);
    if (inheritedMatch && noticeText.length < 650) {
      const scope = inheritedMatch[1] === 'in this project' ? '此项目' : '这些会话';
      const fragments = new Map([
        ['This project was created for', '此项目专为'], ['此项目是为', '此项目专为'],
        ['the', ''], ['an', '一个'], ['automation.', '自动化任务创建。 '],
        ['Also includes', '在' + scope + '中工作时，还会应用'],
        ['此外还包含', '在' + scope + '中工作时，还会应用'],
        ['when working', ''], [inheritedMatch[1], ''], ['.', '。']
      ]);
      function visitInherited(node) {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'STRONG') {
          preservedAutomationNames.add(node);
          return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          const key = node.textContent.trim();
          if (fragments.has(key) && fragments.get(key) !== node.textContent) node.textContent = fragments.get(key);
        } else for (const child of node.childNodes) visitInherited(child);
      }
      for (const child of element.childNodes) visitInherited(child);
      return;
    }
    const match = element.textContent.replace(/\\s+/g, ' ').trim().match(/^This (project|workspace) is managed by the (.+?) automation and can only be deleted by deleting that automation\\.$/i);
    if (!match) return;
    const entity = match[1].toLowerCase() === 'project' ? '项目' : '工作区';
    const fragments = new Map([
      ['This', '此'], [match[1], entity], ['is managed by the', '由'],
      ['automation and can only be deleted by deleting that automation.', ' 自动化任务管理，只有删除该自动化任务后才能删除此' + entity + '。']
    ]);
    function preserve(node) {
      preservedAutomationNames.add(node);
      if (node.nodeType !== Node.TEXT_NODE) for (const child of node.childNodes) preserve(child);
    }
    function visit(node) {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'STRONG') { preserve(node); return; }
      if (node.nodeType === Node.TEXT_NODE) {
        const translated = fragments.get(node.textContent.trim());
        if (translated && translated !== node.textContent) node.textContent = translated;
      } else for (const child of node.childNodes) visit(child);
    }
    for (const child of element.childNodes) visit(child);
  }

  function translateQuotaPermissionText(text) {
    const group = text.match(/^Models within this group:\\s*(.+)$/);
    if (group) return '此组内的模型：' + group[1];
    const reset = text.match(/^You have used some of your (weekly|(\\d+(?:\\.\\d+)?)-hour) limit, it will fully refresh in (.+)\\.$/);
    if (reset) {
      const units = {week:'周', day:'天', hour:'小时', minute:'分钟', second:'秒'};
      const expression = /(\\d+(?:\\.\\d+)?)\\s+(week|day|hour|minute|second)s?\\b/gi;
      const parts = Array.from(reset[3].matchAll(expression));
      const remainder = reset[3].replace(expression, '').replace(/\\band\\b|[,\\s]/gi, '');
      const quota = reset[1] === 'weekly' ? '每周配额' : ' ' + reset[2] + ' 小时配额';
      if (parts.length && !remainder) return '你已使用部分' + quota + '，将在 ' + parts.map(part => part[1] + ' ' + units[part[2].toLowerCase()]).join('，') + '后全部恢复。';
    }
    const listFiles = text.match(/^(Allow|Save rule to always allow) list files in (.+)\\?$/);
    if (listFiles) return (listFiles[1] === 'Allow' ? '允许列出 ' : '保存规则以始终允许列出 ') + listFiles[2] + ' 中的文件吗？';
    const search = text.match(/^(Allow|Save rule to always allow) search for (.+)\\?$/);
    if (search) return (search[1] === 'Allow' ? '允许搜索 ' : '保存规则以始终允许搜索 ') + search[2] + ' 吗？';
    const saveRule = text.match(/^Yes, save rule for '(.+)' (in this conversation|globally)$/);
    if (saveRule) return '是，' + (saveRule[2] === 'globally' ? '全局' : '在此会话中') + '保存“' + saveRule[1] + '”的规则';
    const allowPattern = text.match(/^Yes, and always allow '(.+)'( in this conversation)?$/);
    if (allowPattern) return '是，并' + (allowPattern[2] ? '在此会话中' : '') + '始终允许“' + allowPattern[1] + '”';
    const downloads = text.match(/^Yes, (allow|always allow) downloads from (.+?)( for this run| in this conversation)?$/);
    if (downloads) return '是，' + (downloads[3] === ' for this run' ? '仅本次运行' : downloads[3] === ' in this conversation' ? '在此会话中' : downloads[1] === 'always allow' ? '始终' : '') + '允许从 ' + downloads[2] + ' 下载';
    const allowTarget = text.match(/^Yes, (allow|always allow) (.+?)( in this conversation)?$/);
    if (allowTarget && (allowTarget[2] !== 'this time' && allowTarget[2] !== 'this download')) return '是，' + (allowTarget[3] ? '在此会话中' : '') + (allowTarget[1] === 'always allow' ? '始终' : '') + '允许 ' + allowTarget[2];
    return null;
  }

  function translatePermissionCards() {
    if (typeof document.querySelectorAll !== 'function') return;
    const placeholderEnglish = '(tell the agent what to do instead)';
    const placeholderChinese = normalizedDict[placeholderEnglish];
    const optionLabels = new Set();
    function normalized(node) { return node.textContent.replace(/\\s+/g, ' ').trim(); }
    function replaceLabel(element, translated) {
      const leaves = [];
      function collect(node) {
        if (node.nodeType === Node.TEXT_NODE) leaves.push(node);
        else if (!isExcludedElement(node) && node.getAttribute('data-testid') !== 'permission-app-header' && node.getAttribute('data-testid') !== 'permission-target-editor') {
          for (const child of node.childNodes) collect(child);
        }
      }
      collect(element);
      if (!leaves.length) return;
      for (let index = 0; index < leaves.length; index++) {
        const value = index === 0 ? translated : '';
        if (leaves[index].textContent !== value) leaves[index].textContent = value;
      }
    }
    function translateLeaves(element) {
      if (isExcludedElement(element)) return;
      for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const translated = translateText(child.textContent);
          if (translated !== null && translated !== child.textContent) child.textContent = translated;
        } else translateLeaves(child);
      }
    }
    for (const input of document.querySelectorAll('[data-testid="ask-question-writein"]')) {
      const placeholder = input.getAttribute('placeholder');
      if (input.tagName !== 'TEXTAREA' || ![placeholderEnglish, placeholderChinese].includes(placeholder)) continue;
      if (hasAncestorTestId(input, 'user-message') || hasAncestorTestId(input, 'live-user-turn')) continue;
      let protectedInput = false;
      for (let parent = input.parentElement; parent; parent = parent.parentElement) {
        if (EXCLUDE_TAGS.has(parent.tagName) || parent.matches('.monaco-editor, .cm-editor, [contenteditable]:not([contenteditable="false"])')) { protectedInput = true; break; }
      }
      if (protectedInput) continue;
      let card = input.parentElement;
      while (card) {
        const classes = (card.getAttribute('class') || '').split(/\\s+/);
        if (['no-focus-agent-input', 'no-focus-ring', 'outline-none'].every(name => classes.includes(name))) break;
        card = card.parentElement;
      }
      if (!card) continue;
      // Update the fixed placeholder only, never the user's input value.
      if (placeholderChinese && placeholder !== placeholderChinese) input.setAttribute('placeholder', placeholderChinese);
      for (const header of card.querySelectorAll('[data-testid="ask-question-header-text"]')) {
        for (const label of header.querySelectorAll('span')) {
          const classes = (label.getAttribute('class') || '').split(/\\s+/);
          if (label.getAttribute('data-testid') === 'permission-app-header' || !['font-medium', 'text-foreground', 'min-w-0', 'break-words'].every(name => classes.includes(name))) continue;
          const source = normalized(label);
          if (!/^(Allow |Save rule to always allow )/.test(source)) continue;
          const translated = translateText(source);
          if (translated !== null && translated !== source) replaceLabel(label, translated);
        }
      }
      for (const label of card.querySelectorAll('[data-testid="ask-question-option-text"]')) {
        const source = normalized(label);
        const translated = translateText(source);
        optionLabels.add(source);
        if (translated !== null) optionLabels.add(translated);
        if (translated !== null && translated !== source) replaceLabel(label, translated);
      }
      for (const button of card.querySelectorAll('[data-testid="interaction-skip-button"], [data-testid="interaction-continue-button"]')) translateLeaves(button);
    }
    if (optionLabels.size) {
      for (const label of document.querySelectorAll('[data-testid="ask-question-option-hover-card"]')) {
        const source = normalized(label);
        const translated = translateText(source);
        if (translated !== null && translated !== source && (optionLabels.has(source) || optionLabels.has(translated))) replaceLabel(label, translated);
      }
    }
  }

  const hiddenUiTemplateRules = [{"pattern": "^Give each Best of N fork its own clone of your Git repository instead of a copy-on-write overlay\\\\. Each fork is then a real repository, so commits it makes are kept when you choose it as the winner\\\\. Forks take longer to create, and the wait grows with the size of your repository\\\\.(.*?)$", "prefix": "Give each Best of N fork its own clone of your Git repository instead of a copy-on-write overlay. Each fork is then a real repository, so commits it makes are kept when you choose it as the winner. Forks take longer to create, and the wait grows with the size of your repository.", "replacement": "为 Best of N 的每个候选分支单独克隆 Git 仓库，使用完整仓库取代写入时复制的覆盖层。这样，每个分支都是实际仓库，选为胜出分支时会保留其中的提交。创建分支所需时间更长，仓库越大，等待时间越长。{0}", "maps": {}, "source_ids": [27], "fixed_length": 279}, {"pattern": "^Give each Best of N fork a full clone of your workspace, including its local commit history\\\\. Choosing a winner then gives your workspace that fork's state, so the commits it made are kept\\\\. Forks take longer to create than the default CitC clone\\\\.(.*?)$", "prefix": "Give each Best of N fork a full clone of your workspace, including its local commit history. Choosing a winner then gives your workspace that fork's state, so the commits it made are kept. Forks take longer to create than the default CitC clone.", "replacement": "为 Best of N 的每个候选分支完整克隆工作区，包括本地提交历史。选定胜出分支后，工作区将采用该分支的状态，并保留其中的提交。创建分支所需时间比默认的 CitC 克隆更长。{0}", "maps": {}, "source_ids": [26], "fixed_length": 245}, {"pattern": "^You have (.*?) conversations in progress\\\\. Updating will interrupt them, and they will automatically resume once the update completes\\\\.$", "prefix": "You have ", "replacement": "你有 {0} 个会话正在进行。更新会暂时中断这些会话，更新完成后会自动继续。", "maps": {}, "source_ids": [286], "fixed_length": 128}, {"pattern": "^Agents created by this (scheduled task|automation) run in a dedicated (workspace|project) with its own permissions\\\\. You can change the permissions in the (workspace|project) settings page\\\\.$", "prefix": "Agents created by this ", "replacement": "此{0}创建的智能体在专用{1}中运行，使用独立权限。您可以在{2}设置页面更改权限。", "maps": {"0": {"automation": "自动化", "scheduled task": "计划任务"}, "1": {"project": "项目", "workspace": "工作区"}, "2": {"project": "项目", "workspace": "工作区"}}, "source_ids": [160], "fixed_length": 123}, {"pattern": "^You have (.*?) conversations in progress\\\\. Updating will cancel them and you'll need to manually restart them\\\\.$", "prefix": "You have ", "replacement": "你有 {0} 个会话正在进行。更新会取消这些会话，你需要手动重新启动。", "maps": {}, "source_ids": [287], "fixed_length": 104}, {"pattern": "^No server is listening on port (.*?) inside the remote workspace\\\\. Start it, or ask the agent to, then retry\\\\.$", "prefix": "No server is listening on port ", "replacement": "远程工作区内没有服务器监听端口 {0}。请启动服务器，或让智能体启动，然后重试。", "maps": {}, "source_ids": [16], "fixed_length": 103}, {"pattern": "^Resume the conversation to start its workspace again, then start the server on port (.*?) and retry\\\\.$", "prefix": "Resume the conversation to start its workspace again, then start the server on port ", "replacement": "恢复会话以重新启动其工作区，然后在端口 {0} 启动服务器并重试。", "maps": {}, "source_ids": [15], "fixed_length": 95}, {"pattern": "^When toggled on, (.*?) collects usage data to help Google enhance performance and features\\\\.$", "prefix": "When toggled on, ", "replacement": "开启后，{0} 会收集使用数据，帮助 Google 改进性能和功能。", "maps": {}, "source_ids": [28], "fixed_length": 86}, {"pattern": "^(.*?) folders in this project could not be loaded because their locations are invalid\\\\.$", "prefix": "", "replacement": "此项目中的 {0} 个文件夹因位置无效而无法加载。", "maps": {}, "source_ids": [138], "fixed_length": 81}, {"pattern": "^Recording shortcut for (.*?)\\\\. Press keys to bind, Enter to save, Escape to cancel\\\\.$", "prefix": "Recording shortcut for ", "replacement": "正在为 {0} 录制快捷键。按下要绑定的按键，按 Enter 保存，按 Escape 取消。", "maps": {}, "source_ids": [45], "fixed_length": 77}, {"pattern": "^Microphone access for (.*?) was denied\\\\. Quit and reopen the app to be asked again\\\\.$", "prefix": "Microphone access for ", "replacement": "{0} 的麦克风访问权限被拒绝。退出并重新打开应用后，即可再次请求授权。", "maps": {}, "source_ids": [38], "fixed_length": 77}, {"pattern": "^The (.*?) MCP server requires configuration parameters before it can be started\\\\.$", "prefix": "The ", "replacement": "{0} MCP 服务器需要配置参数后才能启动。", "maps": {}, "source_ids": [186], "fixed_length": 75}, {"pattern": "^Receive product updates, tips, and promotions from Google (.*?) via email\\\\.$", "prefix": "Receive product updates, tips, and promotions from Google ", "replacement": "通过电子邮件接收 Google {0} 的产品更新、使用技巧和促销信息。", "maps": {}, "source_ids": [29], "fixed_length": 69}, {"pattern": "^Compare responses from (.*?) models side-by-side to find the best result\\\\.$", "prefix": "Compare responses from ", "replacement": "并排比较 {0} 个模型的回复，找出最佳结果。", "maps": {}, "source_ids": [231], "fixed_length": 68}, {"pattern": "^(.*?)\\\\. This commit is already pushed; amending will require a force push\\\\.$", "prefix": "", "replacement": "{0}。此提交已推送，修订后需要强制推送。", "maps": {}, "source_ids": [383], "fixed_length": 68}, {"pattern": "^The folder “(.*?)” does not exist\\\\. Would you like to create it\\\\?$", "prefix": "The folder “", "replacement": "文件夹“{0}”不存在。要创建它吗？", "maps": {}, "source_ids": [112], "fixed_length": 58}, {"pattern": "^Connect an account for (.*?) so the agent can run automations\\\\.$", "prefix": "Connect an account for ", "replacement": "为 {0} 连接账号，以便智能体运行自动化任务。", "maps": {}, "source_ids": [325], "fixed_length": 57}, {"pattern": "^This deletes (.*?) \\\\((.*?)\\\\) from your machine\\\\. You can't undo this\\\\.$", "prefix": "This deletes ", "replacement": "这将从您的设备中删除 {0}（{1}）。此操作无法撤销。", "maps": {"0": {"kind": "recording-count"}}, "source_ids": [58], "fixed_length": 56}, {"pattern": "^Environment paused\\\\. Click to resume it and load the (video|image)\\\\.$", "prefix": "Environment paused. Click to resume it and load the ", "replacement": "环境已暂停。点击恢复环境并加载{0}。", "maps": {"0": {"video": "视频", "image": "图片"}}, "source_ids": [127], "fixed_length": 53}, {"pattern": "^On top of those defaults, (.*?) requests the access below\\\\.$", "prefix": "On top of those defaults, ", "replacement": "除默认权限外，{0} 还请求以下访问权限。", "maps": {}, "source_ids": [158], "fixed_length": 53}, {"pattern": "^Cannot add folder: \\"(.*?)\\" is not a valid folder location\\\\.$", "prefix": "Cannot add folder: \\"", "replacement": "无法添加文件夹：“{0}”不是有效的文件夹位置。", "maps": {}, "source_ids": [82, 104], "fixed_length": 53}, {"pattern": "^Can’t create this path — “(.*?)” is a file, not a folder\\\\.$", "prefix": "Can’t create this path — “", "replacement": "无法创建此路径：“{0}”是文件，不是文件夹。", "maps": {}, "source_ids": [111], "fixed_length": 52}, {"pattern": "^This window's agents, files, and terminals are on (.*?)\\\\.$", "prefix": "This window's agents, files, and terminals are on ", "replacement": "此窗口的智能体、文件和终端位于 {0}。", "maps": {}, "source_ids": [101], "fixed_length": 51}, {"pattern": "^Low contrast ratio \\\\((.*?):1\\\\)\\\\. Text may be hard to read\\\\.$", "prefix": "Low contrast ratio (", "replacement": "对比度较低（{0}:1），文字可能难以阅读。", "maps": {}, "source_ids": [371], "fixed_length": 50}, {"pattern": "^Waiting for command completion \\\\(up to (.*?) seconds\\\\)$", "prefix": "Waiting for command completion (up to ", "replacement": "正在等待命令完成（最多 {0} 秒）", "maps": {}, "source_ids": [143], "fixed_length": 47}, {"pattern": "^Failed to save project Google3 configuration: (.*?)$", "prefix": "Failed to save project Google3 configuration: ", "replacement": "保存项目的 Google3 配置失败：{0}", "maps": {}, "source_ids": [66], "fixed_length": 46}, {"pattern": "^Agent permissions preset selector, current: (.*?)$", "prefix": "Agent permissions preset selector, current: ", "replacement": "智能体权限预设选择器，当前：{0}", "maps": {}, "source_ids": [238], "fixed_length": 44}, {"pattern": "^(.*?) is currently unable to handle this request\\\\.$", "prefix": "", "replacement": "{0} 当前无法处理此请求。", "maps": {}, "source_ids": [25], "fixed_length": 44}, {"pattern": "^Failed to save cloud permission settings: (.*?)$", "prefix": "Failed to save cloud permission settings: ", "replacement": "保存云端权限设置失败：{0}", "maps": {}, "source_ids": [59], "fixed_length": 42}, {"pattern": "^Cancel Questionnaire and Stop the Agent \\\\((.*?)\\\\)$", "prefix": "Cancel Questionnaire and Stop the Agent (", "replacement": "取消问卷并停止智能体（{0}）", "maps": {}, "source_ids": [132], "fixed_length": 42}, {"pattern": "^Sort and filter conversations \\\\((.*?) active\\\\)$", "prefix": "Sort and filter conversations (", "replacement": "排序和筛选会话（已启用 {0} 项筛选条件）", "maps": {}, "source_ids": [168], "fixed_length": 39}, {"pattern": "^Failed to save project permissions: (.*?)$", "prefix": "Failed to save project permissions: ", "replacement": "保存项目权限失败：{0}", "maps": {}, "source_ids": [85], "fixed_length": 36}, {"pattern": "^No more older messages, showing (.*?) of (.*?)$", "prefix": "No more older messages, showing ", "replacement": "没有更早的消息，已显示 {0} 条，共 {1} 条", "maps": {}, "source_ids": [290], "fixed_length": 36}, {"pattern": "^Minimum value is (-?\\\\d+(?:\\\\.\\\\d+)?)$", "prefix": "", "replacement": "最小值为 {0}", "maps": {}, "source_ids": ["elicitation-validation"], "fixed_length": 36}, {"pattern": "^Maximum value is (-?\\\\d+(?:\\\\.\\\\d+)?)$", "prefix": "", "replacement": "最大值为 {0}", "maps": {}, "source_ids": ["elicitation-validation"], "fixed_length": 36}, {"pattern": "^Install folder \\"(.*?)\\" is already in use$", "prefix": "Install folder \\"", "replacement": "安装文件夹“{0}”已被占用", "maps": {}, "source_ids": [184], "fixed_length": 35}, {"pattern": "^(.*?) could not find the requested page\\\\.$", "prefix": "", "replacement": "{0} 找不到请求的页面。", "maps": {}, "source_ids": [24], "fixed_length": 35}, {"pattern": "^Failed to save project settings: (.*?)$", "prefix": "Failed to save project settings: ", "replacement": "保存项目设置失败：{0}", "maps": {}, "source_ids": [84, 235], "fixed_length": 33}, {"pattern": "^Agent needs permission to act on (.*?)$", "prefix": "Agent needs permission to act on ", "replacement": "智能体需要您的授权才能操作{0}", "maps": {}, "source_ids": [128], "fixed_length": 33}, {"pattern": "^Load older messages, showing (.*?) of (.*?)$", "prefix": "Load older messages, showing ", "replacement": "加载更早的消息，已显示 {0} 条，共 {1} 条", "maps": {}, "source_ids": [289], "fixed_length": 33}, {"pattern": "^Account this MCP server uses: (.*?)$", "prefix": "Account this MCP server uses: ", "replacement": "此 MCP 服务器使用的账号：{0}", "maps": {}, "source_ids": [200], "fixed_length": 30}, {"pattern": "^Microphone blocked\\\\. Allow in (.*?)\\\\.$", "prefix": "Microphone blocked. Allow in ", "replacement": "麦克风已被阻止。请在 {0} 中允许访问。", "maps": {}, "source_ids": [37], "fixed_length": 30}, {"pattern": "^(.*?)\\\\. Starting in local workspace\\\\.$", "prefix": "", "replacement": "{0}。将在本地工作空间中启动。", "maps": {}, "source_ids": [239], "fixed_length": 30}, {"pattern": "^Failed to delete recordings: (.*?)$", "prefix": "Failed to delete recordings: ", "replacement": "删除录音失败：{0}", "maps": {}, "source_ids": [57], "fixed_length": 29}, {"pattern": "^Failed to unarchive project: (.*?)$", "prefix": "Failed to unarchive project: ", "replacement": "取消归档项目失败：{0}", "maps": {}, "source_ids": [115], "fixed_length": 29}, {"pattern": "^Failed to resolve folder: (.*?) \\\\((.*?)\\\\)$", "prefix": "Failed to resolve folder: ", "replacement": "解析文件夹失败：{0}（{1}）", "maps": {}, "source_ids": [83], "fixed_length": 29}, {"pattern": "^Marked (.*?) conversations as read$", "prefix": "Marked ", "replacement": "已将 {0} 个会话标为已读", "maps": {}, "source_ids": [169], "fixed_length": 29}, {"pattern": "^“(.*?)” isn’t a valid folder name\\\\.$", "prefix": "“", "replacement": "“{0}”不是有效的文件夹名称。", "maps": {}, "source_ids": [113], "fixed_length": 29}, {"pattern": "^Select at least (\\\\d+) items$", "prefix": "", "replacement": "至少选择 {0} 项", "maps": {}, "source_ids": ["elicitation-validation"], "fixed_length": 29}, {"pattern": "^Failed to select workspace: (.*?)$", "prefix": "Failed to select workspace: ", "replacement": "选择工作区失败：{0}", "maps": {}, "source_ids": [116], "fixed_length": 28}, {"pattern": "^Open URL in system browser: (.*?)$", "prefix": "Open URL in system browser: ", "replacement": "在系统浏览器中打开网址：{0}", "maps": {}, "source_ids": [140], "fixed_length": 28}, {"pattern": "^Agent permissions preset: (.*?), (.*?)$", "prefix": "Agent permissions preset: ", "replacement": "智能体权限预设：{0}，{1}", "maps": {}, "source_ids": [237], "fixed_length": 28}, {"pattern": "^(.*?) lines added, (.*?) lines removed$", "prefix": "", "replacement": "新增 {0} 行，删除 {1} 行", "maps": {}, "source_ids": [105], "fixed_length": 28}, {"pattern": "^Select at most (\\\\d+) items$", "prefix": "", "replacement": "最多选择 {0} 项", "maps": {}, "source_ids": ["elicitation-validation"], "fixed_length": 28}, {"pattern": "^Nothing is running on port (.*?)$", "prefix": "Nothing is running on port ", "replacement": "端口 {0} 上没有正在运行的服务", "maps": {}, "source_ids": [14], "fixed_length": 27}, {"pattern": "^No MCP servers found for \\"(.*?)\\"$", "prefix": "No MCP servers found for \\"", "replacement": "找不到与“{0}”匹配的 MCP 服务器", "maps": {}, "source_ids": [267], "fixed_length": 27}, {"pattern": "^Failed to create project: (.*?)$", "prefix": "Failed to create project: ", "replacement": "创建项目失败：{0}", "maps": {}, "source_ids": [137], "fixed_length": 26}, {"pattern": "^Edit side question title: (.*?)$", "prefix": "Edit side question title: ", "replacement": "编辑旁支提问标题：{0}", "maps": {}, "source_ids": [305], "fixed_length": 26}, {"pattern": "^A file already exists at (.*?)\\\\.$", "prefix": "A file already exists at ", "replacement": "{0} 处已存在文件。", "maps": {}, "source_ids": [110], "fixed_length": 26}, {"pattern": "^Configure (.*?), values missing$", "prefix": "Configure ", "replacement": "配置 {0}，尚有值未填写", "maps": {}, "source_ids": [193], "fixed_length": 26}, {"pattern": "^Make (.*?) the default (.*?) account$", "prefix": "Make ", "replacement": "将 {0} 设为默认的 {1} 账号", "maps": {}, "source_ids": [68], "fixed_length": 26}, {"pattern": "^Select project, current: (.*?)(.*?)$", "prefix": "Select project, current: ", "replacement": "选择项目，当前：{0}{1}", "maps": {}, "source_ids": [225], "fixed_length": 25}, {"pattern": "^Failed to save settings: (.*?)$", "prefix": "Failed to save settings: ", "replacement": "保存设置失败：{0}", "maps": {}, "source_ids": [236], "fixed_length": 25}, {"pattern": "^Filter skills and rules: (.*?)$", "prefix": "Filter skills and rules: ", "replacement": "筛选技能和规则：{0}", "maps": {}, "source_ids": [272], "fixed_length": 25}, {"pattern": "^Showing first (.*?) references$", "prefix": "Showing first ", "replacement": "仅显示前 {0} 条引用", "maps": {}, "source_ids": [171], "fixed_length": 25}, {"pattern": "^Open (.*?), (.*?)\\\\. Summarizing call$", "prefix": "Open ", "replacement": "打开{0}，{1}。正在总结通话", "maps": {}, "source_ids": [92], "fixed_length": 25}, {"pattern": "^Minimum length is (\\\\d+)$", "prefix": "", "replacement": "最少输入 {0} 个字符", "maps": {}, "source_ids": ["elicitation-validation"], "fixed_length": 25}, {"pattern": "^Maximum length is (\\\\d+)$", "prefix": "", "replacement": "最多输入 {0} 个字符", "maps": {}, "source_ids": ["elicitation-validation"], "fixed_length": 25}, {"pattern": "^Failed to save project: (.*?)$", "prefix": "Failed to save project: ", "replacement": "保存项目失败：{0}", "maps": {}, "source_ids": [77, 81, 102, 103], "fixed_length": 24}, {"pattern": "^No plugins found for \\"(.*?)\\"\\\\.$", "prefix": "No plugins found for \\"", "replacement": "找不到与“{0}”匹配的插件。", "maps": {}, "source_ids": [274], "fixed_length": 24}, {"pattern": "^Sign in from the (.*?) panel\\\\.$", "prefix": "Sign in from the ", "replacement": "请在 {0} 面板中登录。", "maps": {}, "source_ids": [31], "fixed_length": 24}, {"pattern": "^No (.*?) matching your search$", "prefix": "No ", "replacement": "没有与你的搜索匹配的{0}", "maps": {}, "source_ids": [363], "fixed_length": 24}, {"pattern": "^Authorization code for (.*?)$", "prefix": "Authorization code for ", "replacement": "{0} 的授权码", "maps": {}, "source_ids": [71], "fixed_length": 23}, {"pattern": "^Review permissions for (.*?)$", "prefix": "Review permissions for ", "replacement": "查看 {0} 的权限", "maps": {}, "source_ids": [157], "fixed_length": 23}, {"pattern": "^Failed to (set permissions for|mark as unread|archive|restore|unpin|move|pin) conversation$", "prefix": "Failed to ", "replacement": "{0}会话失败", "maps": {"0": {"pin": "置顶", "unpin": "取消置顶", "archive": "归档", "restore": "恢复", "mark as unread": "标为未读", "move": "移动", "set permissions for": "设置权限"}}, "source_ids": [109], "fixed_length": 23, "special_permissions_action": true}, {"pattern": "^Show (.*?) in the list again$", "prefix": "Show ", "replacement": "在列表中重新显示 {0}", "maps": {}, "source_ids": [97], "fixed_length": 23}, {"pattern": "^(.*?)\\\\. View site information$", "prefix": "", "replacement": "{0}。查看网站信息", "maps": {}, "source_ids": [17], "fixed_length": 23}, {"pattern": "^Input must match (.+)$", "prefix": "", "replacement": "输入必须匹配 {0}", "maps": {}, "source_ids": ["elicitation-validation"], "fixed_length": 23}, {"pattern": "^Preview unavailable — (.*?)$", "prefix": "Preview unavailable — ", "replacement": "无法预览 — {0}", "maps": {}, "source_ids": [214], "fixed_length": 22}, {"pattern": "^No connectors match “(.*?)”$", "prefix": "No connectors match “", "replacement": "没有与“{0}”匹配的连接器", "maps": {}, "source_ids": [233], "fixed_length": 22}, {"pattern": "^Created automation \\"(.*?)\\"\\\\.$", "prefix": "Created automation \\"", "replacement": "已创建自动化任务“{0}”。", "maps": {}, "source_ids": [354], "fixed_length": 22}, {"pattern": "^Opens external link: (.*?)$", "prefix": "Opens external link: ", "replacement": "打开外部链接：{0}", "maps": {}, "source_ids": [121], "fixed_length": 21}, {"pattern": "^Switch environment \\\\((.*?)\\\\)$", "prefix": "Switch environment (", "replacement": "切换环境（{0}）", "maps": {}, "source_ids": [288], "fixed_length": 21}, {"pattern": "^Remove shortcut (.*?) for (.*?)$", "prefix": "Remove shortcut ", "replacement": "移除 {1} 的快捷键 {0}", "maps": {}, "source_ids": [47], "fixed_length": 21}, {"pattern": "^Published (.*?) to origin\\\\.$", "prefix": "Published ", "replacement": "已将 {0} 发布到 origin。", "maps": {}, "source_ids": [389], "fixed_length": 21}, {"pattern": "^Manage (.*?) app settings\\\\.$", "prefix": "Manage ", "replacement": "管理 {0} 应用设置。", "maps": {}, "source_ids": [35], "fixed_length": 21}, {"pattern": "^Couldn't connect to (.*?)$", "prefix": "Couldn't connect to ", "replacement": "无法连接到 {0}", "maps": {}, "source_ids": [94], "fixed_length": 20}, {"pattern": "^Remove context from (.*?)$", "prefix": "Remove context from ", "replacement": "移除 {0} 的上下文", "maps": {}, "source_ids": [229], "fixed_length": 20}, {"pattern": "^Search Google for \\"(.*?)\\"$", "prefix": "Search Google for \\"", "replacement": "在 Google 上搜索“{0}”", "maps": {}, "source_ids": [308], "fixed_length": 20}, {"pattern": "^Sign in to (.*?) remotely$", "prefix": "Sign in to ", "replacement": "远程登录 {0}", "maps": {}, "source_ids": [73], "fixed_length": 20}, {"pattern": "^Scroll to: (.*?) on page (.*?)$", "prefix": "Scroll to: ", "replacement": "滚动到第 {1} 页的 {0}", "maps": {}, "source_ids": [374], "fixed_length": 20}, {"pattern": "^Typing '(.*?)' in Browser$", "prefix": "Typing '", "replacement": "正在浏览器中输入“{0}”", "maps": {}, "source_ids": [148], "fixed_length": 20}, {"pattern": "^Skip \\\\((.*?)\\\\), Skip All \\\\((.*?)\\\\)$", "prefix": "Skip (", "replacement": "跳过（{0}），全部跳过（{1}）", "maps": {}, "source_ids": [131], "fixed_length": 20}, {"pattern": "^Zoom (.*?)%, reset to fit$", "prefix": "Zoom ", "replacement": "缩放 {0}%，点击重置为适应窗口", "maps": {}, "source_ids": [5], "fixed_length": 20}, {"pattern": "^Hide (.*?) from this list$", "prefix": "Hide ", "replacement": "从此列表中隐藏 {0}", "maps": {}, "source_ids": [96], "fixed_length": 20}, {"pattern": "^Page (.*?) failed to load$", "prefix": "Page ", "replacement": "第 {0} 页加载失败", "maps": {}, "source_ids": [375], "fixed_length": 20}, {"pattern": "^(.*?) \\\\(disabled by admin\\\\)$", "prefix": "", "replacement": "{0}（已被管理员停用）", "maps": {}, "source_ids": [33], "fixed_length": 20}, {"pattern": "^(.*?)\\\\. Switch microphone\\\\.$", "prefix": "", "replacement": "{0}。切换麦克风。", "maps": {}, "source_ids": [250], "fixed_length": 20}, {"pattern": "^Amended commit on (.*?)\\\\.$", "prefix": "Amended commit on ", "replacement": "已修订 {0} 上的提交。", "maps": {}, "source_ids": [107], "fixed_length": 19}, {"pattern": "^Failed to update \\"(.*?)\\"$", "prefix": "Failed to update \\"", "replacement": "更新“{0}”失败", "maps": {}, "source_ids": [165, 326, 329, 347], "fixed_length": 19}, {"pattern": "^Failed to delete \\"(.*?)\\"$", "prefix": "Failed to delete \\"", "replacement": "删除“{0}”失败", "maps": {}, "source_ids": [340, 348, 360], "fixed_length": 19}, {"pattern": "^Failed to delete (workspace|project): (.*?)$", "prefix": "Failed to delete ", "replacement": "删除{0}失败：{1}", "maps": {"0": {"project": "项目", "workspace": "工作区"}}, "source_ids": [79], "fixed_length": 19}, {"pattern": "^Failed to start \\"(.*?)\\"\\\\.$", "prefix": "Failed to start \\"", "replacement": "启动“{0}”失败。", "maps": {}, "source_ids": [162], "fixed_length": 19}, {"pattern": "^Using default (.*?) name$", "prefix": "Using default ", "replacement": "使用默认的{0}名称", "maps": {}, "source_ids": [240], "fixed_length": 19}, {"pattern": "^Build with (.*?) Plugins$", "prefix": "Build with ", "replacement": "使用 {0} 插件构建", "maps": {}, "source_ids": [61], "fixed_length": 19}, {"pattern": "^Remove (.*?) from Recent$", "prefix": "Remove ", "replacement": "从最近记录中移除 {0}", "maps": {}, "source_ids": [95], "fixed_length": 19}, {"pattern": "^Typed '(.*?)' in Browser$", "prefix": "Typed '", "replacement": "已在浏览器中输入“{0}”", "maps": {}, "source_ids": [149], "fixed_length": 19}, {"pattern": "^Pushed (.*?) commit(|s) to (.*?)\\\\.$", "prefix": "Pushed ", "replacement": "已将 {0} 个提交推送到 {2}。", "maps": {}, "source_ids": [387], "fixed_length": 19}, {"pattern": "^Show (.*?) earlier steps$", "prefix": "Show ", "replacement": "显示之前的 {0} 个步骤", "maps": {}, "source_ids": [133], "fixed_length": 19}, {"pattern": "^Show (.*?) more subagent(|s)$", "prefix": "Show ", "replacement": "再显示 {0} 个子智能体", "maps": {}, "source_ids": [179, 284, 285], "fixed_length": 19}, {"pattern": "^Open conversation (.*?)$", "prefix": "Open conversation ", "replacement": "打开会话 {0}", "maps": {}, "source_ids": [118], "fixed_length": 18}, {"pattern": "^Select model with (.*?)$", "prefix": "Select model with ", "replacement": "通过 {0} 选择模型", "maps": {}, "source_ids": [297], "fixed_length": 18}, {"pattern": "^Failed to archive (.*?)$", "prefix": "Failed to archive ", "replacement": "归档{0}失败", "maps": {}, "source_ids": [301], "fixed_length": 18}, {"pattern": "^All changes since (.*?)$", "prefix": "All changes since ", "replacement": "{0} 之后的所有更改", "maps": {}, "source_ids": [390], "fixed_length": 18}, {"pattern": "^Exited with code (.*?)\\\\.$", "prefix": "Exited with code ", "replacement": "已退出，退出代码为 {0}。", "maps": {}, "source_ids": [34], "fixed_length": 18}, {"pattern": "^Failed to create (.*?)\\\\.$", "prefix": "Failed to create ", "replacement": "创建{0}失败。", "maps": {}, "source_ids": [355], "fixed_length": 18}, {"pattern": "^Publish (.*?) to origin$", "prefix": "Publish ", "replacement": "将 {0} 发布到 origin", "maps": {}, "source_ids": [385], "fixed_length": 18}, {"pattern": "^(.*?) download progress$", "prefix": "", "replacement": "{0} 的下载进度", "maps": {}, "source_ids": [20], "fixed_length": 18}, {"pattern": "^Add shortcut for (.*?)$", "prefix": "Add shortcut for ", "replacement": "为 {0} 添加快捷键", "maps": {}, "source_ids": [48], "fixed_length": 17}, {"pattern": "^More actions for (.*?)$", "prefix": "More actions for ", "replacement": "{0} 的更多操作", "maps": {}, "source_ids": [197, 264, 271], "fixed_length": 17}, {"pattern": "^Disable Word Wrap(.*?)$", "prefix": "Disable Word Wrap", "replacement": "禁用自动换行{0}", "maps": {}, "source_ids": [212], "fixed_length": 17}, {"pattern": "^Failed to create (.*?)$", "prefix": "Failed to create ", "replacement": "创建{0}失败", "maps": {}, "source_ids": [241], "fixed_length": 17}, {"pattern": "^Failed to delete (.*?)$", "prefix": "Failed to delete ", "replacement": "删除{0}失败", "maps": {}, "source_ids": [303], "fixed_length": 17}, {"pattern": "^Help us improve (.*?)\\\\.$", "prefix": "Help us improve ", "replacement": "帮助我们改进 {0}。", "maps": {}, "source_ids": [170], "fixed_length": 17}, {"pattern": "^System default \\\\((.*?)\\\\)$", "prefix": "System default (", "replacement": "系统默认（{0}）", "maps": {}, "source_ids": [249], "fixed_length": 17}, {"pattern": "^Failed to save \\"(.*?)\\"$", "prefix": "Failed to save \\"", "replacement": "保存“{0}”失败", "maps": {}, "source_ids": [330, 331], "fixed_length": 17}, {"pattern": "^Remove (.*?) from list$", "prefix": "Remove ", "replacement": "从列表中移除 {0}", "maps": {}, "source_ids": [23], "fixed_length": 17}, {"pattern": "^Reset (.*?) to default$", "prefix": "Reset ", "replacement": "将 {0} 重置为默认值", "maps": {}, "source_ids": [49], "fixed_length": 17}, {"pattern": "^\\\\+(.*?) more \\\\(Show all\\\\)$", "prefix": "+", "replacement": "另有 {0} 个（显示全部）", "maps": {}, "source_ids": [234], "fixed_length": 17}, {"pattern": "^Using browser · (.*?)$", "prefix": "Using browser · ", "replacement": "正在使用浏览器 · {0}", "maps": {}, "source_ids": [153], "fixed_length": 16}, {"pattern": "^Fix with Agent: (.*?)$", "prefix": "Fix with Agent: ", "replacement": "使用智能体修复：{0}", "maps": {}, "source_ids": [192], "fixed_length": 16}, {"pattern": "^Enable Word Wrap(.*?)$", "prefix": "Enable Word Wrap", "replacement": "启用自动换行{0}", "maps": {}, "source_ids": [213], "fixed_length": 16}, {"pattern": "^Playback speed (.*?)x$", "prefix": "Playback speed ", "replacement": "播放速度：{0} 倍", "maps": {}, "source_ids": [4], "fixed_length": 16}, {"pattern": "^Sign in to use (.*?)!$", "prefix": "Sign in to use ", "replacement": "登录以使用 {0}！", "maps": {}, "source_ids": [32], "fixed_length": 16}, {"pattern": "^Open the (.*?) plugin$", "prefix": "Open the ", "replacement": "打开 {0} 插件", "maps": {}, "source_ids": [120], "fixed_length": 16}, {"pattern": "^Push (.*?) commit(|s) to (.*?)$", "prefix": "Push ", "replacement": "将 {0} 个提交推送到 {2}", "maps": {}, "source_ids": [384], "fixed_length": 16}, {"pattern": "^(.*?), setup required$", "prefix": "", "replacement": "{0}，需要设置", "maps": {}, "source_ids": [205], "fixed_length": 16}, {"pattern": "^Move to Group: (.*?)$", "prefix": "Move to Group: ", "replacement": "移到分组：{0}", "maps": {}, "source_ids": [220], "fixed_length": 15}, {"pattern": "^Open Subagent: (.*?)$", "prefix": "Open Subagent: ", "replacement": "打开子智能体：{0}", "maps": {}, "source_ids": [296], "fixed_length": 15}, {"pattern": "^Go to turn (.*?) of (.*?)$", "prefix": "Go to turn ", "replacement": "转到第 {0} 轮，共 {1} 轮", "maps": {}, "source_ids": [293], "fixed_length": 15}, {"pattern": "^Duplicate (workspace|project) name$", "prefix": "Duplicate ", "replacement": "{0}名称重复", "maps": {"0": {"project": "项目", "workspace": "工作区"}}, "source_ids": [80], "fixed_length": 15}, {"pattern": "^Choose (Antigravity|Jetski)'s Voice$", "prefix": "Choose ", "replacement": "选择 {0} 的语音", "maps": {}, "source_ids": [55], "fixed_length": 15}, {"pattern": "^Reset (.*?) override(|s)$", "prefix": "Reset ", "replacement": "重置 {0} 项覆盖设置", "maps": {}, "source_ids": [36], "fixed_length": 15}, {"pattern": "^Show (.*?) in folder$", "prefix": "Show ", "replacement": "在文件夹中显示 {0}", "maps": {}, "source_ids": [21], "fixed_length": 15}, {"pattern": "^No (.*?) configured\\\\.$", "prefix": "No ", "replacement": "尚未配置{0}。", "maps": {}, "source_ids": [364], "fixed_length": 15}, {"pattern": "^Auth code for (.*?)$", "prefix": "Auth code for ", "replacement": "{0} 的授权码", "maps": {}, "source_ids": [62, 198, 232], "fixed_length": 14}, {"pattern": "^View Diff for (.*?)$", "prefix": "View Diff for ", "replacement": "查看 {0} 的差异", "maps": {}, "source_ids": [123], "fixed_length": 14}, {"pattern": "^Cost summary: (.*?)$", "prefix": "Cost summary: ", "replacement": "费用汇总：{0}", "maps": {}, "source_ids": [154], "fixed_length": 14}, {"pattern": "^Edit comment: (.*?)$", "prefix": "Edit comment: ", "replacement": "编辑评论：{0}", "maps": {}, "source_ids": [176], "fixed_length": 14}, {"pattern": "^Thinking for (.*?)s$", "prefix": "Thinking for ", "replacement": "已思考 {0} 秒", "maps": {}, "source_ids": [141], "fixed_length": 14}, {"pattern": "^Unfold lines (.*?)-(.*?)$", "prefix": "Unfold lines ", "replacement": "展开第 {0}-{1} 行", "maps": {}, "source_ids": [174], "fixed_length": 14}, {"pattern": "^Committed to (.*?)\\\\.$", "prefix": "Committed to ", "replacement": "已提交到 {0}。", "maps": {}, "source_ids": [382], "fixed_length": 14}, {"pattern": "^Shortcut (.*?) for (.*?)$", "prefix": "Shortcut ", "replacement": "{1} 的快捷键：{0}", "maps": {}, "source_ids": [46], "fixed_length": 14}, {"pattern": "^Enter (.*?) name\\\\.\\\\.\\\\.$", "prefix": "Enter ", "replacement": "输入{0}名称...", "maps": {}, "source_ids": [353], "fixed_length": 14}, {"pattern": "^Stop (.*?) selected$", "prefix": "Stop ", "replacement": "停止选中的 {0} 项", "maps": {}, "source_ids": [42], "fixed_length": 14}, {"pattern": "^(.*?) tool(s|) disabled$", "prefix": "", "replacement": "已停用 {0} 个工具", "maps": {}, "source_ids": [64, 196], "fixed_length": 14}, {"pattern": "^Connected to (.*?)$", "prefix": "Connected to ", "replacement": "已连接到 {0}", "maps": {}, "source_ids": [100, 381], "fixed_length": 13}, {"pattern": "^Conversation (.*?)$", "prefix": "Conversation ", "replacement": "会话 {0}", "maps": {}, "source_ids": [119], "fixed_length": 13}, {"pattern": "^Message from (.*?)$", "prefix": "Message from ", "replacement": "来自 {0} 的消息", "maps": {}, "source_ids": [135], "fixed_length": 13}, {"pattern": "^App view for (tool)$", "prefix": "App view for ", "replacement": "{0} 的应用视图", "maps": {"0": {"tool": "工具"}}, "source_ids": [139], "fixed_length": 13}, {"pattern": "^Voice Speed, (.*?)$", "prefix": "Voice Speed, ", "replacement": "语速，{0}", "maps": {}, "source_ids": [252], "fixed_length": 13}, {"pattern": "^Voice speed, (.*?)$", "prefix": "Voice speed, ", "replacement": "语速，{0}", "maps": {}, "source_ids": [253], "fixed_length": 13}, {"pattern": "^Restarted \\"(.*?)\\"\\\\.$", "prefix": "Restarted \\"", "replacement": "已重新启动“{0}”。", "maps": {}, "source_ids": [164, 332, 341], "fixed_length": 13}, {"pattern": "^Select (.*?) Theme$", "prefix": "Select ", "replacement": "选择 {0} 主题", "maps": {}, "source_ids": [262], "fixed_length": 13}, {"pattern": "^No (plugin|bundle|app) found for$", "prefix": "No ", "replacement": "未找到以下标识对应的{0}：", "maps": {"0": {"plugin": "插件", "bundle": "插件包", "app": "应用"}}, "source_ids": [191], "fixed_length": 13}, {"pattern": "^(.*?) tool(s|) enabled$", "prefix": "", "replacement": "已启用 {0} 个工具", "maps": {}, "source_ids": [63, 195], "fixed_length": 13}, {"pattern": "^(.*?) hidden hosts$", "prefix": "", "replacement": "{0} 台隐藏的主机", "maps": {}, "source_ids": [98], "fixed_length": 13}, {"pattern": "^(.*?) color picker$", "prefix": "", "replacement": "{0}取色器", "maps": {}, "source_ids": [370], "fixed_length": 13}, {"pattern": "^Go to slide (.*?)$", "prefix": "Go to slide ", "replacement": "转到第 {0} 张幻灯片", "maps": {}, "source_ids": [117], "fixed_length": 12}, {"pattern": "^Error while (.*?)$", "prefix": "Error while ", "replacement": "{0}时出错", "maps": {}, "source_ids": [122], "fixed_length": 12}, {"pattern": "^Forked from (.*?)$", "prefix": "Forked from ", "replacement": "分叉自 {0}", "maps": {}, "source_ids": [222], "fixed_length": 12}, {"pattern": "^No matching (.*?)$", "prefix": "No matching ", "replacement": "没有匹配的{0}", "maps": {}, "source_ids": [226], "fixed_length": 12}, {"pattern": "^Detached at (.*?)$", "prefix": "Detached at ", "replacement": "HEAD 分离于 {0}", "maps": {}, "source_ids": [242], "fixed_length": 12}, {"pattern": "^Details for (.*?)$", "prefix": "Details for ", "replacement": "{0} 的详情", "maps": {}, "source_ids": [279], "fixed_length": 12}, {"pattern": "^See more in (.*?)$", "prefix": "See more in ", "replacement": "在 {0} 中查看更多", "maps": {}, "source_ids": [281], "fixed_length": 12}, {"pattern": "^See less in (.*?)$", "prefix": "See less in ", "replacement": "在 {0} 中收起更多内容", "maps": {}, "source_ids": [282], "fixed_length": 12}, {"pattern": "^Running for (.*?)$", "prefix": "Running for ", "replacement": "已运行 {0}", "maps": {"0": {"kind": "duration"}}, "source_ids": [338], "fixed_length": 12}, {"pattern": "^Fold lines (.*?)-(.*?)$", "prefix": "Fold lines ", "replacement": "折叠第 {0}-{1} 行", "maps": {}, "source_ids": [173], "fixed_length": 12}, {"pattern": "^Welcome to (.*?)!$", "prefix": "Welcome to ", "replacement": "欢迎使用 {0}！", "maps": {}, "source_ids": [260], "fixed_length": 12}, {"pattern": "^(.*?), voice (.*?) of (.*?)$", "prefix": "", "replacement": "{0}，第 {1} 个语音，共 {2} 个", "maps": {}, "source_ids": [56], "fixed_length": 12}, {"pattern": "^(.*?)\\\\. Switch mic$", "prefix": "", "replacement": "{0}。切换麦克风", "maps": {}, "source_ids": [251], "fixed_length": 12}, {"pattern": "^Sign in to (.*?)$", "prefix": "Sign in to ", "replacement": "登录 {0}", "maps": {}, "source_ids": [187], "fixed_length": 11}, {"pattern": "^Disconnect (.*?)$", "prefix": "Disconnect ", "replacement": "断开 {0} 的连接", "maps": {}, "source_ids": [202], "fixed_length": 11}, {"pattern": "^Plugins in (.*?)$", "prefix": "Plugins in ", "replacement": "{0} 中的插件", "maps": {}, "source_ids": [280], "fixed_length": 11}, {"pattern": "^Go to page (.*?)$", "prefix": "Go to page ", "replacement": "转到第 {0} 页", "maps": {}, "source_ids": [376], "fixed_length": 11}, {"pattern": "^Send all \\\\((.*?)\\\\)$", "prefix": "Send all (", "replacement": "全部发送（{0}）", "maps": {}, "source_ids": [181], "fixed_length": 11}, {"pattern": "^Pushed to (.*?)\\\\.$", "prefix": "Pushed to ", "replacement": "已推送到 {0}。", "maps": {}, "source_ids": [388], "fixed_length": 11}, {"pattern": "^Enabled \\"(.*?)\\"\\\\.$", "prefix": "Enabled \\"", "replacement": "已启用“{0}”。", "maps": {}, "source_ids": [159], "fixed_length": 11}, {"pattern": "^Started \\"(.*?)\\"\\\\.$", "prefix": "Started \\"", "replacement": "已启动“{0}”。", "maps": {}, "source_ids": [161], "fixed_length": 11}, {"pattern": "^Deleted \\"(.*?)\\"\\\\.$", "prefix": "Deleted \\"", "replacement": "已删除“{0}”。", "maps": {}, "source_ids": [339, 349, 359], "fixed_length": 11}, {"pattern": "^Loading (plugin|bundle|app)\\\\.\\\\.\\\\.$", "prefix": "Loading ", "replacement": "正在加载{0}…", "maps": {"0": {"plugin": "插件", "bundle": "插件包", "app": "应用"}}, "source_ids": [190], "fixed_length": 11}, {"pattern": "^Open (.*?) skill$", "prefix": "Open ", "replacement": "打开 {0} 技能", "maps": {}, "source_ids": [9], "fixed_length": 11}, {"pattern": "^Add (.*?) (plugin|plugins) from (.*?)$", "prefix": "Add ", "replacement": "从 {2} 添加 {0} 个插件", "maps": {}, "source_ids": [263], "fixed_length": 11}, {"pattern": "^(Disable|Enable) (.*?) tool for (.*?)$", "prefix": "", "replacement": "{0} {2} 的 {1} 工具", "maps": {"0": {"Enable": "启用", "Disable": "禁用"}}, "source_ids": [65, 199], "fixed_length": 11}, {"pattern": "^(.*?) CEL values$", "prefix": "", "replacement": "{0} 的 CEL 值", "maps": {}, "source_ids": [323], "fixed_length": 11}, {"pattern": "^Label for (.*?)$", "prefix": "Label for ", "replacement": "{0} 的标签", "maps": {}, "source_ids": [70], "fixed_length": 10}, {"pattern": "^Configure (.*?)$", "prefix": "Configure ", "replacement": "配置 {0}", "maps": {}, "source_ids": [185, 194, 207], "fixed_length": 10}, {"pattern": "^Reconnect (.*?)$", "prefix": "Reconnect ", "replacement": "重新连接 {0}", "maps": {}, "source_ids": [201], "fixed_length": 10}, {"pattern": "^No remote (.*?)$", "prefix": "No remote ", "replacement": "没有远程{0}", "maps": {}, "source_ids": [227], "fixed_length": 10}, {"pattern": "^Send now: (.*?)$", "prefix": "Send now: ", "replacement": "立即发送：{0}", "maps": {}, "source_ids": [257], "fixed_length": 10}, {"pattern": "^See all \\\\((.*?)\\\\)$", "prefix": "See all (", "replacement": "查看全部（{0}）", "maps": {}, "source_ids": [223], "fixed_length": 10}, {"pattern": "^Edit (workspace|project) name$", "prefix": "Edit ", "replacement": "编辑{0}名称", "maps": {"0": {"project": "项目", "workspace": "工作区"}}, "source_ids": [86], "fixed_length": 10}, {"pattern": "^See (.*?) more (.*?)$", "prefix": "See ", "replacement": "再查看 {0} 个{1}", "maps": {}, "source_ids": [268], "fixed_length": 10}, {"pattern": "^(.*?)\\\\. Show in (.*?)$", "prefix": "", "replacement": "{0}。在{1}中显示", "maps": {}, "source_ids": [304], "fixed_length": 10}, {"pattern": "^More for (.*?)$", "prefix": "More for ", "replacement": "{0} 的更多选项", "maps": {}, "source_ids": [74], "fixed_length": 9}, {"pattern": "^See more (.*?)$", "prefix": "See more ", "replacement": "查看更多{0}", "maps": {}, "source_ids": [269], "fixed_length": 9}, {"pattern": "^Open (.*?), (.*?)\\\\. (.*?)$", "prefix": "Open ", "replacement": "打开{0}，{1}。{2}", "maps": {}, "source_ids": [91], "fixed_length": 9}, {"pattern": "^Turn (.*?) of (.*?)$", "prefix": "Turn ", "replacement": "第 {0} 轮，共 {1} 轮", "maps": {}, "source_ids": [294], "fixed_length": 9}, {"pattern": "^Step (.*?) of (.*?)$", "prefix": "Step ", "replacement": "第 {0} 步，共 {1} 步", "maps": {}, "source_ids": [357], "fixed_length": 9}, {"pattern": "^See \\\\[(.*?)\\\\]\\\\((.*?)\\\\)\\\\.$", "prefix": "See [", "replacement": "参阅 [{0}]({1})。", "maps": {}, "source_ids": [361], "fixed_length": 9}, {"pattern": "^See (.*?) more$", "prefix": "See ", "replacement": "再查看 {0} 个", "maps": {}, "source_ids": [270], "fixed_length": 9}, {"pattern": "^Open in (.*?)$", "prefix": "Open in ", "replacement": "在 {0} 中打开", "maps": {}, "source_ids": [7], "fixed_length": 8}, {"pattern": "^Connect (.*?)$", "prefix": "Connect ", "replacement": "连接 {0}", "maps": {}, "source_ids": [76], "fixed_length": 8}, {"pattern": "^Version (.*?)$", "prefix": "Version ", "replacement": "版本 {0}", "maps": {}, "source_ids": [89], "fixed_length": 8}, {"pattern": "^Install (.*?)$", "prefix": "Install ", "replacement": "安装 {0}", "maps": {}, "source_ids": [183], "fixed_length": 8}, {"pattern": "^Restart (.*?)$", "prefix": "Restart ", "replacement": "重新启动 {0}", "maps": {}, "source_ids": [342], "fixed_length": 8}, {"pattern": "^Run (.*?) now$", "prefix": "Run ", "replacement": "立即运行 {0}", "maps": {}, "source_ids": [335, 343, 352], "fixed_length": 8}, {"pattern": "^Source (.*?)$", "prefix": "Source ", "replacement": "来源 {0}", "maps": {}, "source_ids": [11], "fixed_length": 7}, {"pattern": "^Cancel (.*?)$", "prefix": "Cancel ", "replacement": "取消 {0}", "maps": {}, "source_ids": [22], "fixed_length": 7}, {"pattern": "^Toggle (.*?)$", "prefix": "Toggle ", "replacement": "切换 {0}", "maps": {}, "source_ids": [54, 273], "fixed_length": 7}, {"pattern": "^Delete (.*?)$", "prefix": "Delete ", "replacement": "删除{0}", "maps": {}, "source_ids": [78, 87, 265, 336], "fixed_length": 7}, {"pattern": "^Set up (.*?)$", "prefix": "Set up ", "replacement": "设置 {0}", "maps": {}, "source_ids": [156], "fixed_length": 7}, {"pattern": "^Remove (.*?)$", "prefix": "Remove ", "replacement": "移除 {0}", "maps": {}, "source_ids": [246, 312, 321, 322], "fixed_length": 7}, {"pattern": "^Enable (.*?)$", "prefix": "Enable ", "replacement": "启用 {0}", "maps": {}, "source_ids": [266, 334], "fixed_length": 7}, {"pattern": "^Adding (.*?)$", "prefix": "Adding ", "replacement": "正在添加 {0}", "maps": {}, "source_ids": [275], "fixed_length": 7}, {"pattern": "^Resume (.*?)$", "prefix": "Resume ", "replacement": "恢复 {0}", "maps": {}, "source_ids": [346, 351], "fixed_length": 7}, {"pattern": "^Create (.*?)$", "prefix": "Create ", "replacement": "创建{0}", "maps": {}, "source_ids": [358], "fixed_length": 7}, {"pattern": "^Open (.*?), (.*?)$", "prefix": "Open ", "replacement": "打开{0}，{1}", "maps": {}, "source_ids": [93], "fixed_length": 7}, {"pattern": "^Chunk (.*?)$", "prefix": "Chunk ", "replacement": "片段 {0}", "maps": {}, "source_ids": [144], "fixed_length": 6}, {"pattern": "^Unpin (.*?)$", "prefix": "Unpin ", "replacement": "取消固定 {0}", "maps": {}, "source_ids": [310], "fixed_length": 6}, {"pattern": "^Close (.*?)$", "prefix": "Close ", "replacement": "关闭 {0}", "maps": {}, "source_ids": [311], "fixed_length": 6}, {"pattern": "^Pause (.*?)$", "prefix": "Pause ", "replacement": "暂停 {0}", "maps": {}, "source_ids": [345, 350], "fixed_length": 6}, {"pattern": "^Stop (.*?)\\\\?$", "prefix": "Stop ", "replacement": "停止 {0}？", "maps": {"0": {"kind": "item-count"}}, "source_ids": [43], "fixed_length": 6}, {"pattern": "^Add \\\\((.*?)\\\\)$", "prefix": "Add (", "replacement": "添加（{0}）", "maps": {}, "source_ids": [75], "fixed_length": 6}, {"pattern": "^View (video attachment|image attachment) (\\\\d+)$", "prefix": "View ", "replacement": "查看第 {1} 个{0}", "maps": {"0": {"video attachment": "视频附件", "image attachment": "图片附件"}}, "source_ids": [126], "fixed_length": 6}, {"pattern": "^See (.*?): (.*?)$", "prefix": "See ", "replacement": "参阅 {0}：{1}", "maps": {}, "source_ids": [327], "fixed_length": 6}, {"pattern": "^Open (.*?)$", "prefix": "Open ", "replacement": "打开 {0}", "maps": {}, "source_ids": [19, 125, 175, 180, 245, 291, 307], "fixed_length": 5}, {"pattern": "^Stop (.*?)$", "prefix": "Stop ", "replacement": "停止 {0}", "maps": {}, "source_ids": [44, 134], "fixed_length": 5}, {"pattern": "^this (workspace|project)$", "prefix": "this ", "replacement": "此{0}", "maps": {"0": {"project": "项目", "workspace": "工作区"}}, "source_ids": [88], "fixed_length": 5}, {"pattern": "^Copy (.*?)$", "prefix": "Copy ", "replacement": "复制 {0}", "maps": {}, "source_ids": [167], "fixed_length": 5}, {"pattern": "^Rule (.*?)$", "prefix": "Rule ", "replacement": "规则 {0}", "maps": {}, "source_ids": [203], "fixed_length": 5}, {"pattern": "^View (.*?)$", "prefix": "View ", "replacement": "查看 {0}", "maps": {}, "source_ids": [254, 255], "fixed_length": 5}, {"pattern": "^Turn (.*?)$", "prefix": "Turn ", "replacement": "第 {0} 轮", "maps": {}, "source_ids": [292], "fixed_length": 5}, {"pattern": "^Line (.*?)$", "prefix": "Line ", "replacement": "折线系列 {0}", "maps": {}, "source_ids": [366], "fixed_length": 5}, {"pattern": "^Add (.*?)$", "prefix": "Add ", "replacement": "添加 {0}", "maps": {}, "source_ids": [276, 362], "fixed_length": 4}, {"pattern": "^New (.*?)$", "prefix": "New ", "replacement": "新建{0}", "maps": {}, "source_ids": [356], "fixed_length": 4}, {"pattern": "^Bar (.*?)$", "prefix": "Bar ", "replacement": "柱形系列 {0}", "maps": {}, "source_ids": [365], "fixed_length": 4}, {"pattern": "^On (.*?)$", "prefix": "On ", "replacement": "运行于 {0}", "maps": {}, "source_ids": [99], "fixed_length": 3}, {"pattern": "^in (.*?)$", "prefix": "in ", "replacement": "在 {0} 中", "maps": {}, "source_ids": [261], "fixed_length": 3}, {"pattern": "^Up (.*?)$", "prefix": "Up ", "replacement": "已运行 {0}", "maps": {"0": {"kind": "duration"}}, "source_ids": [344], "fixed_length": 3}].map(rule => ({...rule, expression:new RegExp(rule.pattern)}));
  function translateHiddenUiTemplate(text) {
    if (text.length > 8000) return null;
    for (const rule of hiddenUiTemplateRules) {
      if (rule.prefix && !text.startsWith(rule.prefix)) continue;
      const matched = rule.expression.exec(text);
      if (!matched) continue;
      if (rule.special_permissions_action && matched[1] === 'set permissions for') return '设置会话权限失败';
      const values = matched.slice(1);
      for (const [index, map] of Object.entries(rule.maps)) {
        const value = values[Number(index)];
        if (Object.hasOwn(map, value)) values[Number(index)] = map[value];
        else if (map.kind === 'item-count' || map.kind === 'recording-count') {
          const count = value.match(map.kind === 'item-count' ? /^(\\d+) items?$/ : /^(\\d+) call recordings?$/);
          if (count) values[Number(index)] = count[1] + (map.kind === 'item-count' ? ' 项' : ' 段通话录音');
        } else if (map.kind === 'duration' && /^(?:\\d+\\s*[dhms]\\s*)+$/.test(value)) {
          const units = {d:'天',h:'小时',m:'分钟',s:'秒'};
          values[Number(index)] = value.replace(/(\\d+)\\s*([dhms])/g, (_, number, unit) => number + ' ' + units[unit] + ' ').trim();
        }
      }
      return rule.replacement.replace(/\\{(\\d+)\\}/g, (_, index) => values[Number(index)] ?? '');
    }
    return null;
  }


  function translateMembershipText(text) {
    const combinedLimits = text.match(/^Within each group, models share a weekly limit and a (\\d+(?:\\.\\d+)?)-hour limit\\. Quota is consumed proportionally to the cost of the tokens\\. Thus, limits will last longer with shorter tasks or using more cost-effective models\\. The \\1-hour limit (?:is to smooth out aggregate demand and to fairly distribute|smooths out aggregate demand to fairly distribute) global capacity across all users, while your weekly limit is tied directly to your individual tier\\.$/);
    if (combinedLimits) return '每组内的模型共享每周限额和 ' + combinedLimits[1] + ' 小时限额。配额按 Token 成本比例消耗，因此较短的任务或成本更低的模型可让配额使用更久。' + combinedLimits[1] + ' 小时限额用于平衡整体需求，并向所有用户公平分配全球服务容量；每周限额则直接取决于你个人的方案等级。';
    const modelIntroduction = text.match(/^Introducing (Gemini \\d+(?:\\.\\d+)? [A-Za-z][A-Za-z0-9 -]*)$/);
    if (modelIntroduction) return '全新推出 ' + modelIntroduction[1];
    const namedQuota = text.match(/^(Gemini \\d+(?:\\.\\d+)? (?:Argon|Carbon|Hydrogen|Flash(?: Lite)?|Pro)) (Weekly|Daily|Five [Hh]our|\\d+(?:\\.\\d+)?[ -]hour) Limit$/);
    if (namedQuota) {
      const window = namedQuota[2];
      const quota = window === 'Weekly' ? '每周限额' : window === 'Daily' ? '每日限额' : /^Five /i.test(window) ? '5 小时限额' : window.replace(/[ -]hour$/, '') + ' 小时限额';
      return namedQuota[1] + ' ' + quota;
    }
    const separateQuota = text.match(/^For paid Pro plans, (Argon|Carbon|Hydrogen) quota is separate\\. Higher \\1 quota \\(included as part of the larger Gemini quota bucket\\) is available on Ultra plans\\.$/);
    if (separateQuota) return '付费 Pro 方案的 ' + separateQuota[1] + ' 配额单独计算。Ultra 方案提供更高的 ' + separateQuota[1] + ' 配额，并将其包含在更大的 Gemini 配额池中。';
    const orchestrator = text.match(/^(Argon|Carbon|Hydrogen|Neon) that may offload routine steps to (Argon|Carbon|Hydrogen|Flash)\\. Same \\1-level quality, fewer tokens used\\.$/);
    if (orchestrator) return orchestrator[1] + ' 可将常规步骤交给 ' + orchestrator[2] + '，在保持 ' + orchestrator[1] + ' 级别质量的同时，减少 Token 用量。';
    const locationLabel = text.match(/^Where the agent runs, current: (.+)$/);
    if (locationLabel) return '智能体运行位置，当前：' + (locationLabel[1] === 'This Computer' ? '本机' : locationLabel[1] === 'Remote' ? '远程环境' : locationLabel[1]);
    const credits = text.match(/^You need (more|at least (\\d+(?:\\.\\d+)?)) AI Credits to send messages\\. To continue using (.+?) now, purchase more AI Credits\\.(?: Your plan's baseline quota will refresh on (.+)\\.)?$/);
    if (credits) {
      const model = credits[3] === 'this model' ? '此模型' : credits[3];
      let translated = credits[1] === 'more' ? '发送消息需要更多 AI 积分。' : '发送消息至少需要 ' + credits[2] + ' 个 AI 积分。';
      translated += '若要立即继续使用' + (model === '此模型' ? '' : ' ') + model + '，请购买更多 AI 积分。';
      if (credits[4]) translated += '你的方案基础配额将于 ' + formatUiDate(credits[4]) + '刷新。';
      return translated;
    }
    const baselineAndOverage = text.match(/^Your plan's baseline quota will refresh on (.+)\\. To continue using this model now, enable AI Credit overages\\.$/);
    if (baselineAndOverage) return '你的方案基础配额将于 ' + formatUiDate(baselineAndOverage[1]) + '刷新。如需立即继续使用此模型，请启用 AI 积分超额使用。';
    const creditSwitch = text.match(/^When toggled on, (.+?) will use your AI credits to fulfill model requests once you're out of model quota\\. \\1 will always use your model quota first before using AI credits\\.$/);
    if (creditSwitch) return '开启后，一旦你的模型配额耗尽，' + creditSwitch[1] + ' 将使用你的 AI 积分来满足模型请求。' + creditSwitch[1] + ' 始终会先使用你的模型配额，然后再使用 AI 积分。';
    const upgrade = text.match(/^You can upgrade to (?:a |an )?(Google AI (?:Plus|Pro|Ultra)) plan to receive higher rate limits\\.$/);
    if (upgrade) return '你可以升级至 ' + upgrade[1] + ' 方案，以获得更高的请求限额。';
    const eligibility = text.match(/^(Sorry, this account is ineligible to use|Further action is required to use) (.+)$/);
    if (eligibility) return eligibility[1] === 'Sorry, this account is ineligible to use' ? '抱歉，此账号不符合使用 ' + eligibility[2] + ' 的资格' : '使用 ' + eligibility[2] + ' 前需要完成其他操作';
    const controlled = text.match(/^(?:(.+?)\\s+)?For (.+?), (telemetry is force disabled|this setting is disabled)\\.(?: This means (.+?) does not collect any of your prompts, content, or model responses, but will still collect general usage patterns \\(e\\.g\\., feature adoption, active user counts\\)\\.)?$/);
    if (controlled) {
      const intro = controlled[1] ? normalizedDict[controlled[1]] : '';
      if (controlled[1] && !intro) return null;
      const plan = controlled[2] === 'your plan' ? '你的方案' : controlled[2].replace(/ accounts$/, ' 账号');
      let translated = (intro ? intro + ' ' : '') + '对于' + (plan === '你的方案' ? '' : ' ') + plan + '，' + (controlled[3] === 'telemetry is force disabled' ? '遥测已被强制禁用。' : '此设置已禁用。');
      if (controlled[4]) translated += '这意味着 ' + controlled[4] + ' 不会收集你的提示、内容或模型回复，但仍会收集一般使用情况（例如功能采用情况和活跃用户数量）。';
      return translated;
    }
    return null;
  }


  function translateComparisonSurvey() {
    if (typeof document.querySelectorAll !== 'function') return;
    const labels = new Set(['Why did you choose this response?', 'Pick at most 2 reasons', 'Something else (optional)', 'Better instruction following', 'Better solution & code', 'More thorough research', 'The other model hallucinated', 'Clearer writing & artifacts', 'Faster response']);
    for (const survey of document.querySelectorAll('[data-testid="battle-winner-survey"]')) {
      let unsafe = false;
      for (let parent = survey; parent; parent = parent.parentElement) {
        if (EXCLUDE_TAGS.has(parent.tagName) || parent.matches('.monaco-editor, .cm-editor, [contenteditable]:not([contenteditable="false"])') || ['user-message', 'live-user-turn'].includes(parent.getAttribute('data-testid'))) { unsafe = true; break; }
      }
      if (unsafe) continue;
      function visit(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const source = node.textContent.trim();
          if (labels.has(source) && normalizedDict[source]) node.textContent = node.textContent.replace(source, normalizedDict[source]);
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        for (const name of ['placeholder', 'title', 'aria-label']) {
          const source = node.getAttribute(name);
          if (labels.has(source) && normalizedDict[source]) node.setAttribute(name, normalizedDict[source]);
        }
        if (EXCLUDE_TAGS.has(node.tagName) || node.tagName === 'INPUT' || node.matches('.monaco-editor, .cm-editor, [contenteditable]:not([contenteditable="false"])')) return;
        for (const child of node.childNodes) visit(child);
      }
      visit(survey);
    }
  }

  function formatRelativeUiTime(text) {
    const source = String(text || '').trim();
    if (/^(?:just\\s*now|now)$/i.test(source)) return '刚刚';
    const relative = source.match(/^(\\d+)\\s*(mo|s|m|h|d|w|y)(?:\\s+ago)?$/i);
    if (!relative) return null;
    const units = {s:'秒', m:'分钟', h:'小时', d:'天', w:'周', mo:'个月', y:'年'};
    return relative[1] + ' ' + units[relative[2].toLowerCase()] + '前';
  }

  function translateRuntimeUiLabels() {
    if (typeof document.querySelectorAll !== 'function') return;
    function hasClasses(element, names) {
      const classes = (element.getAttribute('class') || '').split(/\\s+/);
      return names.every(name => classes.includes(name));
    }
    function protectedContent(node) {
      for (let element = node; element; element = element.parentElement) {
        if (EXCLUDE_TAGS.has(element.tagName) || element.matches('.monaco-editor, .cm-editor, [contenteditable]:not([contenteditable="false"])')) return true;
        if (['user-message', 'live-user-turn'].includes(element.getAttribute('data-testid'))) return true;
      }
      return false;
    }
    function isProtectedTimestampContent(node, userActions = false) {
      for (let element = node; element; element = element.parentElement) {
        if (EXCLUDE_TAGS.has(element.tagName) || element.matches('.monaco-editor, .cm-editor, [contenteditable]:not([contenteditable="false"])')) return true;
        const testId = element.getAttribute && element.getAttribute('data-testid');
        if (['user-message-content', 'commentable-content', 'live-user-turn', 'live-agent-turn'].includes(testId)) return true;
        if (testId === 'user-message' && !userActions) return true;
        if (testId === 'agent-response' && userActions) return true;
      }
      return false;
    }
    for (const actions of document.querySelectorAll('[data-testid="user-message-actions"]')) {
      if (actions.tagName !== 'DIV' || isProtectedTimestampContent(actions, true)) continue;
      // The timestamp is a direct child of the real user action bar. Do not
      // inspect button text, tooltip content, or arbitrary message descendants.
      for (const label of actions.childNodes) {
        if (label.tagName !== 'SPAN' || !label.hasAttribute('data-screenshot-volatile')) continue;
        if (label.childNodes.length !== 1 || label.childNodes[0].nodeType !== Node.TEXT_NODE) continue;
        const translated = formatRelativeUiTime(label.textContent);
        if (translated !== null && translated !== label.textContent) label.childNodes[0].textContent = translated;
      }
    }
    for (const label of document.querySelectorAll('span[data-screenshot-volatile]')) {
      if (label.tagName !== 'SPAN' || isProtectedTimestampContent(label)) continue;
      const sidebar = hasClasses(label, ['text-sm', 'text-foreground', 'opacity-60', 'min-w-4', 'shrink-0', 'text-right', 'tabular-nums']) &&
        ['conversation-row-sidebar', 'conversation-row-history'].some(id => hasAncestorTestId(label, id));
      const toolbar = hasClasses(label, ['text-sm', 'text-muted-foreground', 'select-none', 'px-1', 'whitespace-nowrap']) && hasAncestorTestId(label, 'cascade-system-message-toolbar');
      const parent = label.parentElement;
      const step = hasClasses(label, ['text-xs', 'text-muted-foreground', 'cursor-default', 'px-1', 'whitespace-nowrap']) && parent && hasClasses(parent, ['flex', 'items-center', 'select-none', 'text-xs']);
      if (!sidebar && !toolbar && !step) continue;
      if (label.childNodes.length !== 1 || label.childNodes[0].nodeType !== Node.TEXT_NODE) continue;
      const translated = formatRelativeUiTime(label.textContent);
      if (translated !== null && translated !== label.textContent) label.childNodes[0].textContent = translated;
    }
    for (const popup of document.querySelectorAll('[data-testid="context-menu-popup"]')) {
      if (protectedContent(popup)) continue;
      for (const label of popup.querySelectorAll('div')) {
        if (!hasClasses(label, ['px-2', 'py-1', 'text-sm', 'text-muted-foreground', 'select-none', 'pointer-events-none'])) continue;
        if (label.childNodes.length !== 1 || label.childNodes[0].nodeType !== Node.TEXT_NODE) continue;
        const translated = formatRelativeUiTime(label.textContent);
        if (translated !== null && translated !== label.textContent) label.childNodes[0].textContent = translated;
      }
    }
    for (const forwardItem of document.querySelectorAll('[data-testid="webview-context-menu-forward"]')) {
      if (protectedContent(forwardItem)) continue;
      function rewriteForward(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (['Forward', '转发'].includes(node.textContent.trim())) node.textContent = '前进';
          return;
        }
        if (node.nodeType === Node.ELEMENT_NODE && !protectedContent(node)) {
          for (const child of node.childNodes) rewriteForward(child);
        }
      }
      rewriteForward(forwardItem);
    }
    function statusText(text) {
      const fixedStatuses = new Set(['Working', 'Thinking', 'Done', 'Ran command', 'Running command', 'Waiting for your answer', 'Waiting for your approval']);
      if (fixedStatuses.has(text.trim()) && normalizedDict[text.trim()]) return normalizedDict[text.trim()];
      // A known task label from the reported screenshot; never applied to commands or output.
      if (text.trim() === 'Running run final video composition') return '正在运行最终视频合成';
      const match = text.match(/^(\\s*)(Running|Reading|Editing|Listing|Searching)(?=\\s|$)(.*)$/);
      if (!match) return null;
      const names = {Running:'正在运行', Reading:'正在读取', Editing:'正在编辑', Listing:'正在列出', Searching:'正在搜索'};
      return match[1] + names[match[2]] + match[3];
    }
    function workedSummaryText(text, hasUpdates) {
      if (!text) return null;
      const updates = hasUpdates && text.match(/^(\\d+) updates?$/);
      if (updates) return updates[1] + ' 条进度更新';
      const match = text.match(/^Worked for (\\d+s|\\d+m|\\d+h(?: \\d+m)?|\\d+d \\d+h \\d+m)(?: · (\\d+) updates?)?$/);
      if (!match || (match[2] && !hasUpdates)) return null;
      const units = {d:'天', h:'小时', m:'分钟', s:'秒'};
      const duration = match[1].replace(/(\\d+)([dhms])/g, (_, count, unit) => count + ' ' + units[unit]);
      return '工作时长 ' + duration + (match[2] ? ' · ' + match[2] + ' 条进度更新' : '');
    }
    for (const button of document.querySelectorAll('[data-testid="worked-for-collapsible"], [data-testid="progress-updates-collapsible"]')) {
      if (button.tagName !== 'BUTTON' || protectedContent(button)) continue;
      const hasUpdates = button.getAttribute('data-testid') === 'progress-updates-collapsible';
      const label = Array.from(button.childNodes).find(node => node.tagName === 'SPAN' && hasClasses(node, ['text-muted-foreground']));
      if (!label || label.childNodes.length !== 1 || label.childNodes[0].nodeType !== Node.TEXT_NODE) continue;
      const [text] = label.childNodes;
      const translated = workedSummaryText(text.textContent, hasUpdates);
      if (translated !== null) text.textContent = translated;
      const aria = workedSummaryText(button.getAttribute('aria-label'), hasUpdates);
      if (aria !== null) button.setAttribute('aria-label', aria);
    }
    for (const root of document.querySelectorAll('[data-testid="tool-group-collapsible"], [data-testid="ephemeral-tool-status"]')) {
      const id = root.getAttribute('data-testid');
      if (!((id === 'tool-group-collapsible' && root.tagName === 'BUTTON') || (id === 'ephemeral-tool-status' && root.tagName === 'DIV')) || protectedContent(root)) continue;
      const aria = root.getAttribute('aria-label');
      if (aria) {
        const translated = statusText(aria);
        if (translated !== null && translated !== aria) root.setAttribute('aria-label', translated);
      }
      for (const label of root.querySelectorAll('[title]')) {
        if (!hasClasses(label, ['text-muted-foreground', 'truncate', 'min-w-0']) || protectedContent(label)) continue;
        const title = label.getAttribute('title');
        const translatedTitle = title && statusText(title);
        if (translatedTitle !== null && translatedTitle !== title) label.setAttribute('title', translatedTitle);
        const leaves = [];
        function collect(node) {
          if (node.nodeType === Node.TEXT_NODE) { leaves.push(node); return; }
          if (node.nodeType !== Node.ELEMENT_NODE || protectedContent(node) || node.tagName === 'SVG' || node.hasAttribute('data-slot-out') || node.getAttribute('aria-hidden') === 'true') return;
          for (const child of node.childNodes) collect(child);
        }
        collect(label);
        const visibleText = leaves.map(node => node.textContent).join('');
        // Only this complete reported task label has a known Chinese equivalent.
        if (visibleText.trim() === 'Running run final video composition' && leaves.length) {
          leaves[0].textContent = '正在运行最终视频合成';
          for (const leaf of leaves.slice(1)) if (leaf.textContent) leaf.textContent = '';
          continue;
        }
        const first = leaves.find(node => node.textContent.trim());
        if (!first) continue;
        const translated = statusText(first.textContent);
        if (translated !== null && translated !== first.textContent) first.textContent = translated;
      }
    }
    for (const header of document.querySelectorAll('[data-testid="changed-files-card-header"]')) {
      if (protectedContent(header)) continue;
      for (const button of header.childNodes) {
        if (button.nodeType !== Node.ELEMENT_NODE || button.tagName !== 'BUTTON' || button.getAttribute('data-testid') !== 'changed-files-card-review') continue;
        for (const label of button.childNodes) {
          if (label.nodeType !== Node.ELEMENT_NODE || label.tagName !== 'SPAN' || label.childNodes.length !== 1) continue;
          const [text] = label.childNodes;
          if (text.nodeType === Node.TEXT_NODE && text.textContent === 'Review') text.textContent = '查看变更';
        }
      }
      const group = Array.from(header.childNodes).find(node => node.nodeType === Node.ELEMENT_NODE);
      if (!group || group.tagName !== 'DIV') continue;
      for (const label of group.childNodes) {
        if (label.nodeType !== Node.ELEMENT_NODE || label.tagName !== 'SPAN' || !hasClasses(label, ['text-secondary-foreground', 'truncate'])) continue;
        if (label.childNodes.length !== 1 || label.childNodes[0].nodeType !== Node.TEXT_NODE) continue;
        const match = label.textContent.trim().match(/^(\\d+) files? changed$/);
        if (match) label.childNodes[0].textContent = match[1] + ' 个文件已更改';
      }
    }
  }


  function translateHiddenSystemUi() {
    if (typeof document.querySelectorAll !== 'function') return;
    function classes(element, names) {
      const list = (element.getAttribute('class') || '').split(/\\s+/);
      return names.every(name => list.includes(name));
    }
    function protectedUi(element, allowPre) {
      for (let node = element; node; node = node.parentElement) {
        if ((EXCLUDE_TAGS.has(node.tagName) && !(allowPre && node.tagName === 'PRE')) || node.matches('.monaco-editor, .cm-editor, [contenteditable]:not([contenteditable="false"])')) return true;
        if (['user-message', 'live-user-turn', 'user-message-content'].includes(node.getAttribute('data-testid'))) return true;
      }
      return false;
    }
    function attributes(element) {
      for (const name of ['title', 'aria-label']) {
        const value = element.getAttribute(name);
        if (!value) continue;
        const translated = translateText(value);
        if (translated !== null && translated !== value) element.setAttribute(name, translated);
      }
    }
    function leaves(element, result) {
      if (element.nodeType === Node.TEXT_NODE) { result.push(element); return; }
      if (element.nodeType !== Node.ELEMENT_NODE || protectedUi(element) || isPluginNameElement(element) || element.tagName === 'SVG' || element.hasAttribute('data-slot-out') || element.getAttribute('aria-hidden') === 'true') return;
      for (const child of element.childNodes) leaves(child, result);
    }
    function fixedLeaves(element) {
      if (protectedUi(element) || isPluginNameElement(element)) return;
      attributes(element);
      for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const key = child.textContent.replace(/\\s+/g, ' ').trim();
          const translated = normalizedDict[key];
          if (translated && translated !== child.textContent) child.textContent = translated;
        } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'SVG') fixedLeaves(child);
      }
    }
    function combined(element, dynamic) {
      const nodes = [];
      leaves(element, nodes);
      const text = nodes.map(node => node.textContent).join('').replace(/\\s+/g, ' ').trim();
      const prefixLabels = {Running:'正在运行',Ran:'已运行',Reading:'正在读取',Read:'已读取',Editing:'正在编辑',Edited:'已编辑',Listing:'正在列出',Listed:'已列出',Searching:'正在搜索',Searched:'已搜索',Thinking:'正在思考'};
      const translated = dynamic ? prefixLabels[text] || translateText(text) : normalizedDict[text];
      if (!translated || translated === text || !nodes.length) return;
      if (nodes[0].textContent !== translated) nodes[0].textContent = translated;
      for (const node of nodes.slice(1)) if (node.textContent) node.textContent = '';
    }
    const fixedRoots = ['code-block-preview-toggle', 'code-block-preview-button', 'code-block-raw-button', 'cos-canvas-label', 'computer-permissions-card', 'computer-permissions-relaunch', 'computer-permissions-continue', 'ask-question-collapse-button', 'ask-question-dismiss-button', 'cleared-step-notice'];
    for (const root of document.querySelectorAll(fixedRoots.map(id => '[data-testid="' + id + '"]').join(', '))) fixedLeaves(root);
    for (const root of document.querySelectorAll('[data-testid="browser-subagent-steps"], [data-testid="browser-subagent-step"]')) if (!protectedUi(root)) attributes(root);
    for (const root of document.querySelectorAll('[data-testid="mcp-app-view-error"]')) {
      if (protectedUi(root)) continue;
      const first = Array.from(root.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (first && first.textContent.trim() === 'Could not load the app view:') first.textContent = '无法加载应用视图：';
    }
    for (const header of document.querySelectorAll('.group.min-h-8.select-none')) {
      if (protectedUi(header) || !classes(header, ['flex', 'w-full', 'min-w-0', 'items-center', 'py-1', 'px-2'])) continue;
      const group = Array.from(header.childNodes).find(node => node.nodeType === Node.ELEMENT_NODE && classes(node, ['flex', 'min-w-0', 'items-center', 'gap-x-1']));
      if (!group) continue;
      let prefixFound = false;
      for (const row of group.querySelectorAll('div')) {
        if (!classes(row, ['flex', 'flex-row', 'items-center', 'gap-1', 'overflow-hidden', 'whitespace-nowrap', 'text-muted-foreground'])) continue;
        const prefix = Array.from(row.childNodes).find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN' && node.getAttribute('class') === 'text-muted-foreground' && !node.hasAttribute('title'));
        if (!prefix) continue;
        prefixFound = true;
        combined(prefix, true);
      }
    }
    for (const label of document.querySelectorAll('.h-8.text-muted-foreground.select-none')) {
      if (!protectedUi(label) && classes(label, ['px-2', 'flex', 'items-center'])) {
        for (const child of label.childNodes) if (child.nodeType === Node.TEXT_NODE && child.textContent.trim() === 'Waiting for user input') child.textContent = '等待用户输入';
      }
    }
    for (const label of document.querySelectorAll('h5, h6')) {
      const parent = label.parentElement;
      if (!parent || !classes(label, ['sr-only']) || !label.hasAttribute('data-find-ignore')) continue;
      const id = parent.getAttribute('data-testid');
      const allowed = (id === 'user-message' && label.tagName === 'H5' && label.textContent === 'You said') || (id === 'agent-response' && label.tagName === 'H6' && ['Agent working', 'Agent said'].includes(label.textContent));
      if (allowed && label.childNodes.length === 1 && label.childNodes[0].nodeType === Node.TEXT_NODE) {
        const translated = normalizedDict[label.textContent];
        if (translated && translated !== label.textContent) label.childNodes[0].textContent = translated;
      }
    }
    for (const error of document.querySelectorAll('p.text-red-500.text-sm.pl-1')) {
      if (protectedUi(error)) continue;
      let form = error.parentElement;
      while (form && form.tagName !== 'FORM') form = form.parentElement;
      if (form && classes(form, ['flex', 'flex-col', 'gap-1'])) combined(error, true);
    }
    const modelRows = new Set(document.querySelectorAll('[data-testid="model-selector-item"], [data-testid="model-selector-custom-item"]'));
    for (const group of document.querySelectorAll('[data-testid="model-selector-effort-group"]')) if (group.parentElement) modelRows.add(group.parentElement);
    for (const row of modelRows) {
      if (protectedUi(row)) continue;
      for (const badge of row.querySelectorAll('.bg-secondary.rounded-full.text-sm')) {
        if (!classes(badge, ['px-1.5'])) continue;
        const label = badge.childNodes.length === 1 && badge.childNodes[0].nodeType === Node.TEXT_NODE ? badge : Array.from(badge.childNodes).find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN' && node.childNodes.length === 1 && node.childNodes[0].nodeType === Node.TEXT_NODE);
        if (label && ['New', 'NEW', '新建'].includes(label.textContent.trim())) label.childNodes[0].textContent = '新增';
      }
    }
    for (const root of document.querySelectorAll('[data-testid="model-selector-trigger"]')) {
      if (protectedUi(root)) continue;
      let aggregate = false;
      for (const label of root.querySelectorAll('span')) {
        if (!label.hasAttribute('data-tooltip-id') || label.childNodes.length !== 1 || label.childNodes[0].nodeType !== Node.TEXT_NODE) continue;
        const count = label.textContent.match(/^(\\d+) models selected$/);
        if (count) { aggregate = true; label.childNodes[0].textContent = '已选择 ' + count[1] + ' 个模型'; }
        else if (/^已选择 \\d+ 个模型$/.test(label.textContent)) aggregate = true;
      }
      const aria = root.getAttribute('aria-label');
      if (aggregate && aria && /^(Select model, current:|选择模型，当前：)/.test(aria)) {
        const translated = aria.replace(/(\\d+) models selected/, '已选择 $1 个模型');
        if (translated !== aria) root.setAttribute('aria-label', translated);
      }
    }
    for (const pre of document.querySelectorAll('pre')) {
      if (protectedUi(pre, true) || !classes(pre, ['overflow-auto']) && !classes(pre, ['overflow-y-auto'])) continue;
      const wrapper = Array.from(pre.childNodes).find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === 'DIV');
      const label = wrapper && wrapper.childNodes[0];
      if (!label || label.nodeType !== Node.ELEMENT_NODE || label.tagName !== 'DIV' || !classes(label, ['text-muted-foreground']) || label.childNodes.length < 4 || Array.from(label.childNodes).some(node => node.nodeType !== Node.TEXT_NODE)) continue;
      const match = label.textContent.match(/^(?:…\\s*\\()?([0-9]+) lines? above hidden\\)?$/);
      if (match) {
        label.childNodes[0].textContent = '…（上方已隐藏 ' + match[1] + ' 行）';
        for (const node of Array.from(label.childNodes).slice(1)) if (node.textContent) node.textContent = '';
      }
    }
  }


  const uiDateMonths = {January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12};

  function formatUiDate(value) {
    return value.replace(/\\b(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2}),\\s+(\\d{4})\\b/g, (original, month, day, year) => Number(day) >= 1 && Number(day) <= 31 ? year + ' 年 ' + uiDateMonths[month] + ' 月 ' + Number(day) + ' 日' : original);
  }

  function translateTextInternal(text) {
    if (!text) return null;
    const normalizedText = text.replace(/\\s+/g, ' ').trim();
    if (!normalizedText) return null;
    const membershipText = translateMembershipText(normalizedText);
    if (membershipText !== null) return membershipText;
    
    const effortNames = {low:'低',medium:'中',high:'高',xhigh:'极高',extra:'极高',max:'最高',thinking:'思考'};
    const modelEffortSuffix = normalizedText.match(/^((?:Gemini|Claude|GPT|Sonnet|Opus)[^()]*?)\\s*\\((low|medium|high|xhigh|max|extra|thinking)(?:\\s+thinking)?\\)$/i);
    if (modelEffortSuffix) return modelEffortSuffix[1].trim() + '（' + effortNames[modelEffortSuffix[2].toLowerCase()] + '）';
    const modelEffortTail = normalizedText.match(/^((?:Gemini|Claude|GPT|Sonnet|Opus).+?)\\s+(low|medium|high|xhigh|max|extra)$/i);
    if (modelEffortTail) return modelEffortTail[1] + ' ' + effortNames[modelEffortTail[2].toLowerCase()];
    const paidPlanNotice = normalizedText.match(/^(.+?) (?:is now available|are available) on paid Pro and Ultra plans\\. Third-party model access will no longer be available on your current plan starting on (.+)\\.$/);
    if (paidPlanNotice) return paidPlanNotice[1].replace(/ and /g, ' 和 ') + ' 现已向付费 Pro 和 Ultra 方案用户开放。从 ' + formatUiDate(paidPlanNotice[2]) + '起，你当前的方案将不再提供第三方模型访问权限。';
    const modelLeavingNotice = normalizedText.match(/^(.+?)\\. Leaving on ([A-Z][a-z]+)\\.? (\\d{1,2})(?:, (\\d{4}))?\\.?$/);
    if (modelLeavingNotice) {
      const [, description, monthText, dayText, year] = modelLeavingNotice;
      const label = normalizedDict[description + '.'] || normalizedDict[description];
      const monthName = Object.keys(uiDateMonths).find(month => month === monthText || month.slice(0, 3) === monthText);
      const day = Number(dayText);
      if (label && monthName && day >= 1 && day <= 31) {
        const date = (year ? year + ' 年 ' : '') + uiDateMonths[monthName] + ' 月 ' + day + ' 日';
        return label.replace(/[。.]$/, '') + '。将于 ' + date + '下线。';
      }
    }
    const removalNotice = normalizedText.match(/^(.+?) will be removed from Antigravity on (.+)\\.$/);
    if (removalNotice) return removalNotice[1] + ' 将于 ' + formatUiDate(removalNotice[2]) + '从 Antigravity 中移除。';
    const planAvailability = normalizedText.match(/^(.+?) is currently available to (Ultra plan|Ultra and paid Pro plan|paid Pro and Ultra) subscribers\\.$/);
    if (planAvailability) {
      const plans = {'Ultra plan':'Ultra 方案订阅用户','Ultra and paid Pro plan':'Ultra 和付费 Pro 方案订阅用户','paid Pro and Ultra':'付费 Pro 和 Ultra 订阅用户'};
      return planAvailability[1] + ' 目前向' + (planAvailability[2] === 'paid Pro and Ultra' ? '' : ' ') + plans[planAvailability[2]] + '开放。';
    }
    const quotaResetNotice = normalizedText.match(/^Your quota for (.+?) will reset on (.+)\\. Switch to another available model to continue\\.$/);
    if (quotaResetNotice) return (quotaResetNotice[1] === 'this model' ? '此模型' : quotaResetNotice[1] + ' ') + '的配额将于 ' + formatUiDate(quotaResetNotice[2]) + '重置。请切换到其他可用模型以继续。';
    const quotaReachedNotice = normalizedText.match(/^Your quota for (.+?) has been reached\\. Switch to another available model to continue\\.$/);
    if (quotaReachedNotice) return (quotaReachedNotice[1] === 'this model' ? '此模型' : quotaReachedNotice[1] + ' ') + '的配额已用尽。请切换到其他可用模型以继续。';
    const baselineResetNotice = normalizedText.match(/^Your plan's baseline quota will refresh on (.+)\\.$/);
    if (baselineResetNotice) return '你的方案基础配额将于 ' + formatUiDate(baselineResetNotice[1]) + '刷新。';
    const quotaPermissionText = translateQuotaPermissionText(normalizedText);
    if (quotaPermissionText !== null) return quotaPermissionText;
    // 1. Exact match in normalized dictionary
    if (normalizedDict[normalizedText]) {
      return normalizedDict[normalizedText];
    }
    
    // Dynamic translation for recorded token usage labels.
    const budgetMatch = normalizedText.match(/^([\\d.]+)%\\s+of\\s+the\\s+customization\\s+budget\\s+is\\s+available\\.$/i);
    if (budgetMatch) {
      return \`可用自定义额度为 \${budgetMatch[1]}%。\`;
    }
    
    // 4. Dynamic Regex translation for breakdowns link
    const breakdownsMatch = normalizedText.match(/^Show\\s+(\\d+)\\s+breakdowns?$/i);
    if (breakdownsMatch) {
      return \`查看 \${breakdownsMatch[1]} 项使用细分\`;
    }
    
    // 5. Dynamic Regex translation for Skills counts
    const skillsMatch = normalizedText.match(/^Skills\\s*\\((\\d+)\\)$/i);
    if (skillsMatch) {
      return \`已启用智能体技能 (\${skillsMatch[1]})\`;
    }

    // 6. Dynamic Regex translation for Skills percent/tokens
    const skillsPctMatch = normalizedText.match(/^Skills\\s*\\(([\\d.]+)%\\)\\s*([\\d,]+)$/i);
    if (skillsPctMatch) {
      return \`技能 (\${skillsPctMatch[1]}%) \${skillsPctMatch[2]} Token\`;
    }

    // 7. Dynamic Regex translation for "See all (14)"
    const seeAllMatch = normalizedText.match(/^See\\s+all\\s+\\((\\d+)\\)$/i);
    if (seeAllMatch) {
      return \`查看全部 (\${seeAllMatch[1]})\`;
    }

    // 8. Dynamic Regex translation for "Learn more about xxx"
    const learnMoreMatch = normalizedText.match(/^Learn\\s+more\\s+about\\s+(.+)$/i);
    if (learnMoreMatch) {
      return \`了解更多关于 \${learnMoreMatch[1]}\`;
    }

    // 9. Dynamic Regex translation for "N project(s)"（"Modified in 4 projects" 的计数节点）
    const projectsMatch = normalizedText.match(/^(\\d+)\\s+projects?$/i);
    if (projectsMatch) {
      return \`\${projectsMatch[1]} 个项目\`;
    }

    // 10. Dynamic Regex translation for "Worked for 5m 23s"（任务耗时）
    const workedForMatch = normalizedText.match(/^Worked\\s+for\\s+(.+)$/i);
    if (workedForMatch) {
      return \`工作时长 \${workedForMatch[1]}\`;
    }

    // 11. Dynamic Regex translation for "Show more (N)"
    const showMoreMatch = normalizedText.match(/^Show\\s+more\\s+\\((\\d+)\\)$/i);
    if (showMoreMatch) {
      return \`显示更多（\${showMoreMatch[1]}）\`;
    }

    // 12. Dynamic Regex translation for "Start Best-of-N"
    const bestOfMatch = normalizedText.match(/^Start\\s+Best-of-(\\d+)$/i);
    if (bestOfMatch) {
      return \`启动 Best-of-\${bestOfMatch[1]}\`;
    }

    // 13. Dynamic Regex translation for "Available for N project(s)"
    const availMatch = normalizedText.match(/^Available\\s+for\\s+(\\d+)\\s+projects?$/i);
    if (availMatch) {
      return \`可用于 \${availMatch[1]} 个项目\`;
    }

    // 14. Dynamic Regex translation for "Thought for 3s"（模型深度思考耗时）
    const thoughtForMatch = normalizedText.match(/^Thought\\s+for\\s+(.+)$/i);
    if (thoughtForMatch) {
      return \`思考时长 \${thoughtForMatch[1]}\`;
    }

    // 15. Dynamic Regex translation for "No more older messages, showing 115 of 115"
    const olderMsgsMatch = normalizedText.match(/^No\\s+more\\s+older\s+messages,\s*showing\s+(\\d+)\s+of\s+(\\d+)$/i);
    if (olderMsgsMatch) {
      return \`没有更早的消息，显示第 \${olderMsgsMatch[1]} / \${olderMsgsMatch[2]} 条\`;
    }

    // 16. Dynamic Regex translation for "Select model, current: ..."
    const runningModelSelector = normalizedText.match(/^Select model, current: (.+)\\. (Applies to (?:\\/btw and )?messages sent after this turn)$/);
    if (runningModelSelector && normalizedDict[runningModelSelector[2]]) {
      return '选择模型，当前：' + runningModelSelector[1] + '。' + normalizedDict[runningModelSelector[2]];
    }
    const selectModelMatch = normalizedText.match(/^Select\\s+model,\s*current:\s*(.+)$/i);
    if (selectModelMatch) {
      return \`选择模型，当前：\${selectModelMatch[1]}\`;
    }

    // 17. Dynamic Regex translation for "Agent permissions preset selector, current: ..."
    const presetSelectorMatch = normalizedText.match(/^Agent\\s+permissions\\s+preset\\s+selector,\s*current:\s*(.+)$/i);
    if (presetSelectorMatch) {
      return \`智能体权限预设选择器，当前：\${presetSelectorMatch[1]}\`;
    }

    // 18. Dynamic Regex translation for "Show submitted (N)"
    const showSubmittedMatch = normalizedText.match(/^Show\\s+submitted\\s+\\((\\d+)\\)$/i);
    if (showSubmittedMatch) {
      return \`显示已提交（\${showSubmittedMatch[1]}）\`;
    }

    // 19. Dynamic Regex translation for "Load older messages, showing N of M"
    const loadOlderMsgsMatch = normalizedText.match(/^Load\\s+older\\s+messages,\\s*showing\\s+(\\d+)\\s+of\\s+(\\d+)$/i);
    if (loadOlderMsgsMatch) {
      return \`加载更早的消息，显示第 \${loadOlderMsgsMatch[1]} / \${loadOlderMsgsMatch[2]} 条\`;
    }

    // 20. Dynamic Regex translation for "Turn N of M"（对话轮次）
    const turnMatch = normalizedText.match(/^Turn\\s+(\\d+)\\s+of\\s+(\\d+)$/i);
    if (turnMatch) {
      return \`第 \${turnMatch[1]} / \${turnMatch[2]} 轮对话\`;
    }

    // 21. Dynamic Regex translation for "Show N earlier step(s)"
    const earlierStepsMatch = normalizedText.match(/^Show\\s+(\\d+)\\s+earlier\\s+steps?$/i);
    if (earlierStepsMatch) {
      return \`显示前 \${earlierStepsMatch[1]} 个步骤\`;
    }

    // 22. Dynamic Regex translation for "Updated <Date/Time>"
    const updatedMatch = normalizedText.match(/^Updated\\s+(.+)$/i);
    if (updatedMatch) {
      return \`更新于 \${updatedMatch[1]}\`;
    }

    // 24. Dynamic Regex translation for tab close tooltip: "Close <Tab Title>"
    const closeTabMatch = normalizedText.match(/^Close\\s+(.+)$/i);
    if (closeTabMatch && closeTabMatch[1].length > 3) {
      return \`关闭 \${closeTabMatch[1]}\`;
    }

    // 25. Dynamic Regex translation for "Your Plan: ..."
    const yourPlanMatch = normalizedText.match(/^Your\\s+Plan:\\s*(.+)$/i);
    if (yourPlanMatch) {
      return \`您的计划：\${normalizedDict[yourPlanMatch[1]] || yourPlanMatch[1]}\`;
    }

    // 26. Dynamic Regex translation for "Resets in ..."
    const resetsInMatch = normalizedText.match(/^Resets\\s+in\\s+(.+)$/i);
    if (resetsInMatch) {
      let t = resetsInMatch[1].trim();
      if (t === '<1m') return '将在 1 分钟内重置';
      t = t.replace(/\\s+/g, ' ')
           .replace(/(\\d+)\\s*d/g, '$1 天 ')
           .replace(/(\\d+)\\s*h/g, '$1 小时 ')
           .replace(/(\\d+)\\s*m/g, '$1 分钟')
           .replace(/\\s+/g, ' ')
           .trim();
      return \`将在 \${t} 后重置\`;
    }

    // 27. Dynamic Regex translation for "Use <Voice>"
    const useVoiceMatch = normalizedText.match(/^Use\\s+(Fola|Arlo|Cleo|Finn|Gero|Lora|Neno|Olin|Tari)$/i);
    if (useVoiceMatch) {
      return \`使用 \${useVoiceMatch[1]}\`;
    }

    // 28. Dynamic Regex translation for "N h/d/m limit"
    const nLimitMatch = normalizedText.match(/^(\\d+)\\s*(s|m|h|d)\\s+limit$/i);
    if (nLimitMatch) {
      const unitMap = { s: '秒', m: '分钟', h: '小时', d: '天' };
      return \`\${nLimitMatch[1]} \${unitMap[nLimitMatch[2].toLowerCase()] || nLimitMatch[2]}限额\`;
    }

    const failedServers = normalizedText.match(/^(\\d+) MCP servers? failed to start$/);
    if (failedServers) return failedServers[1] + ' 个 MCP 服务器启动失败';
    const authPlugin = normalizedText.match(/^MCP server (.+) requires authentication: sign in to "(.+)" in the Accounts section of plugin "(.+)"$/);
    if (authPlugin) return 'MCP 服务器 ' + authPlugin[1] + ' 需要身份验证：请在插件“' + authPlugin[3] + '”的“账号”部分登录“' + authPlugin[2] + '”';
    const authServer = normalizedText.match(/^MCP server (.+) requires authentication$/);
    if (authServer) return 'MCP 服务器 ' + authServer[1] + ' 需要身份验证';
    const credentialExpiry = normalizedText.match(/^Credentials expire in ((?:\\d+(?:\\.\\d+)?[dhms]\\s*)+)\\. Refresh credentials to keep this automation running$/);
    if (credentialExpiry) {
      const units = {d:'天',h:'小时',m:'分钟',s:'秒'};
      const duration = credentialExpiry[1].trim().replace(/(\\d+(?:\\.\\d+)?)([dhms])/g, (_, value, unit) => value + ' ' + units[unit]);
      return '凭据将在 ' + duration + '后到期。请刷新凭据以保持此自动化任务运行。';
    }
    const noApps = normalizedText.match(/^No apps found for "(.+)"\\.$/);
    if (noApps) return '未找到与“' + noApps[1] + '”匹配的应用。';
    const agentUpdateError = normalizedText.match(/^Error updating agent: (.+)$/);
    if (agentUpdateError) return '更新智能体时出错：' + agentUpdateError[1];

    const welcomeMatch = normalizedText.match(/^Welcome back,\\s*(.+?)\\.\\s*Where should we pick up\\?$/i);
    if (welcomeMatch) return '欢迎回来，' + welcomeMatch[1] + '。我们从哪里继续？';
    const greetingMatch = normalizedText.match(/^Hey\\s+(.+?),\\s*what should we build today\\?$/i);
    if (greetingMatch) return '你好，' + greetingMatch[1] + '，今天我们来做些什么？';
    const goodToSeeMatch = normalizedText.match(/^Good to see you,\\s*(.+?)\\.\\s*What's next\\?$/i);
    if (goodToSeeMatch) return '很高兴见到你，' + goodToSeeMatch[1] + '。接下来做什么？';
    const selectorMatch = normalizedText.match(/^(Select project|Select model|Agent permissions preset selector),\\s*current:\\s*(.+)$/i);
    if (selectorMatch) {
      const labels = {'select project': '选择项目', 'select model': '选择模型', 'agent permissions preset selector': '智能体权限预设'};
      return labels[selectorMatch[1].toLowerCase()] + '，当前：' + (normalizedDict[selectorMatch[2]] || selectorMatch[2]);
    }
    const versionMatch = normalizedText.match(/^Version\\s+([0-9.]+)$/i);
    if (versionMatch) return '版本 ' + versionMatch[1];
    const manageProjectMatch = normalizedText.match(/^Manage (project|workspace) (resources|folders)(, agent settings, and permissions| and settings)\\.$/i);
    if (manageProjectMatch) return '管理' + (manageProjectMatch[1].toLowerCase() === 'project' ? '项目' : '工作区') + (manageProjectMatch[2].toLowerCase() === 'resources' ? '资源' : '文件夹') + (manageProjectMatch[3].startsWith(',') ? '、智能体设置和权限。' : '和设置。');
    const outsideProjectMatch = normalizedText.match(/^(Agent settings and permissions|Settings) for conversations outside of (projects|workspaces)\\.$/i);
    if (outsideProjectMatch) return '未处于' + (outsideProjectMatch[2].toLowerCase() === 'projects' ? '项目' : '工作区') + '中的会话的' + (outsideProjectMatch[1].toLowerCase() === 'settings' ? '设置。' : '智能体设置和权限。');
    const pluginActionMatch = normalizedText.match(/^(Install|Add) (.+)$/);
    if (pluginActionMatch) return (pluginActionMatch[1] === 'Install' ? '安装 ' : '添加 ') + pluginActionMatch[2];
    const pluginDetailsMatch = normalizedText.match(/^Details for (.+)$/);
    if (pluginDetailsMatch) return '查看 ' + pluginDetailsMatch[1] + ' 的详情';
    const shelfMatch = normalizedText.match(/^See more in (.+)$/);
    if (shelfMatch) return '查看更多' + (normalizedDict[shelfMatch[1]] || shelfMatch[1]);
    const featuredTabsMatch = normalizedText.match(/^Plugins in (.+)$/);
    if (featuredTabsMatch) return (normalizedDict[featuredTabsMatch[1]] || featuredTabsMatch[1]) + '插件';
    const feedbackIdentityMatch = normalizedText.match(/^Send feedback as (.+)$/);
    if (feedbackIdentityMatch) return '以 ' + feedbackIdentityMatch[1] + ' 的身份发送反馈';
    const usageDetailMatch = normalizedText.match(/^(Daily limit|Weekly limit|\\d+\\s*[smhd]\\s+limit),\\s*resets in (.+)$/i);
    if (usageDetailMatch) return (translateText(usageDetailMatch[1]) || usageDetailMatch[1]) + '，' + (translateText('Resets in ' + usageDetailMatch[2]) || usageDetailMatch[2]);
    const percentageLeftMatch = normalizedText.match(/^(\\d+(?:\\.\\d+)?)% left$/i);
    if (percentageLeftMatch) return percentageLeftMatch[1] + '% 可用';
    const availableCreditsMatch = normalizedText.match(/^Available AI Credits:\\s*(.+)$/i);
    if (availableCreditsMatch) return '可用 AI 积分：' + availableCreditsMatch[1];
    const inheritedPermissionsMatch = normalizedText.match(/^Inherits your Global Permissions when working (in this project|in these conversations)\\.$/);
    if (inheritedPermissionsMatch) return '在' + (inheritedPermissionsMatch[1] === 'in this project' ? '此项目' : '这些会话') + '中工作时，沿用你的全局权限。';
    const hiddenUiText = translateHiddenUiTemplate(normalizedText);
    if (hiddenUiText !== null) return hiddenUiText;
    return null;
  }

  const localizedUiResults = new Set();
  function translateText(text) {
    if (!text) return null;
    const normalized = text.replace(/\\s+/g, ' ').trim();
    if (localizedUiResults.has(normalized)) return null;
    const translated = translateTextInternal(text);
    if (translated !== null && translated !== text) localizedUiResults.add(translated.replace(/\\s+/g, ' ').trim());
    return translated;
  }

  function translateContextMenuItems(items, parentId = '') {
    if (!Array.isArray(items)) return items;
    return items.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const next = { ...item };
      const id = typeof next.id === 'string' ? next.id : '';
      const isCustomGroup = (parentId === 'move-to-group' || id.startsWith('group-')) && id !== 'group-new' && id !== 'group-remove';
      if (typeof next.label === 'string' && !isCustomGroup) {
        const normalized = next.label.replace(/\\s+/g, ' ').trim();
        if (id === 'message-timestamp') {
          const translatedTime = formatRelativeUiTime(normalized);
          if (translatedTime !== null) next.label = translatedTime;
          else {
            const translated = translateText(next.label);
            if (translated !== null) next.label = translated;
          }
        } else if (id === 'forward' && normalized === 'Forward') {
          next.label = '前进';
        } else {
          const translated = translateText(next.label);
          if (translated !== null) next.label = translated;
        }
      }
      const childParentId = id || parentId;
      if (Array.isArray(next.submenu)) next.submenu = translateContextMenuItems(next.submenu, childParentId);
      if (Array.isArray(next.items)) next.items = translateContextMenuItems(next.items, childParentId);
      return next;
    });
  }

  globalThis._agTranslateContextMenuItems = translateContextMenuItems;
  if (window.electronNative && typeof window.electronNative.showContextMenu === 'function' && !window.electronNative.__agZhContextMenuPatched) {
    try {
      const origShowContextMenu = window.electronNative.showContextMenu.bind(window.electronNative);
      window.electronNative.showContextMenu = (items) => origShowContextMenu(translateContextMenuItems(items));
      window.electronNative.__agZhContextMenuPatched = true;
    } catch {}
  }

  function translateRestorePageIcon(node) {
    const icon = node.parentElement;
    if (!icon || !icon.matches('span.google-symbols') || icon.getAttribute('aria-hidden') !== 'true') return false;
    for (let row = icon.parentElement; row; row = row.parentElement) {
      const testId = row.getAttribute('data-testid') || '';
      if (!testId.startsWith('fastpick-item-') && !row.matches('.agy-overlay-item')) continue;
      if (row.getAttribute('data-item-id') !== 'reopenClosedAuxTab' &&
          !row.textContent.includes('Reopen Closed Tab') && !row.textContent.includes('重新打开关闭的标签页')) return false;
      // The client renders this icon as a font ligature, which can appear as its name.
      node.textContent = '↶';
      return true;
    }
    return false;
  }

  const sharedThemePresets = { Catppuccin: '猫布奇诺', Everforest: '常青森林', 'Gruvbox Material': '复古材质' };
  const themePresets = {
    light: { ...sharedThemePresets, 'Default Light': '默认浅色', 'Legacy Light': '经典浅色',
      'One Light': '一号浅色', 'Solarized Light': '日光浅色' },
    dark: { ...sharedThemePresets, 'Default Dark': '默认深色', 'Legacy Dark': '经典深色', Dracula: '德古拉',
      Monokai: '莫诺凯', Nord: '北境', 'One Dark Pro': '一号深色专业版', 'Tokyo Night': '东京之夜',
      'Solarized Dark': '日光深色', Vesper: '暮星' }
  };
  const themeColors = { Background: '背景色', Foreground: '前景色', Accent: '强调色' };

  function appearanceSection(element) {
    const section = element.closest('.space-y-2');
    const heading = section?.querySelector('h3.m-0.font-medium')?.textContent;
    if (heading === 'Light Theme' || heading === '浅色主题') return 'light';
    if (heading === 'Dark Theme' || heading === '深色主题') return 'dark';
    if (heading === 'Appearance' || heading === '外观') return 'appearance';
    return null;
  }

  function presetMode(control) {
    if (!control?.getAttribute('aria-labelledby')?.startsWith('theme-preset-label-')) return null;
    const mode = appearanceSection(control);
    return Object.hasOwn(themePresets, mode) ? mode : null;
  }

  function translateAppearanceText(node) {
    const element = node.parentElement;
    if (!element) return null;
    const text = node.textContent;
    let mode;
    if (element.id?.startsWith('dropdown-value-') && element.parentElement?.matches('button.agy-select-trigger')) {
      mode = presetMode(element.parentElement);
    } else if (element.tagName === 'OPTION') {
      mode = presetMode(element.parentElement);
    } else if (element.matches('div.truncate')) {
      const option = element.closest('.agy-overlay-item[role="option"]');
      const list = option?.closest('[role="listbox"]');
      if (list?.id.endsWith('-list') && list.closest('[data-select-popup]')) {
        const trigger = document.getElementById(list.id.slice(0, -5));
        mode = presetMode(trigger);
        if (mode && option.querySelector('[data-testid="theme-preset-plugin-icon"]')) return text;
      }
    }
    // A plugin can use a built-in name from the other mode. Keep all unrecognized preset names verbatim.
    if (mode) return Object.hasOwn(themePresets[mode], text) ? themePresets[mode][text] : text;

    if (text === 'Strong' && element.closest('[data-slot="toggle-group"]') && appearanceSection(element) === 'appearance') return '增强';
    if (text.startsWith('from ') && element.matches('span.sr-only') && element.closest('[data-testid="theme-preset-plugin-icon"]')) {
      return text === 'from a plugin' ? '来自插件' : '来自 ' + text.slice(5);
    }
    if (element.tagName === 'SPAN' && Object.hasOwn(themeColors, text) && Object.hasOwn(themePresets, appearanceSection(element))) {
      return themeColors[text];
    }
    return null;
  }

  function translateThemeColorAttribute(element, text) {
    const suffix = ' color picker';
    const isPicker = element.tagName === 'BUTTON' && text.endsWith(suffix);
    const color = isPicker ? text.slice(0, -suffix.length) : text;
    if (!isPicker && (element.tagName !== 'INPUT' || element.getAttribute('type') !== 'text')) return null;
    if (!Object.hasOwn(themeColors, color) || !Object.hasOwn(themePresets, appearanceSection(element))) return null;
    return themeColors[color] + (isPicker ? '取色器' : '');
  }

  function translateNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (isInExcludedZone(node)) return;
      if (node.textContent === 'restore_page' && translateRestorePageIcon(node)) return;
      if (node.parentElement?.getAttribute('data-testid') === 'find-bar-match-count') {
        const count = node.textContent.match(/^(\\d+) of (\\d+\\+?)$/);
        if (count) {
          node.textContent = '第 ' + count[1] + ' 项，共 ' + count[2] + ' 项';
          return;
        }
      }
      const translated = translateAppearanceText(node) ?? translateText(node.textContent);
      if (translated !== null && translated !== node.textContent) {
        node.textContent = translated;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (isPluginNameElement(node)) return;
      translateAutomationNotice(node);
      translateComposedDescription(node);
      // Input placeholders
      if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
        const placeholder = node.getAttribute('placeholder');
        const translated = translateText(placeholder);
        if (translated !== null && translated !== placeholder) {
          node.setAttribute('placeholder', translated);
        }
      }
      // Tooltips and titles
      if (node.hasAttribute('title')) {
        const title = node.getAttribute('title');
        const translated = translateThemeColorAttribute(node, title) ?? translateText(title);
        if (translated !== null && translated !== title) {
          node.setAttribute('title', translated);
        }
      }
      // ARIA labels (commonly used by icon-only buttons)
      if (node.hasAttribute('aria-label')) {
        const ariaLabel = node.getAttribute('aria-label');
        const translated = translateThemeColorAttribute(node, ariaLabel) ?? translateText(ariaLabel);
        if (translated !== null && translated !== ariaLabel) {
          node.setAttribute('aria-label', translated);
        }
      }
      // Translate buttons/inputs with values
      if (node.tagName === 'INPUT' && (node.type === 'button' || node.type === 'submit')) {
        const val = node.value;
        const translated = translateText(val);
        if (translated !== null && translated !== val) {
          node.value = translated;
        }
      }
      if (isInExcludedZone(node)) return;
      // Check children
      for (let child of node.childNodes) {
        translateNode(child);
      }
    }
  }

  function translateComposedAncestors(node) {
    let element = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
    for (let depth = 0; element && depth < 8; depth++, element = element.parentElement) {
      if (isInExcludedZone(element)) return;
      translateAutomationNotice(element);
      translateComposedDescription(element);
    }
  }

  function observeDOM() {
    const observer = new MutationObserver((mutations) => {
      for (let mutation of mutations) {
        if (mutation.type === 'childList') {
          translateComposedAncestors(mutation.target);
          for (let node of mutation.addedNodes) {
            if (!isInExcludedZone(node)) {
              translateNode(node);
            }
          }
        } else if (mutation.type === 'characterData' || mutation.type === 'attributes') {
          translateComposedAncestors(mutation.target);
          if (!isInExcludedZone(mutation.target)) {
            translateNode(mutation.target);
          }
        }
      }
      translateComparisonSurvey();
      translateHiddenSystemUi();
    translateRuntimeUiLabels();
    translatePermissionCards();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'aria-label', 'placeholder']
    });

    // Initial translation
    translateNode(document.body);
    translateComparisonSurvey();
    translateHiddenSystemUi();
    translateRuntimeUiLabels();
    translatePermissionCards();
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeDOM);
  } else {
    observeDOM();
  }

  const extraTitleMap = {
    'Agent Manager': '智能体管理器',
    'Inbox': '收件箱',
    'New Conversation': '新建会话',
    'New Chat': '新建对话',
    'Settings': '设置',
    'Customizations': '自定义配置',
    'Browser': '浏览器',
    'Terminal': '终端',
    'Changes': '更改'
  };

  function translateDocumentTitle(title) {
    if (!title || typeof title !== 'string') return null;
    const source = title.trim();
    if (Object.hasOwn(extraTitleMap, source)) return title.replace(source, extraTitleMap[source]);
    // Only fixed app page titles are UI. Conversation/project/terminal titles
    // can contain commands or user text and must not use the general dictionary.
    const page = source.match(/^(Agent Manager|Inbox|New Conversation|New Chat|Settings|Customizations|Browser|Terminal|Changes)(\\s+[-—|]\\s+Antigravity)$/);
    if (page) return title.replace(source, extraTitleMap[page[1]] + page[2]);
    return null;
  }

  function applyTitleTranslation() {
    const title = document.title;
    const translated = translateDocumentTitle(title);
    if (translated !== null && title !== translated) {
      document.title = translated;
    }
  }

  applyTitleTranslation();

  let titleObservationRoot = null;
  function observeTitleRoot() {
    const root = document.head || document.documentElement;
    if (!root || root === titleObservationRoot) return;
    titleObserver.disconnect();
    titleObservationRoot = root;
    titleObserver.observe(root, { childList: true, characterData: true, subtree: true });
  }
  const titleObserver = new MutationObserver(() => {
    applyTitleTranslation();
    observeTitleRoot();
  });
  observeTitleRoot();
})();
// ==================== END OF ANTIGRAVITY CHINESE LOCALIZATION PATCH ====================
`;
}

module.exports = { patch, revert, buildInjectScript, SUPPORTED_VERSION, SUPPORTED_VERSIONS };
if (require.main === module) {
  const args = process.argv.slice(2);
  const invalid = args.filter(argument => !['--revert', '--no-kill', '--help', '-h'].includes(argument));
  if (invalid.length) { console.error('未知参数：' + invalid.join(' ')); process.exitCode = 1; }
  else if (args.includes('--help') || args.includes('-h')) console.log(`node patch.js [--revert] [--no-kill]\n支持 Windows Antigravity ${SUPPORTED_VERSIONS.join(' / ')}。请先保存工作并正常退出客户端。`);
  else Promise.resolve().then(() => {
    const operate = args.includes('--revert') ? revert : patch;
    return operate({ clientVersion: readReleaseTarget() });
  }).catch(error => { console.error('操作失败：' + error.message); process.exitCode = 1; });
}
