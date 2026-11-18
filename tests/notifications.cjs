'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const Module = require('node:module');

// Exercise the real source transformer without executing the installer or
// needing an installed client. This fixture is the supported 2.32.1 handler.
const patchFile = process.env.ANTIGRAVITY_PATCH_TEST_SOURCE || path.resolve(__dirname, '..', 'patch.js');
const patchModule = new Module(patchFile, module);
patchModule.filename = patchFile;
patchModule.paths = Module._nodeModulePaths(path.dirname(patchFile));
patchModule._compile(fs.readFileSync(patchFile, 'utf8') + '\nmodule.exports.transformForNotificationTest = transformFiles;\n', patchFile);
const transformFiles = patchModule.exports.transformForNotificationTest;
const fixture = [
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
  "        notification.on('click', () => {",
  '            const win = remote',
  '                ? windowForSender(event?.sender)',
  '                : (0, utils_1.getLocalHubWindows)()[0];',
  '            if (win) {',
  '                if (win.isMinimized()) {',
  '                    win.restore();',
  '                }',
  '                win.show();',
  '                win.focus();',
  '                if (options?.payload) {',
  "                    win.webContents.send('notification:clicked', options.payload);",
  '                }',
  '            }',
  '        });',
  '        notification.show();',
  '    });',
].join('\n');

const temporaryRoot = fs.realpathSync(os.tmpdir());
const root = fs.mkdtempSync(path.join(temporaryRoot, 'antigravity-notification-test-'));
function transform(source) {
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const filename = path.join(dist, 'ipcHandlers.js');
  fs.writeFileSync(filename, source);
  transformFiles(root, {});
  return fs.readFileSync(filename, 'utf8');
}
function receiver(source, remote = false, label = 'my-host') {
  let handler;
  const notifications = [];
  const clicks = [];
  const win = {
    isMinimized: () => true,
    restore: () => clicks.push('restore'),
    show: () => clicks.push('show'),
    focus: () => clicks.push('focus'),
    webContents: { send: (channel, payload) => clicks.push({ channel, payload }) },
  };
  const remoteSender = {};
  const state = { localLookups: 0, remoteLookups: 0 };
  vm.runInNewContext(source, {
    electron_1: {
      ipcMain: { handle(channel, callback) { assert.equal(channel, 'notification:send'); handler = callback; } },
      Notification: class {
        constructor(options) {
          assert.equal(typeof options.title, 'string');
          assert.equal(typeof options.body, 'string');
          this.options = options;
          this.callbacks = {};
          this.shows = 0;
          notifications.push(this);
        }
        on(event, callback) { this.callbacks[event] = callback; }
        show() { this.shows++; }
      },
    },
    remoteWindowSecurity_1: { isRemoteContents: sender => sender === remoteSender && remote },
    windowBackends_1: { remoteBackendOf: () => ({ label }) },
    utils_1: { getLocalHubWindows() { state.localLookups++; return [win]; } },
    windowForSender(sender) { assert.equal(sender, remoteSender); state.remoteLookups++; return win; },
    truncate: (value, limit) => typeof value === 'string' ? value.slice(0, limit) : value,
    MAX_NOTIFICATION_TITLE: 80,
    MAX_NOTIFICATION_BODY: 200,
  });
  return {
    post(title, body, extra = {}) {
      const options = Object.freeze({ title, body, payload: Object.freeze({ type: 'request_action', cascadeId: 'fixture-id' }), ...extra });
      handler({ sender: remoteSender }, options);
      assert.equal(options.title, title, 'IPC input title must stay unchanged');
      assert.equal(options.body, body, 'IPC input body must stay unchanged');
      const notification = notifications.at(-1);
      assert.equal(notification.shows, 1);
      return notification;
    },
    state, clicks,
  };
}

