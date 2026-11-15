'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawn, spawnSync } = require('node:child_process');

const SUPPORTED_VERSION = '2.32.1';
const PATCH_MARKER = 'ANTIGRAVITY CHINESE LOCALIZATION PATCH';
const EXPECTED_MODULES = ['preload', 'main', 'menu', 'tray', 'updater', 'provisionSplash', 'ipcHandlers'];

function requireWindows() {
  if (process.platform !== 'win32') throw new Error('本补丁仅支持 Windows Antigravity 2.32.1。');
}

function loadAsar() {
  try { return require('@electron/asar'); }
  catch { throw new Error('缺少 @electron/asar，请先在补丁目录执行 npm ci。'); }
}

function getPaths(installDirectory) {
  const installDir = path.resolve(installDirectory || process.env.ANTIGRAVITY_INSTALL_DIR || path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity'));
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
  if (version !== SUPPORTED_VERSION) throw new Error(`不支持 Antigravity ${version || '未知版本'}；本补丁仅验证了 ${SUPPORTED_VERSION}。`);
  for (const module of EXPECTED_MODULES) {
    try { asar.statFile(archive, path.join('dist', module + '.js')); }
    catch { throw new Error(`客户端结构不匹配：缺少 dist/${module}.js，未修改安装文件。`); }
  }
  return version;
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

function validateBackup(asar, paths, currentVersion, allowLegacyMetadata) {
  if (!fs.existsSync(paths.backup)) throw new Error('缺少原始 app.asar.bak；不能从已汉化客户端创建英文备份。请先重新安装同版本官方客户端。');
  const backupVersion = validateArchive(asar, paths.backup);
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

function killAntigravity(paths) {
  const query = '$ErrorActionPreference="Stop"; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:ANTIGRAVITY_PATCH_EXECUTABLE } | ForEach-Object { $_.ProcessId }';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, ANTIGRAVITY_PATCH_EXECUTABLE: paths.executable }
  });
  if (result.error || result.status !== 0) throw new Error('无法检查客户端进程。请手动退出 Antigravity 后使用 --no-kill。');
  for (const identifier of result.stdout.trim().split(/\s+/).filter(Boolean)) {
    if (!/^\d+$/.test(identifier)) throw new Error('进程检查返回了非预期结果，已停止。');
    const stopped = spawnSync('taskkill.exe', ['/PID', identifier, '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    if (stopped.error) throw stopped.error;
  }
}
function startAntigravity(paths) {
  if (!fs.existsSync(paths.executable)) { console.warn('未找到 Antigravity.exe，请手动启动客户端。'); return; }
  const child = spawn(paths.executable, [], { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => console.warn('无法自动启动客户端，请手动启动。'));
  child.unref();
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
function cleanupRun(directory, temporaryRoot) {
  // Never clean a sibling run or follow a substituted run-directory symlink.
  if (!directory || !fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || path.dirname(fs.realpathSync(directory)) !== temporaryRoot) throw new Error('临时目录路径校验失败，请手动检查残留文件。');
  fs.rmSync(directory, { recursive: true, force: true });
}

async function patch(options = {}) {
  requireWindows();
  const asar = loadAsar(), paths = getPaths(options.installDir);
  const version = validateArchive(asar, paths.app);
  const dictionaryPath = path.join(__dirname, 'dictionary.json');
  const dictionary = JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'));
  if (!dictionary || Array.isArray(dictionary) || typeof dictionary !== 'object' || Object.entries(dictionary).some(([key, value]) => !key || typeof value !== 'string')) throw new Error('汉化词典格式不正确。');
  const baseline = prepareBaseline(asar, paths, version);
  if (!options.noKill) killAntigravity(paths);
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
    if (fs.existsSync(paths.app + '.unpacked')) fs.cpSync(paths.app + '.unpacked', workingBaseline + '.unpacked', { recursive: true });
    asar.extractAll(workingBaseline, extractedDir);
    transformFiles(extractedDir, dictionary);
    const unpacked = [...archiveFiles(asar, workingBaseline)].filter(([, entry]) => entry.unpacked).map(([name]) => '**/' + name);
    const unpack = unpacked.length > 1 ? '{' + unpacked.join(',') + '}' : unpacked[0];
    await asar.createPackageWithOptions(extractedDir, rebuilt, unpack ? { unpack } : {});
    verifyRebuiltArchive(asar, workingBaseline, rebuilt);
    // Recheck the baseline immediately before replacement.
    validateBackup(asar, paths, version, false);
    validateArchive(asar, paths.app);
    atomicCopy(rebuilt, paths.app);
  } finally { cleanupRun(temporary, temporaryRoot); }
  console.log(`汉化补丁已应用：Antigravity ${version}，${Object.keys(dictionary).length} 条词条。`);
  if (!options.noKill) startAntigravity(paths);
  return { version, sha256: sha256(paths.app), backupSha256: sha256(paths.backup) };
}

async function revert(options = {}) {
  requireWindows();
  const asar = loadAsar(), paths = getPaths(options.installDir);
  const version = validateArchive(asar, paths.app);
  const backup = validateBackup(asar, paths, version, true);
  if (!options.noKill) killAntigravity(paths);
  atomicCopy(backup, paths.app);
  console.log('已还原为同版本的英文原版，账号、会话和项目配置未修改。');
  if (!options.noKill) startAntigravity(paths);
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
  const _labelMap = {
    'Bring All to Front': '前置全部窗口',
    'New Window': '新建窗口', 'Docs': '文档', 'Check for Updates': '检查更新',
    'Checking for Updates...': '正在检查更新...', 'Downloading Update...': '正在下载更新...', 'Restart to Update': '重启以完成更新',
    'Connect to WSL': '连接到 WSL', 'Reopen Locally': '重新在本地打开', 'Actual Size': '实际大小'
  };
  function _translateMenuItem(item) {
    if (!item) return;
    if (item.role) {
      const key = String(item.role).toLowerCase();
      if (_roleLabelMap[key]) item.label = _roleLabelMap[key];
    }
    if (item.label && _labelMap[item.label]) item.label = _labelMap[item.label];
    // Electron 原生菜单中 Zoom 相关无固定 role 时 label 为 Reset Zoom 等
    if (item.label === 'Reset Zoom') item.label = '重置缩放';
    if (item.label === 'Zoom In') item.label = '放大';
    if (item.label === 'Zoom Out') item.label = '缩小';
    if (item.submenu && item.submenu.items) {
      for (const sub of item.submenu.items) _translateMenuItem(sub);
    } else if (Array.isArray(item.submenu)) {
      for (const sub of item.submenu) _translateMenuItem(sub);
    }
  }
  function _translateMenu(menu) {
    if (!menu || !menu.items) return;
    for (const item of menu.items) _translateMenuItem(item);
  }
  const _origBuildFromTemplate = _electron.Menu.buildFromTemplate;
  _electron.Menu.buildFromTemplate = function(template) {
    // 先翻译 template 中的 role/label
    function translateTemplate(items) {
      if (!Array.isArray(items)) return;
      for (const it of items) {
        if (it.role) {
          const k = String(it.role).toLowerCase();
          if (_roleLabelMap[k] && !it.label) it.label = _roleLabelMap[k];
          if (it.role === 'resetZoom' || it.role === 'resetzoom') it.label = '重置缩放';
          if (it.role === 'zoomIn' || it.role === 'zoomin') it.label = '放大';
          if (it.role === 'zoomOut' || it.role === 'zoomout') it.label = '缩小';
        }
        if (it.label && _labelMap[it.label]) it.label = _labelMap[it.label];
        if (it.label === 'Reset Zoom') it.label = '重置缩放';
        if (it.label === 'Zoom In') it.label = '放大';
        if (it.label === 'Zoom Out') it.label = '缩小';
        if (it.submenu) translateTemplate(Array.isArray(it.submenu) ? it.submenu : (it.submenu.items || []));
      }
    }
    translateTemplate(template);
    const menu = _origBuildFromTemplate.call(this, template);
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
    return typeof el.matches === 'function' && el.matches(EXCLUDE_SELECTOR);
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
    if (['featured-carousel-headline', 'featured-carousel-member-tile', 'plugin-view-title-bar-title', 'custom-view-pane-title'].includes(testId)) return true;
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

  function translateComposedDescription(element) {
    if (isInExcludedZone(element)) return;
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

  function formatUiDate(value) {
    const months = {January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12};
    return value.replace(/\\b(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2}),\\s+(\\d{4})\\b/g, (original, month, day, year) => Number(day) >= 1 && Number(day) <= 31 ? year + ' 年 ' + months[month] + ' 月 ' + Number(day) + ' 日' : original);
  }

  function translateText(text) {
    if (!text) return null;
    const normalizedText = text.replace(/\\s+/g, ' ').trim();
    if (!normalizedText) return null;
    
    const effortNames = {low:'低',medium:'中',high:'高',xhigh:'极高',extra:'极高',max:'最高',thinking:'思考'};
    const modelEffortSuffix = normalizedText.match(/^((?:Gemini|Claude|GPT|Sonnet|Opus)[^()]*?)\\s*\\((low|medium|high|xhigh|max|extra|thinking)(?:\\s+thinking)?\\)$/i);
    if (modelEffortSuffix) return modelEffortSuffix[1].trim() + '（' + effortNames[modelEffortSuffix[2].toLowerCase()] + '）';
    const modelEffortTail = normalizedText.match(/^((?:Gemini|Claude|GPT|Sonnet|Opus).+?)\\s+(low|medium|high|xhigh|max|extra)$/i);
    if (modelEffortTail) return modelEffortTail[1] + ' ' + effortNames[modelEffortTail[2].toLowerCase()];
    const paidPlanNotice = normalizedText.match(/^(.+?) is now available on paid Pro and Ultra plans\\. Third-party model access will no longer be available on your current plan starting on (.+)\\.$/);
    if (paidPlanNotice) return paidPlanNotice[1] + ' 现已向付费 Pro 和 Ultra 方案用户开放。从 ' + formatUiDate(paidPlanNotice[2]) + '起，你当前的方案将不再提供第三方模型访问权限。';
    const removalNotice = normalizedText.match(/^(.+?) will be removed from Antigravity on (.+)\\.$/);
    if (removalNotice) return removalNotice[1] + ' 将于 ' + formatUiDate(removalNotice[2]) + '从 Antigravity 中移除。';
    const planAvailability = normalizedText.match(/^(.+?) is currently available to (Ultra plan|Ultra and paid Pro plan|paid Pro and Ultra) subscribers\\.$/);
    if (planAvailability) {
      const plans = {'Ultra plan':'Ultra 方案订阅用户','Ultra and paid Pro plan':'Ultra 和付费 Pro 方案订阅用户','paid Pro and Ultra':'付费 Pro 和 Ultra 订阅用户'};
      return planAvailability[1] + ' 目前向' + (planAvailability[2] === 'paid Pro and Ultra' ? '' : ' ') + plans[planAvailability[2]] + '开放。';
    }
    const quotaResetNotice = normalizedText.match(/^Your quota for (.+?) will reset on (.+)\\. Switch to another available model to continue\\.$/);
    if (quotaResetNotice) return quotaResetNotice[1] + ' 的配额将于 ' + formatUiDate(quotaResetNotice[2]) + '重置。请切换到其他可用模型以继续。';
    const quotaReachedNotice = normalizedText.match(/^Your quota for (.+?) has been reached\\. Switch to another available model to continue\\.$/);
    if (quotaReachedNotice) return quotaReachedNotice[1] + ' 的配额已用尽。请切换到其他可用模型以继续。';
    const baselineResetNotice = normalizedText.match(/^Your plan's baseline quota will refresh on (.+)\\.$/);
    if (baselineResetNotice) return '你的方案基础配额将于 ' + formatUiDate(baselineResetNotice[1]) + '刷新。';
    // 1. Exact match in normalized dictionary
    if (normalizedDict[normalizedText]) {
      return normalizedDict[normalizedText];
    }
    
    // 2. Handle trailing ellipsis (...) or truncated text for long descriptions
    let cleanText = normalizedText;
    if (normalizedText.endsWith('...')) {
      cleanText = normalizedText.slice(0, -3).trim();
    } else if (normalizedText.endsWith('…')) {
      cleanText = normalizedText.slice(0, -1).trim();
    }
    
    if (cleanText.length > 20) {
      for (const key in normalizedDict) {
        if (key.startsWith(cleanText)) {
          return normalizedDict[key];
        }
      }
    }

    // 3. Dynamic Regex translation for Token Usage percentage
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

    // 23. Dynamic Regex translation for relative time (e.g. "5m ago", "2h ago")
    const agoMatch = normalizedText.match(/^(\\d+)\\s*(s|m|h|d|mo|y)\\s+ago$/i);
    if (agoMatch) {
      const unitMap = { s: '秒', m: '分钟', h: '小时', d: '天', mo: '个月', y: '年' };
      return \`\${agoMatch[1]} \${unitMap[agoMatch[2].toLowerCase()] || agoMatch[2]}前\`;
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
    return null;
  }

  function translateNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (isInExcludedZone(node)) return;
      const translated = translateText(node.textContent);
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
        const translated = translateText(title);
        if (translated !== null && translated !== title) {
          node.setAttribute('title', translated);
        }
      }
      // ARIA labels (commonly used by icon-only buttons)
      if (node.hasAttribute('aria-label')) {
        const ariaLabel = node.getAttribute('aria-label');
        const translated = translateText(ariaLabel);
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
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeDOM);
  } else {
    observeDOM();
  }

  // Translate document title
  const originalTitle = document.title;
  const translatedTitle = translateText(originalTitle);
  if (translatedTitle !== null) {
    document.title = translatedTitle;
  }
  
  // Observe title changes
  const titleObserver = new MutationObserver(() => {
    const title = document.title;
    const translated = translateText(title);
    if (translated !== null && title !== translated) {
      document.title = translated;
    }
  });
  
  const titleEl = document.querySelector('title');
  if (titleEl) {
    titleObserver.observe(titleEl, { childList: true, characterData: true });
  }
})();
// ==================== END OF ANTIGRAVITY CHINESE LOCALIZATION PATCH ====================
`;
}



module.exports = { patch, revert, buildInjectScript, SUPPORTED_VERSION };
if (require.main === module) {
  const args = process.argv.slice(2);
  const invalid = args.filter(argument => !['--revert', '--no-kill', '--help', '-h'].includes(argument));
  if (invalid.length) { console.error('未知参数：' + invalid.join(' ')); process.exitCode = 1; }
  else if (args.includes('--help') || args.includes('-h')) console.log('node patch.js [--revert] [--no-kill]\n仅支持 Windows Antigravity 2.32.1。请先保存工作。');
  else (args.includes('--revert') ? revert : patch)({ noKill: args.includes('--no-kill') }).catch(error => { console.error('操作失败：' + error.message); process.exitCode = 1; });
}
