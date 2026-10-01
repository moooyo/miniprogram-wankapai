import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appendFile, cp, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import automator from 'miniprogram-automator';
import { createDesignPageWaiter, runDesignScenarios } from './design-scenarios.mjs';
import { readRenderedViewport } from './ui-helpers.mjs';

const runFile = promisify(execFile);
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harnessFiles = ['scripts/design-acceptance.mjs', 'scripts/design-scenarios.mjs', 'scripts/ui-helpers.mjs',
  'scripts/wechat-cli.ps1', 'scripts/wechat-cli-adapter.cjs'];
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(root, '.qa-native', 'design-acceptance', runId);
const projectPath = path.join(output, 'project');
const screenshotsPath = path.join(output, 'screenshots');
const requestedCases = process.env.WECHAT_DESIGN_CASES ? JSON.parse(process.env.WECHAT_DESIGN_CASES) : null;
assert.ok(requestedCases === null || (Array.isArray(requestedCases) && requestedCases.length > 0
  && requestedCases.every(value => typeof value === 'string' && value.length > 0)), 'WECHAT_DESIGN_CASES must be a nonempty JSON string array.');
const selectedCases = requestedCases ? new Set(requestedCases) : null;
const keepOpen = process.env.WECHAT_DESIGN_KEEP_OPEN !== '0';
const storageKey = 'card-benefits.native.demo.v1';
const draftStoragePrefix = 'card-benefits.form-draft.v1:';
const cliPath = process.env.WECHAT_DEVTOOLS_CLI || (process.platform === 'win32'
  ? path.join(root, 'scripts/wechat-cli.ps1')
  : '/Applications/wechatwebdevtools.app/Contents/MacOS/cli');
const report = {
  startedAt: new Date().toISOString(),
  approach: 'WeChat CLI and miniprogram-automator; no computer-use automation',
  mode: 'demo',
  designReference: { directory: 'D:/Code/design_handoff_activity_features', canvas: { width: 402, height: 874 } },
  keepOpen,
  cliPath,
  scope: selectedCases ? 'Focused follow-up with unchanged application identity' : 'Complete native acceptance',
  requestedCases, skippedCases: [],
  cases: [], screenshots: [], exceptions: [], warnings: [], navigation: [], protocolDiagnostics: [], screenshotRetries: [],
  limitations: [
    'Simulator acceptance does not verify physical devices or deployed cloud services.',
    'No real account authorization, photo picker, subscription delivery, or production publishing is tested. Activity publication uses the isolated demo service only.',
    'OCR starts from an owned pending lead and bundled demo image; the operating-system image picker and image upload are not exercised.',
    'Picker change events exercise application handlers, not the operating-system picker gesture.',
    'Only operation-scoped platform picker and modal callbacks may be simulated; the report records each use. Application rendering and domain responses are never mocked.',
    'The report records the actual rendered simulator viewport; other viewports are not implied.',
  ],
};
let miniProgram;
let storageSnapshot;
let storageBackedUp = false;
let currentCase;
let waitForPage;
let protocolFailure;

async function fingerprint(directory) {
  const items = [];
  async function visit(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) items.push({ file: path.relative(directory, full).split(path.sep).join('/'),
        sha256: createHash('sha256').update(await readFile(full)).digest('hex') });
    }
  }
  await visit(directory);
  return { sha256: createHash('sha256').update(JSON.stringify(items)).digest('hex'), files: items };
}