try {
  const source = transform(fixture);
  new vm.Script(source);
  const local = receiver(source);
  const summary = 'Deploy **Swarm**; constructor\nAgent finished: nested $1';
  assert.equal(local.post('Antigravity', 'Agent finished: ' + summary).options.body, '智能体已完成任务，点击查看结果。');
  assert.equal(local.post('Antigravity', 'Agent finished: 中文摘要').options.body, '智能体已完成任务，点击查看结果。');
  assert.equal(local.post('Antigravity', 'Agent finished').options.body, '智能体已完成');
  assert.equal(local.post('Jetski', 'Agent finished').options.body, '智能体已完成');
  assert.equal(local.post('Custom application', 'Agent finished: literal').options.body, 'Agent finished: literal');
  assert.equal(local.post('Antigravity', 'Agent finished', { payload: { type: 'custom' } }).options.body, 'Agent finished');
  assert.equal(local.post('Antigravity', 'Agent finished', { payload: undefined }).options.body, 'Agent finished');

  for (const body of ['Agent finished: literal question', 'constructor', 'toString', '__proto__', 'Click to respond to the question.']) {
    const one = local.post('The agent has a question for you:', body).options;
    assert.equal(one.title, '智能体有一个问题需要您回答：');
    assert.equal(one.body, body, 'Dynamic question must stay byte-identical');
    assert.equal(local.post('The agent has questions for you:', body).options.title, '智能体有一些问题需要您回答：');
    assert.equal(local.post('Requesting your permission:', body).options.body, body, 'Permission target must stay byte-identical');
  }
  for (const word of ['constructor', 'toString', '__proto__']) {
    const n = local.post(word, word).options;
    assert.equal(n.title, word);
    assert.equal(n.body, word);
    assert.equal(local.post('Antigravity', word).options.body, word);
  }
  const command = 'echo "Agent finished: Open terminal" && git show HEAD:$1';
  const terminal = local.post('Requesting your permission in Terminal:', 'Command: ' + command).options;
  assert.equal(terminal.title, '请求您授权终端操作：');
  assert.equal(terminal.body, '命令：' + command);
  const url = 'https://example.test/Agent%20finished:?q=constructor&x=$1';
  const link = local.post('Requesting your permission to open URL:', 'URL: ' + url).options;
  assert.equal(link.title, '请求您授权打开网址：');
  assert.equal(link.body, 'URL：' + url);
  assert.equal(local.post('Action requires your attention', 'The agent is waiting for your input.').options.body, '智能体正在等待您的输入。');
  assert.equal(local.post('Action requires your attention', 'unrecognized body').options.body, 'unrecognized body');
  assert.equal(local.post('Requesting your permission:', 'resource/path').options.title, '请求您的授权：');
  const localClick = local.post('Antigravity', 'Agent finished', { silent: true });
  assert.equal(localClick.options.silent, true);
  localClick.callbacks.click();
  assert.equal(local.state.localLookups, 1);
  assert.equal(local.state.remoteLookups, 0);
  assert.deepEqual(local.clicks.slice(0, 3), ['restore', 'show', 'focus']);
  assert.equal(local.clicks[3].channel, 'notification:clicked');
  assert.equal(local.clicks[3].payload.cascadeId, 'fixture-id');

  const host = 'host-label-' + 'x'.repeat(85);
  const remote = receiver(source, true, host);
  const remoteNotification = remote.post('Antigravity', 'Agent finished: ' + 's'.repeat(300));
  assert.equal(remoteNotification.options.title, (host + ': Antigravity').slice(0, 80));
  assert.equal(remoteNotification.options.body, '智能体已完成任务，点击查看结果。');
  remoteNotification.callbacks.click();
  assert.equal(remote.state.localLookups, 0);
  assert.equal(remote.state.remoteLookups, 1);
  assert.equal(remote.clicks[3].payload.type, 'request_action');

  assert.throws(() => transform(fixture.replace('MAX_NOTIFICATION_BODY)', 'MAX_NOTIFICATION_BODY + 1)')), /系统通知处理器.*不匹配/);
  assert.throws(() => transform(fixture + '\n' + fixture), /系统通知处理器.*不匹配/);
  assert.equal(transform("'use strict';\nconst syntheticFixture = true;\n"), "'use strict';\nconst syntheticFixture = true;\n");
  console.log('Native notification regression checks passed: real handler transform, scoped fixed copy, dynamic content, prototype keys, remote attribution/truncation, clicks and strict anchors.');
} finally {
  if (path.dirname(fs.realpathSync(root)) !== temporaryRoot || fs.lstatSync(root).isSymbolicLink()) throw new Error('Test cleanup containment check failed');
  fs.rmSync(root, { recursive: true, force: true });
}