async function fingerprintHarness() {
  const files = await Promise.all(harnessFiles.map(async file => ({ file,
    sha256: createHash('sha256').update(await readFile(path.join(root, file))).digest('hex') })));
  return { sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}

async function fingerprintSource() {
  const directories = ['miniprogram', 'domain', 'shared'];
  return Object.fromEntries(await Promise.all(directories.map(async directory => [directory, await fingerprint(path.join(root, directory))])));
}

function boundProtocol(program) {
  const send = program.connection.send.bind(program.connection);
  program.connection.send = async (method, params) => {
    if (protocolFailure) throw protocolFailure;
    let timer;
    try {
      return await Promise.race([send(method, params), new Promise((_, reject) => {
        timer = setTimeout(() => {
          protocolFailure = new Error(`WeChat automation protocol timed out after 30 seconds: ${method}`);
          reject(protocolFailure);
        }, 30000);
      })]);
    } catch (error) {
      const details = { method, case: currentCase?.name || 'initialization', at: new Date().toISOString() };
      for (const key of ['pageId', 'elementId', 'selector', 'path', 'names']) {
        if (params?.[key] !== undefined) details[key] = params[key];
      }
      error.details = { ...error.details, automationMethod: method, ...details };
      report.protocolDiagnostics.push({ ...details, error: error.message });
      await appendFile(path.join(output, 'protocol-errors.jsonl'), JSON.stringify({ ...details, error: error.message }) + '\n');
      throw error;
    } finally { clearTimeout(timer); }
  };
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitUntil(predicate, message, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch (error) { lastError = error; }
    await sleep(150);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}
function expect(condition, message, details) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}
async function measure(element) {
  assert.ok(element, 'The measured element must exist.');
  const identified = async (name, action) => {
    try { return await action(); }
    catch (error) { error.details = { ...error.details, automationStep: name }; throw error; }
  };
  const [position, size] = await Promise.all([
    identified('Element.offset', () => element.offset()),
    identified('Element.size', () => element.size()),
  ]);
  const x = Number(position.left), y = Number(position.top);
  const width = Number(size.width), height = Number(size.height);
  return { x, y, width, height, right: x + width, bottom: y + height };
}
async function readViewport() {
  try { return await readRenderedViewport(miniProgram); }
  catch (error) { error.details = { ...error.details, automationStep: 'RenderedViewport' }; throw error; }
}
async function capture(name) {
  const safeName = name.replace(/[^a-zA-Z0-9_-]+/g, '-');
  const filename = `${String(report.screenshots.length + 1).padStart(2, '0')}-${safeName}.png`;
  // Wait for the native navigation transition to paint before collecting evidence.
  await sleep(500);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await miniProgram.screenshot({ path: path.join(screenshotsPath, filename) });
      break;
    } catch (error) {
      error.details = { ...error.details, automationStep: 'App.captureScreenshot', screenshotName: name, attempt };
      if (!/timeout waiting for automator response/i.test(error.message) || attempt === 3) throw error;
      report.screenshotRetries.push({ name, attempt, error: error.message, at: new Date().toISOString() });
      console.log(`RETRY screenshot ${name}: attempt ${attempt}`);
      // Capturing evidence is read-only. Never replay taps, inputs or commands.
      await sleep(750);
    }
  }
  const screenshot = { name, file: `screenshots/${filename}` };
  report.screenshots.push(screenshot);
  currentCase?.screenshots.push(screenshot.file);
}
async function check(name, action) {
  if (selectedCases && !selectedCases.has(name) && name !== 'Native acceptance candidate remains unchanged') {
    report.skippedCases.push(name);
    return;
  }
  if (protocolFailure) throw protocolFailure;
  const result = { name, status: 'running', screenshots: [], measurements: {} };
  currentCase = result;
  const start = Date.now();
  try {
    await action();
    result.status = 'passed';
    console.log(`PASS ${name}`);
  } catch (error) {
    result.status = 'failed';
    result.error = error.message;
    result.stack = error.stack;
    if (error.cause) result.cause = { message: error.cause.message, stack: error.cause.stack };
    result.details = error.details;
    console.error(`FAIL ${name}: ${error.message}`);
    if (error.details) console.error(JSON.stringify(error.details.samples ? {
      expected: error.details.expected, sampleCount: error.details.samples.length,
      lastSample: error.details.samples.at(-1),
    } : error.details));
    try { await capture(`failure-${name}`); } catch (captureError) { result.captureError = captureError.message; result.captureStack = captureError.stack; }
  } finally {
    result.durationMs = Date.now() - start;
    report.cases.push(result);
    await appendFile(path.join(output, 'cases.jsonl'), JSON.stringify(result) + '\n');
    currentCase = undefined;
  }
  if (protocolFailure) throw protocolFailure;
}
function record(name, value) {
  if (currentCase) currentCase.measurements[name] = value;
}
async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function launchProject() {
  const port = await unusedPort();
  report.automation = { port, wsEndpoint: `ws://127.0.0.1:${port}`, projectPath, startedAt: new Date().toISOString(), status: 'launching' };
  // This directory is ignored by Git and contains the local diagnostic endpoint.
  await writeFile(path.join(output, 'automation.json'), JSON.stringify(report.automation, null, 2) + '\n');
  const options = { windowsHide: true, timeout: 90000, maxBuffer: 2 * 1024 * 1024 };
  // PowerShell passes paths as data and can execute the official .bat on modern Node versions.
  const result = process.platform === 'win32'
    ? await runFile(path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-Command',
      '& $env:UI_CLI_PATH auto --project $env:UI_PROJECT_PATH --auto-port ([int]$env:UI_AUTOMATION_PORT) --trust-project --lang en',
    ], { ...options, env: { ...process.env, UI_CLI_PATH: cliPath, UI_PROJECT_PATH: projectPath, UI_AUTOMATION_PORT: String(port) } })
    : await runFile(cliPath, ['auto', '--project', projectPath, '--auto-port', String(port), '--trust-project'], options);
  await writeFile(path.join(output, 'cli.log'), result.stdout + result.stderr);
  expect(!/service port disabled|service port.*closed|初始化错误|\[error\]/i.test(result.stdout + result.stderr),
    'WeChat CLI refused the connection. Enable its service port and check cli.log.');
  await waitUntil(async () => {
    try { miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` }); return true; }
    catch { return false; }
  }, 'The simulator automation endpoint did not become ready.', 30000);
  boundProtocol(miniProgram);
  report.automation.status = 'connected';
  await writeFile(path.join(output, 'automation.json'), JSON.stringify(report.automation, null, 2) + '\n');
}
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
async function saveReport() {
  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.cases.filter(result => result.status === 'passed').length,
    failed: report.cases.filter(result => result.status === 'failed').length,
    runtimeExceptions: report.exceptions.length,
  };
  report.designMetrics = report.cases.flatMap(result => Object.values(result.measurements)
    .filter(value => value && typeof value === 'object' && typeof value.valid === 'boolean' && value.property));
  report.designSummary = { matched: report.designMetrics.filter(metric => metric.valid).length,
    differed: report.designMetrics.filter(metric => !metric.valid).length };
  report.coverage = { routes: [...new Set(report.navigation.filter(item => item.status === 'ready').map(item => item.expected))].sort() };
  report.status = report.fatal || report.cleanupError || !report.cases.length || report.summary.failed || report.summary.runtimeExceptions ? 'failed' : 'passed';
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const caseRows = report.cases.map(result => `<tr><td>${escapeHtml(result.name)}</td><td class="${result.status}">${result.status}</td><td>${escapeHtml(result.error || '')}</td></tr>`).join('');
  const metricRows = report.designMetrics.map(metric => `<tr><td>${escapeHtml(metric.route)}<br>${escapeHtml(metric.selector)}</td><td>${escapeHtml(metric.property)}</td><td>${escapeHtml(metric.expected)}</td><td>${escapeHtml(metric.actual)}</td><td class="${metric.valid ? 'passed' : 'failed'}">${metric.valid ? 'matched' : 'differed'}</td></tr>`).join('');
  const screenshots = report.screenshots.map(shot => `<figure><a href="${shot.file}"><img src="${shot.file}" alt="${escapeHtml(shot.name)}" loading="lazy"></a><figcaption>${escapeHtml(shot.name)}</figcaption></figure>`).join('');
  await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mini Program Design Acceptance</title><style>body{font:16px/1.6 system-ui,sans-serif;margin:32px;color:#172230;background:#f4f7fb}main{max-width:1200px;margin:auto}h1{margin-bottom:0}table{border-collapse:collapse;width:100%;background:white}td,th{padding:12px;text-align:left;border-bottom:1px solid #dbe3ef}.passed{color:#167147}.failed{color:#aa3030}.gallery{display:flex;flex-wrap:wrap;gap:24px}figure{margin:0;width:min(100%,320px)}img{max-width:100%;border:1px solid #dbe3ef}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:16px}</style><main><h1>Mini Program Design Acceptance</h1><p>${escapeHtml(report.startedAt)} · ${escapeHtml(report.status)} · Official developer tools and SDK</p><p>${report.summary.passed} passed · ${report.summary.failed} failed · ${report.summary.runtimeExceptions} runtime exceptions</p><pre>${escapeHtml(JSON.stringify(report.environment || {}, null, 2))}</pre>${report.fatal ? `<pre class="failed">${escapeHtml(report.fatal)}</pre>` : ''}<table><thead><tr><th>Case</th><th>Result</th><th>Details</th></tr></thead><tbody>${caseRows}</tbody></table><h2>Rendered design metrics</h2><p>${report.designSummary.matched} matched · ${report.designSummary.differed} differed. Reference canvas: 402 × 874 logical pixels.</p><table><thead><tr><th>Native element</th><th>Property</th><th>Reference</th><th>Actual</th><th>Result</th></tr></thead><tbody>${metricRows}</tbody></table><h2>Evidence</h2><div class="gallery">${screenshots}</div><h2>Scope limits</h2><ul>${report.limitations.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p>Demo storage restored: ${escapeHtml(report.storageRestored)}. See report.json for geometry and runtime diagnostics.</p></main></html>`);
  await writeFile(path.join(root, '.qa-native', 'design-acceptance', 'latest.json'), JSON.stringify({ output, report: path.join(output, 'report.json'), html: path.join(output, 'index.html') }, null, 2) + '\n');
  console.log(`REPORT ${path.join(output, 'index.html')}`);
  console.log(`RESULT ${JSON.stringify(report.summary)}`);
}

await mkdir(screenshotsPath, { recursive: true });
try {
  report.harness = await fingerprintHarness();
  await writeFile(path.join(output, 'acceptance-harness-manifest.json'), JSON.stringify(report.harness, null, 2) + '\n');
  report.designReference.manifest = await fingerprint(report.designReference.directory);
  await writeFile(path.join(output, 'design-reference-manifest.json'), JSON.stringify(report.designReference.manifest, null, 2) + '\n');
  const settings = require(path.join(root, 'dist/miniprogram/runtime-config.js'));
  assert.equal(settings.mode, 'demo', 'UI acceptance must only run against demo mode.');
  assert.equal(settings.cloudEnvId, '', 'UI acceptance must not have a cloud environment.');
  const shared = JSON.parse(await readFile(path.join(root, 'project.config.json'), 'utf8'));
  const local = JSON.parse(await readFile(path.join(root, 'project.private.config.json'), 'utf8'));
  const appid = process.env.WECHAT_TEST_APPID || local.appid;
  assert.match(appid || '', /^wx[0-9a-f]{16}$/, 'A local test AppID is required.');
  await cp(path.join(root, 'dist/miniprogram'), path.join(projectPath, 'miniprogram'), { recursive: true });
  report.build = await fingerprint(path.join(projectPath, 'miniprogram'));
  report.source = await fingerprintSource();
  await writeFile(path.join(output, 'source-manifest.json'), JSON.stringify(report.source, null, 2) + '\n');
  await writeFile(path.join(output, 'build-manifest.json'), JSON.stringify(report.build, null, 2) + '\n');
  await writeFile(path.join(projectPath, 'project.config.json'), JSON.stringify({
    ...shared, appid, projectname: `bank-benefits-design-${runId}`, miniprogramRoot: 'miniprogram/',
    cloudfunctionRoot: undefined,
  }, null, 2) + '\n');
  await writeFile(path.join(projectPath, 'project.private.config.json'), JSON.stringify({
    appid, libVersion: local.libVersion, setting: { ...local.setting, compileHotReLoad: false },
  }, null, 2) + '\n');
  await launchProject();
  waitForPage = createDesignPageWaiter(miniProgram, {
    measure,
    onDiagnostic: async diagnostic => {
      const item = { case: currentCase?.name || 'initialization', at: new Date().toISOString(), ...diagnostic };
      report.navigation.push(item);
      await appendFile(path.join(output, 'navigation.jsonl'), JSON.stringify(item) + '\n');
    },
  });
  miniProgram.on('exception', error => report.exceptions.push({ message: error.message, stack: error.stack }));
  // SDK .on('console') dispatches an unawaited request; await it explicitly so
  // initialization failures are retained in the report instead of crashing Node.
  EventEmitter.prototype.on.call(miniProgram, 'console', message => {
    if (['error', 'warn', 'warning'].includes(message.type)) report.warnings.push({ type: message.type, args: message.args });
  });
  await waitUntil(async () => !!(await miniProgram.currentPage())?.path,
    'The native app did not finish its initial compilation and launch.', 60000);
  try {
    await miniProgram.connection.send('App.enableLog');
    report.consoleCapture = { enabled: true };
  } catch (error) {
    report.consoleCapture = { enabled: false, error: error.message };
    report.limitations.push('The developer tools console-log protocol was unavailable. The SDK exception channel and page error states remain recorded.');
  }
  const info = await miniProgram.evaluate(() => ({ ...wx.getWindowInfo(), ...wx.getDeviceInfo(), ...wx.getAppBaseInfo() }));
  await miniProgram.switchTab('/pages/todo/index');
  await waitForPage('/pages/todo/index');
  // The SDK classifies methods without a Sync suffix as asynchronous.
  const viewport = await readViewport();
  report.environment = { platform: info.platform, SDKVersion: info.SDKVersion, model: info.model,
    windowWidth: viewport.windowWidth, windowHeight: viewport.windowHeight, pixelRatio: info.pixelRatio,
    statusBarHeight: info.statusBarHeight, screenWidth: info.screenWidth, screenHeight: info.screenHeight,
    viewportSource: 'Rendered selectViewport().boundingClientRect() in the actual simulator' };
  report.designReference.actualViewport = { width: viewport.windowWidth, height: viewport.windowHeight };
  report.designReference.exactCanvasMatch = viewport.windowWidth === 402 && viewport.windowHeight === 874;
  if (viewport.windowWidth !== 402) report.limitations.push(`The rendered width is ${viewport.windowWidth}px, while the design reference uses 402px. Exact-canvas pixel equivalence is not asserted.`);
  await writeFile(path.join(output, 'environment.json'), JSON.stringify(report.environment, null, 2) + '\n');
  assert.equal(info.platform, 'devtools', 'This runner is limited to the local simulator.');
  storageSnapshot = await miniProgram.evaluate((demoKey, draftPrefix) => {
    const keys = wx.getStorageInfoSync().keys.filter(key => key === demoKey || key.startsWith(draftPrefix) || key.startsWith('lounges.recent.')
      || ['activities.mineOnly', 'rewards.initialTab', 'rewards.initialCurrency'].includes(key));
    return Object.fromEntries(keys.map(key => [key, wx.getStorageSync(key)]));
  }, storageKey, draftStoragePrefix);
  storageBackedUp = true;
  await writeFile(path.join(output, 'demo-storage-backup.json'), JSON.stringify(storageSnapshot));
  const helpers = { check, expect, capture, measure, waitUntil, record, waitForPage,
    viewport: readViewport };
  await runDesignScenarios(miniProgram, helpers);
  const configuredRoutes = JSON.parse(await readFile(path.join(projectPath, 'miniprogram/app.json'), 'utf8')).pages;
  const visitedRoutes = new Set(report.navigation.filter(item => item.status === 'ready').map(item => item.expected));
  await check(selectedCases ? 'Native acceptance candidate remains unchanged' : 'All configured native pages reached a stable rendered state', async () => {
    if (!selectedCases) {
      const missing = configuredRoutes.filter(route => !visitedRoutes.has(route));
      expect(missing.length === 0, 'Some configured native pages were not exercised.', { missing });
    } else {
      const executed = new Set(report.cases.map(item => item.name));
      const missing = [...selectedCases].filter(name => !executed.has(name));
      expect(missing.length === 0, 'Some requested follow-up cases were not executed.', { missing });
    }
    assert.deepEqual(await fingerprintSource(), report.source, 'Application, shared contracts, or domain source changed during native acceptance.');
    assert.deepEqual(await fingerprint(path.join(projectPath, 'miniprogram')), report.build, 'Native build changed during acceptance.');
    assert.deepEqual(await fingerprintHarness(), report.harness, 'Acceptance harness changed during native acceptance.');
  });
} catch (error) {
  report.fatal = error.stack || error.message;
  console.error(error.message);
  if (miniProgram) {
    try { await capture('initialization-or-fatal-error'); } catch (captureError) { report.fatalCaptureError = captureError.message; }
    try { report.fatalLogic = await miniProgram.evaluate(() => ({ routes: getCurrentPages().map(page => page.route) })); }
    catch (logicError) { report.fatalLogicError = logicError.message; }
  }
} finally {
  if (miniProgram) {
    try {
      if (storageBackedUp) {
        const restored = await miniProgram.evaluate((demoKey, draftPrefix, original) => {
          const relevant = key => key === demoKey || key.startsWith(draftPrefix) || key.startsWith('lounges.recent.')
            || ['activities.mineOnly', 'rewards.initialTab', 'rewards.initialCurrency'].includes(key);
          for (const key of wx.getStorageInfoSync().keys.filter(relevant)) {
            if (!Object.prototype.hasOwnProperty.call(original, key)) wx.removeStorageSync(key);
          }
          for (const [key, value] of Object.entries(original)) wx.setStorageSync(key, value);
          return Object.fromEntries(wx.getStorageInfoSync().keys.filter(relevant).map(key => [key, wx.getStorageSync(key)]));
        }, storageKey, draftStoragePrefix, storageSnapshot);
        assert.deepEqual(restored, storageSnapshot, 'Demo and draft storage did not match the original snapshot after restoration.');
        report.storageRestored = true;
        await unlink(path.join(output, 'demo-storage-backup.json'));
      }
      if (!keepOpen) await miniProgram.close();
      report.automation.status = keepOpen ? 'left-open-for-review' : 'closed';
      report.automation.finishedAt = new Date().toISOString();
      await writeFile(path.join(output, 'automation.json'), JSON.stringify(report.automation, null, 2) + '\n');
    } catch (error) {
      report.cleanupError = error.message;
      report.cleanupStack = error.stack;
      report.storageRestored ??= false;
    }
    miniProgram.disconnect();
  }
  await saveReport();
}
if (report.status !== 'passed') process.exitCode = 1;
