import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.resolve(process.env.PROTOTYPE_ACCEPTANCE_OUTPUT || path.join(root, '.qa-native', 'prototype', runId));
const prototypeRoot = path.join(root, 'dist', 'prototype');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PROTOTYPE_PLAYWRIGHT_MODULE || 'playwright');
const report = {
  startedAt: new Date().toISOString(),
  approach: 'Remote Chromium browser projection of native WXML, WXSS, page controllers, and the real demo domain service.',
  mode: 'demo',
  cases: [], screenshots: [], exceptions: [], warnings: [], httpErrors: [],
  limitations: [
    'Browser projection is not WeChat Developer Tools or physical-device acceptance.',
    'Browser adapters replace native pickers, navigation, privacy dialogs, image selection, clipboard, and subscription APIs.',
    'Cloud deployment, actual notifications, account authorization, and publishing are outside this acceptance.',
    'The test fixture changes only the workbench chrome to expose exact native preview dimensions; source page CSS is preserved.',
    'Image-picker cancellation is a dispatched browser cancel event, not a physical operating-system album gesture.',
    'Nested platform modal priority is exercised through a simulated wx adapter event, not an operating-system interruption.',
    'Foreground date refresh is exercised through simulated host lifecycle callbacks, not a physical-device background/foreground transition.',
    'Chinese composition checks use calibrated Chromium CDP sessions, not an operating-system input method or native WeChat IME.',
    'Default favicon requests may return 404; recorded request URLs distinguish these from native UI asset failures.',
  ],
};
const sizes = [
  { name: '375', width: 375, height: 812 },
  { name: '320', width: 320, height: 720 },
  { name: '768-landscape', width: 768, height: 375 },
];
const browserArgs = ['--no-sandbox', '--disable-gpu'];
const displayLimits = [
  '浏览器原型验收不等同于微信开发者工具或真机验收。',
  '原生选择器、导航、隐私弹窗、图片选择、剪贴板和微信订阅由浏览器适配。',
  '本次未部署云端、发送真实通知、进行真实账号授权或发布。',
  '尺寸检查仅调整工作台外壳，保留来源页面的布局与交互。',
  '图片选择取消通过浏览器取消事件模拟，不代表真机系统相册手势。',
  '嵌套平台弹窗优先级通过模拟 wx 适配器事件验证，不代表真机系统中断。',
  '跨日前台恢复通过模拟宿主生命周期回调验证，不代表真机前后台切换。',
  '中文组合输入通过 Chromium CDP 会话与普通控件对照验证，不代表系统输入法或微信真机。',
  '浏览器可能请求未提供的 favicon.ico；报告记录请求地址，以区分网站图标与页面资源加载失败。',
];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let browser;
let server;
let page;
let currentCase;
let baseUrl;
const exercisedHandlers = new Set();
const fingerprintDirectories = ['miniprogram', 'domain', 'shared', 'cloudfunctions', 'prototype', 'scripts'];
const fingerprintFiles = ['package.json', 'package-lock.json', 'tsconfig.json'];
const fingerprintExcludedDirectories = new Set(['node_modules', 'dist', '.qa-native', '.git', 'docs', 'tests']);

async function sourceSnapshot() {
  const files = [...fingerprintFiles];
  async function collect(directory) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!fingerprintExcludedDirectories.has(entry.name)) await collect(relative);
      }
      else {
        assert.ok(entry.isFile(), `Source provenance requires a regular file: ${relative}`);
        files.push(relative);
      }
    }
  }
  for (const directory of fingerprintDirectories) await collect(directory);
  files.sort();
  const entries = [];
  for (const relative of files) {
    const digest = createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex');
    entries.push(`${digest}  ${relative}`);
  }
  const manifest = entries.join('\n') + '\n';
  return { manifest, fileCount: files.length, sha256: createHash('sha256').update(manifest, 'utf8').digest('hex') };
}

function attachDiagnostics(target) {
  target.on('pageerror', error => report.exceptions.push({ case: currentCase?.name, message: error.message, stack: error.stack }));
  target.on('console', message => { if (message.type() === 'error') report.warnings.push({ case: currentCase?.name, message: message.text(), location: message.location() }); });
  target.on('response', response => {
    if (response.status() >= 400) report.httpErrors.push({ case: currentCase?.name, source: 'browser-response', url: response.url(), status: response.status() });
  });
}

async function waitUntil(predicate, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let detail;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch (error) { detail = error.message; }
    await sleep(50);
  }
  throw new Error(`${message}${detail ? `: ${detail}` : ''}`);
}
const native = selector => page.locator('#native-page').locator(selector);
async function data() { return page.evaluate(() => window.Prototype.current?.data || {}); }
async function route() { return page.evaluate(() => window.Prototype.current?.route || ''); }
async function settled() {
  await waitUntil(async () => {
    const value = await data();
    return Object.keys(value).length > 0 && !value.loading && !value.loadingMore && !value.reloading && !value.refreshing && !value.dateRefreshing && !value.countsLoading
      && !value.saving && !value.busy && !value.busyId && !value.changingRole;
  }, 'The source page did not settle');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function openPage(target) {
  await page.evaluate(async value => { await window.Prototype.openPage(value); }, target);
  await settled();
}
async function waitRoute(name) {
  await waitUntil(async () => (await route()).replace(/^\//, '') === `pages/${name}/index`, `Navigation did not reach ${name}`);
  await settled();
}
async function click(selector, text) {
  let target = native(selector);
  if (text) target = target.filter({ hasText: text });
  await target.first().click();
}
async function clickDetailAction(handler) {
  const primary = native(`.detail-bottom-bar .detail-primary[data-handler="${handler}"]`);
  if (await primary.count()) { await primary.click(); return; }
  if (!(await data()).showManage) await click('.detail-more[data-handler="openManage"]');
  await native(`[data-sheet-dialog="detail-manage"] button[data-handler="${handler}"]`).click();
}
async function expectText(selector, expected) {
  await waitUntil(async () => (await native(selector).allTextContents()).join(' ').includes(expected),
    `Expected visible source text: ${selector} / ${expected}`);
}
async function resize(size) {
  // Browser width matches the preview so native vw units and media queries retain their real meaning.
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.evaluate(({ width, height }) => {
    const device = document.querySelector('#device');
    device.style.setProperty('width', `${width}px`, 'important');
    device.style.setProperty('height', `${height}px`, 'important');
    device.style.setProperty('min-height', `${height}px`, 'important');
    device.style.setProperty('max-height', `${height}px`, 'important');
  }, size);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
}
async function capture(name, metadata = {}) {
  const filename = `${String(report.screenshots.length + 1).padStart(3, '0')}-${name.replace(/[^a-zA-Z0-9_-]+/g, '-')}.png`;
  await page.locator('#device').screenshot({ path: path.join(output, 'screenshots', filename) });
  const record = { name, file: `screenshots/${filename}`, ...metadata };
  report.screenshots.push(record);
  currentCase?.screenshots.push(record.file);
  return record;
}
async function check(name, action) {
  currentCase = { name, status: 'running', screenshots: [], measurements: {} };
  const result = currentCase;
  const started = Date.now();
  try {
    await action();
    result.status = 'passed';
    console.log(`PASS ${name}`);
  } catch (error) {
    result.status = 'failed';
    result.error = error.message;
    result.stack = error.stack;
    console.error(`FAIL ${name}: ${error.message}`);
    try { await capture(`failure-${name}`); } catch (captureError) { result.captureError = captureError.message; }
  } finally {
    for (const handler of await page.evaluate(() => window.Prototype?.performed || []).catch(() => [])) exercisedHandlers.add(handler);
    result.durationMs = Date.now() - started;
    report.cases.push(result);
    await writeFile(path.join(output, 'cases.json'), JSON.stringify(report.cases, null, 2) + '\n');
    currentCase = undefined;
  }
}
async function geometry() {
  return page.evaluate(() => {
    const host = document.querySelector('#native-page');
    const bounds = host.getBoundingClientRect();
    const device = document.querySelector('#device').getBoundingClientRect();
    const nativeRoot = host.shadowRoot;
    const unlabeledButtons = [...nativeRoot.querySelectorAll('button')].flatMap(element => {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height || element.closest('[hidden]')) return [];
      return !element.textContent.trim() && !element.getAttribute('aria-label')?.trim()
        ? [{ className: element.className, handler: element.dataset.handler }] : [];
    });
    const overflow = [...nativeRoot.querySelectorAll('*')].flatMap(element => {
      if (!(element instanceof HTMLElement)) return [];
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height || box.bottom < bounds.top || box.top > bounds.bottom) return [];
      // A horizontal bank rail deliberately clips its internal children.
      if (element.closest('.bank-rail')) return [];
      return box.left < bounds.left - 2 || box.right > bounds.right + 2
        ? [{ tag: element.tagName, className: element.className, text: element.textContent.slice(0, 70), x: box.x - bounds.x, width: box.width }]
        : [];
    });
    return {
      preview: { width: device.width, height: device.height },
      viewport: { width: bounds.width, height: bounds.height, scrollWidth: host.scrollWidth, clientWidth: host.clientWidth },
      overflow, unlabeledButtons, text: nativeRoot.querySelector('.prototype-native-content')?.innerText.replace(/\s+/g, ' ').trim() || '',
    };
  });
}
async function allRoutesMatrix(routes) {
  for (const size of sizes) {
    await resize(size);
    for (const target of routes) {
      const name = target.split('/')[1];
      await check(`Route ${name} at ${size.name}`, async () => {
        await openPage(target);
        const value = await data();
        assert.ok(!value.failed && !value.loadError, `Page failed to load: ${JSON.stringify(value)}`);
        const measured = await geometry();
        currentCase.measurements.layout = measured;
        assert.equal(Math.round(measured.preview.width), size.width, 'Preview width does not match the requested viewport');
        assert.equal(Math.round(measured.preview.height), size.height, 'Preview height does not match the requested viewport');
        assert.ok(measured.viewport.scrollWidth <= measured.viewport.clientWidth + 2,
          `Native viewport scrolls horizontally: ${JSON.stringify(measured.viewport)}`);
        assert.equal(measured.overflow.length, 0, `Source elements overflow the native viewport: ${JSON.stringify(measured.overflow.slice(0, 8))}`);
        assert.ok(!/\b(?:undefined|NaN)\b/.test(measured.text), 'A raw JavaScript sentinel leaked into the rendered interface');
        assert.equal(measured.unlabeledButtons.length, 0, `Source buttons lack visible or accessible labels: ${JSON.stringify(measured.unlabeledButtons)}`);
        if (['todo', 'activities', 'rewards', 'wallet', 'mine'].includes(name)) {
          const bar = await page.locator('#native-tabs').boundingBox();
          const device = await page.locator('#device').boundingBox();
          assert.ok(bar && bar.y + bar.height <= device.y + device.height + 2,
            `Bottom navigation is outside the preview: ${JSON.stringify({ bar, device })}`);
          assert.equal(await page.locator('#native-tabs button:visible').count(), 5, 'A primary navigation tab is missing');
        }
        assert.ok(await native('button, input, textarea, [role], .page, .entry-page, .lead-page, .editor-page, .web-entry-page').count() > 0,
          'The route has no source-rendered native content');
        await capture(`${name}-${size.name}`, { route: target, size: size.name, width: size.width, height: size.height, matrix: true });
      });
    }
  }
  await resize(sizes[0]);
}
async function reset() {
  // Fixture setup is outside the source application's interactive acceptance.
  await page.evaluate(async () => { await window.Prototype.resetFixture(); });
  await settled();
}
async function injectState(control) {
  // Workbench-only controls inject deterministic network states; source actions still use real pointer input.
  await page.locator(control).evaluate(element => element.click());
}

async function runInteractions() {
  await check('All five primary tabs navigate and expose the selected destination', async () => {
    await reset();
    for (const [name, label] of [['activities', '活动'], ['rewards', '收益'], ['wallet', '卡包'], ['mine', '我的'], ['todo', '待办']]) {
      await page.locator('#native-tabs button').filter({ hasText: label }).click();
      await waitRoute(name);
      assert.equal(await page.locator('#native-tabs button[aria-current="page"]').textContent(), label,
        'The tab bar did not communicate its selected destination');
    }
  });

  await check('Bank sheet search, empty recovery, selection, and dismissal', async () => {
    await openPage('pages/activities/index');
    await click('.all-banks');
    await native('.sheet').waitFor({ state: 'visible' });
    await native('.bank-search').fill('NoSuchBank');
    await expectText('.search-empty', '没有找到');
    await capture('bank-search-empty');
    await native('.bank-search').fill('招商');
    await waitUntil(async () => await native('.bank-grid-choice').count() === 1, 'Bank search did not narrow its results');
    await click('.bank-grid-choice');
    await settled();
    assert.equal((await data()).bankId, 'cmb');
    assert.equal(await native('.sheet-layer').count(), 0, 'The sheet remains open after selection');
    await expectText('.feed-heading', '招商');
    await click('.all-banks');
    await click('.sheet-close');
    assert.equal(await native('.sheet-layer').count(), 0, 'The sheet close button did not dismiss the panel');
    await capture('bank-selected');
  });

  await check('Monthly progress, completion, receipt, and persisted history', async () => {
    await reset();
    await openPage('pages/todo/index');
    let state = await data();
    const monthly = state.tasks.find(item => item.activityId === 'monthly');
    assert.ok(monthly, 'The monthly demo task is missing');
    const id = monthly.id;
    const row = () => native(`.task-row[data-id="${id}"]`);
    await row().locator('.task-primary').click();
    await waitRoute('progress');
    await native('#progress').fill('3');
    await click('.entry-primary');
    await waitRoute('todo');
    await waitUntil(async () => (await data()).raw.tasks.some(item => item.id === id && item.progress === 3), 'Progress was not persisted');
    await row().locator('.task-primary').click();
    await settled();
    await click('.tabs .tab', '本期已完成');
    await waitUntil(async () => (await data()).tasks.some(item => item.id === id), 'Completed task did not appear in the completed filter');
    await row().locator('.task-primary').click();
    await waitRoute('receipt');
    await native('#amount').fill('18.50');
    await click('.entry-primary');
    await waitRoute('todo');
    await click('.history-entry');
    await waitRoute('history');
    state = await data();
    assert.ok(JSON.stringify(state).includes('18.50') || JSON.stringify(state).includes('1850'), 'History does not contain the saved receipt');
    await capture('monthly-recorded-history');
  });

  await check('Empty lead form points to required fields and retains valid input', async () => {
    await reset();
    await openPage('pages/submission-lead/index');
    await click('.lead-dock .primary-button');
    await expectText('#field-title .field-error', '名称');
    assert.ok((await data()).errors.bankId, 'Missing bank must be rejected');
    await native('#title').fill('原型验收线索');
    await native('#sourceNote').fill('银行 App → 信用卡 → 优惠活动。');
    assert.equal((await data()).lead.title, '原型验收线索');
    await click('.lead-dock .secondary-button');
    await capture('lead-validation-and-draft');
    await page.locator('#native-back').click();
    const dialog = page.locator('#platform-layer button').last();
    if (await dialog.isVisible()) await dialog.click();
    await page.evaluate(async () => { await window.Prototype.openPage('pages/submission-lead/index'); });
    const recovery = page.locator('#platform-layer button').filter({ hasText: '恢复草稿' });
    await recovery.waitFor({ state: 'visible' });
    await recovery.click();
    await settled();
    assert.equal(await native('#title').inputValue(), '原型验收线索', 'Saved draft did not recover its title');
    await capture('lead-draft-recovered');
  });

  await check('Preferences change exposes an explicit saved confirmation', async () => {
    await reset();
    await openPage('pages/preferences/index');
    const initial = (await data()).newActivities;
    await native('[data-field="newActivities"]').click();
    await waitUntil(async () => (await data()).newActivities !== initial, 'The notification switch did not update');
    await click('.primary-button');
    await settled();
    await expectText('.saved-message', '已保存');
    await capture('preferences-saved');
    await openPage('pages/preferences/index');
    assert.equal((await data()).newActivities, !initial, 'Saved preferences did not persist');
  });

  await check('Wallet bill action is reversible and preserves the account', async () => {
    await reset();
    await openPage('pages/wallet/index');
    const first = (await data()).groups.find(group => group.primaryBill && !group.primaryBill.paid);
    assert.ok(first, 'The unpaid bill fixture is missing');
    const billId = first.primaryBill.id;
    await native(`button[data-id="${billId}"]`).filter({ hasText: '标记还款' }).click();
    const confirm = page.locator('#platform-layer button').last();
    if (await confirm.isVisible()) await confirm.click();
    await settled();
    assert.ok((await data()).groups.some(group => group.id === first.id && group.primaryBill?.paid), 'Bill did not record the paid state');
    await native(`button[data-id="${billId}"]`).filter({ hasText: '撤销还款' }).click();
    const undoConfirm = page.locator('#platform-layer button').last();
    if (await undoConfirm.isVisible()) await undoConfirm.click();
    await settled();
    assert.ok((await data()).groups.some(group => group.id === first.id && !group.primaryBill?.paid), 'Undo did not restore the unpaid bill');
    await capture('wallet-bill-restored');
  });

  await check('Card creation, editing, and removal update the wallet through source forms', async () => {
    await reset();
    await openPage('pages/wallet/index');
    const initialCount = (await data()).cardCount;
    await click('.page-heading button', '添加卡片');
    await waitRoute('card-edit');
    await click('.kind-button', '借记卡');
    await native('#field-nickname input').fill('验收借记卡');
    await click('.save-button');
    await waitRoute('wallet');
    assert.equal((await data()).cardCount, initialCount + 1, 'The new card did not enter the wallet');
    const added = native('.loose-card').filter({ hasText: '验收借记卡' });
    await added.locator('button').click();
    await waitRoute('card-edit');
    await native('#field-nickname input').fill('验收日常卡');
    await click('.save-button');
    await waitRoute('wallet');
    await expectText('.loose-card', '验收日常卡');
    await capture('card-created-and-renamed');
    await native('.loose-card').filter({ hasText: '验收日常卡' }).locator('button').click();
    await waitRoute('card-edit');
    await click('.remove-button');
    await page.locator('#platform-layer button').last().click();
    await waitRoute('wallet');
    assert.equal((await data()).cardCount, initialCount, 'Removing the created card changed the wallet count incorrectly');
  });

  await check('Wallet refresh preserves readable records, blocks stale changes, and retries', async () => {
    await reset();
    await openPage('pages/wallet/index');
    const initial = await data();
    const count = await native('.account-group').count();
    const bill = initial.groups.find(group => group.primaryBill && !group.primaryBill.paid).primaryBill;
    const action = () => native(`.bill-date-row button[data-id="${bill.id}"]`);
    await injectState('#slow-next');
    await waitUntil(async () => (await data()).refreshing === true, 'Wallet did not expose its refreshing state');
    assert.equal(await native('.account-group').count(), count, 'Refreshing removed previously read accounts');
    assert.equal(await action().isDisabled(), true, 'A bill could mutate while the wallet was refreshing');
    await capture('wallet-slow-refresh-retains-records');
    await settled();
    await injectState('#fail-next');
    await waitUntil(async () => Boolean((await data()).refreshError), 'Wallet refresh failure did not show recovery feedback');
    await settled();
    assert.equal((await data()).outdated, true, 'The outdated wallet was not marked stale');
    assert.equal(await native('.account-group').count(), count, 'Failed refresh discarded the previous accounts');
    assert.equal(await action().isDisabled(), true, 'Stale bill actions remained enabled after a failed refresh');
    await expectText('.refresh-notice', '上次读取');
    await capture('wallet-failed-refresh-retains-records');
    await click('.refresh-notice button', '重新刷新');
    await settled();
    assert.equal((await data()).outdated, false, 'Successful retry did not clear the stale marker');
    assert.equal((await data()).refreshError, '', 'Successful retry left the error message');
    assert.equal(await action().isDisabled(), false, 'Successful retry did not re-enable bill actions');
    assert.equal((await data()).cardCount, initial.cardCount, 'Refresh recovery altered the wallet contents');
  });

  for (const view of [
    { route: 'todo', row: '.task-row', action: '.task-primary' },
    { route: 'rewards', row: '.pending-row', action: '.pending-footer button' },
  ]) {
    await check(`${view.route} refresh retains readable rows and prevents stale mutations`, async () => {
      await reset();
      await openPage(`pages/${view.route}/index`);
      if (view.route === 'rewards') { await click('.tabs .tab', '待确认'); await settled(); }
      const count = await native(view.row).count();
      assert.ok(count > 0, 'The refresh fixture must contain visible actionable rows');
      await injectState('#slow-next');
      await waitUntil(async () => (await data()).refreshing === true, 'Refresh did not expose its pending state');
      assert.equal(await native(view.row).count(), count, 'Slow refresh hid previously read rows');
      assert.equal(await native(view.action).first().isDisabled(), true, 'A mutation remained enabled during refresh');
      await settled();
      await injectState('#fail-next');
      await waitUntil(async () => Boolean((await data()).refreshError), 'Failed refresh did not expose a retry');
      await settled();
      assert.equal(await native(view.row).count(), count, 'Refresh failure discarded previously read rows');
      assert.equal(await native(view.action).first().isDisabled(), true, 'A stale row still allows mutation');
      await capture(`${view.route}-refresh-failure-keeps-rows`);
      await click('.refresh-notice button');
      await settled();
      assert.equal((await data()).outdated, false, 'Retry did not clear the stale marker');
      assert.equal(await native(view.action).first().isDisabled(), false, 'Retry did not restore the row action');
    });
  }

  await check('Instant discount uses benefit wording and its own reward subtotal', async () => {
    await reset();
    await page.evaluate(async () => { await window.Prototype.scenarios.discount(); });
    await waitRoute('detail');
    await clickDetailAction('join');
    await settled();
    await clickDetailAction('receipt');
    await waitRoute('receipt');
    await expectText('#amount-field .entry-label', '实际优惠');
    await expectText('#receipt-date-field .entry-label', '享受优惠日期');
    await native('#amount').fill('27.50');
    await click('.entry-primary');
    await waitRoute('detail');
    assert.equal((await data()).detail.participation.receivedMinor, 2750, 'The discount amount was not persisted');
    await openPage('pages/rewards/index');
    await click('.tabs .tab', '已记录');
    await settled();
    const rewards = await data();
    assert.ok(rewards.received.some(item => item.kindLabel === '已享优惠'), 'The discount is missing its benefit ledger label');
    assert.ok(rewards.discountTotal.includes('27.50'), 'The discount did not enter the discount subtotal');
    assert.equal(rewards.cashbackTotal, '¥0', 'The discount incorrectly increased cashback');
    await capture('discount-ledger-subtotal');
  });

  await check('Load failure offers a working retry and slow load is visible', async () => {
    await openPage('pages/activities/index');
    await injectState('#fail-next');
    await waitUntil(async () => Boolean((await data()).error), 'The requested load failure did not surface');
    await expectText('[role="alert"]', '重试');
    await capture('load-failure');
    await click('button', '重新加载');
    await settled();
    assert.equal((await data()).error, '', 'Retry did not clear the load failure');
    await injectState('#slow-next');
    await waitUntil(async () => (await data()).loading === true, 'Slow loading did not expose its pending state');
    await capture('slow-loading');
    await settled();
    assert.ok((await data()).items.length > 0, 'Slow loading lost the activity list');
  });

  await check('Receipt save failure preserves the entered amount and allows retry', async () => {
    await reset();
    await openPage('pages/receipt/index');
    await native('#amount').fill('77.50');
    await injectState('#fail-save');
    await click('.entry-primary');
    await settled();
    await expectText('.entry-form-error', '保存失败');
    assert.equal(await native('#amount').inputValue(), '77.50', 'The failed save discarded the entered amount');
    await capture('receipt-save-failure-retains-input');
    await click('.entry-primary');
    await waitRoute('todo');
    await openPage('pages/history/index');
    assert.ok((await data()).items.some(item => item.activityId === 'quarterly' && item.stage === 'received'), 'Retry did not persist the receipt');
  });

  await check('Lead submission remains private and incomplete moderation is rejected', async () => {
    await reset();
    await openPage('pages/submissions/index');
    await click('.new-button');
    await waitRoute('submission-lead');
    const title = '验收线索：银行餐饮优惠';
    const bankIndex = (await data()).bankOptions.findIndex(bank => bank.id === 'cmb');
    await native('#field-bankId select').selectOption(String(bankIndex));
    await native('#title').fill(title);
    await native('#sourceNote').fill('银行 App → 信用卡 → 优惠活动，等待运营核实。');
    await click('.lead-dock .primary-button');
    await settled();
    if ((await route()).includes('submission-lead')) await click('.status-notice button');
    await waitRoute('submissions');
    const saved = (await data()).items.find(item => item.titleText === title);
    assert.ok(saved && saved.status === 'pending' && saved.isLead && saved.draft === null, 'Lead submission lost its moderated private state');
    await capture('lead-submitted-pending');
    await openPage('pages/activities/index');
    assert.ok(!(await data()).items.some(item => item.title === title), 'An unreviewed lead entered the public catalog');
    await openPage('pages/review/index');
    assert.equal((await data()).denied, true, 'Ordinary users can enter moderation');
    await capture('ordinary-user-review-denied');
    await page.evaluate(async () => { await window.Prototype.scenarios.review(); });
    await waitRoute('review');
    await native(`.review-row[data-id="${saved.id}"]`).click();
    await waitRoute('submission-edit');
    assert.equal((await data()).leadReview, true, 'The review did not open the lead completion editor');
    await click('.editor-dock .primary-button');
    await settled();
    const errors = (await data()).errors;
    assert.ok(errors.startsOn && errors.endsOn && errors.targetText && errors.rewardText && errors.sourceVerified,
      'Incomplete moderation failed to require verified rules');
    await expectText('.error-banner', '请检查');
    await capture('incomplete-lead-review-errors');
    assert.equal((await data()).submission.status, 'pending', 'An invalid review published the lead');
  });

  await check('Image upload, preview, and removal use the source lead editor', async () => {
    await reset();
    await openPage('pages/submission-lead/index');
    const chooser = page.waitForEvent('filechooser');
    await click('.upload-button');
    const fileChooser = await chooser;
    await fileChooser.setFiles({ name: 'prototype-rule.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII=', 'base64') });
    await waitUntil(async () => (await data()).imageRows.length === 1 && !(await data()).uploading, 'Uploaded image did not appear in the lead');
    await click('.image-preview');
    await page.locator('#platform-layer img').waitFor({ state: 'visible' });
    await capture('lead-image-preview');
    await page.locator('#platform-layer button').filter({ hasText: '关闭' }).click();
    await click('.remove-image');
    await waitUntil(async () => (await data()).imageRows.length === 0, 'Removing the image left it in the draft');
    await capture('lead-image-removed');
  });

  await check('History audit sheet remains reachable in a short landscape viewport', async () => {
    await reset();
    await resize(sizes[2]);
    await openPage('pages/history/index');
    await click('.audit-link');
    await waitUntil(async () => (await data()).showAudit && !(await data()).auditLoading, 'Audit history did not settle');
    await native('.sheet-close').waitFor({ state: 'visible' });
    const panel = await native('.sheet').boundingBox();
    const close = await native('.sheet-close').boundingBox();
    const device = await page.locator('#device').boundingBox();
    assert.ok(panel.y >= device.y && panel.y + panel.height <= device.y + device.height + 2, 'Landscape audit panel escapes the preview');
    assert.ok(close.y >= device.y && close.y + close.height <= device.y + device.height + 2, 'Landscape audit close button is unreachable');
    await capture('history-audit-landscape');
    await click('.sheet-close');
    assert.equal((await data()).showAudit, false, 'Closing audit did not restore the history page');
    await resize(sizes[0]);
  });

  for (const form of [
    { route: 'progress', field: '#progress', value: '3', idKey: 'progressInput' },
    { route: 'receipt', field: '#amount', value: '77.50', idKey: 'amountInput' },
  ]) {
    await check(`Version conflict preserves ${form.route} input until explicit reapplication`, async () => {
      await reset();
      await openPage(`pages/${form.route}/index`);
      await native(form.field).fill(form.value);
      await page.evaluate(async () => { await window.Prototype.scenarios.conflict(); });
      await click('.entry-primary');
      await settled();
      assert.equal((await data()).conflict, true, 'The concurrent update was not detected');
      assert.equal(await native(form.field).inputValue(), form.value, 'The conflict discarded the user input');
      assert.equal(await native('.entry-primary').isDisabled(), true, 'Conflicting input could save before reading the latest version');
      await capture(`${form.route}-version-conflict`);
      await click('#record-conflict button', '读取最新记录');
      await settled();
      assert.equal((await data()).conflict, false, 'Reading the latest record did not clear the conflict');
      assert.equal((await data()).reapplyRequired, true, 'Reapplication was not explicitly requested');
      assert.equal(await native(form.field).inputValue(), form.value, 'Reading the latest record overwrote the preserved input');
      await expectText('.entry-primary', '重新应用并保存');
      await click('.entry-primary');
      await waitRoute('todo');
    });
  }

  await reset();
  await page.evaluate(async () => { await window.Prototype.scenarios.pagination(); });
  for (const list of [
    { route: 'activities', items: 'items', cursor: 'cursor', auto: true },
    { route: 'history', items: 'items', cursor: 'cursor', auto: true },
    { route: 'rewards', items: 'received', cursor: 'nextCursor' },
    { route: 'submissions', items: 'items', cursor: 'nextCursor' },
    { route: 'review', items: 'items', cursor: 'nextCursor', moderator: true },
  ]) {
    await check(`Pagination failure preserves ${list.route} items and its cursor for retry`, async () => {
      if (list.moderator) await page.evaluate(async () => { await window.Prototype.scenarios.review(); });
      else await openPage(`pages/${list.route}/index`);
      await settled();
      const before = await data();
      assert.ok(before[list.cursor] && before[list.items].length, 'The pagination fixture did not expose another page');
      const beforeIds = before[list.items].map(item => item.id);
      await injectState('#fail-read');
      const more = native('button[data-handler="loadMore"]');
      if (list.auto) await more.scrollIntoViewIfNeeded();
      else await more.click();
      await waitUntil(async () => Boolean((await data()).loadMoreError), 'Pagination did not expose its local failure');
      await settled();
      const failed = await data();
      assert.deepEqual(failed[list.items].map(item => item.id), beforeIds, 'A pagination failure discarded previously loaded rows');
      assert.equal(failed[list.cursor], before[list.cursor], 'A failed page advanced the cursor');
      await capture(`${list.route}-pagination-failure`);
      await more.click();
      await settled();
      const after = await data();
      assert.ok(after[list.items].length > beforeIds.length, 'Retry did not append the next page');
      assert.equal(after.loadMoreError, '', 'Retry left the pagination failure message');
      assert.equal(new Set(after[list.items].map(item => item.id)).size, after[list.items].length, 'Pagination produced duplicate rows');
    });
  }

  await check('Returning from detail and switching tabs preserve the catalog position and filter', async () => {
    await openPage('pages/activities/index');
    await native('.bank-choice[data-id="cmb"]').click();
    await settled();
    const offer = native('.offer-heading').nth(8);
    await offer.scrollIntoViewIfNeeded();
    const priorScroll = await page.locator('#native-page').evaluate(element => element.scrollTop);
    assert.ok(priorScroll > 200, 'The return-position fixture did not scroll into its catalog');
    await offer.click();
    await waitRoute('detail');
    await page.locator('#native-back').click();
    await waitRoute('activities');
    const afterBack = await page.locator('#native-page').evaluate(element => element.scrollTop);
    assert.ok(Math.abs(afterBack - priorScroll) <= 3, `Detail return lost the list position: ${priorScroll} to ${afterBack}`);
    assert.equal((await data()).bankId, 'cmb', 'Detail return discarded the bank filter');
    await page.locator('#native-tabs button').filter({ hasText: '收益' }).click();
    await waitRoute('rewards');
    await page.locator('#native-tabs button').filter({ hasText: '活动' }).click();
    await waitRoute('activities');
    assert.equal((await data()).bankId, 'cmb', 'Switching primary tabs discarded the bank filter');
    const afterTab = await page.locator('#native-page').evaluate(element => element.scrollTop);
    assert.ok(Math.abs(afterTab - priorScroll) <= 3, `Primary-tab return lost the list position: ${priorScroll} to ${afterTab}`);
    await capture('catalog-filter-and-position-restored');
  });

  await check('Submission switches expose their source labels to assistive technology', async () => {
    await reset();
    await openPage('pages/submission-edit/index');
    await click('#section-rules .section-heading');
    const registration = page.getByRole('switch', { name: /需要银行报名/ });
    const invitation = page.getByRole('switch', { name: /仅限受邀用户/ });
    await registration.waitFor({ state: 'visible' });
    await invitation.waitFor({ state: 'visible' });
    const before = (await data()).draft.requiresRegistration;
    await registration.click();
    assert.equal((await data()).draft.requiresRegistration, !before, 'The named registration control did not toggle its source field');
    await capture('submission-switch-accessible-names');
  });

  await check('A failed reward-month change keeps the requested scope visible and retryable', async () => {
    await reset();
    await openPage('pages/rewards/index');
    const initialMonth = (await data()).month;
    const nextMonth = initialMonth.endsWith('-01') ? `${Number(initialMonth.slice(0, 4)) - 1}-12`
      : `${initialMonth.slice(0, 4)}-${String(Number(initialMonth.slice(5)) - 1).padStart(2, '0')}`;
    const label = `${nextMonth.slice(0, 4)} 年 ${Number(nextMonth.slice(5))} 月`;
    await injectState('#fail-read');
    await native('.reward-filters input[type="month"]').fill(nextMonth);
    await waitUntil(async () => (await data()).failed === true, 'The month-filter failure did not appear');
    await settled();
    assert.equal((await data()).month, nextMonth, 'The failed filter did not retain its requested month');
    assert.equal((await data()).monthLabel, label, 'The visible month label still describes the previous scope');
    await expectText('.reward-filters .picker-text', label);
    assert.equal(await native('input[type="month"]').evaluate(element => element.getRootNode().activeElement === element), true,
      'Date picker lost focus after its source state update');
    await capture('rewards-new-month-load-failure');
    await click('.empty .secondary', '重试');
    await settled();
    assert.equal((await data()).month, nextMonth, 'Retry loaded a different month');
    assert.equal((await data()).failed, false, 'Month retry did not recover');
    await native('.reward-filters select').focus();
    await native('.reward-filters select').selectOption('1');
    await settled();
    assert.equal(await native('.reward-filters select').evaluate(element => element.getRootNode().activeElement === element), true,
      'The currency picker lost focus after its source state update');
  });

  await check('Choosing a lower card preserves the short-landscape sheet position', async () => {
    await reset();
    await resize(sizes[2]);
    await page.evaluate(async () => {
      for (let index = 0; index < 8; index++) await window.Prototype.api.command('card.save', {
        bankId: 'boc', issuerId: 'boc-mo', kind: 'credit', network: 'mastercard', nickname: `横屏验收卡${index}`,
      });
      await window.Prototype.navigate('pages/detail/index?id=annual');
    });
    await waitRoute('detail');
    await click('button[data-handler="openManage"]');
    await click('button[data-handler="anotherCard"]');
    const last = native('.card-option').last();
    await last.scrollIntoViewIfNeeded();
    const before = await native('.sheet-body').evaluate(element => element.scrollTop);
    assert.ok(before > 200, 'The card sheet fixture did not scroll to its lower choices');
    await last.click();
    await waitUntil(async () => Boolean((await data()).selectedCardId), 'The card option was not selected');
    const after = await native('.sheet-body').evaluate(element => element.scrollTop);
    assert.ok(Math.abs(after - before) <= 3, `Selecting a card lost its sheet position: ${before} to ${after}`);
    const selected = await native('.card-option.is-selected').boundingBox();
    const body = await native('.sheet-body').boundingBox();
    assert.ok(selected.y >= body.y - 2 && selected.y + selected.height <= body.y + body.height + 2,
      'The selected card is outside the visible sheet body');
    assert.equal(await native('.card-option.is-selected').evaluate(element => element.getRootNode().activeElement === element), true,
      'The selected card lost keyboard focus');
    await capture('card-sheet-selection-position-preserved');
    await click('.sheet-close');
    await resize(sizes[0]);
  });

  for (const privatePage of [
    { route: 'review', list: '.review-list', row: '.review-row' },
    { route: 'submissions', list: '.submission-list', row: '.submission-row' },
  ]) {
    await check(`${privatePage.route} hides private rows until the current session is verified`, async () => {
      await reset();
      await page.evaluate(async () => { await window.Prototype.scenarios.pagination(); });
      await page.evaluate(async () => { await window.Prototype.scenarios.review(); });
      await settled();
      if (privatePage.route !== 'review') await openPage(`pages/${privatePage.route}/index`);
      const count = await native(privatePage.row).count();
      assert.ok(count > 0, 'The private list fixture must contain previously read content');
      const height = await native(privatePage.list).evaluate(element => element.getBoundingClientRect().height);
      const expectProtected = async () => {
        assert.equal((await data()).sessionVerified, false, 'The list claimed a verified session prematurely');
        assert.equal(await native(privatePage.list).isVisible(), false, 'Unverified private content remained visible');
        assert.equal(await native(privatePage.list).getAttribute('aria-hidden'), 'true', 'Unverified content remains exposed to assistive technology');
        assert.equal(await native(privatePage.row).count(), count, 'Session verification removed the retained row structure');
        assert.ok(Math.abs(await native(privatePage.list).evaluate(element => element.getBoundingClientRect().height) - height) <= 1,
          'Session verification collapsed the retained list position');
        const pagination = native('button[data-handler="loadMore"]');
        if (await pagination.count()) assert.equal(await pagination.isDisabled(), true, 'Unverified pagination looks actionable but cannot run');
      };
      await injectState('#slow-next');
      await waitUntil(async () => (await data()).loading === true && !(await data()).sessionVerified, 'Session revalidation did not enter its pending state');
      await expectProtected();
      await settled();
      assert.equal(await native(privatePage.list).isVisible(), true, 'Successful revalidation did not reveal authorized content');
      await injectState('#fail-next');
      await waitUntil(async () => Boolean((await data()).error) && !(await data()).loading, 'Session revalidation failure did not appear');
      await expectProtected();
      await capture(`${privatePage.route}-unverified-private-content-hidden`);
      await click('.error button');
      await settled();
      assert.equal((await data()).sessionVerified, true, 'Retry did not verify the account');
      assert.equal(await native(privatePage.list).isVisible(), true, 'Authorized private content did not recover after retry');
      if (privatePage.route === 'review') {
        const instanceId = await page.evaluate(() => window.Prototype.current._instanceId);
        await page.evaluate(async () => { await window.Prototype.scenarios.denied(); });
        await settled();
        assert.equal(await page.evaluate(() => window.Prototype.current._instanceId), instanceId,
          'Revocation must recheck the already loaded review instance');
        assert.equal((await data()).denied, true, 'Revoked moderation access did not show the permission boundary');
        assert.equal((await data()).items.length, 0, 'Revoked moderation access retained private rows');
        assert.equal(await native(privatePage.row).count(), 0, 'Revoked moderation content remains in the rendered list');
      }
    });
  }
}

async function runSubmissionResultRecoveryRegressions() {
  for (const kind of ['lead', 'full']) {
    const previousPage = page;
    let context;
    try {
      await check(`Product review pending ${kind} submission rejects edits and resolves one original creation`, async () => {
        context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
        page = await context.newPage(); page.setDefaultTimeout(12000); attachDiagnostics(page);
        await page.goto(baseUrl, { waitUntil: 'load' }); await page.waitForFunction(() => window.Prototype?.ready); await settled();
        await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{max-width:none!important;min-height:0!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
        await resize(sizes[0]); await reset(); await openPage('pages/submissions/index');
        const routeName = kind === 'lead' ? 'submission-lead' : 'submission-edit';
        const action = kind === 'lead' ? 'submission.lead.save' : 'submission.save';
        const payloadField = kind === 'lead' ? 'lead' : 'draft';
        const draftScope = kind === 'lead' ? 'submission-lead' : 'submission';
        const submit = () => native(kind === 'lead' ? '.lead-dock .primary-button' : '.editor-dock .primary-button');
        const title = `Review Two Pending ${kind}`;
        await openPage(`pages/${routeName}/index`);
        const ownerId = (await data()).ownerId;
        const originalIntent = await page.evaluate(() => window.Prototype.current.creationIntentKey);
        const draftKey = entity => ['card-benefits.form-draft.v1', draftScope, ownerId, entity].map(encodeURIComponent).join(':');
        const readDraft = entity => page.evaluate(key => window.wx.getStorageSync(key) || null, draftKey(entity));
        const state = () => page.evaluate(() => ({ commands: window.__reviewSubmissionLoss.commands, committed: window.__reviewSubmissionLoss.committed }));
        const evidence = () => page.evaluate(() => {
          const seed = window.wx.getStorageSync('card-benefits.native.demo.v1').seed;
          const submissions = Object.values(seed.submissions || {});
          const ids = submissions.map(item => item.id);
          return { submissions, requests: Object.values(seed.requests || {}).filter(item => ids.includes(item.result?.id)),
            audit: Object.values(seed.audit_events || {}).filter(item => ids.includes(item.entityId)) };
        });
        assert.equal((await evidence()).submissions.length, 0, 'The response-loss fixture must start without submissions');
        await native('#title').fill(title);
        await native('#field-bankId select').selectOption(String((await data()).bankOptions.findIndex(bank => bank.id === 'cmb')));
        if (kind === 'full') {
          const issuer = native('#field-issuerIds input[type="checkbox"]').first();
          if (!(await issuer.isChecked())) await issuer.check();
          await native('#cardDescription').fill('Eligible credit cards from the selected issuer.');
          await native('#conditions').fill('Complete one qualifying purchase.');
          await native('.next-section[data-section="rules"]').click();
          await native('#field-endsOn input').fill((await data()).today); await native('#field-endsOn input').press('Tab');
          await native('#targetText').fill('1'); await native('#rewardText').fill('10');
          await native('.next-section[data-section="entrance"]').click();
          await native('#instructions').fill('Bank app > credit cards > current offers.');
          await native('.next-section[data-section="source"]').click();
        }
        await native('#sourceNote').fill('Bank app > credit cards > offers; official details need moderator review.');
        await page.evaluate(({ action, payloadField, title }) => {
          const api = window.Prototype.api;
          const state = window.__reviewSubmissionLoss = { api, command: api.command, setStorage: wx.setStorageSync, commands: [], committed: null };
          api.command = async function (...args) {
            if (args[0] !== action) return state.command.apply(this, args);
            const call = { action: args[0], payload: JSON.parse(JSON.stringify(args[1])), options: args[2] ? JSON.parse(JSON.stringify(args[2])) : null };
            state.commands.push(call);
            try { const result = await state.command.apply(this, args); call.result = JSON.parse(JSON.stringify(result)); return result; }
            catch (error) { call.error = { code: error.code, message: error.message }; throw error; }
          };
          wx.setStorageSync = function (...args) {
            const result = state.setStorage.apply(this, args);
            if (args[0] !== 'card-benefits.native.demo.v1' || state.committed) return result;
            const seed = args[1]?.seed;
            const submission = Object.values(seed?.submissions || {}).find(item => item[payloadField]?.title === title);
            if (!submission) return result;
            const request = Object.values(seed.requests || {}).find(item => {
              try { const fingerprint = JSON.parse(item.fingerprint); return item.result?.id === submission.id && fingerprint.action === action && !fingerprint.payload.id; }
              catch { return false; }
            });
            if (!request) return result;
            state.committed = { submissionId: submission.id, requestId: request.requestId };
            throw Object.assign(new Error('The submission was persisted but its response was lost.'), { code: 'NETWORK_ERROR' });
          };
        }, { action, payloadField, title });
        await submit().click();
        await waitUntil(async () => (await state()).committed && !(await data()).saving, 'The declared fault did not follow a persisted submission');
        assert.equal((await data()).pendingCreationUnconfirmed, true);
        const first = (await state()).commands[0];
        const id = (await state()).committed.submissionId;
        assert.deepEqual(first.options, { intentKey: originalIntent });
        assert.equal(first.error.code, 'NETWORK_ERROR');
        assert.equal((await state()).commands.length, 1);
        const pending = (await readDraft('new')).value.pendingCreation;
        assert.equal(pending.intentKey, originalIntent);
        assert.deepEqual(pending[payloadField], first.payload[payloadField]);
        const committed = await evidence();
        assert.equal(committed.submissions.length, 1); assert.equal(committed.requests.length, 1);
        assert.equal(committed.submissions[0].id, id); assert.equal(committed.submissions[0].ownerId, ownerId);
        assert.equal(committed.submissions[0].status, 'pending'); assert.equal(committed.submissions[0].version, 1);
        if (kind === 'full') await native('.section-heading[data-section="basic"]').click();
        const lockedTitle = (await data())[payloadField].title;
        assert.equal(await native('#title').isDisabled(), true);
        assert.equal(await native('#field-bankId select').isDisabled(), true);
        await native('#title').scrollIntoViewIfNeeded();
        const titleBounds = await native('#title').boundingBox();
        await page.mouse.click(titleBounds.x + titleBounds.width / 2, titleBounds.y + titleBounds.height / 2);
        await page.keyboard.type('Rejected title edit');
        assert.equal((await data())[payloadField].title, lockedTitle, 'Typing into a pending title changed the creation payload');
        if (kind === 'lead') {
          assert.equal(await native('#sourceNote').isDisabled(), true);
          assert.equal(await native('.full-form-link').isDisabled(), true, 'A pending lead could branch into a second full creation');
          assert.equal(await native('.upload-button').isDisabled(), true);
        } else {
          for (const section of ['rules', 'entrance', 'source']) {
            await native(`.section-heading[data-section="${section}"]`).click();
            assert.ok(await native('.section-body input, .section-body textarea, .section-body select').evaluateAll(elements => elements.length > 0 && elements.every(element => element.disabled)),
              `Pending ${section} controls still allow request changes`);
          }
        }
        assert.deepEqual((await readDraft('new')).value.pendingCreation, pending, 'Read-only inspection changed the saved pending payload');
        assert.equal(await page.evaluate(() => window.Prototype.current.creationIntentKey), originalIntent);
        await capture(`review2-${kind}-pending-input-locked`);
        await page.locator('#native-back').click();
        await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click(); await waitRoute('submissions');
        const legacyTitle = title + ' retained legacy edit';
        const legacyConditions = 'A retained local edit from the previous client version.';
        let recoveredPending = pending;
        if (kind === 'full') {
          // Declare an older-version local draft whose visible edits differ from its pending request.
          await page.evaluate(({ key, title, conditions }) => {
            const draft = wx.getStorageSync(key);
            draft.value.draft.title = title; draft.value.draft.conditions = conditions;
            draft.value.openSection = 'basic'; draft.value.draftEdited = true;
            delete draft.value.pendingCreation.inputSnapshot;
            wx.setStorageSync(key, draft);
          }, { key: draftKey('new'), title: legacyTitle, conditions: legacyConditions });
          recoveredPending = JSON.parse(JSON.stringify(pending));
          delete recoveredPending.inputSnapshot;
        }
        await openPage(`pages/${routeName}/index`);
        assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0, 'An unresolved creation offered an ordinary discard dialog');
        assert.equal((await data()).pendingCreationUnconfirmed, true);
        assert.equal(await native('#title').isDisabled(), true);
        assert.equal((await data())[payloadField].title, kind === 'full' ? legacyTitle : title);
        assert.deepEqual(await page.evaluate(() => window.Prototype.current.pendingCreation), recoveredPending);
        assert.equal(await page.evaluate(() => window.Prototype.current.creationIntentKey), originalIntent);
        await submit().click();
        await waitUntil(async () => (await state()).commands.length === 2 && !(await data()).saving, 'The exact pending request did not finish its retry');
        const replay = (await state()).commands[1];
        assert.deepEqual(replay.payload, first.payload); assert.deepEqual(replay.options, first.options);
        assert.equal(replay.result.id, id); assert.equal(replay.error, undefined);
        assert.deepEqual(await evidence(), committed, 'Retrying the unknown result duplicated or modified its record, request, or audit event');
        assert.equal(await readDraft('new'), null);
        if (kind === 'lead') {
          await waitRoute('submissions');
          assert.equal((await data()).items.filter(item => item.id === id).length, 1);
        } else {
          await waitRoute('submission-edit');
          assert.equal((await data()).submissionId, id); assert.equal((await data()).ownerId, ownerId);
          assert.equal((await data()).pendingCreationUnconfirmed, false); assert.equal((await data()).dirty, true);
          assert.equal((await data()).draft.title, legacyTitle); assert.equal(await native('#title').isEnabled(), true);
          assert.equal((await data()).draft.conditions, legacyConditions);
          assert.equal((await readDraft(id)).value.draft.title, legacyTitle, 'Resolving the request lost the legacy edited copy');
          assert.equal((await readDraft(id)).value.draft.conditions, legacyConditions);
          await submit().click(); await waitRoute('submissions');
          const update = (await state()).commands[2];
          assert.equal(update.payload.id, id); assert.equal(update.payload.expectedVersion, 1); assert.equal(update.options, null);
          assert.equal(update.payload.draft.title, legacyTitle);
          assert.equal(update.payload.draft.conditions, legacyConditions);
          const updated = await evidence();
          assert.equal(updated.submissions.length, 1); assert.equal(updated.submissions[0].id, id);
          assert.equal(updated.submissions[0].ownerId, ownerId); assert.equal(updated.submissions[0].version, 2);
          assert.equal(updated.submissions[0].draft.title, legacyTitle); assert.equal(updated.submissions[0].draft.conditions, legacyConditions);
          assert.equal(await readDraft(id), null);
          await native(`.submission-row[data-id="${id}"]`).click(); await waitRoute('submission-edit');
          await native('#title').fill(legacyTitle + ' existing draft');
          const savedEdit = (await readDraft(id)).value;
          await page.locator('#native-back').click(); await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click(); await waitRoute('submissions');
          await native(`.submission-row[data-id="${id}"]`).click();
          await page.locator('#platform-layer button').filter({ hasText: '恢复草稿' }).click(); await waitRoute('submission-edit');
          assert.equal((await data()).submissionId, id); assert.equal((await data()).submission.version, 2);
          assert.equal((await data()).draft.title, savedEdit.draft.title); assert.deepEqual((await readDraft(id)).value, savedEdit);
          assert.equal((await evidence()).submissions.length, 1, 'Restoring an existing edit created another submission');
        }
        await capture(`review2-${kind}-one-original-submission`);
      });
    } finally {
      page = previousPage;
      await context?.close();
    }
  }
}

async function runReviewTwoContextRegressions() {
  const expectRoute = async name => {
    await waitUntil(async () => page.evaluate(name =>
      window.Prototype.current?.route === `pages/${name}/index`, name),
    `The context regression did not reach ${name}`);
    await settled();
  };
  const query = (action, payload = {}) => page.evaluate(({ action, payload }) =>
    window.Prototype.api.query(action, payload), { action, payload });
  const installCommandTrace = async () => {
    await page.evaluate(() => {
      const api = window.Prototype.api;
      const command = api.command;
      window.__reviewTwoContextCommands = [];
      api.command = async function (action, payload, ...options) {
        const entry = { action, payload: JSON.parse(JSON.stringify(payload)) };
        window.__reviewTwoContextCommands.push(entry);
        const result = await command.call(this, action, payload, ...options);
        entry.result = JSON.parse(JSON.stringify(result));
        return result;
      };
    });
  };
  const commands = () => page.evaluate(() => window.__reviewTwoContextCommands);
  const isolatedCheck = async (name, clock, action) => {
    const previousPage = page;
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    try {
      await context.addInitScript(clock => {
        const NativeDate = window.Date;
        window.__reviewTwoContextClock = { NativeDate, now: NativeDate.parse(clock) };
        window.Date = new Proxy(NativeDate, {
          construct(target, args) {
            return Reflect.construct(target, args.length ? args : [window.__reviewTwoContextClock.now]);
          },
          apply() { return new NativeDate(window.__reviewTwoContextClock.now).toString(); },
          get(target, property, receiver) {
            return property === 'now' ? () => window.__reviewTwoContextClock.now : Reflect.get(target, property, receiver);
          },
        });
      }, clock);
      page = await context.newPage();
      page.setDefaultTimeout(12000);
      attachDiagnostics(page);
      const runtimeErrors = [];
      page.on('pageerror', error => runtimeErrors.push(error.message));
      await check(name, async () => {
        await page.goto(baseUrl, { waitUntil: 'load' });
        await page.waitForFunction(() => window.Prototype?.ready && window.Prototype.current?.data);
        await settled();
        await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption,.flow-overview{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{max-width:none!important;min-height:0!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
        await resize(sizes.find(size => size.width === 320) || { width: 320, height: 720 });
        await reset();
        await action();
        assert.deepEqual(runtimeErrors, [], 'The context regression raised a browser exception');
      });
    } finally {
      try { await context.close(); } finally { page = previousPage; }
    }
  };

  await isolatedCheck('Review two Todo More identifies cross-year participation periods and completes only the selected historical record',
    '2026-12-30T04:00:00.000Z', async () => {
      await page.evaluate(() => window.Prototype.scenarios.review());
      await expectRoute('review');
      const fixture = await page.evaluate(async () => {
        const api = window.Prototype.api;
        const session = await api.query('session.get', {});
        const { activity } = await api.query('activity.get', { activityId: 'monthly' });
        const { id, revision, status, publishedAt, updatedAt, publishedBy, ...base } = activity;
        const draft = { ...base, title: 'Review Two Cross-Year Context', frequency: 'monthly',
          startsOn: '2026-12-01', endsOn: '2027-12-31', scope: 'user', target: 3,
          requiresRegistration: false, requiresInvitation: false,
          conditions: 'Browser acceptance fixture for independent participation periods.', sourceUrl: '',
          sourceNote: 'Demo source for cross-year context acceptance.',
          entrance: { kind: 'guide', label: 'Participation guide', instructions: 'Bank app > Offers.', imageIds: [] } };
        const submission = await api.command('submission.save', { draft });
        const published = await api.command('submission.review', { id: submission.id,
          expectedVersion: submission.version, decision: 'publish', sourceVerified: true, draft });
        const joined = await api.command('activity.join', { activityId: published.id });
        const detail = await api.query('activity.get', { participationId: joined.id });
        return { activityId: published.id, oldId: joined.id, ownerId: session.userId,
          title: draft.title, oldRecord: detail.participation, published: detail.activity.status };
      });
      assert.equal(fixture.published, 'published');
      assert.equal(fixture.oldRecord.ownerId, fixture.ownerId);
      assert.equal(fixture.oldRecord.periodKey, '2026-12');
      assert.equal(fixture.oldRecord.endsOn, '2026-12-31');
      await page.evaluate(() => window.Prototype.scenarios.submit());
      await expectRoute('submission-lead');
      await page.evaluate(() => {
        window.__reviewTwoContextClock.now = window.__reviewTwoContextClock.NativeDate.parse('2027-01-05T04:00:00.000Z');
      });
      await openPage('pages/todo/index');
      const session = await query('session.get');
      assert.equal(session.today, '2027-01-05');
      assert.equal(session.isModerator, false, 'Interactive acceptance must run as the ordinary demo owner');
      const before = await data();
      const records = before.raw.tasks.filter(record => record.activityId === fixture.activityId)
        .sort((left, right) => left.periodKey.localeCompare(right.periodKey));
      assert.equal(records.length, 2, 'The real period materialization must retain December and create January');
      assert.deepEqual(records.map(record => record.periodKey), ['2026-12', '2027-01']);
      assert.ok(records.every(record => record.ownerId === fixture.ownerId));
      const [oldRecord, currentRecord] = records;
      assert.equal(oldRecord.id, fixture.oldId);
      assert.notEqual(currentRecord.id, oldRecord.id);
      assert.equal(currentRecord.endsOn, '2027-01-31');
      const oldRow = () => native(`.task-row[data-id="${oldRecord.id}"]`);
      assert.equal(await oldRow().locator('.task-period').textContent(), '参与期 · 2026年12月');
      assert.equal(await oldRow().locator('.date-column').getAttribute('aria-label'), '2026-12-31截止');

      const showContext = async record => {
        const period = record.periodKey === '2026-12' ? '2026年12月' : '2027年1月';
        const more = native(`.more-button[data-id="${record.id}"]`);
        assert.ok((await more.getAttribute('aria-label')).includes(period), 'The More control omits its participation year');
        await more.click();
        await waitUntil(async () => (await data()).showActions, 'The source More action did not open');
        const state = await data();
        assert.equal(state.actionId, record.id);
        assert.equal(state.actionTitle, fixture.title);
        assert.equal(state.actionPeriod, period);
        assert.equal(state.actionDeadline, record.endsOn);
        const sheet = native('[data-sheet-dialog="todo-actions"]');
        assert.equal(await sheet.locator('.action-period').textContent(), `参与期 · ${period}`);
        assert.equal(await sheet.locator('.action-deadline').textContent(), `截止 ${record.endsOn}`);
        assert.equal(await sheet.locator('.action-context').isVisible(), true);
        assert.equal(await sheet.locator('button[data-handler="openTask"]').getAttribute('data-id'), record.id);
        const contextBox = await sheet.locator('.action-context').boundingBox();
        const firstActionBox = await sheet.locator('.task-more-progress').boundingBox();
        assert.ok(contextBox && firstActionBox && contextBox.y + contextBox.height <= firstActionBox.y + 1,
          'The period and deadline must precede the record mutation controls');
        await capture(`review2-todo-more-${record.periodKey}`, { participationId: record.id,
          ownerId: record.ownerId, periodKey: record.periodKey, endsOn: record.endsOn });
      };
      await showContext(currentRecord);
      await native('[data-sheet-dialog="todo-actions"] .sheet-close').click();
      await waitUntil(async () => !(await data()).showActions, 'Closing More did not dismiss its context');
      await showContext(oldRecord);
      await installCommandTrace();
      await native('[data-sheet-dialog="todo-actions"] .task-more-complete').click();
      await settled();
      const calls = await commands();
      assert.equal(calls.length, 1, 'One historical completion must send one business command');
      assert.equal(calls[0].action, 'participation.complete');
      assert.deepEqual(calls[0].payload, { participationId: oldRecord.id });
      assert.equal(calls[0].result.id, oldRecord.id);
      const stored = await page.evaluate(activityId => {
        const seed = window.wx.getStorageSync('card-benefits.native.demo.v1').seed;
        return Object.values(seed.participations).filter(record => record.activityId === activityId)
          .sort((left, right) => left.periodKey.localeCompare(right.periodKey));
      }, fixture.activityId);
      assert.equal(stored.length, 2, 'Completing a selected period must not duplicate or delete participation records');
      assert.equal(stored[0].id, oldRecord.id);
      assert.equal(stored[0].ownerId, fixture.ownerId);
      assert.equal(stored[0].periodKey, oldRecord.periodKey);
      assert.equal(stored[0].startsOn, oldRecord.startsOn);
      assert.equal(stored[0].endsOn, oldRecord.endsOn);
      assert.deepEqual(stored[0].snapshot, oldRecord.snapshot, 'Completing an old period changed its rule snapshot');
      assert.equal(stored[0].stage, 'completed');
      assert.equal(stored[0].version, oldRecord.version + 1);
      assert.deepEqual(stored[1], currentRecord, 'The old-period More action changed the current participation');
      const after = await data();
      assert.equal(after.unfinishedCount, before.unfinishedCount - 1);
      assert.equal(after.allCount, before.allCount - 1);
      assert.equal(after.completedCount, before.completedCount,
        'Historical completion must not enter the current-period completion count');
      assert.equal(after.pendingCount, before.pendingCount + 1);
      assert.equal(after.raw.tasks.some(record => record.id === oldRecord.id), false);
      assert.equal(after.raw.tasks.filter(record => record.activityId === fixture.activityId).length, 1);
      assert.equal(after.raw.tasks.find(record => record.activityId === fixture.activityId).id, currentRecord.id);
      await capture('review2-todo-historical-completion-keeps-current-period', { commands: calls,
        beforeCounts: { unfinished: before.unfinishedCount, all: before.allCount, completed: before.completedCount, pending: before.pendingCount },
        afterCounts: { unfinished: after.unfinishedCount, all: after.allCount, completed: after.completedCount, pending: after.pendingCount } });
    });

  await isolatedCheck('Review two archived wallet accounts retain distinct identities and edit only the selected bill',
    '2026-09-24T04:00:00.000Z', async () => {
      await openPage('pages/wallet/index');
      const baseline = await query('wallet.get');
      const baselineCount = (await data()).cardCount;
      const fixture = await page.evaluate(async () => {
        const api = window.Prototype.api;
        const session = await api.query('session.get', {});
        const entries = [];
        for (const suffix of ['A', 'B']) {
          const nickname = `Review Two Archive ${suffix}`;
          const created = await api.command('card.save', { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa',
            kind: 'credit', nickname, billing: { statementDay: 1, dueDay: 28, dueMonthOffset: 0,
              dueOn: `${session.month}-28`, remindDays: 3 } });
          const wallet = await api.query('wallet.get', {});
          const card = wallet.cards.find(item => item.id === created.id);
          const account = wallet.accounts.find(item => item.id === card.billingAccountId);
          const bill = wallet.bills.find(item => item.billingAccountId === account.id && item.periodKey === session.month);
          entries.push({ nickname, card, account, bill });
        }
        return { entries, ownerId: session.userId, month: session.month };
      });
      const [accountA, accountB] = fixture.entries;
      assert.notEqual(accountA.card.id, accountB.card.id);
      assert.notEqual(accountA.account.id, accountB.account.id);
      assert.notEqual(accountA.bill.id, accountB.bill.id);
      for (const entry of fixture.entries) {
        assert.equal(entry.card.ownerId, fixture.ownerId);
        assert.equal(entry.account.ownerId, fixture.ownerId);
        assert.equal(entry.bill.ownerId, fixture.ownerId);
        assert.equal(entry.account.label, entry.nickname);
        assert.equal(entry.bill.billingAccountId, entry.account.id);
        assert.equal(entry.bill.periodKey, fixture.month);
        assert.equal(entry.bill.paidAt, null);
      }
      await openPage('pages/wallet/index');
      assert.equal((await data()).cardCount, baselineCount + 2);
      assert.equal((await data()).raw.bills.length, baseline.bills.length + 2);
      await installCommandTrace();
      const renderedGroup = id => native(`.account-group:has(.account-settings[data-id="${id}"])`);
      const reveal = async id => {
        const settings = native(`.account-settings[data-id="${id}"]`);
        if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
      };
      for (const [index, entry] of fixture.entries.entries()) {
        await reveal(entry.account.id);
        await renderedGroup(entry.account.id).locator(`.account-edit[data-id="${entry.card.id}"]`).click();
        await expectRoute('card-edit');
        assert.equal((await data()).id, entry.card.id);
        await native('.remove-button').click();
        await page.locator('#platform-layer .platform-actions button').filter({ hasText: /^移除$/ }).click();
        await expectRoute('wallet');
        assert.equal((await data()).cardCount, baselineCount + 1 - index);
        assert.ok((await data()).raw.cards.find(card => card.id === entry.card.id).archivedAt);
        assert.equal((await data()).raw.accounts.find(account => account.id === entry.account.id).enabled, false);
      }
      const archived = await data();
      const groups = fixture.entries.map(entry => archived.groups.find(group => group.id === entry.account.id));
      assert.equal(groups[0].title, groups[1].title, 'The fixture must require identity beyond the common issuer title');
      assert.notEqual(groups[0].identity, groups[1].identity, 'Archived A and B must remain visibly distinguishable');
      for (const [index, entry] of fixture.entries.entries()) {
        const group = groups[index];
        assert.equal(group.archived, true);
        assert.equal(group.cards.length, 0);
        assert.equal(group.reminderAvailable, false);
        assert.equal(group.primaryBill.id, entry.bill.id);
        assert.ok(group.identity.includes(entry.account.label), 'Archiving discarded the remembered account label');
        assert.equal(await renderedGroup(entry.account.id).locator('.account-identity').textContent(), group.identity);
        assert.equal(await renderedGroup(entry.account.id).locator('.account-identity').isVisible(), true);
        assert.equal(await renderedGroup(entry.account.id).locator('.reminder-button').count(), 0);
      }
      await renderedGroup(accountB.account.id).scrollIntoViewIfNeeded();
      await capture('review2-wallet-archived-identities', { accounts: fixture.entries.map((entry, index) =>
        ({ accountId: entry.account.id, cardId: entry.card.id, billId: entry.bill.id, identity: groups[index].identity })) });

      const beforeUpdates = await query('wallet.get');
      const revisedDate = `${fixture.month}-29`;
      await reveal(accountB.account.id);
      await renderedGroup(accountB.account.id)
        .locator(`.bill-meta-row [data-id="${accountB.bill.id}"] input[type="date"]`).fill(revisedDate);
      await settled();
      assert.equal((await data()).raw.bills.find(bill => bill.id === accountB.bill.id).dueOn, revisedDate);
      const paid = () => renderedGroup(accountB.account.id)
        .locator(`button[data-handler="togglePaid"][data-id="${accountB.bill.id}"]`);
      await paid().click();
      await settled();
      const marked = (await data()).raw.bills.find(bill => bill.id === accountB.bill.id);
      assert.ok(marked.paidAt, 'The selected archived bill did not persist its paid marker');
      assert.equal((await data()).groups.find(group => group.id === accountB.account.id).settledArchive, true);
      assert.deepEqual((await data()).raw.bills.find(bill => bill.id === accountA.bill.id), accountA.bill,
        'Marking B paid changed archived account A');
      await reveal(accountB.account.id);
      await paid().click();
      await settled();
      const finalWallet = await query('wallet.get');
      const finalBill = finalWallet.bills.find(bill => bill.id === accountB.bill.id);
      assert.deepEqual(finalBill, { ...accountB.bill, dueOn: revisedDate, paidAt: null });
      assert.equal(finalBill.ownerId, fixture.ownerId);
      assert.equal(finalBill.billingAccountId, accountB.account.id);
      assert.equal(finalBill.periodKey, fixture.month);
      const exceptB = wallet => wallet.bills.filter(bill => bill.id !== accountB.bill.id)
        .sort((left, right) => left.id.localeCompare(right.id));
      assert.deepEqual(exceptB(finalWallet), exceptB(beforeUpdates), 'Editing B changed another account or historical bill');
      assert.deepEqual(finalWallet.cards, beforeUpdates.cards);
      assert.deepEqual(finalWallet.accounts, beforeUpdates.accounts);
      assert.equal(finalWallet.cards.length, baseline.cards.length + 2);
      assert.equal(finalWallet.accounts.length, baseline.accounts.length + 2);
      assert.equal(finalWallet.bills.length, baseline.bills.length + 2);
      assert.equal((await data()).cardCount, baselineCount);
      const calls = await commands();
      assert.deepEqual(calls.map(call => ({ action: call.action, payload: call.payload })), [
        { action: 'card.remove', payload: { id: accountA.card.id } },
        { action: 'card.remove', payload: { id: accountB.card.id } },
        { action: 'bill.update', payload: { id: accountB.bill.id, dueOn: revisedDate } },
        { action: 'bill.update', payload: { id: accountB.bill.id, paid: true } },
        { action: 'bill.update', payload: { id: accountB.bill.id, paid: false } },
      ], 'The actual source controls dispatched to an unexpected card or bill');
      assert.ok(calls.filter(call => call.action === 'bill.update').every(call => call.result.id === accountB.bill.id));
      for (const [index, entry] of fixture.entries.entries()) {
        const group = (await data()).groups.find(item => item.id === entry.account.id);
        assert.equal(group.identity, groups[index].identity, 'A bill mutation changed the archived account identity');
        assert.equal(group.archived, true);
        assert.equal(group.reminderAvailable, false);
      }
      await renderedGroup(accountB.account.id).scrollIntoViewIfNeeded();
      await capture('review2-wallet-selected-archived-bill-restored', { commands: calls,
        accountA: accountA.bill, accountB: finalBill, activeCardCount: (await data()).cardCount });
    });
}

async function runFinalReminderBoundaryRegression() {
  const originalPage = page;
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, deviceScaleFactor: 1,
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
  });
  try {
    await context.addInitScript(() => {
      const NativeDate = window.Date;
      const now = NativeDate.parse('2026-09-24T04:00:00.000Z');
      window.Date = new Proxy(NativeDate, {
        construct(target, args) { return Reflect.construct(target, args.length ? args : [now]); },
        apply() { return new NativeDate(now).toString(); },
        get(target, property, receiver) {
          return property === 'now' ? () => now : Reflect.get(target, property, receiver);
        },
      });
    });
    page = await context.newPage();
    page.setDefaultTimeout(12000);
    attachDiagnostics(page);
    const runtimeErrors = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    await check('Expired deadline and repayment entries preserve record actions while past expected reward dates retain the real demo explanation', async () => {
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.waitForFunction(() => window.Prototype?.ready && window.Prototype.current?.data);
      await settled();
      await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption,.flow-overview{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{max-width:none!important;min-height:0!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
      await resize(sizes.find(size => size.width === 320) || { width: 320, height: 720 });
      await reset();
      const expectRoute = async name => {
        await waitUntil(async () => page.evaluate(name => window.Prototype.current?.route === `pages/${name}/index`, name),
          `The reminder boundary regression did not reach ${name}`);
        await settled();
      };
      const query = (action, payload = {}) => page.evaluate(({ action, payload }) =>
        window.Prototype.api.query(action, payload), { action, payload });
      const seed = () => page.evaluate(() => structuredClone(wx.getStorageSync('card-benefits.native.demo.v1').seed));
      const commands = () => page.evaluate(() => window.__finalReminderBoundaryTrace.commands);
      const fixture = await page.evaluate(async () => {
        const api = window.Prototype.api;
        const session = await api.query('session.get', {});
        const prior = (await api.query('activity.get', { participationId: 'demo-prior-pending' })).participation;
        const current = (await api.query('activity.get', { activityId: 'monthly' })).participation;
        const initialWallet = await api.query('wallet.get', {});
        const card = initialWallet.cards.find(item => item.id === 'demo-card-cmb');
        const account = initialWallet.accounts.find(item => item.id === card.billingAccountId);
        const bill = initialWallet.bills.find(item => item.billingAccountId === account.id && item.periodKey === session.month);
        const pastDate = '2026-09-23', futureDate = '2026-09-28';
        await api.command('participation.expected', { participationId: prior.id, expectedOn: pastDate });
        await api.command('bill.update', { id: bill.id, dueOn: pastDate });
        return { session, current, prior, card, account, pastDate, futureDate,
          reward: (await api.query('activity.get', { participationId: prior.id })).participation,
          wallet: await api.query('wallet.get', {}), billId: bill.id };
      });
      assert.equal(fixture.session.demo, true, 'This case must remain in the real demo branch');
      assert.equal(fixture.session.isModerator, false);
      assert.equal(fixture.session.today, '2026-09-24');
      assert.equal(fixture.prior.id, 'demo-prior-pending');
      assert.equal(fixture.prior.periodKey, '2026-08');
      assert.equal(fixture.prior.endsOn, '2026-08-31');
      assert.equal(fixture.reward.ownerId, fixture.session.userId);
      assert.equal(fixture.reward.stage, 'completed');
      assert.equal(fixture.reward.expectedOn, fixture.pastDate);
      assert.ok(fixture.reward.expectedOn < fixture.session.today);
      assert.equal(fixture.account.enabled, true);
      assert.equal(fixture.account.ownerId, fixture.session.userId);
      const overdueBill = fixture.wallet.bills.find(bill => bill.id === fixture.billId);
      assert.equal(overdueBill.ownerId, fixture.session.userId);
      assert.equal(overdueBill.billingAccountId, fixture.account.id);
      assert.equal(overdueBill.periodKey, fixture.session.month);
      assert.equal(overdueBill.dueOn, fixture.pastDate);
      assert.equal(overdueBill.paidAt, null);
      const baseline = await seed();
      await page.evaluate(() => {
        const api = window.Prototype.api;
        const trace = window.__finalReminderBoundaryTrace = { api, originalCommand: api.command, commands: [] };
        api.command = async function (action, payload, ...options) {
          const entry = { action, payload: structuredClone(payload) };
          trace.commands.push(entry);
          const result = await trace.originalCommand.call(this, action, payload, ...options);
          entry.result = structuredClone(result);
          return result;
        };
      });

      const explainDemoReminder = async (locator, screenshot, metadata) => {
        const before = await seed(), callsBefore = (await commands()).length;
        assert.equal(await locator.isEnabled(), true);
        await locator.click();
        await page.locator('#platform-layer h2').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#platform-layer h2').textContent(), '演示提醒');
        const text = await page.locator('#platform-layer').innerText();
        assert.ok(text.includes('演示模式不发送微信消息'));
        assert.ok(text.includes('配置正式模板'));
        await capture(screenshot, { ...metadata,
          evidenceScope: 'Real browser demo explanation only; no native consent, cloud grant, or message delivery is claimed.' });
        await page.locator('#platform-layer button').filter({ hasText: '知道了' }).click();
        await settled();
        assert.equal((await commands()).length, callsBefore, 'A demo reminder explanation dispatched a business mutation');
        assert.deepEqual(await seed(), before, 'A demo reminder explanation changed persistent data');
      };

      await openPage(`pages/detail/index?participationId=${encodeURIComponent(fixture.reward.id)}`);
      assert.equal((await data()).detail.participation.id, fixture.reward.id);
      assert.equal((await data()).view.isPast, true);
      assert.equal(await native('.deadline-reminder-expired').count(), 0,
        'An overdue expected reward date was incorrectly treated as an expired deadline');
      const rewardReminder = native('.reminder-link').filter({ hasText: '开启预计到账提醒' });
      assert.equal(await rewardReminder.count(), 1);
      await explainDemoReminder(rewardReminder, 'final-reminder-past-reward-demo-explanation', {
        participationId: fixture.reward.id, ownerId: fixture.session.userId, expectedOn: fixture.pastDate,
      });
      assert.equal((await data()).reminderReady, false);

      await page.evaluate(id => window.Prototype.api.command('participation.undoComplete', { participationId: id }), fixture.reward.id);
      await openPage(`pages/detail/index?participationId=${encodeURIComponent(fixture.reward.id)}`);
      const undone = (await data()).detail.participation;
      assert.equal(undone.id, fixture.reward.id);
      assert.equal(undone.ownerId, fixture.session.userId);
      assert.equal(undone.stage, 'in_progress');
      assert.equal(undone.version, fixture.reward.version + 1);
      assert.equal(undone.expectedOn, null);
      assert.equal(undone.completedAt, null);
      assert.equal(undone.endsOn, fixture.prior.endsOn);
      assert.deepEqual(undone.snapshot, fixture.prior.snapshot);
      assert.equal((await data()).view.deadlineReminderExpired, true);
      assert.equal(await native('.reminder-link').count(), 0, 'An expired unfinished period retained an authorization CTA');
      const deadlineNotice = native('.deadline-reminder-expired');
      assert.equal(await deadlineNotice.isVisible(), true);
      assert.ok((await deadlineNotice.textContent()).includes('可补填本期进度和结果'));
      assert.equal(await native('.progress-heading button[data-handler="editProgress"]').isEnabled(), true);
      await deadlineNotice.scrollIntoViewIfNeeded();
      await capture('final-reminder-expired-deadline-preserves-actions', {
        participationId: undone.id, ownerId: undone.ownerId, periodKey: undone.periodKey, endsOn: undone.endsOn,
      });

      await openPage('pages/todo/index');
      const todo = await data();
      const task = todo.tasks.find(item => item.id === undone.id);
      assert.ok(task, 'The expired unfinished record disappeared from Todo');
      assert.equal(task.groupKey, 'overdue');
      assert.equal(task.deadline, undone.endsOn);
      assert.equal(todo.raw.tasks.find(item => item.id === undone.id).ownerId, fixture.session.userId);
      assert.equal(todo.nearestBill, '9/23');
      const oldRow = native(`.task-row[data-id="${undone.id}"]`);
      await oldRow.locator('.more-button').click();
      await waitUntil(async () => (await data()).showActions, 'The expired period More sheet did not open');
      assert.equal((await data()).actionId, undone.id);
      assert.equal((await data()).actionDeadline, undone.endsOn);
      const todoSheet = native('[data-sheet-dialog="todo-actions"]');
      assert.equal(await todoSheet.locator('.task-more-progress').isEnabled(), true);
      assert.equal(await todoSheet.locator('.task-more-receipt').isEnabled(), true);
      await capture('final-reminder-expired-todo-record-actions', { participationId: undone.id, deadline: undone.endsOn });
      await todoSheet.locator('button[data-handler="openTask"]').click();
      await expectRoute('detail');
      assert.equal((await data()).detail.participation.id, undone.id);
      await native('.progress-heading button[data-handler="editProgress"]').click();
      await expectRoute('progress');
      assert.equal((await data()).participationId, undone.id);
      assert.equal((await data()).ownerId, fixture.session.userId);
      assert.equal((await data()).editable, true);
      await native('#progress').fill('2');
      await native('.entry-primary[data-handler="save"]').click();
      await expectRoute('detail');
      const progressed = (await data()).detail.participation;
      assert.equal(progressed.id, undone.id);
      assert.equal(progressed.ownerId, fixture.session.userId);
      assert.equal(progressed.progress, 2);
      assert.equal(progressed.version, undone.version + 1);
      assert.equal(progressed.endsOn, undone.endsOn);
      assert.equal(await native('.reminder-link').count(), 0);
      await native('.detail-more').click();
      await waitUntil(async () => (await data()).showManage, 'The expired record More sheet did not open');
      await native('[data-sheet-dialog="detail-manage"] button[data-handler="receipt"]').click();
      await expectRoute('receipt');
      assert.equal((await data()).participation.id, undone.id);
      assert.equal((await data()).ownerId, fixture.session.userId);
      assert.equal((await data()).allowed, true);
      assert.equal((await data()).minDate, undone.startsOn);
      assert.equal((await data()).maxDate, fixture.session.today);
      await native('#amount').fill('17.50');
      await native('input[type="date"]').fill(fixture.pastDate);
      await native('.entry-primary[data-handler="save"]').click();
      await expectRoute('detail');
      const received = (await data()).detail.participation;
      assert.equal(received.id, undone.id);
      assert.equal(received.ownerId, fixture.session.userId);
      assert.equal(received.stage, 'received');
      assert.equal(received.receivedOn, fixture.pastDate);
      assert.equal(received.receivedMinor, 1750);
      assert.equal(received.version, progressed.version + 1);
      assert.equal(received.periodKey, undone.periodKey);
      assert.equal(received.startsOn, undone.startsOn);
      assert.equal(received.endsOn, undone.endsOn);
      assert.deepEqual(received.snapshot, undone.snapshot);
      const afterReceipt = await seed();
      assert.equal(Object.keys(afterReceipt.participations).length, Object.keys(baseline.participations).length);
      assert.deepEqual(afterReceipt.participations[fixture.current.id], fixture.current,
        'Updating the expired period changed the current monthly participation');
      const newRewards = Object.values(afterReceipt.rewards || {}).filter(item => item.participationId === undone.id && !item.reversedAt);
      assert.equal(newRewards.length, 1, 'Recording an expired period created duplicate rewards');
      assert.equal(newRewards[0].ownerId, fixture.session.userId);
      assert.equal(newRewards[0].activityPeriod, undone.periodKey);
      assert.equal(newRewards[0].receivedOn, fixture.pastDate);
      assert.equal(newRewards[0].amountMinor, 1750);
      assert.equal(Object.keys(afterReceipt.rewards || {}).length, Object.keys(baseline.rewards || {}).length + 1);

      await openPage('pages/todo/index');
      assert.equal((await data()).raw.tasks.some(item => item.id === undone.id), false);
      await native('.follow-up[data-handler="openWallet"]').click();
      await expectRoute('wallet');
      assert.equal((await data()).serverToday, fixture.session.today);
      const group = () => native(`.account-group:has(.account-settings[data-id="${fixture.account.id}"])`);
      const billState = () => data().then(state => state.raw.bills.find(item => item.id === fixture.billId));
      const paidButton = () => group().locator(`button[data-handler="togglePaid"][data-id="${fixture.billId}"]`);
      const reminderButton = () => group().locator(`.reminder-button[data-id="${fixture.billId}"]`);
      const initialGroup = (await data()).groups.find(item => item.id === fixture.account.id);
      assert.equal(initialGroup.primaryBill.id, fixture.billId);
      assert.equal(initialGroup.primaryBill.reminderExpired, true);
      assert.equal(initialGroup.reminderAvailable, true);
      assert.equal(await reminderButton().count(), 0);
      assert.equal(await group().locator('.bill-reminder-expired').isVisible(), true);
      assert.ok((await group().locator('.bill-reminder-expired').textContent()).includes('仍可标记还款和修改日期'));
      assert.equal(await paidButton().isEnabled(), true);
      await group().scrollIntoViewIfNeeded();
      await capture('final-reminder-expired-repayment-preserves-actions', {
        billId: fixture.billId, ownerId: fixture.session.userId, dueOn: overdueBill.dueOn,
      });
      await paidButton().click();
      await settled();
      assert.ok((await billState()).paidAt, 'An overdue bill could not be marked paid');
      assert.equal((await billState()).id, fixture.billId);
      assert.equal((await billState()).ownerId, fixture.session.userId);
      await paidButton().click();
      await settled();
      assert.deepEqual(await billState(), overdueBill, 'Undoing payment changed the overdue bill identity or date');
      assert.equal(await reminderButton().count(), 0);
      await group().locator('.account-settings').click();
      const dateInput = group().locator(`.bill-meta-row [data-id="${fixture.billId}"] input[type="date"]`);
      assert.equal(await dateInput.isEnabled(), true);
      await dateInput.fill(fixture.futureDate);
      await settled();
      assert.deepEqual(await billState(), { ...overdueBill, dueOn: fixture.futureDate });
      const futureGroup = (await data()).groups.find(item => item.id === fixture.account.id);
      assert.equal(futureGroup.primaryBill.id, fixture.billId);
      assert.equal(futureGroup.primaryBill.reminderExpired, false);
      assert.equal(await group().locator('.bill-reminder-expired').count(), 0);
      assert.equal(await reminderButton().count(), 1);
      await explainDemoReminder(reminderButton(), 'final-reminder-repayment-future-date-demo-explanation', {
        billId: fixture.billId, ownerId: fixture.session.userId, dueOn: fixture.futureDate,
      });
      assert.equal((await data()).reminderNoticeId, '', 'The demo explanation claimed successful real authorization');
      await paidButton().click();
      await settled();
      const finalWallet = await query('wallet.get');
      const finalBill = finalWallet.bills.find(item => item.id === fixture.billId);
      assert.ok(finalBill.paidAt);
      assert.deepEqual(finalBill, { ...overdueBill, dueOn: fixture.futureDate, paidAt: finalBill.paidAt });
      assert.equal(finalBill.ownerId, fixture.session.userId);
      assert.equal(finalBill.billingAccountId, fixture.account.id);
      assert.equal(finalBill.periodKey, fixture.session.month);
      assert.equal(finalWallet.bills.length, fixture.wallet.bills.length);
      const otherBills = wallet => wallet.bills.filter(item => item.id !== fixture.billId)
        .sort((left, right) => left.id.localeCompare(right.id));
      assert.deepEqual(otherBills(finalWallet), otherBills(fixture.wallet));
      assert.deepEqual(finalWallet.cards, fixture.wallet.cards);
      assert.deepEqual(finalWallet.accounts, fixture.wallet.accounts);
      assert.equal(await reminderButton().count(), 0, 'A paid bill retained an authorization CTA');
      const calls = await commands();
      assert.deepEqual(calls.map(call => ({ action: call.action, payload: call.payload })), [
        { action: 'participation.undoComplete', payload: { participationId: undone.id } },
        { action: 'participation.progress', payload: { participationId: undone.id, progress: 2,
          registered: Boolean(undone.registeredAt), expectedVersion: undone.version } },
        { action: 'reward.confirm', payload: { participationId: undone.id, amountMinor: 1750,
          receivedOn: fixture.pastDate, expectedVersion: progressed.version } },
        { action: 'bill.update', payload: { id: fixture.billId, paid: true } },
        { action: 'bill.update', payload: { id: fixture.billId, paid: false } },
        { action: 'bill.update', payload: { id: fixture.billId, dueOn: fixture.futureDate } },
        { action: 'bill.update', payload: { id: fixture.billId, paid: true } },
      ], 'The visible record controls dispatched to an unexpected record or bill');
      assert.ok(calls.filter(call => call.action === 'bill.update').every(call => call.result.id === fixture.billId));
      assert.equal(calls.some(call => call.action === 'reminder.authorize' || call.action === 'preferences.save'), false);
      const finalSeed = await seed();
      assert.equal(Object.keys(finalSeed.participations).length, Object.keys(baseline.participations).length);
      assert.equal(Object.keys(finalSeed.rewards || {}).length, Object.keys(baseline.rewards || {}).length + 1);
      assert.deepEqual(finalSeed.participations[fixture.current.id], fixture.current);
      await capture('final-reminder-record-and-bill-identity-preserved', {
        commands: calls, participation: received, bill: finalBill,
        participationCount: Object.keys(finalSeed.participations).length, billCount: finalWallet.bills.length,
      });
      assert.deepEqual(runtimeErrors, [], 'The reminder boundary regression raised a browser exception');
    });
  } finally {
    try { await context.close(); } finally { page = originalPage; }
  }
}

async function runFinalAccessibilityRegression() {
  const previousPage = page;
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1,
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
  try {
    await context.addInitScript(() => {
      const NativeDate = window.Date;
      window.__finalA11yClock = { NativeDate, now: NativeDate.parse('2026-08-24T04:00:00.000Z') };
      window.Date = new Proxy(NativeDate, {
        construct(target, args) { return Reflect.construct(target, args.length ? args : [window.__finalA11yClock.now]); },
        apply() { return new NativeDate(window.__finalA11yClock.now).toString(); },
        get(target, property, receiver) {
          return property === 'now' ? () => window.__finalA11yClock.now : Reflect.get(target, property, receiver);
        },
      });
    });
    page = await context.newPage();
    page.setDefaultTimeout(12000);
    attachDiagnostics(page);
    const runtimeErrors = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    await check('Final accessibility names distinguish thirteen picker fields, same-name archived bills, and same-title bank histories', async () => {
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.waitForFunction(() => window.Prototype?.ready && window.Prototype.current?.data);
      await settled();
      await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption,.flow-overview{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{max-width:none!important;min-height:0!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
      await resize(sizes.find(size => size.width === 320) || { width: 320, height: 720 });
      const covered = new Set();
      const evidence = { controls: [], history: [], bills: [] };
      const atRoute = name => page.evaluate(name => window.Prototype.current?.route === `pages/${name}/index`, name);
      const expectRoute = async name => {
        await waitUntil(() => atRoute(name), `The accessibility flow did not reach ${name}`);
        await settled();
      };
      const query = (action, payload = {}) => page.evaluate(({ action, payload }) =>
        window.Prototype.api.query(action, payload), { action, payload });
      const ledger = () => page.evaluate(() => window.wx.getStorageSync('card-benefits.native.demo.v1').seed);
      // The projection labels both the picker wrapper and its actual form control.
      const byName = name => page.locator('#native-page').getByLabel(name, { exact: true }).and(native('input, select'));
      const assertName = async (selector, field, value, coverage) => {
        const control = native(selector);
        const name = await control.getAttribute('aria-label');
        assert.ok(name?.includes(field), `The control does not announce its field: ${field}`);
        assert.ok(name.includes(value), `The control does not announce its current value: ${field} / ${value}`);
        assert.ok(!/undefined|NaN|⌄/.test(name), 'A picker name contains a raw value or decorative arrow');
        assert.equal(await byName(name).count(), 1, `The accessible picker name is ambiguous: ${name}`);
        assert.equal(await control.isDisabled(), false);
        covered.add(coverage);
        evidence.controls.push({ coverage, name });
        return name;
      };
      const selectRole = async moderator => {
        await native('.demo-heading select').selectOption(moderator ? '1' : '0');
        await waitUntil(async () => (await data()).session?.isModerator === moderator && !(await data()).changingRole,
          'The actual demo role selector did not settle');
        await settled();
        await assertName('.demo-heading select', '演示角色', moderator ? '运营审核' : '普通用户', 'mine.role');
      };

      // Exercise every full-form picker through the source lead-to-full continuation.
      await reset();
      await page.locator('#native-tabs button').filter({ hasText: '我的' }).click();
      await expectRoute('mine');
      const ownerId = (await data()).session.userId;
      const formLedger = await ledger();
      await assertName('.demo-heading select', '演示角色', '普通用户', 'mine.role');
      await selectRole(true);
      assert.equal((await data()).session.userId, ownerId, 'Demo role selection changed the record owner');
      await selectRole(false);
      assert.equal((await data()).session.userId, ownerId);
      await capture('final-a11y-demo-role-name', { ownerId, name: await native('.demo-heading select').getAttribute('aria-label') });
      await native('.menu-row[data-handler="openSubmission"]').click();
      await expectRoute('submission-lead');
      const leadBankIndex = (await data()).bankOptions.findIndex(bank => bank.id === 'cmb');
      assert.ok(leadBankIndex > 0);
      await native('#field-bankId select').selectOption(String(leadBankIndex));
      await native('#title').fill('Accessibility Draft Fixture');
      await native('.full-form-link').click();
      await waitUntil(async () => await atRoute('submission-edit') ||
        await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).count() > 0,
      'The full-form continuation did not navigate or request departure confirmation');
      if (await atRoute('submission-lead')) await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click();
      await expectRoute('submission-edit');
      assert.equal((await data()).fromLead, true);
      assert.equal((await data()).importedLead, true);
      assert.equal((await data()).ownerId, ownerId);
      assert.equal((await data()).draft.startsOn, '');
      assert.equal((await data()).draft.endsOn, '');
      assert.equal((await data()).submissionId, '');
      const selectField = async ({ field, container, label, options, index, target }) => {
        const before = await data();
        const choices = before[options];
        const current = choices[before[index]];
        await assertName(`${container} select`, label, typeof current === 'string' ? current : current.name, `full.${field}`);
        const selectedIndex = choices.findIndex(option => (typeof option === 'string' ? option : option.id) === target);
        assert.ok(selectedIndex >= 0, `The actual picker does not offer ${target}`);
        await native(`${container} select`).selectOption(String(selectedIndex));
        await waitUntil(async () => field.split('.').reduce((value, key) => value?.[key], (await data()).draft) === target,
          `The named picker did not update its own draft field: ${field}`);
        const selected = choices[selectedIndex];
        await assertName(`${container} select`, label, typeof selected === 'string' ? selected : selected.name, `full.${field}`);
      };
      await selectField({ field: 'bankId', container: '#field-bankId', label: '银行', options: 'bankOptions', index: 'bankIndex', target: 'icbc' });
      await native('#field-bankId select').selectOption('0');
      assert.equal((await data()).draft.bankId, '');
      await assertName('#field-bankId select', '银行', '尚未选择', 'full.bankId');
      await selectField({ field: 'cardKind', container: '#field-cardKind', label: '卡片类型', options: 'cardKinds', index: 'cardKindIndex', target: 'debit' });
      await native('.section-heading[data-section="rules"]').click();
      await assertName('#field-startsOn input[type="date"]', '开始日期', '尚未选择', 'full.startsOn');
      await assertName('#field-endsOn input[type="date"]', '最终结束日期', '尚未选择', 'full.endsOn');
      assert.notEqual(await native('#field-startsOn input[type="date"]').getAttribute('aria-label'),
        await native('#field-endsOn input[type="date"]').getAttribute('aria-label'), 'Two empty dates must remain distinguishable');
      await capture('final-a11y-full-empty-date-names', { ownerId, start: '', end: '' });
      for (const [field, label, value] of [['startsOn', '开始日期', '2026-08-24'], ['endsOn', '最终结束日期', '2026-12-31']]) {
        const selector = `#field-${field} input[type="date"]`;
        const emptyName = await native(selector).getAttribute('aria-label');
        await byName(emptyName).fill(value);
        await native(selector).press('Tab');
        assert.equal((await data()).draft[field], value, 'The accessible date name resolved to the wrong draft field');
        await assertName(selector, label, value, `full.${field}`);
      }
      for (const field of [
        { field: 'frequency', container: '#field-frequency', label: '活动周期', options: 'frequencies', index: 'frequencyIndex', target: 'monthly' },
        { field: 'unit', container: '#field-unit', label: '每期累计门槛单位', options: 'unitOptions', index: 'unitIndex', target: '笔' },
        { field: 'rewardKind', container: '#field-rewardKind', label: '奖励类型', options: 'rewardKinds', index: 'rewardKindIndex', target: 'discount' },
        { field: 'currency', container: '#field-currency', label: '奖励币种', options: 'currencies', index: 'currencyIndex', target: 'HKD' },
        { field: 'scope', container: '#field-scope', label: '参与名额', options: 'scopes', index: 'scopeIndex', target: 'card' },
      ]) await selectField(field);
      await native('.section-heading[data-section="entrance"]').click();
      await selectField({ field: 'entrance.kind', container: '#field-entrance-kind', label: '入口形式', options: 'entranceKinds', index: 'entranceKindIndex', target: 'web' });
      assert.deepEqual(await ledger(), formLedger, 'Role and form accessibility checks must not submit or mutate domain records');
      assert.equal([...covered].filter(key => key.startsWith('full.')).length, 10);
      await capture('final-a11y-full-picker-values', { names: evidence.controls.filter(item => item.coverage.startsWith('full.')) });

      // Two same-name real accounts each accumulate August and September bills.
      await reset();
      const walletFixture = await page.evaluate(async () => {
        const api = window.Prototype.api;
        const session = await api.query('session.get', {});
        const baseline = await api.query('wallet.get', {});
        const cards = [];
        for (const suffix of ['A', 'B']) {
          const created = await api.command('card.save', { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa',
            kind: 'credit', nickname: 'Accessibility Shared Name',
            billing: { statementDay: 1, dueDay: 28, dueMonthOffset: 0, dueOn: '2026-08-28', remindDays: 3 } },
          { intentKey: `final-a11y-account-${suffix}` });
          cards.push((await api.query('wallet.get', {})).cards.find(card => card.id === created.id));
        }
        window.__finalA11yClock.now = window.__finalA11yClock.NativeDate.parse('2026-09-24T04:00:00.000Z');
        await api.query('wallet.get', {});
        for (const card of cards) await api.command('card.remove', { id: card.id });
        const wallet = await api.query('wallet.get', {});
        return { ownerId: session.userId, baselineCardCount: baseline.cards.length, cards,
          accounts: wallet.accounts.filter(account => cards.some(card => card.billingAccountId === account.id)),
          bills: wallet.bills.filter(bill => cards.some(card => card.billingAccountId === bill.billingAccountId)) };
      });
      assert.equal(walletFixture.accounts.length, 2);
      assert.equal(new Set(walletFixture.accounts.map(account => account.id)).size, 2);
      assert.equal(new Set(walletFixture.accounts.map(account => account.label)).size, 1, 'The fixture must contain same-name accounts');
      assert.equal(walletFixture.bills.length, 4);
      assert.ok([...walletFixture.cards, ...walletFixture.accounts, ...walletFixture.bills].every(record => record.ownerId === walletFixture.ownerId));
      await page.locator('#native-tabs button').filter({ hasText: '卡包' }).click();
      await expectRoute('wallet');
      const groupSelector = id => `.account-group:has(.account-settings[data-id="${id}"])`;
      const names = [];
      for (const account of walletFixture.accounts) {
        const group = (await data()).groups.find(item => item.id === account.id);
        assert.equal(group.archived, true);
        assert.equal(group.bills.length, 2);
        assert.equal(group.cards.length, 0);
        assert.ok(group.identity.includes(account.label));
        await native(`.account-settings[data-id="${account.id}"]`).click();
        for (const [kind, bills] of [['primaryDate', [group.primaryBill]], ['historicalDate', group.otherBills]]) {
          for (const bill of bills) {
            const selector = `${groupSelector(account.id)} [data-wx-tag="picker"][data-id="${bill.id}"] input[type="date"]`;
            const name = await assertName(selector, '账单还款日期', bill.dueOn, `wallet.${kind}`);
            for (const part of [group.title, group.identity, bill.period]) {
              assert.ok(name.includes(part), `The bill picker omits bank, account, or period context: ${part}`);
            }
            assert.equal(await byName(name).evaluate(control => control.closest('[data-wx-tag="picker"]').dataset.id),
              bill.id, 'The accessible name points to a different business bill');
            names.push(name);
            evidence.bills.push({ accountId: account.id, billId: bill.id, kind, name });
          }
        }
      }
      assert.equal(new Set(names).size, 4, 'Same-name accounts and different periods must have unique date names');
      const groups = walletFixture.accounts.map(account => (data()).then(value => value.groups.find(group => group.id === account.id)));
      const identities = (await Promise.all(groups)).map(group => group.identity);
      assert.equal(new Set(identities).size, 2);
      const selectedAccount = walletFixture.accounts[1];
      const selectedBill = walletFixture.bills.find(bill => bill.billingAccountId === selectedAccount.id && bill.periodKey === '2026-09');
      assert.ok(selectedBill);
      const targetName = evidence.bills.find(item => item.billId === selectedBill.id).name;
      const beforeWallet = await query('wallet.get');
      await page.evaluate(() => {
        const api = window.Prototype.api, command = api.command;
        window.__finalA11yCommands = [];
        api.command = async function (action, payload, ...options) {
          const result = await command.call(this, action, payload, ...options);
          window.__finalA11yCommands.push({ action, payload: JSON.parse(JSON.stringify(payload)), result });
          return result;
        };
      });
      await byName(targetName).fill('2026-09-29');
      await settled();
      const afterWallet = await query('wallet.get');
      const calls = await page.evaluate(() => window.__finalA11yCommands);
      assert.equal(calls.length, 1);
      assert.deepEqual({ action: calls[0].action, payload: calls[0].payload },
        { action: 'bill.update', payload: { id: selectedBill.id, dueOn: '2026-09-29' } });
      assert.equal(calls[0].result.id, selectedBill.id);
      assert.deepEqual(afterWallet.bills.find(bill => bill.id === selectedBill.id), { ...selectedBill, dueOn: '2026-09-29' });
      const unchangedBills = wallet => wallet.bills.filter(bill => bill.id !== selectedBill.id).sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(unchangedBills(afterWallet), unchangedBills(beforeWallet));
      assert.deepEqual(afterWallet.cards, beforeWallet.cards);
      assert.deepEqual(afterWallet.accounts, beforeWallet.accounts);
      assert.equal(afterWallet.bills.length, beforeWallet.bills.length);
      assert.equal(afterWallet.cards.length, walletFixture.baselineCardCount + 2);
      assert.equal((await data()).cardCount, walletFixture.baselineCardCount);
      const updatedSelector = `${groupSelector(selectedAccount.id)} [data-wx-tag="picker"][data-id="${selectedBill.id}"] input[type="date"]`;
      const updatedName = await assertName(updatedSelector, '账单还款日期', '2026-09-29', 'wallet.historicalDate');
      assert.notEqual(updatedName, targetName, 'The bill accessible name kept a stale date after the real update');
      await native(updatedSelector).scrollIntoViewIfNeeded();
      await capture('final-a11y-same-name-account-bill-names', { bills: evidence.bills, selectedBillId: selectedBill.id, updatedName });

      // Read-only history navigation must distinguish same-title user-scope records by bank.
      await reset();
      await page.locator('#native-tabs button').filter({ hasText: '我的' }).click();
      await expectRoute('mine');
      await selectRole(true);
      const historyFixture = await page.evaluate(async () => {
        const api = window.Prototype.api;
        const session = await api.query('session.get', {});
        const before = window.wx.getStorageSync('card-benefits.native.demo.v1').seed;
        const { activity } = await api.query('activity.get', { activityId: 'monthly' });
        const { id, revision, status, publishedAt, updatedAt, publishedBy, ...base } = activity;
        const title = 'Same Title Accessibility Fixture';
        const records = [];
        for (const [bankId, issuerId] of [['cmb', 'cmb-cn'], ['hsbc', 'hsbc-hk']]) {
          const draft = { ...base, title, bankId, issuerIds: [issuerId], frequency: 'monthly',
            startsOn: '2026-09-01', endsOn: '2026-12-31', scope: 'user', target: 1, unit: '次',
            currency: 'CNY', rewardMinor: 100, requiresRegistration: false, requiresInvitation: false,
            conditions: 'Declared browser accessibility fixture.', sourceUrl: '', sourceNote: 'Demo source for bank identity acceptance.',
            entrance: { kind: 'guide', label: 'Participation guide', instructions: 'Bank app > Offers.', imageIds: [] } };
          const submission = await api.command('submission.save', { draft });
          const published = await api.command('submission.review', { id: submission.id, expectedVersion: submission.version,
            decision: 'publish', sourceVerified: true, draft });
          const joined = await api.command('activity.join', { activityId: published.id });
          records.push((await api.query('activity.get', { participationId: joined.id })).participation);
        }
        return { title, records, ownerId: session.userId, initialParticipationCount: Object.keys(before.participations).length };
      });
      assert.equal(historyFixture.records.length, 2);
      assert.equal(new Set(historyFixture.records.map(record => record.id)).size, 2);
      assert.ok(historyFixture.records.every(record => record.ownerId === historyFixture.ownerId && !record.cardId));
      await selectRole(false);
      assert.equal((await data()).session.userId, historyFixture.ownerId);
      await native('.menu-row[data-handler="openHistory"]').click();
      await expectRoute('history');
      const beforeHistory = await ledger();
      assert.equal(Object.keys(beforeHistory.participations).length, historyFixture.initialParticipationCount + 2);
      const rowModels = (await data()).items.filter(item => historyFixture.records.some(record => record.id === item.id));
      assert.equal(rowModels.length, 2);
      assert.equal(new Set(rowModels.map(item => item.title)).size, 1);
      assert.equal(new Set(rowModels.map(item => [item.period, item.stage, item.amount, item.cardName].join('|'))).size, 1,
        'The fixture must depend on bank identity, not a different period, status, amount, or card');
      assert.deepEqual(rowModels.map(item => item.bankName).sort(), ['招行', '汇丰'].sort());
      for (const record of historyFixture.records) {
        const row = (await data()).items.find(item => item.id === record.id);
        const title = `${row.bankName} · ${historyFixture.title}`;
        const labelPattern = new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const accessibleRecord = page.locator('#native-page').getByRole('button', { name: labelPattern });
        assert.equal(await accessibleRecord.count(), 1, 'The same-title bank record has an ambiguous accessible name');
        assert.equal(await accessibleRecord.getAttribute('data-id'), record.id);
        assert.equal(await accessibleRecord.getAttribute('data-activity'), record.activityId);
        assert.equal((await native(`.record-main[data-id="${record.id}"] .record-title`).innerText()).trim(), title);
        evidence.history.push({ bankId: record.snapshot.bankId, participationId: record.id, activityId: record.activityId, title });
        await accessibleRecord.click();
        await expectRoute('detail');
        assert.equal((await data()).detail.activity.id, record.activityId);
        assert.deepEqual((await data()).detail.participation, record, 'The accessible record link opened a different owner or period');
        await page.locator('#native-back').click();
        await expectRoute('history');
      }
      assert.deepEqual(await ledger(), beforeHistory, 'Reading the disambiguated records changed the domain ledger');
      assert.equal(covered.size, 13, 'The case did not exercise all thirteen changed picker templates');
      assert.deepEqual(runtimeErrors, [], 'The accessibility regression raised a browser exception');
      await capture('final-a11y-same-title-history-bank-identities', { covered: [...covered], history: evidence.history });
    });
  } finally {
    try { await context.close(); } finally { page = previousPage; }
  }
}

async function runProductUxRegressions() {
  const primaryHandler = () => native('.detail-primary').getAttribute('data-handler');
  await check('Product UX detail primary actions preserve the participation lifecycle and one-row dock', async () => {
    await reset();
    await openPage('pages/detail/index?id=monthly');
    const original = (await data()).detail.participation;
    assert.equal(await primaryHandler(), 'editProgress');
    for (const size of sizes) {
      await resize(size);
      assert.equal(await native('.detail-bottom-bar button').count(), 2, 'The detail dock must expose one primary action and More');
      const primary = await native('.detail-primary').boundingBox();
      const more = await native('.detail-more').boundingBox();
      const device = await page.locator('#device').boundingBox();
      assert.ok(primary && more && device && Math.abs(primary.y - more.y) < 2, 'The detail actions wrapped into multiple rows');
      assert.ok(primary.height >= 48 && more.height >= 48, 'The compact dock reduced action target size');
      assert.ok(primary.y + primary.height <= device.y + device.height + 1, 'The detail primary action is outside the device');
      await capture(`product-detail-primary-${size.name}`);
    }
    await resize(sizes[0]);
    await clickDetailAction('skip'); await settled();
    assert.equal((await data()).detail.participation.stage, 'skipped');
    assert.equal(await primaryHandler(), 'resume');
    await clickDetailAction('resume'); await settled();
    assert.equal(await primaryHandler(), 'editProgress');
    assert.equal((await data()).detail.participation.id, original.id, 'Resuming changed the participation identity');
    await clickDetailAction('editProgress'); await waitRoute('progress');
    await native('#progress').fill(String(original.snapshot.target));
    await click('.entry-primary'); await waitRoute('detail');
    assert.equal(await primaryHandler(), 'complete');
    await clickDetailAction('complete'); await settled();
    assert.equal((await data()).detail.participation.stage, 'completed');
    assert.equal(await primaryHandler(), 'receipt');
    assert.equal(await native('.date-setting[data-handler="openExpected"]').count(), 1, 'The completed cash reward lost its expected-date entry');
    await clickDetailAction('receipt'); await waitRoute('receipt');
    await native('#amount').fill('15.25');
    await click('.entry-primary'); await waitRoute('detail');
    const received = (await data()).detail.participation;
    assert.equal(received.id, original.id);
    assert.equal(received.stage, 'received');
    assert.equal(received.receivedMinor, 1525);
    assert.deepEqual(received.snapshot, original.snapshot, 'Changing primary actions altered the period snapshot');
    assert.equal(await primaryHandler(), 'receipt');
    await expectText('.detail-primary', '修改到账');
    await capture('product-detail-received-primary');
    await openPage('pages/detail/index?id=instant');
    assert.equal((await data()).detail.participation, null);
    assert.equal(await primaryHandler(), 'join');
    await clickDetailAction('join'); await settled();
    assert.equal(await primaryHandler(), 'receipt');
    await expectText('.detail-primary', '记录已享优惠');
    await clickDetailAction('complete'); await settled();
    assert.equal((await data()).detail.participation.stage, 'completed', 'More lost the direct completion path for discounts');
  });

  await check('Product UX More preserves direct receipt access and blocks stale detail actions', async () => {
    await reset(); await openPage('pages/detail/index?id=monthly');
    const original = (await data()).detail.participation;
    await click('.detail-more');
    assert.equal(await native('[data-sheet-dialog="detail-manage"] button[data-handler="receipt"]').count(), 1);
    assert.equal(await native('[data-sheet-dialog="detail-manage"] button[data-handler="complete"]').count(), 1);
    await click('.sheet-close');
    await injectState('#slow-next');
    await waitUntil(async () => (await data()).refreshing, 'The active detail did not begin refreshing');
    assert.equal(await native('.detail-primary').isDisabled(), true);
    assert.equal(await native('.detail-more').isDisabled(), true, 'More could reopen mutation actions during refresh');
    await settled();
    await injectState('#fail-next');
    await waitUntil(async () => !!(await data()).refreshError, 'The active detail did not expose the failed refresh');
    await settled();
    assert.equal((await data()).outdated, true);
    assert.equal(await native('.detail-primary').isDisabled(), true);
    assert.equal(await native('.detail-more').isDisabled(), true, 'More could expose mutation actions on stale state');
    assert.deepEqual((await data()).detail.participation, original, 'A failed refresh changed the retained participation');
    await click('.refresh-notice button'); await settled();
    assert.equal((await data()).outdated, false);
    await clickDetailAction('receipt'); await waitRoute('receipt');
    assert.equal((await data()).participation.id, original.id, 'The relocated receipt entry changed its target record');
    await native('#amount').fill('9.50'); await click('.entry-primary'); await waitRoute('detail');
    assert.equal((await data()).detail.participation.id, original.id);
    assert.equal((await data()).detail.participation.receivedMinor, 950, 'The relocated receipt entry did not persist through the business service');
  });

  await check('Product UX empty rewards show one total and a working pending destination', async () => {
    await reset(); await openPage('pages/rewards/index');
    assert.equal((await data()).received.length, 0);
    assert.ok((await data()).pendingCount > 0, 'The empty-rewards fixture needs pending records');
    assert.equal(await native('.income-breakdown').count(), 0, 'Empty rewards repeated zero subtotals');
    assert.equal(await native('.section-heading').count(), 0, 'Empty rewards retained an empty record heading');
    assert.equal(await native('.income-total').count(), 1);
    await expectText('.income-empty', '这个月还没有收益记录');
    await capture('product-rewards-empty');
    await native('.income-empty button[data-handler="selectTab"]').click(); await settled();
    assert.equal((await data()).tab, 'pending');
    assert.ok(await native('.pending-row').count() > 0, 'The empty-state action did not reveal pending records');
  });

  for (const size of sizes) {
    await check(`Product UX preferences keep save reachable and help optional at ${size.name}`, async () => {
      await reset(); await resize(size); await openPage('pages/preferences/index');
      const initial = (await data()).newActivities;
      assert.equal(await native('.preferences-dock .primary-button').isDisabled(), true, 'Unchanged settings should not offer an effective save');
      assert.equal(await native('#reminder-help').count(), 0, 'Detailed reminder instructions should initially be collapsed');
      await native('.note-toggle').click();
      assert.equal(await native('.note-toggle').getAttribute('aria-expanded'), 'true');
      await expectText('#reminder-help', '下一期需重新开启');
      await native('[data-field="newActivities"]').click();
      assert.equal((await data()).dirty, true);
      const dock = await native('.preferences-dock').boundingBox();
      const save = await native('.preferences-dock .primary-button').boundingBox();
      const device = await page.locator('#device').boundingBox();
      assert.ok(dock && save && device && save.height >= 48 && save.y >= device.y && save.y + save.height <= device.y + device.height + 1,
        'The preferences save target is not fully visible at the requested size');
      const point = { x: save.x + save.width / 2, y: save.y + save.height / 2 };
      assert.equal(await page.evaluate(point => {
        const root = document.querySelector('#native-page').shadowRoot;
        return !!root.elementFromPoint(point.x, point.y)?.closest('.preferences-dock .primary-button');
      }, point), true, 'Another layer covers the fixed save control');
      await page.mouse.click(point.x, point.y); await settled();
      await expectText('.preferences-dock .saved-message', '已保存');
      assert.equal((await data()).dirty, false);
      assert.equal(await page.evaluate(async () => (await window.Prototype.api.query('preferences.get', {})).newActivities), !initial,
        'The visible fixed save control did not persist the chosen preference');
      await native('.note-toggle').click();
      assert.equal(await native('#reminder-help').count(), 0);
      await capture(`product-preferences-dock-${size.name}`);
    });
  }
  await resize(sizes[0]);

  await check('Product UX single-issuer card guidance preserves multi-issuer selection and saved identity', async () => {
    await reset(); await openPage('pages/wallet/index');
    await native('.page-heading button[data-handler="addCard"]').click(); await waitRoute('card-edit');
    assert.equal((await data()).issuerOptions.length, 1);
    assert.equal(await native('#field-bankId .issuer-summary').count(), 1);
    assert.equal(await native('#field-issuerId select').count(), 0, 'A single issuer retained a redundant picker');
    const bankIndex = (await data()).banks.findIndex(bank => bank.id === 'hsbc');
    await native('#field-bankId select').selectOption(String(bankIndex));
    assert.equal((await data()).issuerOptions.length, 2);
    assert.equal(await native('#field-bankId .issuer-summary').count(), 0);
    assert.equal(await native('#field-issuerId select').isEnabled(), true);
    await native('#field-issuerId select').selectOption('1');
    const issuerId = (await data()).issuerOptions[1].id;
    await native('.kind-button[data-kind="debit"]').click();
    await native('#card-nickname').fill('Product UX Issuer Card');
    await native('.save-button').click(); await waitRoute('wallet');
    const wallet = await page.evaluate(() => window.Prototype.api.query('wallet.get', {}));
    const saved = wallet.cards.find(card => card.nickname === 'Product UX Issuer Card');
    assert.ok(saved, 'The multi-issuer card did not persist');
    assert.equal(saved.bankId, 'hsbc');
    assert.equal(saved.issuerId, issuerId, 'Simplifying the issuer display changed the selected issuing entity');
    await capture('product-card-issuer-saved');
  });

  await check('Product UX compact tools and optional history help retain their destinations', async () => {
    await reset(); await openPage('pages/mine/index');
    for (const [handler, target] of [['openEntitlements', 'entitlements'], ['openLounges', 'lounges']]) {
      const entry = native(`.tool-entry[data-handler="${handler}"]`);
      const title = await entry.locator('.tool-title').boundingBox();
      const description = await entry.locator('.tool-description').boundingBox();
      assert.ok(title && description && title.y + title.height <= description.y + 1,
        'The compact tool title must remain above its description');
      assert.ok(Math.abs(title.x - description.x) < 1, 'The compact tool text lost its shared left alignment');
      await entry.click(); await waitRoute(target);
      await page.locator('#native-back').click(); await waitRoute('mine');
    }
    await native('.menu-row[data-handler="openHistory"]').click(); await waitRoute('history');
    const ids = (await data()).items.map(item => item.id);
    assert.equal(await native('#history-record-help').count(), 0);
    await native('.history-help').click();
    assert.equal(await native('.history-help').getAttribute('aria-expanded'), 'true');
    await expectText('#history-record-help', '实际到账日期');
    assert.deepEqual((await data()).items.map(item => item.id), ids, 'Opening record help changed the displayed history');
    await native('.history-help').click();
    assert.equal(await native('#history-record-help').count(), 0);
    assert.equal(await native('.audit-link').count(), ids.length, 'The revised history rows lost their audit entries');
    await capture('product-history-compact-records');
  });
}

async function workbenchAcceptance() {
  const nativePage = page;
  const preview = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  attachDiagnostics(preview);
  page = preview;
  try {
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.Prototype?.ready === true);
    await check('Desktop workbench device width drives native form responsiveness', async () => {
      await page.locator('#viewport-width').selectOption('320');
      await openPage('pages/submission-lead/index');
      const metrics = await native('.lead-dock .primary-button').evaluate(element => {
        const style = getComputedStyle(element);
        const range = document.createRange();
        range.selectNodeContents(element);
        return { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
          text: element.textContent, lineHeight: parseFloat(style.lineHeight), textHeight: range.getBoundingClientRect().height };
      });
      assert.ok(metrics.width >= 96, `The narrow preview collapsed its primary action: ${JSON.stringify(metrics)}`);
      assert.ok(metrics.textHeight <= metrics.lineHeight * 1.5, `The primary action wraps into a vertical column: ${JSON.stringify(metrics)}`);
      await capture('desktop-workbench-320-lead');
    });
    await page.locator('#viewport-width').selectOption('390');
    await openPage('pages/activities/index');
    await page.locator('.flow-overview summary').click();
    await page.screenshot({ path: path.join(output, 'workbench-overview.png'), fullPage: true });
  } finally {
    await preview.close();
    page = nativePage;
  }
}

async function runR5Regressions() {
  await check('Cancelling the full-submission image picker preserves images, draft, and errors', async () => {
    await reset();
    await openPage('pages/submission-edit/index');
    await native('#title').fill('取消选图验收稿');
    await click('#section-entrance .section-heading');
    const imageChooser = page.waitForEvent('filechooser');
    await click('.upload-button');
    await (await imageChooser).setFiles({ name: 'existing-rule.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII=', 'base64') });
    await waitUntil(async () => (await data()).imageRows.length === 1 && !(await data()).uploading, 'The initial image was not saved to the draft');
    await click('.editor-dock .primary-button');
    await settled();
    assert.ok(Object.keys((await data()).errors).length > 0, 'The cancellation fixture must retain existing validation errors');
    await click('#section-entrance .section-heading');
    const snapshot = async () => page.evaluate(() => ({
      draft: window.Prototype.current.data.draft, errors: window.Prototype.current.data.errors,
      images: window.Prototype.current.data.imageRows,
      drafts: Object.fromEntries(Object.keys(localStorage).filter(key => key.includes('form-draft')).map(key => [key, localStorage.getItem(key)])),
    }));
    const before = await snapshot();
    const cancelChooser = page.waitForEvent('filechooser');
    await click('.upload-button');
    await cancelChooser;
    await page.locator('input[type="file"]').last().dispatchEvent('cancel');
    await waitUntil(async () => !(await data()).uploading, 'The cancelled image picker remained busy');
    assert.deepEqual(await snapshot(), before, 'Picker cancellation changed retained images, form errors, or the saved draft');
    await capture('full-submission-image-cancel-preserves-state');
  });

  await check('Detail refresh retains content and disables stale receipt actions until retry', async () => {
    await reset();
    await page.evaluate(async () => { await window.Prototype.navigate('pages/detail/index?id=quarterly'); });
    await waitRoute('detail');
    const title = await native('.activity-title').textContent();
    const receipt = () => native('.detail-bottom-bar button[data-handler="receipt"]');
    await injectState('#slow-next');
    await waitUntil(async () => (await data()).refreshing === true, 'Detail did not enter its refresh state');
    assert.equal(await native('.activity-title').textContent(), title, 'Refreshing removed the activity context');
    assert.equal(await receipt().isDisabled(), true, 'Receipt remained actionable during refresh');
    await settled();
    await receipt().click();
    await waitRoute('receipt');
    await native('#amount').fill('75.25');
    await page.evaluate(() => {
      const api = window.Prototype.api;
      const state = window.__acceptanceDetailReturnRead = { api, query: api.query, triggered: false };
      api.query = function (...args) {
        // Date freshness legitimately reads before saving. Fail only the detail
        // request issued after the real receipt has committed and returned.
        if (!state.triggered && args[0] === 'activity.get' && window.Prototype.current.route === 'pages/detail/index') {
          state.triggered = true;
          return Promise.reject(Object.assign(new Error('验收模拟：返回详情后的读取失败。'), { code: 'NETWORK_ERROR' }));
        }
        return state.query.apply(this, args);
      };
    });
    try {
      await click('.entry-primary');
      await waitRoute('detail');
      assert.equal(await page.evaluate(() => window.__acceptanceDetailReturnRead.triggered), true);
      assert.equal((await data()).outdated, true, 'A failed return refresh did not mark the detail stale');
      assert.equal(await native('.activity-title').textContent(), title, 'A failed return refresh removed the saved activity context');
      assert.equal(await receipt().isDisabled(), true, 'A stale receipt action could overwrite newer state');
      await expectText('.refresh-notice', '上次读取');
      await capture('detail-receipt-return-refresh-failure');
      await click('.refresh-notice button');
      await settled();
      assert.equal((await data()).detail.participation.receivedMinor, 7525, 'Retry did not reveal the successfully recorded receipt');
      assert.equal(await receipt().isDisabled(), false, 'Retry left the receipt action frozen');
      await receipt().click();
      await waitRoute('receipt');
      await native('#amount').fill('76.25');
      await click('.entry-primary');
      await waitRoute('detail');
      assert.equal((await data()).detail.participation.receivedMinor, 7625, 'Receipt correction did not refresh the retained detail page');
    } finally {
      await page.evaluate(() => {
        const state = window.__acceptanceDetailReturnRead;
        state.api.query = state.query;
        delete window.__acceptanceDetailReturnRead;
      });
    }
  });

  await check('Registration-only conflicts state the latest registration and retain the visible local choice', async () => {
    await reset();
    const id = await page.evaluate(async () => {
      const joined = await window.Prototype.api.command('activity.join', { activityId: 'extra-icbc' });
      await window.Prototype.api.command('participation.progress', { participationId: joined.id, progress: 2, registered: true, expectedVersion: joined.version });
      return joined.id;
    });
    for (const remoteRegistered of [false, true]) {
      await page.evaluate(async value => { await window.Prototype.navigate(`pages/progress/index?activityId=extra-icbc&id=${encodeURIComponent(value)}`); }, id);
      await waitRoute('progress');
      const localRegistered = !remoteRegistered;
      const checkbox = native('.entry-registration input[type="checkbox"]');
      if (await checkbox.isChecked() !== localRegistered) await checkbox.click();
      await native('#progress').fill('3');
      await page.evaluate(async ({ id, registered }) => {
        const latest = (await window.Prototype.api.query('activity.get', { participationId: id })).participation;
        await window.Prototype.api.command('participation.progress', { participationId: id, progress: latest.progress, registered, expectedVersion: latest.version });
      }, { id, registered: remoteRegistered });
      await click('.entry-primary');
      await settled();
      assert.equal((await data()).conflict, true, 'Registration-only remote changes did not cause a conflict');
      await click('#record-conflict button', '读取最新记录');
      await settled();
      assert.equal((await data()).participation.snapshot.requiresRegistration, false, 'This fixture must not require registration in its rules');
      assert.ok((await data()).latestSummary.endsWith(remoteRegistered ? '已报名' : '未报名'), 'The latest summary hides the changed registration value');
      assert.equal(await checkbox.isVisible(), true, 'Reading the latest record hid the local registration choice');
      assert.equal(await checkbox.isChecked(), localRegistered, 'Reading the latest record overwrote the local checkbox choice');
      await capture(`registration-conflict-latest-${remoteRegistered ? 'registered' : 'unregistered'}`);
      await click('.entry-primary');
      await waitRoute('todo');
    }
  });

  await check('A concurrent first receipt requires explicit reapplication without overwriting the other client', async () => {
    await reset();
    await page.evaluate(async () => { await window.Prototype.navigate('pages/detail/index?id=instant'); });
    await waitRoute('detail');
    await clickDetailAction('receipt');
    await waitRoute('receipt');
    assert.equal((await data()).participation, null, 'The new-receipt fixture already has a participation');
    await native('#amount').fill('12.34');
    const receivedOn = (await data()).minDate;
    await native('#receipt-date-field input[type="date"]').fill(receivedOn);
    const other = await page.evaluate(async () => {
      const session = await window.Prototype.api.query('session.get', {});
      return window.Prototype.api.command('reward.confirm', { activityId: 'instant', amountMinor: 950, receivedOn: session.today, expectNew: true });
    });
    await click('.entry-primary');
    await settled();
    assert.equal((await data()).conflict, true, 'A concurrent first write silently overwrote another client');
    assert.equal(await native('#amount').inputValue(), '12.34', 'The first-write conflict discarded the amount');
    assert.equal(await native('#receipt-date-field input').inputValue(), receivedOn, 'The first-write conflict discarded the receipt date');
    const beforeReapply = await page.evaluate(async () => (await window.Prototype.api.query('activity.get', { activityId: 'instant' })).participation);
    assert.equal(beforeReapply.id, other.id, 'A concurrent first write created a second participation');
    assert.equal(beforeReapply.receivedMinor, 950, 'The blocked save changed the other client receipt');
    await capture('new-receipt-concurrent-first-write');
    await click('#record-conflict button', '读取最新记录');
    await settled();
    assert.equal((await data()).reapplyRequired, true, 'The newer first receipt did not require an explicit review decision');
    assert.equal(await native('#amount').inputValue(), '12.34', 'Latest-record loading replaced the retained amount');
    await click('.entry-primary');
    await waitRoute('detail');
    assert.equal((await data()).detail.participation.id, other.id, 'Reapplication duplicated the receipt participation');
    assert.equal((await data()).detail.participation.receivedMinor, 1234, 'Explicit reapplication did not save the retained amount');
    assert.equal((await data()).detail.participation.receivedOn, receivedOn, 'Explicit reapplication lost the selected date');
  });
}

async function runDepartureRegressions() {
  const originalPage = page;
  page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  attachDiagnostics(page);
  try {
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.Prototype?.ready === true);
    const prepare = async () => {
      await reset();
      await page.evaluate(async () => { await window.Prototype.navigate('pages/detail/index?id=quarterly'); });
      await waitRoute('detail');
      await click('.date-setting[data-handler="openExpected"]');
      const expected = new Date(`${(await data()).expectedOn}T12:00:00Z`);
      expected.setUTCDate(expected.getUTCDate() + 1);
      const value = expected.toISOString().slice(0, 10);
      await native('.sheet input[type="date"]').fill(value);
      await waitUntil(async () => (await data()).expectedDirty, 'The expected-date editor was not dirty');
      return { value, instance: await page.evaluate(() => window.Prototype.current._instanceId) };
    };
    const assertRetained = async state => {
      assert.equal(await page.evaluate(() => window.Prototype.current._instanceId), state.instance, 'Cancelled departure replaced the source page instance');
      assert.equal((await data()).showExpected, true, 'Cancelled departure closed the expected-date sheet');
      assert.equal((await data()).expectedOn, state.value, 'Cancelled departure discarded the date');
      assert.equal((await data()).expectedDirty, true, 'Cancelled departure cleared unsaved state');
    };
    const noResidualDialog = async () => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#platform-layer h2').count(), 0, 'An unrelated page received a second discard confirmation');
    };
    await check('Dirty expected-date Back cancellation preserves the editor and confirmation leaves once', async () => {
      const state = await prepare();
      await page.locator('#native-back').click();
      await page.locator('#platform-layer button').filter({ hasText: '继续填写' }).click();
      await assertRetained(state);
      await capture('expected-date-back-cancel-retains-editor');
      await page.locator('#native-back').click();
      await page.locator('#platform-layer button').filter({ hasText: '离开' }).click();
      await waitRoute('todo');
      await noResidualDialog();
    });
    await check('Atlas navigation and return preserve the dirty expected-date snapshot', async () => {
      const state = await prepare();
      await page.locator('.atlas-link[data-route="pages/preferences/index"]').click();
      await page.locator('#platform-layer button').filter({ hasText: '离开' }).click();
      await waitRoute('preferences');
      await noResidualDialog();
      await page.locator('#native-back').click();
      await waitRoute('detail');
      await assertRetained(state);
      await capture('expected-date-atlas-return-retains-editor');
      await page.locator('.atlas-link[data-route="pages/wallet/index"]').click();
      await page.locator('#platform-layer button').filter({ hasText: '离开' }).click();
      await waitRoute('wallet');
      await noResidualDialog();
    });
    await check('Reset cancellation retains a dirty sheet and confirmation resets with one prompt', async () => {
      const state = await prepare();
      await page.locator('#reset-prototype').click();
      assert.equal(await page.locator('#platform-layer h2').textContent(), '重置演示记录？');
      await page.locator('#platform-layer button').filter({ hasText: '保留记录' }).click();
      await assertRetained(state);
      await page.locator('#reset-prototype').click();
      await page.locator('#platform-layer button').filter({ hasText: '重置' }).click();
      await waitRoute('todo');
      await noResidualDialog();
      await capture('expected-date-reset-completed');
    });
  } finally {
    await page.close();
    page = originalPage;
  }
}

async function runR6Regressions() {
  const originalPage = page;
  page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  attachDiagnostics(page);
  try {
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.Prototype?.ready === true);
    await check('Platform confirmation owns keyboard focus across repeated validation and cancellation', async () => {
      await reset();
      await openPage('pages/progress/index');
      await native('#progress').fill('invalid');
      for (let attempt = 0; attempt < 2; attempt++) {
        await click('.entry-primary');
        await waitUntil(async () => await native('#progress').evaluate(element => element.getRootNode().activeElement === element),
          'Repeated validation did not focus its invalid field');
        await click('.entry-secondary');
        await page.locator('#platform-layer h2').waitFor({ state: 'visible' });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const assertModalOwnsFocus = async () => {
          const state = await page.evaluate(() => ({
            modalOwnsFocus: Boolean(document.activeElement?.closest('#platform-layer')),
            inert: ['#native-page', '#native-tabs', '.native-navigation'].every(selector => document.querySelector(selector).inert),
            nativeFocus: document.querySelector('#native-page').shadowRoot.activeElement?.id || '',
          }));
          assert.equal(state.inert, true, 'The confirmation left native controls interactive behind its modal');
          assert.equal(state.modalOwnsFocus, true, `Focus escaped the platform confirmation: ${JSON.stringify(state)}`);
        };
        await assertModalOwnsFocus();
        for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
          await page.keyboard.press(key);
          await assertModalOwnsFocus();
        }
        if (attempt === 1) await capture('platform-confirmation-keyboard-focus-contained');
        await page.keyboard.press('Escape');
        await page.locator('#platform-layer h2').waitFor({ state: 'detached' });
        assert.equal((await route()), 'pages/progress/index', 'Cancelling the confirmation left the progress form');
        assert.equal(await native('#progress').inputValue(), 'invalid', 'Cancelling the confirmation discarded the invalid input');
        assert.equal(await native('.entry-secondary').evaluate(element => element.getRootNode().activeElement === element), true,
          'Cancelling the confirmation did not restore focus to its initiating control');
        assert.equal(await page.locator('#native-page').evaluate(element => element.inert), false, 'Cancelling left the source form inert');
      }
    });

    await check('Returning from progress retains detail query parameters through browser reload', async () => {
      await reset();
      const id = await page.evaluate(async () => (await window.Prototype.api.query('activity.get', { activityId: 'monthly' })).participation.id);
      await page.evaluate(async value => {
        await window.Prototype.navigate(`pages/detail/index?id=monthly&participationId=${encodeURIComponent(value)}`);
      }, id);
      await waitRoute('detail');
      await click('button[data-handler="editProgress"]');
      await waitRoute('progress');
      await page.locator('#native-back').click();
      await waitRoute('detail');
      const parameters = await page.evaluate(() => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || '')));
      assert.equal(parameters.id, 'monthly', 'Back removed the activity parameter from the address');
      assert.equal(parameters.participationId, id, 'Back removed the selected record parameter from the address');
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.Prototype?.ready === true);
      await waitRoute('detail');
      assert.equal((await data()).activityId, 'monthly', 'Reload could not restore the activity from its address');
      assert.equal((await data()).detail.participation.id, id, 'Reload opened a different participation');
      assert.equal((await data()).error, '', 'Reload converted a valid detail link into an error state');
      await capture('detail-back-query-reload-restored');
    });

    await check('Catalog insertion and removal preserve focus by record identity rather than list index', async () => {
      await reset();
      await page.evaluate(async () => { await window.Prototype.scenarios.review(); });
      await settled();
      await openPage('pages/activities/index');
      const initialIndex = (await data()).items.findIndex(item => item.id === 'monthly');
      assert.ok(initialIndex >= 0, 'The catalog fixture is missing the monthly record');
      const originalInstance = await page.evaluate(() => window.Prototype.current._instanceId);
      await native('.offer-heading[data-id="monthly"]').focus();
      await page.evaluate(async () => {
        const detail = await window.Prototype.api.query('activity.get', { activityId: 'monthly' });
        const session = await window.Prototype.api.query('session.get', {});
        const { id, revision, status, publishedAt, updatedAt, publishedBy, ...draft } = detail.activity;
        const inserted = { ...draft, title: '焦点保位插入验收活动', endsOn: session.today, sourceNote: '仅用于演示数据焦点身份验收。' };
        const submission = await window.Prototype.api.command('submission.save', { draft: inserted });
        await window.Prototype.api.command('submission.review', {
          id: submission.id, expectedVersion: submission.version, decision: 'publish', sourceVerified: true, draft: inserted,
        });
        await window.Prototype.refresh();
      });
      await settled();
      assert.equal(await page.evaluate(() => window.Prototype.current._instanceId), originalInstance, 'The identity test replaced the catalog instance');
      const shiftedIndex = (await data()).items.findIndex(item => item.id === 'monthly');
      assert.ok(shiftedIndex > initialIndex, 'The inserted record did not move the original row to a different index');
      assert.equal(await native('.offer-heading[data-id="monthly"]').evaluate(element => element.getRootNode().activeElement === element), true,
        'List insertion moved focus to another record at the previous index');
      await capture('catalog-insert-retains-record-focus');
      await page.evaluate(async () => {
        await window.Prototype.api.command('activity.withdraw', { activityId: 'monthly' });
        await window.Prototype.refresh();
      });
      await settled();
      assert.ok(!(await data()).items.some(item => item.id === 'monthly'), 'The withdrawn fixture remained in the public catalog');
      const focus = await page.evaluate(() => {
        const control = window.Prototype.shadow.activeElement;
        return control ? { id: control.dataset.id, isRow: control.matches('.offer-heading,.tile-action') } : null;
      });
      assert.ok(!focus?.isRow, `Removing the focused record silently transferred focus to another row: ${JSON.stringify(focus)}`);
    });
  } finally {
    await page.close();
    page = originalPage;
  }
}

async function runR7InteractionRegressions() {
  await check('Cancelling registration produces an explicit audit entry without a misleading progress change', async () => {
    await reset();
    await openPage('pages/progress/index');
    const id = (await data()).participation.id;
    assert.equal((await data()).participation.progress, 2);
    await native('.entry-registration input[type="checkbox"]').uncheck();
    await click('.entry-primary');
    await waitRoute('todo');
    const saved = (await data()).raw.tasks.find(item => item.id === id);
    assert.equal(saved.progress, 2, 'Registration editing changed the accumulated progress');
    assert.equal(saved.registeredAt, null, 'The registration flag was not removed');
    await click('.history-entry');
    await waitRoute('history');
    await click(`.audit-link[data-id="${id}"]`);
    await waitUntil(async () => (await data()).showAudit && !(await data()).auditLoading, 'The registration audit did not load');
    const audit = (await data()).audit[0];
    assert.equal(audit.label, '取消报名标记', 'The audit did not explain the registration-only action');
    assert.ok(audit.description.includes('进度仍为 2 笔') && audit.description.includes('已报名 → 未报名'), 'The audit obscures unchanged progress or the registration transition');
    await expectText('.audit-row', '取消报名标记');
    await capture('registration-cancel-audit-clear');
  });

  await check('Short-landscape sheet keyboard traversal reveals every focused control', async () => {
    await reset();
    await resize(sizes[2]);
    await page.evaluate(async () => {
      for (let index = 0; index < 8; index++) await window.Prototype.api.command('card.save', {
        bankId: 'boc', issuerId: 'boc-mo', kind: 'credit', network: 'mastercard', nickname: `键盘验收卡${index}`,
      });
      await window.Prototype.navigate('pages/detail/index?id=annual');
    });
    await waitRoute('detail');
    await click('button[data-handler="openManage"]');
    await click('button[data-handler="anotherCard"]');
    await native('.sheet-close').focus();
    for (const key of ['Shift+Tab', 'Shift+Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      const focus = await page.evaluate(() => {
        const active = window.Prototype.shadow.activeElement;
        const panel = active?.closest('.sheet');
        const clip = active?.closest('.sheet-body') || panel;
        const a = active?.getBoundingClientRect(), b = clip?.getBoundingClientRect();
        return { inSheet: Boolean(panel), text: active?.textContent, y: a?.y, bottom: a ? a.y + a.height : null,
          clipTop: b?.y, clipBottom: b ? b.y + b.height : null, backgroundInert: window.Prototype.shadow.querySelector('.detail-page').inert };
      });
      assert.equal(focus.inSheet, true, 'Sheet keyboard traversal escaped to the background');
      assert.equal(focus.backgroundInert, true, 'The active sheet left background source controls interactive');
      assert.ok(focus.y >= focus.clipTop - 2 && focus.bottom <= focus.clipBottom + 2, `The focused sheet control is off screen: ${JSON.stringify(focus)}`);
    }
    await page.keyboard.press('Shift+Tab');
    await capture('landscape-sheet-keyboard-focus-visible');
    await click('.sheet-close');
    await resize(sizes[0]);
  });

  await check('A busy sheet retains focus with no enabled controls and yields to nested platform dialogs', async () => {
    await reset();
    await resize(sizes[2]);
    await page.evaluate(async () => { await window.Prototype.navigate('pages/detail/index?id=quarterly'); });
    await waitRoute('detail');
    await click('.date-setting[data-handler="openExpected"]');
    await page.evaluate(() => {
      const api = window.Prototype.api;
      const original = api.command;
      const state = window.__acceptanceExpectedGate = { api, original, release: null };
      api.command = function (action, payload) {
        if (action !== 'participation.expected') return original.call(api, action, payload);
        return new Promise((resolve, reject) => { state.release = () => original.call(api, action, payload).then(resolve, reject); });
      };
    });
    try {
      await click('.sheet-confirm');
      await waitUntil(async () => (await data()).busy === true, 'The expected-date save did not remain pending');
      for (const key of ['Tab', 'Shift+Tab', 'Escape']) {
        await page.keyboard.press(key);
        const focus = await page.evaluate(() => ({
          inSheet: Boolean(window.Prototype.shadow.activeElement?.closest('.sheet')),
          panelFocused: window.Prototype.shadow.activeElement?.classList.contains('sheet'),
          backgroundInert: window.Prototype.shadow.querySelector('.detail-page').inert,
        }));
        assert.equal(focus.inSheet, true, `Busy-sheet focus escaped after ${key}`);
        assert.equal(focus.panelFocused, true, 'A sheet with no enabled controls did not retain panel focus');
        assert.equal(focus.backgroundInert, true, 'The busy sheet left its background interactive');
        assert.equal((await data()).showExpected, true, 'Escape dismissed a non-dismissible save');
      }
      await capture('busy-sheet-keyboard-focus-contained');
      // Simulate an asynchronous native platform event through the actual wx
      // adapter. Busy workbench shortcuts are intentionally blocked by R13.
      await page.evaluate(() => { void wx.showModal({ title: '使用前请了解',
        content: '这是用于验证保存期间平台弹窗优先级的模拟事件。', platform: true, policyLink: true,
        confirmText: '同意并继续', cancelText: '暂不同意' }); });
      await page.locator('#platform-layer .privacy-policy-link').click();
      assert.equal(await page.locator('#platform-layer h2').textContent(), '用户隐私保护指引');
      for (const key of ['Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('#platform-layer'))), true, 'A nested platform dialog lost focus to the sheet');
      }
      await page.locator('#platform-layer button').filter({ hasText: '返回授权' }).click();
      await page.locator('#platform-layer button').filter({ hasText: '暂不同意' }).click();
      assert.equal(await page.evaluate(() => Boolean(window.Prototype.shadow.activeElement?.closest('.sheet'))), true, 'Closing the platform dialog did not restore busy-sheet focus');
    } finally {
      await page.evaluate(async () => {
        const state = window.__acceptanceExpectedGate;
        if (!state) return;
        state.api.command = state.original;
        if (state.release) await state.release();
        delete window.__acceptanceExpectedGate;
      });
      await settled();
    }
    await click('.date-setting[data-handler="openExpected"]');
    await click('.sheet-close');
    assert.equal(await native('.date-setting[data-handler="openExpected"]').evaluate(element => element.getRootNode().activeElement === element), true,
      'Closing the sheet did not restore its initiating source button');
    await resize(sizes[0]);
  });
}

async function runR7LocatorRegression() {
  const originalPage = page;
  page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  attachDiagnostics(page);
  try {
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.Prototype?.ready === true);
    const action = handler => page.locator('#action-list .action-row').filter({
      has: page.locator('code').filter({ hasText: new RegExp(`^${handler}$`) }),
    }).locator('.action-locate');
    const expandInspector = async () => {
      const section = page.locator('details').filter({ has: page.locator('#action-list') }).first();
      if (await section.getAttribute('open') === null) await section.locator(':scope > summary').click();
    };
    await check('Action inspector locates real switch and checkbox controls without crossing modal boundaries', async () => {
      await openPage('pages/preferences/index');
      await expandInspector();
      await action('change').click();
      assert.equal(await page.evaluate(() => window.Prototype.shadow.activeElement?.matches('input[role="switch"]')), true,
        'The preference locator focused a non-interactive switch wrapper');
      await capture('inspector-locates-real-switch');
      await openPage('pages/submission-edit/index');
      const index = (await data()).bankOptions.findIndex(bank => bank.id === 'cmb');
      await native('#field-bankId select').selectOption(String(index));
      await action('selectIssuers').click();
      assert.equal(await page.evaluate(() => window.Prototype.shadow.activeElement?.matches('input[type="checkbox"]')
        && window.Prototype.shadow.activeElement.closest('[data-handler="selectIssuers"]') !== null), true, 'Issuer location did not reach a checkbox');
      await action('selectNetworks').click();
      assert.equal(await page.evaluate(() => window.Prototype.shadow.activeElement?.matches('input[type="checkbox"]')
        && window.Prototype.shadow.activeElement.closest('.network-options') !== null), true, 'Network location did not reach a checkbox');
      await click('#section-rules .section-heading');
      await action('toggle').click();
      assert.equal(await page.evaluate(() => window.Prototype.shadow.activeElement?.matches('input[role="switch"]')), true, 'The rule locator focused a non-interactive switch wrapper');
      await reset();
      await openPage('pages/progress/index');
      await action('onRegistrationChange').click();
      assert.equal(await page.evaluate(() => window.Prototype.shadow.activeElement?.matches('input[type="checkbox"]')), true, 'Registration location did not reach its checkbox');
      await native('#progress').fill('invalid');
      await click('.entry-secondary');
      await page.locator('#platform-layer h2').waitFor({ state: 'visible' });
      const before = await page.locator('#native-page').evaluate(element => element.scrollTop);
      await action('onRegistrationChange').click();
      assert.equal(await page.evaluate(() => window.Prototype.shadow.activeElement), null, 'The inspector focused a source control behind the platform modal');
      assert.equal(await page.locator('#native-page').evaluate(element => element.scrollTop), before, 'The inspector scrolled a background form behind the platform modal');
      await page.locator('#platform-layer button').filter({ hasText: '继续填写' }).click();
      await reset();
      await openPage('pages/detail/index');
      await click('button[data-handler="openRules"]');
      const sheetScroll = await native('.sheet-body').evaluate(element => element.scrollTop);
      await action('editProgress').click();
      const backgroundFocused = await page.evaluate(() => {
        const active = window.Prototype.shadow.activeElement;
        return Boolean(active && !active.closest('.sheet'));
      });
      assert.equal(backgroundFocused, false, 'The inspector focused a control behind the active sheet');
      assert.equal(await native('.sheet-body').evaluate(element => element.scrollTop), sheetScroll, 'The inspector moved the active sheet while targeting its background');
      await capture('inspector-respects-sheet-boundary');
    });
  } finally { await page.close(); page = originalPage; }
}

async function runR8CardRegressions() {
  await check('The per-card selector explains ineligible cards and still permits eligible participation', async () => {
    await reset();
    const cards = await page.evaluate(async () => ({
      ineligible: await window.Prototype.api.command('card.save', {
        bankId: 'boc', issuerId: 'boc-mo', kind: 'credit', network: 'visa', nickname: '澳门Visa不匹配验收',
      }),
      eligible: await window.Prototype.api.command('card.save', {
        bankId: 'boc', issuerId: 'boc-mo', kind: 'credit', network: 'mastercard', nickname: '澳门Mastercard匹配验收',
      }),
    }));
    await page.evaluate(async () => { await window.Prototype.navigate('pages/detail/index?id=annual'); });
    await waitRoute('detail');
    await click('button[data-handler="openManage"]');
    await click('button[data-handler="anotherCard"]');
    const rejected = native(`.card-option[data-id="${cards.ineligible.id}"]`);
    assert.equal(await rejected.isDisabled(), true, 'The source selector still permits a card rejected by the domain');
    assert.ok((await rejected.textContent()).includes('不能用于这项活动'), 'The source selector does not explain why this card is unavailable');
    assert.ok(!(await rejected.textContent()).includes('仍可手动记录'), 'The source selector still promises an unsupported manual override');
    assert.equal(await native('.sheet-confirm').isDisabled(), true, 'Participation can continue before an eligible card is selected');
    await capture('card-selector-ineligible-explained');
    await native(`.card-option[data-id="${cards.eligible.id}"]`).click();
    await click('.sheet-confirm');
    await settled();
    assert.equal((await data()).detail.participation.cardId, cards.eligible.id, 'An eligible card could not join its separate participation');
    assert.equal((await data()).showCards, false, 'Successful eligible selection did not close the sheet');
  });

  await check('Existing card-scoped receipt records remain correctable after card eligibility changes', async () => {
    await reset();
    const id = await page.evaluate(async () => {
      const detail = await window.Prototype.api.query('activity.get', { activityId: 'annual' });
      const record = detail.participation;
      const session = await window.Prototype.api.query('session.get', {});
      await window.Prototype.api.command('reward.confirm', { participationId: record.id, amountMinor: 4000, receivedOn: session.today, expectedVersion: record.version });
      await window.Prototype.api.command('card.save', { id: record.cardId, bankId: 'boc', issuerId: 'boc-mo', kind: 'credit', network: 'visa', nickname: '已有关联记录卡片' });
      await window.Prototype.navigate(`pages/detail/index?id=annual&participationId=${encodeURIComponent(record.id)}`);
      return record.id;
    });
    await waitRoute('detail');
    await clickDetailAction('receipt');
    await waitRoute('receipt');
    assert.equal((await data()).participation.id, id, 'Correction opened a different per-card record');
    assert.equal((await data()).isEditing, true, 'An existing receipt became a new participation form');
    await native('#amount').fill('41.25');
    await click('.entry-primary');
    await waitRoute('detail');
    assert.equal((await data()).detail.participation.id, id, 'Correcting the existing record duplicated participation');
    assert.equal((await data()).detail.participation.receivedMinor, 4125, 'Current eligibility rules blocked correction of an existing receipt');
    await capture('existing-card-record-correction-retained');
  });
}

async function runR7ImageRegressions() {
  async function fixture() {
    return page.evaluate(async () => {
      const session = await window.Prototype.api.query('session.get', {});
      const assets = [];
      for (const [label, color] of [['A', '#cc3333'], ['B', '#3366cc']]) {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 320, 180);
        context.fillStyle = '#ffffff'; context.font = 'bold 100px sans-serif'; context.fillText(label, 120, 125);
        const content = canvas.toDataURL('image/png');
        const fileId = await new Promise((resolve, reject) => wx.getFileSystemManager().saveFile({ tempFilePath: content, success: value => resolve(value.savedFilePath), fail: reject }));
        const id = `image_r7_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const size = atob(content.split(',')[1]).length;
        await window.Prototype.api.command('asset.register', { id, fileId, cloudPath: `uploads/${session.userId}/${id}.png`, mime: 'image/png', size });
        assets.push({ id, fileId });
      }
      const detail = await window.Prototype.api.query('activity.get', { activityId: 'monthly' });
      const { id, revision, status, publishedAt, updatedAt, publishedBy, ...draft } = detail.activity;
      draft.title = '图片异步加载验收稿件';
      draft.entrance = { kind: 'guide', label: '参与入口', instructions: '请查看入口图片。', imageIds: assets.map(asset => asset.id) };
      const submission = await window.Prototype.api.command('submission.save', { draft });
      return { submissionId: submission.id, assets };
    });
  }
  async function installGate(ids, actions) {
    await page.evaluate(({ ids, actions }) => {
      const api = window.Prototype.api;
      const state = window.__acceptanceImageGate = {
        api, originalQuery: api.query, originalPreview: wx.previewImage,
        active: true, held: new Set(), pending: [], previewCalls: [],
      };
      api.query = async function (action, payload) {
        const result = await state.originalQuery.call(api, action, payload);
        if (state.active && actions.includes(action) && !state.held.has(action)
          && payload.ids?.length === ids.length && ids.every(id => payload.ids.includes(id))) {
          state.held.add(action);
          return new Promise(resolve => state.pending.push({ action, result, resolve }));
        }
        return result;
      };
      wx.previewImage = function (options) {
        state.previewCalls.push({ urls: [...options.urls], current: options.current });
        return state.originalPreview.call(wx, options);
      };
    }, { ids, actions });
  }
  async function releaseGate() {
    await page.evaluate(async () => {
      const state = window.__acceptanceImageGate;
      state.active = false;
      for (const item of state.pending) item.resolve(item.result);
      // Drain the source controller's promise continuations before observing the result.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }
  async function restoreGate() {
    await page.evaluate(async () => {
      const state = window.__acceptanceImageGate;
      if (!state) return;
      state.active = false;
      for (const item of state.pending) item.resolve(item.result);
      state.api.query = state.originalQuery;
      wx.previewImage = state.originalPreview;
      delete window.__acceptanceImageGate;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }

  await check('Removing an image during initial loading rejects stale assets and previews only the remaining image', async () => {
    await reset();
    const value = await fixture();
    const [removed, remaining] = value.assets;
    try {
      await installGate(value.assets.map(asset => asset.id), ['assets.get', 'assets.urls']);
      await openPage(`pages/submission-edit/index?id=${encodeURIComponent(value.submissionId)}`);
      await waitUntil(async () => page.evaluate(() => window.__acceptanceImageGate.pending.length === 2), 'Initial image responses were not deferred');
      assert.deepEqual((await data()).sourceImageIds, [], 'The fixture must contain entrance images only');
      await native('.section-heading[data-section="entrance"]').click();
      assert.equal(await native('.image-preview:disabled').count(), 2, 'The initial image reads did not expose the loading state');
      assert.equal(await native('.remove-image:enabled').count(), 2, 'The loading image rows cannot be removed through the interface');
      await native(`.remove-image[data-id="${removed.id}"]`).click();
      await waitUntil(async () => {
        const state = await data();
        return !state.loadingImages && state.imageRows.length === 1 && state.imageRows[0].id === remaining.id && state.imageRows[0].url;
      }, 'Removing image A did not reload the remaining image B');
      // Release the obsolete A/B response after the newer B response has settled.
      await releaseGate();
      await settled();
      const state = await data();
      assert.deepEqual(state.draft.entrance.imageIds, [remaining.id]);
      assert.deepEqual(state.imageRows.map(item => item.id), [remaining.id]);
      assert.deepEqual(state.assets.map(item => item.id), [remaining.id], 'The obsolete response restored the removed asset');
      assert.deepEqual(state.assetUrls.map(item => item.id), [remaining.id], 'The obsolete response restored the removed image URL');
      await native(`.image-preview[data-id="${remaining.id}"]`).click();
      await page.locator('#platform-layer img').waitFor({ state: 'visible' });
      const calls = await page.evaluate(() => window.__acceptanceImageGate.previewCalls);
      assert.deepEqual(calls, [{ urls: [remaining.fileId], current: remaining.fileId }], 'Preview included an image that is no longer in the entrance');
      await capture('r7-image-stale-load-filtered', { previewCalls: calls, remainingImageId: remaining.id, removedImageId: removed.id });
      await page.locator('#platform-layer button').filter({ hasText: '关闭预览' }).click();
    } finally { await restoreGate(); }
  });

  await check('Removing the preview target before its URL response prevents a late image dialog', async () => {
    await reset();
    const value = await fixture();
    const [removed, remaining] = value.assets;
    await openPage(`pages/submission-edit/index?id=${encodeURIComponent(value.submissionId)}`);
    await waitUntil(async () => !(await data()).loadingImages && (await data()).assets.length === 2, 'The image fixture did not finish loading');
    await native('.section-heading[data-section="entrance"]').click();
    await native(`.remove-image[data-id="${removed.id}"]`).click();
    assert.deepEqual((await data()).draft.entrance.imageIds, [remaining.id]);
    await waitUntil(async () => !(await data()).loadingImages && (await data()).assets.length === 1, 'The remaining image did not settle before preview');
    try {
      await installGate([remaining.id], ['assets.urls']);
      await native(`.image-preview[data-id="${remaining.id}"]`).click();
      await waitUntil(async () => page.evaluate(() => window.__acceptanceImageGate.pending.length === 1), 'The final preview URL response was not deferred');
      assert.equal(await page.locator('#platform-layer img').count(), 0, 'Preview opened before the deferred URL response');
      await native(`.remove-image[data-id="${remaining.id}"]`).click();
      await waitUntil(async () => (await data()).imageRows.length === 0, 'The pending preview target was not removed through the interface');
      await releaseGate();
      await settled();
      assert.deepEqual((await data()).draft.entrance.imageIds, []);
      const calls = await page.evaluate(() => window.__acceptanceImageGate.previewCalls);
      assert.deepEqual(calls, [], 'The late response invoked native preview after its target was removed');
      assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0, 'The late response opened a platform dialog');
      assert.equal(await page.locator('#platform-layer img').count(), 0, 'The late response displayed the removed image');
      await capture('r7-image-late-preview-cancelled', { previewCalls: calls, removedImageId: remaining.id });
    } finally { await restoreGate(); }
  });
}

async function runR8StorageRegressions() {
  // Faults stay inside the active remote browser and are restored after every case.
  const installStorageFaults = async ({ writeFailure = false, deleteFailure = false } = {}) => {
    await page.evaluate(({ writeFailure, deleteFailure }) => {
      const state = window.__r8StorageFaults || {
        setItem: Storage.prototype.setItem,
        removeItem: Storage.prototype.removeItem,
        getItem: Storage.prototype.getItem,
        writeKeys: [],
        deleteKeys: [],
      };
      state.writeFailure = writeFailure;
      state.deleteFailure = deleteFailure;
      window.__r8StorageFaults = state;
      Storage.prototype.setItem = function (key, value) {
        if (state.writeFailure) {
          state.writeKeys.push(key);
          throw new DOMException('Injected write-only storage quota failure', 'QuotaExceededError');
        }
        return state.setItem.call(this, key, value);
      };
      Storage.prototype.removeItem = function (key) {
        if (state.deleteFailure) {
          state.deleteKeys.push(key);
          throw new DOMException('Injected storage deletion failure', 'SecurityError');
        }
        return state.removeItem.call(this, key);
      };
    }, { writeFailure, deleteFailure });
  };
  const restoreStorage = async () => {
    await page.evaluate(() => {
      const state = window.__r8StorageFaults;
      if (!state) return;
      Storage.prototype.setItem = state.setItem;
      Storage.prototype.removeItem = state.removeItem;
      // The read method is never replaced by these regressions.
      delete window.__r8StorageFaults;
    });
  };
  const expectRoute = async name => {
    await waitUntil(async () => await page.evaluate(name =>
      window.Prototype.current?.route === 'pages/' + name + '/index', name),
    'Storage regression did not reach ' + name);
  };
  const openLeadFromMine = async () => {
    await native('.menu-row[data-handler="openSubmission"]').click();
    await expectRoute('submission-lead');
  };
  const fillAndSaveLead = async (title, sourceNote) => {
    await native('#title').fill(title);
    await native('#sourceNote').fill(sourceNote);
    await native('.lead-dock .secondary-button').click();
    await waitUntil(async () => (await data()).localDraftStatus === '本机草稿已保存，尚未提交',
      'The source lead editor did not report the saved draft');
  };
  const leaveSavedLead = async () => {
    await page.locator('#native-back').click();
    const confirm = page.locator('#platform-layer button').filter({ hasText: /^离开$/ });
    await confirm.waitFor({ state: 'visible' });
    await confirm.click();
    await expectRoute('mine');
    await settled();
  };
  const recoverLead = async () => {
    await openLeadFromMine();
    const recover = page.locator('#platform-layer button').filter({ hasText: '恢复草稿' });
    await recover.waitFor({ state: 'visible' });
    await recover.click();
    await settled();
  };
  const leadDraftKey = async () => [
    'card-benefits.form-draft.v1', 'submission-lead', (await data()).ownerId, 'new',
  ].map(encodeURIComponent).join(':');
  const draftSnapshot = async key => page.evaluate(key => {
    const raw = localStorage.getItem('wankapai.prototype.' + key);
    return {
      persisted: raw === null ? null : JSON.parse(raw),
      visible: wx.getStorageSync(key) ?? null,
      readsUnmodified: Storage.prototype.getItem === window.__r8StorageFaults.getItem,
      failedWrites: [...window.__r8StorageFaults.writeKeys],
      failedDeletes: [...window.__r8StorageFaults.deleteKeys],
    };
  }, key);
  const expectMemoryWarning = async () => {
    const warning = page.locator('#prototype-storage-warning');
    await warning.waitFor({ state: 'visible' });
    const text = await warning.innerText();
    assert.ok(text.includes('仅在此页面暂存') && text.includes('请勿刷新或关闭'),
      'The memory-only persistence warning did not explain the temporary lifetime');
    assert.equal(await warning.getAttribute('role'), 'status');
    assert.equal(await warning.getAttribute('aria-live'), 'polite');
    assert.equal(await page.evaluate(() =>
      Storage.prototype.getItem === window.__r8StorageFaults.getItem), true,
    'Quota and deletion faults must leave localStorage reads available');
  };

  await check('Write-only quota faults preserve new and updated lead drafts through source UI recovery', async () => {
    try {
      for (const existingDraft of [false, true]) {
        await restoreStorage();
        await reset();
        await openPage('pages/mine/index');
        await openLeadFromMine();
        await settled();
        const key = await leadDraftKey();
        if (existingDraft) await fillAndSaveLead('存储回归旧线索', '旧来源：银行 App → 旧入口');

        await installStorageFaults({ writeFailure: true });
        const expectedTitle = existingDraft ? '存储回归更新后的线索' : '存储回归新增线索';
        const expectedSource = '新来源：银行 App → 权益中心 → 活动规则';
        await fillAndSaveLead(expectedTitle, expectedSource);
        const saved = await draftSnapshot(key);
        assert.equal(saved.readsUnmodified, true);
        assert.ok(saved.failedWrites.includes('wankapai.prototype.' + key),
          'The source editor did not encounter the intended draft quota fault');
        assert.equal(saved.persisted?.value.lead.title ?? null, existingDraft ? '存储回归旧线索' : null,
          'The quota fixture unexpectedly changed persistent draft storage');
        assert.equal(saved.visible.value.lead.title, expectedTitle,
          'The storage adapter did not expose the latest in-memory draft');
        await expectMemoryWarning();

        await leaveSavedLead();
        await expectMemoryWarning();
        await recoverLead();
        assert.equal(await native('#title').inputValue(), expectedTitle,
          'Recovery lost the latest title during write-only quota failure');
        assert.equal(await native('#sourceNote').inputValue(), expectedSource,
          'Recovery lost the latest source during write-only quota failure');
        assert.equal((await data()).localDraftStatus, '已恢复本机草稿，尚未提交');
        await expectMemoryWarning();
        await capture(existingDraft ? 'r8-quota-updated-lead-recovered' : 'r8-quota-new-lead-recovered');
      }
    } finally {
      await restoreStorage();
      await reset();
    }
  });

  await check('Quota fallback keeps uploaded PNG thumbnails and source preview visible with a persistent warning', async () => {
    try {
      await reset();
      await openPage('pages/mine/index');
      await openLeadFromMine();
      await settled();
      await installStorageFaults({ writeFailure: true });
      // Generate only the file-picker fixture; image selection still uses the source upload action.
      const dataUrl = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 180;
        const drawing = canvas.getContext('2d');
        drawing.fillStyle = '#1764D9'; drawing.fillRect(0, 0, 320, 180);
        drawing.fillStyle = '#ffffff'; drawing.font = 'bold 42px sans-serif';
        drawing.fillText('QUOTA', 72, 105);
        return canvas.toDataURL('image/png');
      });
      const chooserPromise = page.waitForEvent('filechooser');
      await native('.upload-button').click();
      const chooser = await chooserPromise;
      await chooser.setFiles({
        name: 'r8-storage-quota.png', mimeType: 'image/png',
        buffer: Buffer.from(dataUrl.split(',')[1], 'base64'),
      });
      await waitUntil(async () => {
        const value = await data();
        return value.imageRows.length === 1 && !value.uploading && !value.loadingImages;
      }, 'The source lead editor did not finish the quota-fault image upload');
      await waitUntil(async () => native('img.image-thumbnail').evaluate(image =>
        image.complete && image.naturalWidth === 320 && image.naturalHeight === 180),
      'The uploaded image alias did not resolve to the PNG in memory');
      assert.equal((await data()).imageError, '');
      const fileId = (await data()).imageRows[0].url;
      const imageStorage = await page.evaluate(fileId => ({
        persisted: localStorage.getItem('wankapai.prototype.image:' + fileId),
        visible: wx.getStorageSync('image:' + fileId),
        failedWrites: window.__r8StorageFaults.writeKeys,
      }), fileId);
      assert.equal(imageStorage.persisted, null);
      assert.equal(imageStorage.visible, dataUrl);
      assert.ok(imageStorage.failedWrites.includes('wankapai.prototype.image:' + fileId));
      await expectMemoryWarning();
      await capture('r8-quota-image-thumbnail');

      await native('.image-preview').click();
      const preview = page.locator('#platform-layer img');
      await preview.waitFor({ state: 'visible' });
      await waitUntil(async () => preview.evaluate(image =>
        image.complete && image.naturalWidth === 320 && image.naturalHeight === 180),
      'The source image-preview action did not display the memory-backed PNG');
      assert.equal(await preview.getAttribute('src'), dataUrl);
      await expectMemoryWarning();
      await capture('r8-quota-image-preview');
      await page.locator('#platform-layer button').filter({ hasText: '关闭' }).click();
      await fillAndSaveLead('图片存储回归线索', '银行 App → 图片规则');
      await leaveSavedLead();
      await expectMemoryWarning();
      await recoverLead();
      await waitUntil(async () => native('img.image-thumbnail').evaluate(image =>
        image.complete && image.naturalWidth === 320 && image.naturalHeight === 180),
      'Reopening the source editor lost its memory-backed image');
      await expectMemoryWarning();
      await capture('r8-quota-image-recovered');
    } finally {
      await restoreStorage();
      await reset();
    }
  });

  await check('Failed draft deletion and reset prevent persisted stale drafts from returning', async () => {
    try {
      await reset();
      await openPage('pages/mine/index');
      await openLeadFromMine();
      await settled();
      await fillAndSaveLead('删除回归持久旧线索', '银行 App → 旧规则');
      const key = await leadDraftKey();
      await leaveSavedLead();
      await installStorageFaults({ deleteFailure: true });
      await openLeadFromMine();
      const discard = page.locator('#platform-layer button').filter({ hasText: '放弃草稿' });
      await discard.waitFor({ state: 'visible' });
      await discard.click();
      await settled();
      assert.equal(await native('#title').inputValue(), '');
      const deleted = await draftSnapshot(key);
      assert.equal(deleted.persisted.value.lead.title, '删除回归持久旧线索',
        'The deletion fault must leave the old physical record in place');
      assert.equal(deleted.visible, null,
        'A failed deletion must hide the physical draft through a tombstone');
      assert.ok(deleted.failedDeletes.includes('wankapai.prototype.' + key));
      await expectMemoryWarning();

      // A clean source editor leaves without a dirty-form confirmation.
      await page.locator('#native-back').click();
      await expectRoute('mine'); await settled();
      await openLeadFromMine(); await settled();
      assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0,
        'The discarded stale draft unexpectedly offered recovery');
      assert.equal(await native('#title').inputValue(), '');
      await capture('r8-delete-fault-does-not-restore-old-draft');

      // Reset must clear an in-memory replacement without reviving the old physical record.
      await installStorageFaults({ writeFailure: true, deleteFailure: true });
      await fillAndSaveLead('重置前仅内存的新线索', '银行 App → 仅内存新规则');
      assert.equal((await draftSnapshot(key)).visible.value.lead.title, '重置前仅内存的新线索');
      await reset();
      await settled();
      const cleared = await draftSnapshot(key);
      assert.equal(cleared.persisted.value.lead.title, '删除回归持久旧线索');
      assert.equal(cleared.visible, null,
        'Reset revived a stale disk value or retained the pre-reset memory override');
      await expectMemoryWarning();
      await openPage('pages/mine/index');
      await openLeadFromMine(); await settled();
      assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0,
        'Reset left an obsolete draft recovery prompt');
      assert.equal(await native('#title').inputValue(), '');
      assert.equal(await native('#sourceNote').inputValue(), '');
      await expectMemoryWarning();
      await capture('r8-reset-clears-quota-overrides-and-preserves-tombstones');
    } finally {
      await restoreStorage();
      await reset();
    }
  });
}

// Integrate this function into the main remote acceptance runner and invoke it once.
// Required runner globals: assert, page, native, data, check, reset, openPage,
// waitUntil, settled, and capture. This snippet performs no standalone execution.
async function runR8LeadTransferRegression() {
  await check('R8 completed lead-to-full submission returns to its list without an active duplicate lead', async () => {
    await reset();
    await openPage('pages/submissions/index');
    const title = '完整线索转稿验收';
    const listSubmissions = () => page.evaluate(async () =>
      (await window.Prototype.api.query('submissions.list', { limit: 50 })).items);
    const atRoute = name => page.evaluate(value =>
      window.Prototype.current.route === `pages/${value}/index`, name);
    const waitForRoute = async name => {
      await waitUntil(() => atRoute(name), `Lead transfer did not reach ${name}`);
      await settled();
    };
    assert.equal((await listSubmissions()).length, 0, 'The isolated reset unexpectedly retained submissions');

    await native('.new-button').click();
    await waitForRoute('submission-lead');
    const bankIndex = (await data()).bankOptions.findIndex(item => item.id === 'cmb');
    assert.ok(bankIndex >= 0, 'The lead bank selector is missing the fixture bank');
    await native('#field-bankId select').selectOption(String(bankIndex));
    await native('#title').fill(title);
    await native('#sourceNote').fill('银行 App → 信用卡 → 优惠活动；保留完整转稿的原始出处。');
    const chooserPromise = page.waitForEvent('filechooser');
    await native('.upload-button').click();
    await (await chooserPromise).setFiles({
      name: 'r8-transfer-source.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII=', 'base64'),
    });
    await waitUntil(async () => {
      const value = await data();
      return value.imageRows.length === 1 && !value.uploading && !value.loadingImages;
    }, 'The source screenshot did not finish uploading');
    const sourceLead = (await data()).lead;
    const ownerId = (await data()).ownerId;
    const readDraft = scope => page.evaluate(({ scope, ownerId }) => {
      const key = ['card-benefits.form-draft.v1', scope, ownerId, 'new'].map(encodeURIComponent).join(':');
      return window.wx.getStorageSync(key) || null;
    }, { scope, ownerId });
    await native('.full-form-link').click();
    await waitUntil(async () => await atRoute('submission-edit')
      || await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).count() > 0,
    'The full-form continuation did not navigate or request departure confirmation');
    if (await atRoute('submission-lead')) {
      await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click();
    }
    await waitForRoute('submission-edit');
    assert.equal((await data()).fromLead, true, 'The full form did not retain its entry context');
    assert.equal((await data()).importedLead, true, 'The full form did not import the source lead');
    assert.deepEqual((await data()).sourceImageIds, sourceLead.imageIds, 'The full form lost the original source screenshot reference');
    const leadDraftBefore = await readDraft('submission-lead');
    assert.deepEqual(leadDraftBefore?.value?.lead, sourceLead, 'The source lead was not preserved as a local draft');

    const issuer = native('#field-issuerIds input[type="checkbox"]').first();
    if (!(await issuer.isChecked())) await issuer.check();
    await native('#cardDescription').fill('适用招商银行信用卡。');
    await native('#conditions').fill('活动期内完成一笔合资格消费。');
    await native('.next-section[data-section="rules"]').click();
    const today = (await data()).today;
    await native('#field-startsOn input[type="date"]').fill(today);
    await native('#field-startsOn input[type="date"]').press('Tab');
    await native('#field-endsOn input[type="date"]').fill(`${Number(today.slice(0, 4)) + 1}-12-31`);
    await native('#field-endsOn input[type="date"]').press('Tab');
    await native('#targetText').fill('1');
    await native('#rewardText').fill('10');
    await native('.next-section[data-section="entrance"]').click();
    await native('#instructions').fill('银行 App → 信用卡 → 优惠活动 → 对应活动。');
    await native('.next-section[data-section="source"]').click();
    const fullDraftBefore = await readDraft('submission');
    assert.equal(fullDraftBefore?.value?.draft?.title, title, 'The full-form draft was not saved before submission');
    assert.deepEqual(fullDraftBefore.value.sourceImageIds, sourceLead.imageIds, 'The saved full-form draft lost source image recovery data');
    await capture('r8-lead-transfer-full-ready');

    await native('.editor-dock .primary-button').click();
    await waitForRoute('submissions');
    const rows = await listSubmissions();
    assert.equal(rows.length, 1, 'Completing the transfer did not create exactly one submission');
    assert.equal(rows[0].draft?.title, title, 'The intended full submission was not saved');
    assert.equal(rows[0].status, 'pending', 'The submitted full record did not remain under moderation');
    assert.equal(rows[0].lead, undefined, 'Completing the full form unexpectedly submitted the separate source lead');
    assert.deepEqual(rows[0].draft.entrance.imageIds, [], 'An unused source screenshot was automatically published as an entrance image');
    assert.equal((await data()).items.filter(item => item.id === rows[0].id).length, 1, 'The result list did not show the completed submission exactly once');
    assert.equal(await native('.lead-dock .primary-button').count(), 0, 'The completed destination retained a new-lead submit button');
    const stackAfterSave = await page.evaluate(() => window.getCurrentPages().map(item => item.route));
    assert.equal(stackAfterSave.at(-1), 'pages/submissions/index', 'The completed route was not the submissions list');
    assert.ok(!stackAfterSave.includes('pages/submission-lead/index'), 'The navigation stack retained the dirty source lead');
    assert.ok(!stackAfterSave.includes('pages/submission-edit/index'), 'The navigation stack retained the submitted full editor');
    assert.deepEqual(await readDraft('submission-lead'), leadDraftBefore, 'Successful full submission changed or deleted the original source draft');
    assert.equal(await readDraft('submission'), null, 'Successful full submission retained its own submitted draft');
    await capture('r8-lead-transfer-one-submission-list', { submissionId: rows[0].id, retainedSourceImageIds: sourceLead.imageIds, stackAfterSave });

    await page.locator('#native-back').click();
    await waitUntil(async () => !await atRoute('submissions'), 'Back navigation from the completed list did not finish');
    await settled();
    assert.equal(await atRoute('submission-lead'), false, 'Back navigation reopened the already-completed source lead');
    assert.equal(await atRoute('submission-edit'), false, 'Back navigation reopened the submitted full editor');
    assert.equal(await native('.lead-dock .primary-button').count(), 0, 'Back navigation exposed an accidental second lead submission');
    assert.equal((await listSubmissions()).length, 1, 'Back navigation created another submission');
    assert.deepEqual(await readDraft('submission-lead'), leadDraftBefore, 'Back navigation removed the retained source draft');
    await capture('r8-lead-transfer-safe-back');
  });
}

async function runR8GalleryRegressions() {
  async function fixture(publish = false) {
    return page.evaluate(async publish => {
      const session = await window.Prototype.api.query('session.get', {});
      const assets = [];
      for (const [label, color] of [['A', '#cc3333'], ['B', '#3366cc'], ['C', '#228844']]) {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 320, 180);
        context.fillStyle = '#ffffff'; context.font = 'bold 100px sans-serif'; context.fillText(label, 120, 125);
        const content = canvas.toDataURL('image/png');
        const fileId = await new Promise((resolve, reject) => wx.getFileSystemManager().saveFile({ tempFilePath: content, success: value => resolve(value.savedFilePath), fail: reject }));
        const id = `image_r8_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await window.Prototype.api.command('asset.register', {
          id, fileId, cloudPath: `uploads/${session.userId}/${id}.png`, mime: 'image/png', size: atob(content.split(',')[1]).length,
        });
        assets.push({ id, fileId });
      }
      const detail = await window.Prototype.api.query('activity.get', { activityId: 'monthly' });
      const { id, revision, status, publishedAt, updatedAt, publishedBy, ...draft } = detail.activity;
      draft.title = '图片预览定位验收稿件';
      draft.entrance = { kind: 'guide', label: '参与入口', instructions: '请按 A、B、C 的顺序查看入口图片。', imageIds: assets.map(asset => asset.id) };
      const submission = await window.Prototype.api.command('submission.save', { draft });
      const activity = publish ? await window.Prototype.api.command('submission.review', {
        id: submission.id, expectedVersion: submission.version, decision: 'publish', sourceVerified: true, draft,
      }) : null;
      return { submissionId: submission.id, activityId: activity?.id, assets };
    }, publish);
  }
  async function installResponses(ids, plans) {
    await page.evaluate(({ ids, plans }) => {
      const api = window.Prototype.api;
      const state = window.__acceptanceGalleryUrls = {
        api, originalQuery: api.query, originalPreview: wx.previewImage,
        plans: plans.map(plan => [...plan]), responses: [], previewCalls: [],
      };
      api.query = async function (action, payload) {
        const result = await state.originalQuery.call(api, action, payload);
        if (action !== 'assets.urls' || payload.ids?.length !== ids.length || !ids.every(id => payload.ids.includes(id))) return result;
        const byId = new Map(result.map(item => [item.id, item]));
        const plan = state.plans.shift();
        const returned = plan ? plan.map(id => byId.get(id)).filter(Boolean) : result;
        state.responses.push({ requestedIds: [...payload.ids], original: result, returned });
        return returned;
      };
      wx.previewImage = function (options) {
        state.previewCalls.push({ urls: [...options.urls], current: options.current });
        return state.originalPreview.call(wx, options);
      };
    }, { ids, plans });
  }
  async function restoreResponses() {
    await page.evaluate(() => {
      const state = window.__acceptanceGalleryUrls;
      if (!state) return;
      state.api.query = state.originalQuery;
      wx.previewImage = state.originalPreview;
      delete window.__acceptanceGalleryUrls;
    });
  }
  async function openEditor(value) {
    await openPage(`pages/submission-edit/index?id=${encodeURIComponent(value.submissionId)}`);
    await waitUntil(async () => {
      const state = await data();
      return !state.loadingImages && state.assets.length === 3 && state.imageRows.every(item => item.url);
    }, 'The three-image submission fixture did not load completely');
    await native('.section-heading[data-section="entrance"]').click();
    assert.deepEqual((await data()).sourceImageIds, [], 'The fixture must contain entrance images only');
    assert.deepEqual((await data()).imageRows.map(item => item.id), value.assets.map(asset => asset.id));
    assert.equal(await native('.image-preview:enabled').count(), 3);
  }
  async function closePreview() {
    await page.locator('#platform-layer button').filter({ hasText: '关闭预览' }).click();
  }

  await check('Partial and reordered preview URLs preserve the clicked image and original gallery order', async () => {
    await reset();
    const value = await fixture();
    const [a, b, c] = value.assets;
    const ids = value.assets.map(asset => asset.id);
    await openEditor(value);
    try {
      // Only the final preview URL lookups are changed; the initial A/B/C rows remain intact.
      await installResponses(ids, [[b.id, c.id], [c.id, a.id, b.id]]);
      for (const [index, name, expectedUrls] of [
        [0, 'partial', [b.fileId, c.fileId]],
        [1, 'reordered', [a.fileId, b.fileId, c.fileId]],
      ]) {
        await native(`.image-preview[data-id="${b.id}"]`).click();
        await page.locator('#platform-layer img').waitFor({ state: 'visible' });
        const actual = await page.evaluate(() => ({ calls: window.__acceptanceGalleryUrls.previewCalls, responses: window.__acceptanceGalleryUrls.responses }));
        assert.equal(actual.calls.length, index + 1);
        assert.deepEqual(actual.calls[index], { urls: expectedUrls, current: b.fileId }, `The ${name} response opened a different image or reordered the gallery`);
        assert.deepEqual((await data()).imageRows.map(item => item.id), ids, 'Preview changed the editor image rows');
        assert.deepEqual((await data()).draft.entrance.imageIds, ids);
        await capture(`r8-gallery-${name}-opens-b`, { actualPreview: actual.calls[index], returnedIds: actual.responses[index].returned.map(item => item.id), clickedImageId: b.id });
        await closePreview();
      }
    } finally { await restoreResponses(); }
  });

  await check('A missing selected image URL shows a Chinese recovery message instead of another image', async () => {
    await reset();
    const value = await fixture();
    const [a, b, c] = value.assets;
    const ids = value.assets.map(asset => asset.id);
    await openEditor(value);
    try {
      await installResponses(ids, [[a.id, c.id]]);
      await native(`.image-preview[data-id="${b.id}"]`).click();
      await waitUntil(async () => /这张图片暂时无法加载.*重新读取.*重试/.test((await data()).errors.imageIds || ''), 'The missing selected image did not expose a Chinese retry message');
      await settled();
      const state = await data();
      const actual = await page.evaluate(() => ({ calls: window.__acceptanceGalleryUrls.previewCalls, responses: window.__acceptanceGalleryUrls.responses }));
      assert.deepEqual(actual.calls, [], 'A different image was opened when the selected image URL was missing');
      assert.equal(await page.locator('#platform-layer img').count(), 0);
      assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0);
      assert.equal(await native('#field-imageIds .field-error').innerText(), state.errors.imageIds, 'The recovery message was not visible beside the image controls');
      assert.deepEqual(state.imageRows.map(item => item.id), ids);
      assert.deepEqual(state.draft.entrance.imageIds, ids);
      await capture('r8-gallery-selected-image-missing', { recoveryMessage: state.errors.imageIds, previewCalls: actual.calls, returnedIds: actual.responses[0].returned.map(item => item.id) });
    } finally { await restoreResponses(); }
  });

  await check('Partial detail image URLs preserve all asset identities and later screenshot buttons', async () => {
    await reset();
    await page.evaluate(async () => { await window.Prototype.scenarios.review(); });
    await settled();
    const value = await fixture(true);
    const [a, b, c] = value.assets;
    const ids = value.assets.map(asset => asset.id);
    assert.ok(value.activityId, 'The real demo moderation flow did not publish the image fixture');
    try {
      await installResponses(ids, [[b.id, c.id]]);
      await openPage(`pages/detail/index?id=${encodeURIComponent(value.activityId)}`);
      const state = await data();
      assert.deepEqual(state.detail.assets.map(asset => asset.id), ids);
      assert.deepEqual(state.view.entryImages.map(item => item.id), ids, 'The partial URL response removed or shifted an asset identity');
      const initial = await page.evaluate(() => window.__acceptanceGalleryUrls.responses);
      assert.equal(initial.length, 1);
      assert.deepEqual(initial[0].returned.map(item => item.id), [b.id, c.id]);
      // Demo file URLs can fall back locally; either a thumbnail or an empty-URL placeholder must retain A's identity.
      assert.equal(state.view.entryImages[0].id, a.id);
      await native('.entry-image-link').click();
      const buttons = native('.guide-image-button');
      assert.equal(await buttons.count(), 3, 'The guide dropped the image whose URL was omitted');
      assert.deepEqual(await buttons.evaluateAll(elements => elements.map(element => element.dataset.id)), ids, 'The guide buttons lost their asset identities');
      await capture('r8-gallery-detail-partial-identity', { requestedIds: ids, returnedIds: [b.id, c.id], retainedEntryImages: state.view.entryImages });
      for (const [position, asset] of [[1, b], [2, c]]) {
        assert.match(await buttons.nth(position).getAttribute('aria-label'), new RegExp(`第\\s*${position + 1}\\s*张`));
        await buttons.nth(position).click();
        await page.locator('#platform-layer img').waitFor({ state: 'visible' });
        const calls = await page.evaluate(() => window.__acceptanceGalleryUrls.previewCalls);
        assert.equal(calls.length, position);
        assert.deepEqual(calls[position - 1], { urls: value.assets.map(item => item.fileId), current: asset.fileId }, 'A later guide button opened a different asset after partial initial URLs');
        await capture(`r8-gallery-detail-position-${position + 1}`, { clickedPosition: position + 1, clickedImageId: asset.id, actualPreview: calls[position - 1] });
        await closePreview();
      }
    } finally { await restoreResponses(); }
  });
}

async function runR9RetryIntentRegressions() {
  const installCommitLoss = async (action, partialPayload) => page.evaluate(({ action, partialPayload }) => {
    const api = window.Prototype.api;
    const originalSet = wx.setStorageSync, originalCommand = api.command;
    const baseline = new Set(Object.keys(wx.getStorageSync('card-benefits.native.demo.v1').seed.requests || {}));
    const state = window.__acceptanceCommitLoss = { api, originalSet, originalCommand, calls: [], injected: null };
    api.command = async function (...args) {
      const call = { action: args[0], payload: JSON.parse(JSON.stringify(args[1])), options: args[2] || null };
      state.calls.push(call);
      try { const result = await originalCommand.apply(api, args); call.result = result; return result; }
      catch (error) { call.error = { code: error.code, message: error.message }; throw error; }
    };
    wx.setStorageSync = function (key, value) {
      const result = originalSet(key, value);
      if (key !== 'card-benefits.native.demo.v1' || state.injected) return result;
      const request = Object.values(value.seed.requests || {}).find(candidate => {
        if (baseline.has(candidate.id)) return false;
        const request = JSON.parse(candidate.fingerprint);
        return request.action === action && Object.entries(partialPayload).every(([key, value]) => request.payload[key] === value);
      });
      if (request) {
        state.injected = request;
        const error = new Error('验收模拟：操作已提交，但响应丢失'); error.code = 'NETWORK_ERROR'; throw error;
      }
      return result;
    };
  }, { action, partialPayload });
  const stopFault = async () => page.evaluate(() => {
    const state = window.__acceptanceCommitLoss;
    if (state) wx.setStorageSync = state.originalSet;
  });
  const restore = async () => page.evaluate(() => {
    const state = window.__acceptanceCommitLoss;
    if (!state) return;
    wx.setStorageSync = state.originalSet; state.api.command = state.originalCommand;
    delete window.__acceptanceCommitLoss;
  });
  const waitForLoss = async () => {
    await waitUntil(async () => page.evaluate(() => Boolean(window.__acceptanceCommitLoss.injected)
      && window.__acceptanceCommitLoss.calls.some(call => call.error?.code === 'NETWORK_ERROR')), 'The injected fault did not occur after the domain commit');
    await settled();
    await stopFault();
  };
  const requests = async (action, partialPayload) => page.evaluate(({ action, partialPayload }) =>
    Object.values(wx.getStorageSync('card-benefits.native.demo.v1').seed.requests || {}).filter(candidate => {
      const request = JSON.parse(candidate.fingerprint);
      return request.action === action && Object.entries(partialPayload).every(([key, value]) => request.payload[key] === value);
    }), { action, partialPayload });
  const nextDay = (value, offset) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };

  await check('A committed bill response loss does not replay an obsolete paid result after undo', async () => {
    await reset(); await openPage('pages/wallet/index');
    const bill = (await data()).groups.find(group => group.primaryBill && !group.primaryBill.paid).primaryBill;
    const button = () => native(`.bill-date-row button[data-id="${bill.id}"]`);
    try {
      await installCommitLoss('bill.update', { id: bill.id, paid: true });
      await button().click(); await waitForLoss();
      const committed = await page.evaluate(async id => (await window.Prototype.api.query('wallet.get', {})).bills.find(bill => bill.id === id), bill.id);
      assert.ok(committed.paidAt, 'The lost response must follow an actual committed payment marker');
      await page.evaluate(async () => { await window.Prototype.refresh(); }); await settled();
      assert.ok((await data()).raw.bills.find(item => item.id === bill.id).paidAt);
      await button().click(); await settled();
      assert.equal((await data()).raw.bills.find(item => item.id === bill.id).paidAt, null);
      await button().click(); await settled();
      assert.ok((await data()).raw.bills.find(item => item.id === bill.id).paidAt, 'The new paid intent replayed the obsolete first success');
      const paidRequests = await requests('bill.update', { id: bill.id, paid: true });
      assert.equal(paidRequests.length, 2, 'The new paid intent did not dispatch a distinct domain request');
      assert.notEqual(paidRequests[0].requestId, paidRequests[1].requestId);
      await capture('bill-response-loss-undo-mark-new-intent', { paidRequestIds: paidRequests.map(item => item.requestId), commands: await page.evaluate(() => window.__acceptanceCommitLoss.calls) });
    } finally { await restore(); }
  });

  await check('Card billing correction retires an older retry for the affected bill date', async () => {
    await reset(); await openPage('pages/wallet/index');
    const group = (await data()).groups.find(group => group.primaryBill && group.primaryCardId);
    const bill = (await data()).raw.bills.find(item => item.id === group.primaryBill.id);
    const dateA = nextDay(bill.dueOn, 1), dateB = nextDay(bill.dueOn, 2);
    await native(`.account-settings[data-id="${group.id}"]`).click();
    const datePicker = () => native(`.bill-meta-row [data-id="${bill.id}"] input[type="date"]`);
    try {
      await installCommitLoss('bill.update', { id: bill.id, dueOn: dateA });
      await datePicker().fill(dateA); await waitForLoss();
      await page.evaluate(async () => { await window.Prototype.refresh(); }); await settled();
      assert.equal((await data()).raw.bills.find(item => item.id === bill.id).dueOn, dateA);
      await native(`.account-edit[data-id="${group.primaryCardId}"]`).click();
      await waitRoute('card-edit');
      assert.equal((await data()).billingIndex, 0, 'The billing fixture must use its existing independent account');
      await native('#field-dueOn input[type="date"]').fill(dateB);
      await click('.save-button'); await waitRoute('wallet');
      assert.equal((await data()).raw.bills.find(item => item.id === bill.id).dueOn, dateB, 'The card editor did not correct its current bill');
      await datePicker().fill(dateA); await settled();
      assert.equal((await data()).raw.bills.find(item => item.id === bill.id).dueOn, dateA, 'The explicit bill change replayed a result superseded by card billing');
      const dateRequests = await requests('bill.update', { id: bill.id, dueOn: dateA });
      assert.equal(dateRequests.length, 2, 'The post-card-edit bill intent reused its obsolete request ID');
      await capture('card-billing-retires-bill-date-retry', { dueOn: dateA, requestIds: dateRequests.map(item => item.requestId), commands: await page.evaluate(() => window.__acceptanceCommitLoss.calls) });
    } finally { await restore(); }
  });

  await check('Rejoining after untracking creates a fresh tracking intent after a lost join response', async () => {
    await reset(); await openPage('pages/detail/index');
    const changeTracking = async handler => {
      await click('button[data-handler="openManage"]');
      await click(`.sheet-option[data-handler="${handler}"]`);
      await settled();
    };
    await changeTracking('untrack');
    assert.equal((await data()).detail.tracking.enabled, false);
    try {
      await installCommitLoss('activity.join', { activityId: 'monthly' });
      await changeTracking('join'); await waitForLoss();
      await page.evaluate(async () => { await window.Prototype.refresh(); }); await settled();
      assert.equal((await data()).detail.tracking.enabled, true, 'The failed response did not follow an actual committed join');
      await changeTracking('untrack');
      assert.equal((await data()).detail.tracking.enabled, false);
      await changeTracking('join');
      assert.equal((await data()).detail.tracking.enabled, true, 'Rejoining replayed the old result without restoring tracking');
      const observed = await requests('activity.join', { activityId: 'monthly' });
      const issued = observed.filter(item => !item.requestId.startsWith('seed-'));
      assert.equal(issued.length, 2, 'The second join did not use a fresh tracking request');
      await capture('join-response-loss-untrack-rejoin', { requestIds: issued.map(item => item.requestId), commands: await page.evaluate(() => window.__acceptanceCommitLoss.calls) });
    } finally { await restore(); }
  });
}

async function runR9PreviewCancellationRegressions() {
  async function fixture(publish = false) {
    return page.evaluate(async publish => {
      const session = await window.Prototype.api.query('session.get', {});
      const assets = [];
      for (const [label, color] of [['A', '#cc3333'], ['B', '#3366cc']]) {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 320, 180);
        context.fillStyle = '#ffffff'; context.font = 'bold 100px sans-serif'; context.fillText(label, 120, 125);
        const content = canvas.toDataURL('image/png');
        const fileId = await new Promise((resolve, reject) => wx.getFileSystemManager().saveFile({ tempFilePath: content, success: value => resolve(value.savedFilePath), fail: reject }));
        const id = `image_r9_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await window.Prototype.api.command('asset.register', {
          id, fileId, cloudPath: `uploads/${session.userId}/${id}.png`, mime: 'image/png', size: atob(content.split(',')[1]).length,
        });
        assets.push({ id, fileId });
      }
      const detail = await window.Prototype.api.query('activity.get', { activityId: 'monthly' });
      const { id, revision, status, publishedAt, updatedAt, publishedBy, ...draft } = detail.activity;
      draft.title = '图片预览取消验收稿件'; draft.scope = 'user'; draft.rewardKind = 'cashback';
      draft.entrance = { kind: 'guide', label: '参与入口', instructions: '请查看入口图片。', imageIds: assets.map(asset => asset.id) };
      const submission = await window.Prototype.api.command('submission.save', { draft });
      let activityId;
      let participationId;
      if (publish) {
        const activity = await window.Prototype.api.command('submission.review', {
          id: submission.id, expectedVersion: submission.version, decision: 'publish', sourceVerified: true, draft,
        });
        const joined = await window.Prototype.api.command('activity.join', { activityId: activity.id });
        const completed = await window.Prototype.api.command('participation.complete', { participationId: joined.id });
        activityId = activity.id; participationId = completed.id;
      }
      return { submissionId: submission.id, activityId, participationId, assets };
    }, publish);
  }
  async function installGate(ids) {
    await page.evaluate(ids => {
      const api = window.Prototype.api;
      const state = window.__acceptancePreviewCancellation = {
        api, originalQuery: api.query, originalPreview: wx.previewImage,
        held: false, pending: [], previewCalls: [],
      };
      api.query = async function (action, payload) {
        const result = await state.originalQuery.call(api, action, payload);
        if (action === 'assets.urls' && !state.held && payload.ids?.length === ids.length && ids.every(id => payload.ids.includes(id))) {
          state.held = true;
          return new Promise(resolve => state.pending.push({ action, payload, result, resolve }));
        }
        return result;
      };
      wx.previewImage = function (options) {
        const current = window.Prototype.current.data;
        state.previewCalls.push({
          urls: [...options.urls], current: options.current,
          context: { showGuide: current.showGuide, showExpected: current.showExpected, openSection: current.openSection },
        });
        return state.originalPreview.call(wx, options);
      };
    }, ids);
  }
  async function releaseGate() {
    await page.evaluate(async () => {
      const state = window.__acceptancePreviewCancellation;
      for (const item of state.pending) item.resolve(item.result);
      // Allow the original source handler to consume its response before checking for a late preview.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await settled();
  }
  async function restoreGate() {
    await page.evaluate(async () => {
      const state = window.__acceptancePreviewCancellation;
      if (!state) return;
      state.api.query = state.originalQuery;
      wx.previewImage = state.originalPreview;
      for (const item of state.pending) item.resolve(item.result);
      delete window.__acceptancePreviewCancellation;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }
  async function waitForHeldPreview() {
    await waitUntil(async () => page.evaluate(() => window.__acceptancePreviewCancellation.pending.length === 1), 'The final preview URL response was not deferred');
    assert.equal(await page.locator('#platform-layer img').count(), 0, 'The preview opened before the deferred URL response');
  }
  async function assertCancelled() {
    const calls = await page.evaluate(() => window.__acceptancePreviewCancellation.previewCalls);
    assert.deepEqual(calls, [], 'An abandoned preview request invoked the native image viewer');
    assert.equal(await page.locator('#platform-layer img').count(), 0, 'An abandoned preview displayed an image');
    assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0, 'An abandoned preview opened a platform dialog');
    return calls;
  }
  async function assertFreshPreview(value, selected) {
    await page.locator('#platform-layer img').waitFor({ state: 'visible' });
    const calls = await page.evaluate(() => window.__acceptancePreviewCancellation.previewCalls);
    assert.equal(calls.length, 1, 'A new preview should open exactly once after the previous request was cancelled');
    assert.deepEqual(calls[0].urls, value.assets.map(asset => asset.fileId));
    assert.equal(calls[0].current, selected.fileId, 'The new click did not select the requested image');
    return calls;
  }
  async function closePreview() {
    await page.locator('#platform-layer button').filter({ hasText: '关闭预览' }).click();
  }

  await check('Closing the detail guide cancels its pending preview without blocking a later new preview', async () => {
    await reset();
    await page.evaluate(async () => { await window.Prototype.scenarios.review(); });
    await settled();
    const value = await fixture(true);
    const [a, b] = value.assets;
    await openPage(`pages/detail/index?id=${encodeURIComponent(value.activityId)}&participationId=${encodeURIComponent(value.participationId)}`);
    assert.equal((await data()).detail.participation.stage, 'completed');
    await native('.entry-image-link').click();
    try {
      await installGate(value.assets.map(asset => asset.id));
      await native(`.guide-image-button[data-id="${a.id}"]`).click();
      await waitForHeldPreview();
      await native('.sheet-close').click();
      await waitUntil(async () => !(await data()).showGuide, 'The guide did not close through its source sheet control');
      await native('.date-setting').click();
      await waitUntil(async () => (await data()).showExpected, 'The expected-date sheet did not open');
      await releaseGate();
      const cancelledCalls = await assertCancelled();
      assert.equal((await data()).showGuide, false);
      assert.equal((await data()).showExpected, true, 'The cancelled preview disturbed the newly opened date sheet');
      await capture('r9-detail-preview-cancelled-over-date-sheet', { previewCalls: cancelledCalls });
      await native('.sheet-close').click();
      await waitUntil(async () => !(await data()).showExpected, 'The expected-date sheet did not close');
      await native('.entry-image-link').click();
      await native(`.guide-image-button[data-id="${b.id}"]`).click();
      const freshCalls = await assertFreshPreview(value, b);
      await capture('r9-detail-guide-new-preview-after-cancel', { previewCalls: freshCalls });
      await closePreview();
    } finally { await restoreGate(); }
  });

  await check('Changing full-submission sections cancels the old image preview and permits a later fresh click', async () => {
    await reset();
    const value = await fixture();
    const [a, b] = value.assets;
    await openPage(`pages/submission-edit/index?id=${encodeURIComponent(value.submissionId)}`);
    await waitUntil(async () => {
      const state = await data();
      return !state.loadingImages && state.assets.length === 2 && state.imageRows.every(item => item.url);
    }, 'The full-submission image fixture did not load');
    await native('.section-heading[data-section="entrance"]').click();
    try {
      await installGate(value.assets.map(asset => asset.id));
      await native(`.image-preview[data-scope="entrance"][data-id="${a.id}"]`).click();
      await waitForHeldPreview();
      await native('.section-heading[data-section="source"]').click();
      await waitUntil(async () => (await data()).openSection === 'source', 'The source section did not open through its source control');
      await releaseGate();
      const cancelledCalls = await assertCancelled();
      assert.equal((await data()).openSection, 'source', 'The cancelled preview disturbed the active source section');
      assert.deepEqual((await data()).draft.entrance.imageIds, value.assets.map(asset => asset.id), 'Cancelling preview changed the draft image membership');
      await capture('r9-submission-preview-cancelled-on-section-change', { previewCalls: cancelledCalls });
      await native('.section-heading[data-section="entrance"]').click();
      await native(`.image-preview[data-scope="entrance"][data-id="${b.id}"]`).click();
      const freshCalls = await assertFreshPreview(value, b);
      await capture('r9-submission-new-preview-after-section-return', { previewCalls: freshCalls });
      await closePreview();
    } finally { await restoreGate(); }
  });
}

async function runR9CardIntentRegression() {
  const nicknameA = '创建意图回归旅行卡';
  const nicknameB = '创建意图回归已更名卡';
  const expectRoute = async name => {
    await waitUntil(async () => await page.evaluate(name =>
      window.Prototype.current?.route === 'pages/' + name + '/index', name),
    'Card intent regression did not reach ' + name);
  };
  const addCard = async () => {
    await native('.page-heading button[data-handler="addCard"]').click();
    await expectRoute('card-edit');
  };
  const fillDebitCard = async nickname => {
    await native('.kind-button[data-kind="debit"]').click();
    await native('#card-nickname').fill(nickname);
  };
  const leaveCard = async () => {
    await page.locator('#native-back').click();
    const leave = page.locator('#platform-layer button').filter({ hasText: /^离开$/ });
    await leave.waitFor({ state: 'visible' });
    await leave.click();
    await expectRoute('wallet');
    await settled();
  };
  const draftKey = value => [
    'card-benefits.form-draft.v1', 'card', value.userId, value.draftEntityId,
  ].map(encodeURIComponent).join(':');
  const readSavedDraft = async key => page.evaluate(key => wx.getStorageSync(key) ?? null, key);
  const seedState = async () => page.evaluate(() => {
    const seed = wx.getStorageSync('card-benefits.native.demo.v1')?.seed;
    return { cards: Object.values(seed?.cards || {}), requests: Object.values(seed?.requests || {}) };
  });
  const traceState = async () => page.evaluate(() => {
    const state = window.__r9CardIntent;
    return {
      commands: state.commands,
      committedFailure: state.committedFailure,
      observedWritesBeforeFailure: state.observedWritesBeforeFailure,
    };
  });
  const restorePersistWrapper = async () => {
    await page.evaluate(() => {
      const state = window.__r9CardIntent;
      if (state) wx.setStorageSync = state.setStorageSync;
    });
  };
  const restoreAll = async () => {
    await page.evaluate(() => {
      const state = window.__r9CardIntent;
      if (!state) return;
      wx.setStorageSync = state.setStorageSync;
      state.api.command = state.command;
      delete window.__r9CardIntent;
    });
  };

  await check('Card creation intents survive a committed response loss and remain distinct after explicit draft rejection', async () => {
    try {
      await reset();
      await openPage('pages/wallet/index');
      const baselineCards = (await data()).raw.cards.filter(card => !card.archivedAt);
      await addCard();
      await settled();
      await fillDebitCard(nicknameA);
      const originalPage = await data();
      const originalIntent = originalPage.intentKey;
      const creationDraftKey = draftKey(originalPage);
      assert.ok(typeof originalIntent === 'string' && originalIntent.length > 0 && originalIntent.length <= 128);
      assert.equal(originalPage.draftEntityId, 'new:');

      await page.evaluate(({ nickname, baselineIds }) => {
        const api = window.Prototype.api;
        const state = window.__r9CardIntent = {
          api, command: api.command, setStorageSync: wx.setStorageSync,
          commands: [], committedFailure: null, observedWritesBeforeFailure: 0,
          baselineIds,
        };
        // Observe the actual source call without dropping the third options argument.
        api.command = function (...args) {
          state.commands.push({
            action: args[0],
            payload: JSON.parse(JSON.stringify(args[1])),
            options: args.length > 2 ? JSON.parse(JSON.stringify(args[2])) : null,
            argumentCount: args.length,
          });
          return state.command.apply(this, args);
        };
        wx.setStorageSync = function (...args) {
          // Commit the real seed first; the injected exception represents a lost response.
          const result = state.setStorageSync.apply(this, args);
          if (args[0] !== 'card-benefits.native.demo.v1' || state.committedFailure) return result;
          state.observedWritesBeforeFailure++;
          const seed = args[1]?.seed;
          const created = Object.values(seed?.cards || {}).find(card =>
            !state.baselineIds.includes(card.id) && !card.archivedAt &&
            card.nickname === nickname && card.kind === 'debit');
          if (!created) return result;
          const request = Object.values(seed?.requests || {}).find(record => {
            if (record.result?.id !== created.id || typeof record.fingerprint !== 'string') return false;
            try {
              const fingerprint = JSON.parse(record.fingerprint);
              return fingerprint.action === 'card.save' && !fingerprint.payload.id &&
                fingerprint.payload.nickname === nickname && fingerprint.payload.kind === 'debit';
            } catch { return false; }
          });
          if (!request) return result;
          state.committedFailure = { cardId: created.id, requestId: request.requestId, request, card: created };
          throw Object.assign(new Error('卡片已写入，但响应未收到，请重试。'), { code: 'NETWORK_ERROR' });
        };
      }, { nickname: nicknameA, baselineIds: baselineCards.map(card => card.id) });

      await native('.save-button').click();
      await waitUntil(async () => (await traceState()).committedFailure !== null,
        'The intended card creation was not persisted before the simulated response loss');
      await waitUntil(async () => !(await data()).saving,
        'The source editor remained busy after the committed response loss');
      await expectRoute('card-edit');
      const failed = await data();
      assert.equal(failed.dirty, true);
      assert.equal(failed.draftSaved, true);
      assert.equal(failed.nickname, nicknameA);
      assert.ok(failed.pendingCreationSignature,
        'An ambiguous creation failure must retain the submitted payload signature');
      const pendingDraft = await readSavedDraft(creationDraftKey);
      assert.equal(pendingDraft.value.intentKey, originalIntent);
      assert.equal(pendingDraft.value.pendingCreation.pending, true);
      assert.equal(pendingDraft.value.pendingCreation.intentKey, originalIntent);
      assert.equal(pendingDraft.value.pendingCreation.payloadSignature, failed.pendingCreationSignature);
      const firstTrace = await traceState();
      const firstCall = firstTrace.commands[0];
      assert.equal(firstCall.action, 'card.save');
      assert.equal(firstCall.argumentCount, 3);
      assert.deepEqual(firstCall.options, { intentKey: originalIntent });
      assert.equal(firstCall.payload.id, undefined);
      assert.equal(firstCall.payload.intentKey, undefined);
      assert.equal(JSON.stringify(firstCall.payload), failed.pendingCreationSignature);
      const originalId = firstTrace.committedFailure.cardId;
      assert.match(firstTrace.committedFailure.requestId, /^intent_[0-9a-f]{32}$/,
        'The browser adapter did not forward the source form creation intent to the real API');
      const committedCards = (await seedState()).cards.filter(card =>
        !card.archivedAt && card.nickname === nicknameA);
      assert.deepEqual(committedCards.map(card => card.id), [originalId],
        'The after-commit fixture must contain exactly one persisted card');
      await restorePersistWrapper();
      await capture('r9-card-committed-response-loss-retains-draft');

      await leaveCard();
      assert.equal((await data()).raw.cards.filter(card =>
        !card.archivedAt && card.nickname === nicknameA).length, 1);
      const walletCard = native('.loose-card').filter({ hasText: nicknameA });
      assert.equal(await walletCard.locator('button[data-handler="editCard"]').getAttribute('data-id'), originalId);
      await addCard();
      const recover = page.locator('#platform-layer button').filter({ hasText: '恢复核对' });
      await recover.waitFor({ state: 'visible' });
      const provisionalIntent = (await data()).intentKey;
      assert.notEqual(provisionalIntent, originalIntent,
        'A saved creation intent must not be adopted before recovery is confirmed');
      await recover.click();
      await settled();
      const recovered = await data();
      assert.equal(recovered.intentKey, originalIntent);
      assert.equal(recovered.nickname, nicknameA);
      assert.equal(recovered.pendingCreationSignature, failed.pendingCreationSignature);
      assert.equal(recovered.raw.cards.filter(card => !card.archivedAt && card.id === originalId).length, 1,
        'The recovered form must observe the card that already exists');
      await native('.save-button').click();
      await expectRoute('wallet');
      await settled();
      const replayTrace = await traceState();
      assert.equal(replayTrace.commands.length, 2);
      assert.deepEqual(replayTrace.commands[1].payload, firstCall.payload);
      assert.deepEqual(replayTrace.commands[1].options, { intentKey: originalIntent });
      assert.equal(replayTrace.commands[1].argumentCount, 3);
      const replayCards = (await data()).raw.cards.filter(card => !card.archivedAt);
      assert.equal(replayCards.length, baselineCards.length + 1);
      assert.deepEqual(replayCards.filter(card => card.nickname === nicknameA).map(card => card.id), [originalId]);
      assert.equal(await readSavedDraft(creationDraftKey), null,
        'A confirmed creation replay must clear its local pending draft');
      await capture('r9-card-recovered-intent-replays-one-card');

      // Editing an existing record uses its entity namespace and no creation options.
      const editButton = native('.loose-card').filter({ hasText: nicknameA }).locator('button[data-handler="editCard"]');
      assert.equal(await editButton.getAttribute('data-id'), originalId);
      await editButton.click();
      await expectRoute('card-edit'); await settled();
      assert.equal((await data()).draftEntityId, originalId);
      assert.equal((await data()).intentKey, '');
      await native('#card-nickname').fill(nicknameB);
      const editDraftKey = draftKey(await data());
      assert.notEqual(editDraftKey, creationDraftKey);
      const editingDraft = await readSavedDraft(editDraftKey);
      assert.equal(editingDraft.value.nickname, nicknameB);
      assert.equal(editingDraft.value.intentKey, undefined);
      assert.equal(editingDraft.value.pendingCreation, undefined);
      await native('.save-button').click();
      await expectRoute('wallet'); await settled();
      const editedCard = (await data()).raw.cards.find(card => card.id === originalId);
      assert.equal(editedCard.nickname, nicknameB);
      assert.equal(await readSavedDraft(editDraftKey), null);
      const editTrace = (await traceState()).commands[2];
      assert.equal(editTrace.payload.id, originalId);
      assert.equal(editTrace.argumentCount, 2);
      assert.equal(editTrace.options, null);

      // Create a real, fresh abandoned draft because successful replay cleared the old one.
      await addCard(); await settled();
      await fillDebitCard(nicknameA);
      const abandonedIntent = (await data()).intentKey;
      assert.notEqual(abandonedIntent, originalIntent);
      assert.equal((await readSavedDraft(creationDraftKey)).value.intentKey, abandonedIntent);
      await leaveCard();
      await addCard();
      const discard = page.locator('#platform-layer button').filter({ hasText: '放弃草稿' });
      await discard.waitFor({ state: 'visible' });
      const replacementIntent = (await data()).intentKey;
      assert.notEqual(replacementIntent, abandonedIntent);
      assert.notEqual(replacementIntent, originalIntent);
      await capture('r9-card-explicit-draft-rejection');
      await discard.click();
      await settled();
      assert.equal((await data()).nickname, '');
      assert.equal((await data()).intentKey, replacementIntent);
      assert.equal((await data()).pendingCreationSignature, '');
      assert.equal(await readSavedDraft(creationDraftKey), null,
        'Explicitly rejecting the draft must remove its abandoned creation namespace');
      await fillDebitCard(nicknameA);
      assert.equal((await data()).intentKey, replacementIntent);
      await native('.save-button').click();
      await expectRoute('wallet'); await settled();
      const finalCards = (await data()).raw.cards.filter(card => !card.archivedAt);
      const replacement = finalCards.filter(card => card.nickname === nicknameA);
      assert.equal(replacement.length, 1);
      assert.notEqual(replacement[0].id, originalId,
        'A fresh intent with the same visible payload must create a distinct card');
      assert.equal(finalCards.find(card => card.id === originalId).nickname, nicknameB);
      assert.equal(finalCards.length, baselineCards.length + 2);
      const finalTrace = await traceState();
      assert.equal(finalTrace.commands.length, 4);
      assert.deepEqual(finalTrace.commands[3].payload, firstCall.payload);
      assert.deepEqual(finalTrace.commands[3].options, { intentKey: replacementIntent });
      assert.equal(finalTrace.commands[3].argumentCount, 3);
      const creationRequests = (await seedState()).requests.filter(record => {
        try {
          const fingerprint = JSON.parse(record.fingerprint);
          return fingerprint.action === 'card.save' && !fingerprint.payload.id &&
            fingerprint.payload.nickname === nicknameA && fingerprint.payload.kind === 'debit';
        } catch { return false; }
      });
      assert.equal(creationRequests.length, 2,
        'Retry must reuse its stored request while a new creation intent gets a distinct request');
      assert.equal(new Set(creationRequests.map(request => request.requestId)).size, 2);
      assert.ok(creationRequests.some(request =>
        request.requestId === firstTrace.committedFailure.requestId && request.result.id === originalId));
      assert.ok(creationRequests.some(request =>
        request.requestId !== firstTrace.committedFailure.requestId && request.result.id === replacement[0].id));
      assert.equal(await readSavedDraft(creationDraftKey), null);
      await capture('r9-card-fresh-intent-creates-distinct-card');
    } finally {
      await restoreAll();
      await reset();
    }
  });
}

async function runR11ArchivedBillRegression() {
  await check('Archived unpaid bills explain unavailable WeChat reminders while preserving history controls', async () => {
    await reset(); await openPage('pages/wallet/index');
    const group = (await data()).groups.find(item => item.primaryBill && !item.primaryBill.paid && item.cards.length === 1);
    assert.ok(group, 'The archive fixture must contain an unpaid independent account');
    const billId = group.primaryBill.id;
    const originalBill = (await data()).raw.bills.find(item => item.id === billId);
    await native(`.account-settings[data-id="${group.id}"]`).click();
    await native(`.account-edit[data-id="${group.primaryCardId}"]`).click();
    await waitRoute('card-edit');
    await click('.remove-button');
    await page.locator('#platform-layer .platform-actions button').last().click();
    await waitRoute('wallet');
    const archived = (await data()).groups.find(item => item.id === group.id);
    assert.equal(archived.archived, true, 'Removing the final card did not retain an archived account');
    assert.equal(archived.reminderAvailable, false, 'The inactive account still advertises reminder availability');
    const renderedGroup = () => native(`.account-group:has(.account-settings[data-id="${group.id}"])`);
    assert.equal(await renderedGroup().locator('.reminder-button').count(), 0, 'The archived bill still offers a subscription that its worker cannot deliver');
    assert.ok((await renderedGroup().innerText()).includes('历史账单不再提供微信提醒'), 'The archived bill does not explain its reminder limitation');
    const settings = native(`.account-settings[data-id="${group.id}"]`);
    if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
    const date = new Date(`${originalBill.dueOn}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1);
    const revisedDate = date.toISOString().slice(0, 10);
    await renderedGroup().locator(`.bill-meta-row [data-id="${billId}"] input[type="date"]`).fill(revisedDate);
    await settled();
    assert.equal((await data()).raw.bills.find(item => item.id === billId).dueOn, revisedDate, 'Archiving removed the historical date correction');
    const paid = () => renderedGroup().locator(`.bill-date-row button[data-id="${billId}"]`);
    await paid().click(); await settled();
    assert.ok((await data()).raw.bills.find(item => item.id === billId).paidAt, 'The archived bill cannot be marked paid');
    await paid().click(); await settled();
    const restored = (await data()).raw.bills.find(item => item.id === billId);
    assert.equal(restored.paidAt, null, 'The archived bill cannot undo its manual paid marker');
    assert.equal(restored.periodKey, originalBill.periodKey, 'Historical controls changed the bill period');
    assert.equal(await renderedGroup().locator('.reminder-button').count(), 0);
    await capture('archived-bill-reminder-boundary-history-editable', { billId, periodKey: restored.periodKey, revisedDate });
  });
}

async function runR10CardDateRegressions() {
  const originalPage = page;
  const expectRoute = async name => {
    await waitUntil(async () => await page.evaluate(name =>
      window.Prototype.current?.route === 'pages/' + name + '/index', name),
    'Card date regression did not reach ' + name);
  };
  const advanceOctober = async () => {
    await page.evaluate(() => {
      window.__r10Clock.now = window.__r10Clock.NativeDate.parse('2026-10-01T04:00:00.000Z');
    });
  };
  const newCreditCard = async (nickname, dueOn) => {
    await native('.page-heading button[data-handler="addCard"]').click();
    await expectRoute('card-edit'); await settled();
    await native('#card-nickname').fill(nickname);
    await native('#field-billing input[role="switch"]').check();
    // Select the zero-based value explicitly because numeric labels also match strings.
    await native('#field-statementDay select').selectOption({ value: '4' });
    await native('#field-dueOn input').fill(dueOn);
    assert.equal((await data()).statementDay, 5);
    assert.equal((await data()).dueOn, dueOn);
  };
  const seedForCard = async cardId => page.evaluate(cardId => {
    const seed = wx.getStorageSync('card-benefits.native.demo.v1')?.seed;
    const card = seed?.cards?.[cardId];
    return {
      card,
      account: seed?.billing_accounts?.[card?.billingAccountId],
      cards: Object.values(seed?.cards || {}),
      bills: Object.values(seed?.bills || {}).filter(bill => bill.billingAccountId === card?.billingAccountId),
      requests: Object.values(seed?.requests || {}).filter(request => request.result?.id === cardId),
    };
  }, cardId);
  const trace = async () => page.evaluate(() => ({
    commands: window.__r10CardDate.commands,
    committedFailure: window.__r10CardDate.committedFailure,
  }));
  const installTrace = async ({ nickname, failAfterCommit = false }) => {
    await page.evaluate(({ nickname, failAfterCommit }) => {
      const api = Prototype.api;
      const seed = wx.getStorageSync('card-benefits.native.demo.v1')?.seed;
      const state = window.__r10CardDate = {
        api, command: api.command, setStorageSync: wx.setStorageSync,
        baselineIds: Object.keys(seed?.cards || {}), commands: [], committedFailure: null,
      };
      api.command = function (...args) {
        state.commands.push({
          action: args[0], payload: JSON.parse(JSON.stringify(args[1])),
          options: args[2] === undefined ? null : JSON.parse(JSON.stringify(args[2])),
          argumentCount: args.length, browserNow: new Date().toISOString(),
        });
        return state.command.apply(this, args);
      };
      if (!failAfterCommit) return;
      wx.setStorageSync = function (...args) {
        // Persist the real seed before losing the response; pre-read persistence cannot consume the fault.
        const result = state.setStorageSync.apply(this, args);
        if (args[0] !== 'card-benefits.native.demo.v1' || state.committedFailure) return result;
        const seed = args[1]?.seed;
        const card = Object.values(seed?.cards || {}).find(card =>
          !state.baselineIds.includes(card.id) && !card.archivedAt && card.nickname === nickname);
        const request = card && Object.values(seed?.requests || {}).find(record => {
          try {
            const fingerprint = JSON.parse(record.fingerprint);
            return record.result?.id === card.id && fingerprint.action === 'card.save' &&
              !fingerprint.payload.id && fingerprint.payload.nickname === nickname;
          } catch { return false; }
        });
        if (!request) return result;
        state.committedFailure = { cardId: card.id, requestId: request.requestId };
        throw Object.assign(new Error('卡片已写入，但响应未收到，请重试。'), { code: 'NETWORK_ERROR' });
      };
    }, { nickname, failAfterCommit });
  };
  const restorePersistWrapper = async () => {
    await page.evaluate(() => {
      if (window.__r10CardDate) wx.setStorageSync = window.__r10CardDate.setStorageSync;
    });
  };
  const restoreTrace = async () => {
    await page.evaluate(() => {
      const state = window.__r10CardDate;
      if (!state) return;
      wx.setStorageSync = state.setStorageSync;
      state.api.command = state.command;
      delete window.__r10CardDate;
    });
  };
  const revealAccount = async accountId => {
    const settings = native('.account-settings[data-id="' + accountId + '"]');
    if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
    const group = native('.account-group:has(.account-settings[data-id="' + accountId + '"])');
    await group.scrollIntoViewIfNeeded();
    return group;
  };
  const isolatedCheck = async (name, action) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    try {
      await context.addInitScript(() => {
        const NativeDate = window.Date;
        window.__r10Clock = { NativeDate, now: NativeDate.parse('2026-09-30T04:00:00.000Z') };
        window.Date = new Proxy(NativeDate, {
          construct(target, args) { return Reflect.construct(target, args.length ? args : [window.__r10Clock.now]); },
          apply() { return new NativeDate(window.__r10Clock.now).toString(); },
          get(target, property, receiver) {
            return property === 'now' ? () => window.__r10Clock.now : Reflect.get(target, property, receiver);
          },
        });
      });
      page = await context.newPage();
      attachDiagnostics(page);
      page.setDefaultTimeout(10000);
      const runtimeErrors = [];
      page.on('pageerror', error => runtimeErrors.push(error.message));
      await check(name, async () => {
        await page.goto(baseUrl, { waitUntil: 'load' });
        await page.waitForFunction(() => Prototype.ready && Prototype.current?.data);
        await settled();
        // Match the normal acceptance preview without altering source layout.
        await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{width:375px!important;height:812px!important;min-height:812px!important;max-height:812px!important;max-width:none!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
        await reset();
        await openPage('pages/wallet/index');
        await action();
        assert.deepEqual(runtimeErrors, [], 'The isolated card date regression raised a browser exception');
      });
    } finally {
      try { await restoreTrace(); } catch {}
      // Closing the isolated context discards its Date override, fixtures, and storage.
      try { await context.close(); } finally { page = originalPage; }
    }
  };

  await isolatedCheck('A recovered credit-card creation resolves its original committed result across a month boundary', async () => {
    const nickname = '跨月原意图重试验收卡';
    const baselineCount = (await data()).raw.cards.filter(card => !card.archivedAt).length;
    await newCreditCard(nickname, '2026-09-30');
    const before = await data();
    assert.equal(before.currentMonth, '2026-09');
    assert.equal(before.dueDay, 30);
    assert.equal(before.dueMonthOffset, 0);
    const intentKey = before.intentKey;
    await installTrace({ nickname, failAfterCommit: true });
    await native('.save-button').click();
    await waitUntil(async () => (await trace()).committedFailure !== null && !(await data()).saving,
      'The September creation was not persisted before the one-shot response loss');
    await expectRoute('card-edit');
    const pending = await data();
    const firstTrace = await trace();
    assert.equal(firstTrace.commands.length, 1);
    assert.equal(firstTrace.commands[0].argumentCount, 3);
    assert.deepEqual(firstTrace.commands[0].options, { intentKey });
    assert.equal(pending.dirty, true);
    assert.equal(pending.draftSaved, true);
    assert.ok(pending.pendingCreationSignature);
    const originalId = firstTrace.committedFailure.cardId;
    const persistedSeptember = await seedForCard(originalId);
    const septemberBill = persistedSeptember.bills.find(bill => bill.periodKey === '2026-09');
    assert.equal(septemberBill.statementOn, '2026-09-05');
    assert.equal(septemberBill.dueOn, '2026-09-30');
    await restorePersistWrapper();
    await native('#field-dueOn').scrollIntoViewIfNeeded();
    await capture('r10-september-creation-response-loss', { browserDate: '2026-09-30' });

    await advanceOctober();
    await page.locator('#native-back').click();
    await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click();
    await expectRoute('wallet'); await settled();
    assert.deepEqual((await data()).raw.cards.filter(card =>
      !card.archivedAt && card.nickname === nickname).map(card => card.id), [originalId]);
    await native('.page-heading button[data-handler="addCard"]').click();
    await expectRoute('card-edit');
    const recover = page.locator('#platform-layer button').filter({ hasText: '恢复核对' });
    await recover.waitFor({ state: 'visible' });
    await recover.click(); await settled();
    const recovered = await data();
    assert.equal(recovered.intentKey, intentKey);
    assert.equal(recovered.pendingCreationSignature, pending.pendingCreationSignature);
    assert.equal(recovered.pendingLookupOnly, true, 'An old-period creation must only look up its original result');
    assert.equal(await native('.save-button').innerText(), '核对上次保存结果');
    assert.equal(await native('#card-nickname').isDisabled(), true);
    assert.equal(await native('#field-dueOn input').isDisabled(), true);
    assert.equal(await native('#field-dueOn input').inputValue(), '2026-09-30');
    assert.equal(await page.evaluate(() => new Date().toISOString()), '2026-10-01T04:00:00.000Z');
    await native('.save-button').click();
    await waitUntil(async () => (await trace()).commands.length === 2,
      'The recovered original creation was blocked by a later-month form check instead of being replayed');
    await expectRoute('wallet'); await settled();
    const replay = (await trace()).commands[1];
    assert.deepEqual(replay.payload, firstTrace.commands[0].payload,
      'Cross-month recovery changed the original creation payload');
    assert.deepEqual(replay.options, { intentKey, replayOnly: true });
    assert.equal(replay.argumentCount, 3);
    const after = await seedForCard(originalId);
    const liveCards = after.cards.filter(card => !card.archivedAt);
    assert.equal(liveCards.length, baselineCount + 1);
    assert.deepEqual(liveCards.filter(card => card.nickname === nickname).map(card => card.id), [originalId]);
    assert.deepEqual(after.bills.find(bill => bill.periodKey === '2026-09'), septemberBill,
      'Replaying the committed intent changed its September bill snapshot');
    const creations = after.requests.filter(request => {
      try {
        const fingerprint = JSON.parse(request.fingerprint);
        return fingerprint.action === 'card.save' && !fingerprint.payload.id;
      } catch { return false; }
    });
    assert.equal(creations.length, 1);
    assert.equal(creations[0].requestId, firstTrace.committedFailure.requestId);
    await revealAccount(after.card.billingAccountId);
    await capture('r10-october-replay-keeps-original-card-and-bill', {
      browserDate: '2026-10-01', originalCardId: originalId, septemberDueOn: septemberBill.dueOn,
    });
  });

  await isolatedCheck('A nickname-only save from an open September editor preserves September and October bill dates', async () => {
    const nickname = '跨月账期保留验收卡';
    await newCreditCard(nickname, '2026-10-10');
    assert.equal((await data()).dueDay, 10);
    assert.equal((await data()).dueMonthOffset, 1);
    await native('.save-button').click();
    await expectRoute('wallet'); await settled();
    const card = (await data()).raw.cards.find(card => !card.archivedAt && card.nickname === nickname);
    assert.ok(card);
    const before = await seedForCard(card.id);
    const septemberBill = before.bills.find(bill => bill.periodKey === '2026-09');
    assert.equal(septemberBill.statementOn, '2026-09-05');
    assert.equal(septemberBill.dueOn, '2026-10-10');
    await revealAccount(card.billingAccountId);
    await native('.account-edit[data-id="' + card.id + '"]').click();
    await expectRoute('card-edit'); await settled();
    assert.equal((await data()).currentMonth, '2026-09');
    assert.equal(await native('#field-dueOn input').inputValue(), '2026-10-10');
    await native('#field-dueOn').scrollIntoViewIfNeeded();
    await capture('r10-open-september-card-editor', { browserDate: '2026-09-30' });
    await installTrace({ nickname });
    await advanceOctober();
    await native('#card-nickname').fill('跨月账期保留验收卡改名');
    // The only source edit after midnight is the nickname.
    assert.equal(await native('#field-dueOn input').inputValue(), '2026-10-10');
    await native('.save-button').click();
    await expectRoute('wallet'); await settled();
    const calls = (await trace()).commands;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'card.save');
    assert.equal(calls[0].payload.id, card.id);
    assert.equal(calls[0].payload.nickname, '跨月账期保留验收卡改名');
    const after = await seedForCard(card.id);
    assert.equal(after.card.nickname, '跨月账期保留验收卡改名');
    assert.equal(after.card.billingAccountId, card.billingAccountId);
    assert.deepEqual(after.bills.find(bill => bill.periodKey === '2026-09'), septemberBill,
      'Saving only the nickname changed the original September bill snapshot');
    const octoberBill = after.bills.find(bill => bill.periodKey === '2026-10');
    assert.ok(octoberBill, 'The wallet did not generate the real October bill');
    assert.equal(octoberBill.statementOn, '2026-10-05');
    assert.equal(octoberBill.dueOn, '2026-11-10',
      'A stale September form overwrote the October bill with the September due date');
    assert.equal(octoberBill.paidAt, null);
    assert.equal(after.account.statementDay, 5);
    assert.equal(after.account.dueDay, 10);
    assert.equal(after.account.dueMonthOffset, 1);
    const group = await revealAccount(card.billingAccountId);
    const visible = await group.innerText();
    assert.ok(visible.includes('2026年10月') && visible.includes('11 月 10 日'));
    await capture('r10-nickname-save-preserves-both-bill-periods', {
      browserDate: '2026-10-01', cardId: card.id,
      septemberDueOn: septemberBill.dueOn, octoberDueOn: octoberBill.dueOn,
    });
  });
}

// Drop this function into the remote acceptance runner and invoke it once.
// Required globals: assert, browser, baseUrl, page, native, data, check, reset,
// openPage, waitUntil, settled, and capture. No standalone execution is included.
async function runR10FullPendingDateRegression() {
  const previousPage = page;
  let isolatedContext;
  let isolatedPage;
  try {
    await check('R10 exact full-submission intent replays its committed result after the activity expires', async () => {
      isolatedContext = await browser.newContext({
        viewport: { width: 375, height: 812 }, deviceScaleFactor: 1,
        locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
      });
      await isolatedContext.addInitScript(() => {
        const NativeDate = window.Date;
        window.__r10FullClock = { NativeDate, now: NativeDate.parse('2026-09-30T04:00:00.000Z') };
        window.Date = new Proxy(NativeDate, {
          construct(target, args) {
            return Reflect.construct(target, args.length ? args : [window.__r10FullClock.now]);
          },
          apply() { return new NativeDate(window.__r10FullClock.now).toString(); },
          get(target, property, receiver) {
            return property === 'now' ? () => window.__r10FullClock.now : Reflect.get(target, property, receiver);
          },
        });
      });
      isolatedPage = await isolatedContext.newPage();
      page = isolatedPage;
      attachDiagnostics(page);
      page.setDefaultTimeout(12000);
      const runtimeErrors = [];
      page.on('pageerror', error => runtimeErrors.push(error.message));
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.waitForFunction(() => window.Prototype?.ready);
      await settled();
      await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{width:375px!important;height:812px!important;max-height:812px!important;max-width:none!important;min-height:0!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
      await reset();
      await openPage('pages/submissions/index');
      const title = '跨日完整投稿原意图重试验收';
      const listSubmissions = () => page.evaluate(async () =>
        (await window.Prototype.api.query('submissions.list', { limit: 50 })).items);
      const atRoute = name => page.evaluate(value =>
        window.Prototype.current.route === `pages/${value}/index`, name);
      const expectRoute = async name => {
        await waitUntil(() => atRoute(name), `The pending full submission did not reach ${name}`);
        await settled();
      };
      const traceState = () => page.evaluate(() => {
        const state = window.__r10FullPendingTrace;
        return { commands: state.commands, committedFailure: state.committedFailure };
      });
      const controllerState = () => page.evaluate(() => ({
        creationIntentKey: window.Prototype.current.creationIntentKey,
        pendingCreation: window.Prototype.current.pendingCreation,
      }));
      assert.equal((await listSubmissions()).length, 0, 'The isolated full-submission case did not start empty');
      await openPage('pages/submission-edit/index');
      assert.equal((await data()).today, '2026-09-30', 'The new full form did not load on the controlled September date');
      const originalIntent = (await controllerState()).creationIntentKey;
      assert.ok(typeof originalIntent === 'string' && originalIntent.length > 0 && originalIntent.length <= 128);
      const ownerId = (await data()).ownerId;
      const readSavedDraft = () => page.evaluate(ownerId => {
        const key = ['card-benefits.form-draft.v1', 'submission', ownerId, 'new'].map(encodeURIComponent).join(':');
        return window.wx.getStorageSync(key) || null;
      }, ownerId);
      const readSeedEvidence = () => page.evaluate(title => {
        const seed = window.wx.getStorageSync('card-benefits.native.demo.v1')?.seed || {};
        const submissions = Object.values(seed.submissions || {}).filter(item => item.draft?.title === title || item.lead?.title === title);
        const ids = submissions.map(item => item.id);
        const requests = Object.values(seed.requests || {}).filter(item => ids.includes(item.result?.id));
        const audit = Object.values(seed.audit_events || {}).filter(item => ids.includes(item.entityId));
        return { submissions, requests, audit };
      }, title);

      await native('#title').fill(title);
      const bankIndex = (await data()).bankOptions.findIndex(item => item.id === 'cmb');
      assert.ok(bankIndex >= 0);
      await native('#field-bankId select').selectOption(String(bankIndex));
      const issuer = native('#field-issuerIds input[type="checkbox"]').first();
      if (!(await issuer.isChecked())) await issuer.check();
      await native('#cardDescription').fill('适用招商银行信用卡。');
      await native('#conditions').fill('活动最后一天完成一笔合资格消费。');
      await native('.next-section[data-section="rules"]').click();
      await native('#field-startsOn input[type="date"]').fill('2026-09-30');
      await native('#field-startsOn input[type="date"]').press('Tab');
      await native('#field-endsOn input[type="date"]').fill('2026-09-30');
      await native('#field-endsOn input[type="date"]').press('Tab');
      await native('#targetText').fill('1');
      await native('#rewardText').fill('10');
      await native('.next-section[data-section="entrance"]').click();
      await native('#instructions').fill('银行 App → 信用卡 → 优惠活动 → 到期活动。');
      await native('.next-section[data-section="source"]').click();
      await native('#sourceNote').fill('银行 App → 信用卡 → 优惠活动；已在活动最后一天核对官方规则。');
      assert.equal((await data()).filledSections, 4, 'The full form was not completed through its source inputs');
      assert.equal((await data()).draft.startsOn, '2026-09-30');
      assert.equal((await data()).draft.endsOn, '2026-09-30');
      await native('.section-heading[data-section="rules"]').click();
      await capture('r10-full-pending-september-complete');

      await page.evaluate(title => {
        const api = window.Prototype.api;
        const seed = window.wx.getStorageSync('card-benefits.native.demo.v1')?.seed || {};
        const state = window.__r10FullPendingTrace = {
          api, originalCommand: api.command, originalSet: window.wx.setStorageSync,
          baselineIds: Object.keys(seed.submissions || {}), commands: [], committedFailure: null,
        };
        // Preserve all source arguments, including the explicit third-argument intent.
        api.command = async function (...args) {
          const call = {
            action: args[0], payload: JSON.parse(JSON.stringify(args[1])),
            options: args[2] === undefined ? null : JSON.parse(JSON.stringify(args[2])),
            argumentCount: args.length, browserNow: new Date().toISOString(),
          };
          state.commands.push(call);
          try {
            const result = await state.originalCommand.apply(this, args);
            call.result = JSON.parse(JSON.stringify(result));
            return result;
          } catch (error) {
            call.error = { code: error.code, message: error.message };
            throw error;
          }
        };
        window.wx.setStorageSync = function (...args) {
          // Persist the actual committed demo seed before simulating one lost response.
          const result = state.originalSet.apply(this, args);
          if (args[0] !== 'card-benefits.native.demo.v1' || state.committedFailure) return result;
          const nextSeed = args[1]?.seed;
          const created = Object.values(nextSeed?.submissions || {}).find(item =>
            !state.baselineIds.includes(item.id) && item.draft?.title === title);
          if (!created) return result;
          const request = Object.values(nextSeed?.requests || {}).find(record => {
            if (record.result?.id !== created.id || typeof record.fingerprint !== 'string') return false;
            try {
              const fingerprint = JSON.parse(record.fingerprint);
              return fingerprint.action === 'submission.save' && !fingerprint.payload.id
                && fingerprint.payload.draft?.title === title;
            } catch { return false; }
          });
          if (!request) return result;
          state.committedFailure = { submissionId: created.id, requestId: request.requestId, request, submission: created };
          throw Object.assign(new Error('验收模拟：投稿已写入，但提交响应丢失。'), { code: 'NETWORK_ERROR' });
        };
      }, title);

      await native('.editor-dock .primary-button').click();
      await waitUntil(async () => {
        const trace = await traceState();
        return trace.committedFailure && trace.commands.some(call => call.error?.code === 'NETWORK_ERROR');
      }, 'The full-submission fault did not follow a real committed and persisted result');
      await waitUntil(async () => !(await data()).saving, 'The full form remained busy after its lost response');
      await expectRoute('submission-edit');
      const firstTrace = await traceState();
      assert.equal(firstTrace.commands.length, 1, 'The first UI save dispatched more than once');
      const firstCall = firstTrace.commands[0];
      const originalId = firstTrace.committedFailure.submissionId;
      assert.equal(firstCall.action, 'submission.save');
      assert.equal(firstCall.argumentCount, 3, 'The source creation intent was not passed as the third argument');
      assert.deepEqual(firstCall.options, { intentKey: originalIntent });
      assert.equal(firstCall.payload.intentKey, undefined, 'The intent was incorrectly inserted into the business payload');
      assert.match(firstTrace.committedFailure.requestId, /^intent_[0-9a-f]{32}$/, 'The browser adapter did not forward the explicit creation intent');
      assert.equal(firstCall.payload.draft.endsOn, '2026-09-30');
      const savedPending = await readSavedDraft();
      assert.equal(savedPending?.value?.intentKey, originalIntent);
      assert.equal(savedPending.value.pendingCreation.pending, true);
      assert.equal(savedPending.value.pendingCreation.intentKey, originalIntent);
      assert.deepEqual(savedPending.value.pendingCreation.draft, firstCall.payload.draft, 'The persisted pending payload differs from the actual command');
      assert.deepEqual((await controllerState()).pendingCreation, savedPending.value.pendingCreation);
      assert.equal((await data()).pendingCreationUnconfirmed, true, 'The lost response was not explained as an unconfirmed submission');
      await native('.section-heading[data-section="basic"]').click();
      assert.equal(await native('#title').isDisabled(), true, 'An unknown creation result allowed the request title to change');
      assert.equal(await native('#field-bankId select').isDisabled(), true, 'An unknown creation result allowed the bank to change');
      await native('.section-heading[data-section="rules"]').click();
      assert.equal(await native('#field-endsOn input').isDisabled(), true, 'An unknown creation result allowed the original expiry to change');
      assert.equal((await controllerState()).creationIntentKey, originalIntent, 'Locking the pending request replaced its creation intent');
      const beforeRollover = await readSeedEvidence();
      assert.equal(beforeRollover.submissions.length, 1);
      assert.equal(beforeRollover.submissions[0].id, originalId);
      assert.equal(beforeRollover.requests.length, 1);
      assert.equal(beforeRollover.requests[0].requestId, firstTrace.committedFailure.requestId);
      await native('.draft-progress[role="status"]').scrollIntoViewIfNeeded();
      await capture('r10-full-pending-committed-response-loss', { originalId, requestId: firstTrace.committedFailure.requestId });
      await page.evaluate(() => { window.wx.setStorageSync = window.__r10FullPendingTrace.originalSet; });

      await page.locator('#native-back').click();
      await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click();
      await expectRoute('submissions');
      assert.equal((await listSubmissions()).length, 1, 'The committed full submission was missing before rollover');
      await page.evaluate(() => {
        window.__r10FullClock.now = window.__r10FullClock.NativeDate.parse('2026-10-01T04:00:00.000Z');
      });
      // An unconfirmed request recovers automatically so it cannot be discarded into a second creation.
      await page.evaluate(async () => { await window.Prototype.openPage('pages/submission-edit/index'); });
      await expectRoute('submission-edit');
      assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0, 'Pending recovery offered a discard path before resolving the original request');
      const recovered = await data();
      assert.equal(recovered.today, '2026-10-01', 'The recovered form did not load the current business date');
      assert.equal(recovered.draft.startsOn, '2026-09-30');
      assert.equal(recovered.draft.endsOn, '2026-09-30');
      assert.ok(recovered.draft.endsOn < recovered.today, 'The recovery did not exercise an expired activity');
      assert.equal(recovered.pendingCreationUnconfirmed, true);
      assert.equal((await controllerState()).creationIntentKey, originalIntent);
      assert.deepEqual((await controllerState()).pendingCreation, savedPending.value.pendingCreation, 'Automatic pending recovery changed the stored intent or payload');
      assert.deepEqual(recovered.draft, savedPending.value.draft, 'Recovery changed the visible full-form draft');
      assert.equal(recovered.targetText, savedPending.value.targetText);
      assert.equal(recovered.rewardText, savedPending.value.rewardText);
      if (recovered.openSection !== 'rules') await native('.section-heading[data-section="rules"]').click();
      assert.equal(await native('#field-endsOn input').isDisabled(), true, 'The recovered pending request allowed its original expiry to change');
      await native('#field-endsOn').scrollIntoViewIfNeeded();
      await capture('r10-full-pending-october-exact-recovery', { originalId, originalIntent, requestId: firstTrace.committedFailure.requestId });

      await native('.editor-dock .primary-button').click();
      await waitUntil(async () => (await traceState()).commands.length === 2, 'The exact expired pending submission was blocked before retry dispatch');
      await expectRoute('submissions');
      const finalTrace = await traceState();
      assert.equal(finalTrace.commands.length, 2, 'The retry dispatched an unexpected extra command');
      const replay = finalTrace.commands[1];
      assert.equal(replay.action, 'submission.save');
      assert.equal(replay.argumentCount, 3, 'The retry dropped the explicit intent options');
      assert.deepEqual(replay.options, { intentKey: originalIntent });
      assert.deepEqual(replay.payload, firstCall.payload, 'The cross-day retry changed the committed request payload');
      assert.equal(replay.error, undefined, 'The committed pending request did not return its prior result');
      assert.equal(replay.result?.id, originalId, 'The retry created or returned a different submission');
      assert.equal(replay.browserNow, '2026-10-01T04:00:00.000Z');
      const finalRows = await listSubmissions();
      assert.equal(finalRows.length, 1, 'The cross-day retry created a duplicate submission');
      assert.equal(finalRows[0].id, originalId);
      assert.equal(finalRows[0].status, 'pending');
      assert.equal(finalRows[0].version, 1, 'The retry mutated the already committed submission');
      const afterRollover = await readSeedEvidence();
      assert.deepEqual(afterRollover.submissions, beforeRollover.submissions, 'The idempotent retry altered the committed submission');
      assert.deepEqual(afterRollover.requests, beforeRollover.requests, 'The retry did not reuse the stored intent request');
      assert.deepEqual(afterRollover.audit, beforeRollover.audit, 'The retry created an extra submission audit event');
      assert.equal(await readSavedDraft(), null, 'The acknowledged pending full draft was not cleared');
      assert.deepEqual(runtimeErrors, [], 'The isolated boundary regression emitted a runtime exception');
      await capture('r10-full-pending-one-original-result', { originalId, requestId: firstTrace.committedFailure.requestId, commands: finalTrace.commands });
    });
  } finally {
    if (isolatedPage && !isolatedPage.isClosed()) {
      await isolatedPage.evaluate(() => {
        const trace = window.__r10FullPendingTrace;
        if (trace) {
          window.wx.setStorageSync = trace.originalSet;
          trace.api.command = trace.originalCommand;
          delete window.__r10FullPendingTrace;
        }
        if (window.__r10FullClock) {
          window.Date = window.__r10FullClock.NativeDate;
          delete window.__r10FullClock;
        }
      }).catch(() => {});
    }
    page = previousPage;
    await isolatedContext?.close();
  }
}

async function runR10SheetInterruptionRegression() {
  await check('Opening detail guidance cancels pending card preparation and a fresh card choice still joins correctly', async () => {
    await reset();
    await page.evaluate(async () => { await window.Prototype.scenarios.review(); });
    await settled();
    const value = await page.evaluate(async () => {
      const session = await window.Prototype.api.query('session.get', {});
      const assets = [];
      for (const [label, color] of [['A', '#cc3333'], ['B', '#3366cc']]) {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 320, 180);
        context.fillStyle = '#ffffff'; context.font = 'bold 100px sans-serif'; context.fillText(label, 120, 125);
        const content = canvas.toDataURL('image/png');
        const fileId = await new Promise((resolve, reject) => wx.getFileSystemManager().saveFile({ tempFilePath: content, success: result => resolve(result.savedFilePath), fail: reject }));
        const id = `image_r10_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await window.Prototype.api.command('asset.register', {
          id, fileId, cloudPath: `uploads/${session.userId}/${id}.png`, mime: 'image/png', size: atob(content.split(',')[1]).length,
        });
        assets.push({ id, fileId });
      }
      const detail = await window.Prototype.api.query('activity.get', { activityId: 'annual' });
      const { id, revision, status, publishedAt, updatedAt, publishedBy, ...draft } = detail.activity;
      draft.title = '选卡准备取消验收活动';
      draft.entrance = { kind: 'guide', label: '参与入口', instructions: '请查看入口图片。', imageIds: assets.map(asset => asset.id) };
      const submission = await window.Prototype.api.command('submission.save', { draft });
      const activity = await window.Prototype.api.command('submission.review', {
        id: submission.id, expectedVersion: submission.version, decision: 'publish', sourceVerified: true, draft,
      });
      const wallet = await window.Prototype.api.query('wallet.get', {});
      const card = wallet.cards.find(item => !item.archivedAt && item.bankId === 'boc' && item.issuerId === 'boc-mo' && item.network === 'mastercard' && item.kind === 'credit');
      return { activityId: activity.id, assets, scope: draft.scope, expectedCardId: card?.id };
    });
    assert.equal(value.scope, 'card');
    assert.ok(value.expectedCardId, 'The real demo wallet does not contain the qualifying BOC Macau Mastercard');
    await openPage(`pages/detail/index?id=${encodeURIComponent(value.activityId)}`);
    assert.equal((await data()).detail.participation, null, 'The fixture must start without a participation');
    assert.deepEqual((await data()).view.entryImages.map(item => item.id), value.assets.map(asset => asset.id));

    async function assertOnlySheet(expectedFlag, expectedId) {
      const state = await data();
      const openFlags = ['showGuide', 'showCards', 'showRules', 'showManage', 'showExpected'].filter(flag => state[flag]);
      assert.deepEqual(openFlags, [expectedFlag], 'The source controller exposed overlapping detail panels');
      const layers = await native('.sheet-layer').evaluateAll(elements => elements.map(element => ({ id: element.dataset.sheetId, inert: element.inert })));
      assert.deepEqual(layers, [{ id: expectedId, inert: false }], 'The visible sheet stack contains another panel or an inert foreground');
      return { openFlags, layers };
    }

    try {
      await page.evaluate(() => {
        const api = window.Prototype.api;
        const state = window.__acceptanceCardInterruption = {
          api, originalQuery: api.query, originalPreview: wx.previewImage,
          held: false, pending: [], queryCalls: [], previewCalls: [],
        };
        api.query = async function (action, payload) {
          state.queryCalls.push({ action, payload });
          const result = await state.originalQuery.call(api, action, payload);
          if (action === 'wallet.get' && !state.held) {
            state.held = true;
            return new Promise(resolve => state.pending.push({ action, payload, result, resolve }));
          }
          return result;
        };
        wx.previewImage = function (options) {
          state.previewCalls.push({ urls: [...options.urls], current: options.current });
          return state.originalPreview.call(wx, options);
        };
      });
      await clickDetailAction('join');
      await waitUntil(async () => page.evaluate(() => window.__acceptanceCardInterruption.pending.length === 1 && window.Prototype.current.data.busy), 'The initial card-preparation wallet response was not deferred');
      assert.equal(await native('.entry-image-link:enabled').count(), 1, 'Read-only guidance should remain available during card preparation');
      await native('.entry-image-link').click();
      await waitUntil(async () => {
        const state = await data();
        return state.showGuide && !state.busy;
      }, 'Opening guidance did not cancel card preparation and release its busy state');
      await assertOnlySheet('showGuide', 'detail-guide');
      await page.evaluate(async () => {
        for (const item of window.__acceptanceCardInterruption.pending) item.resolve(item.result);
        // Let the abandoned source request finish before checking the new context.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await settled();
      const guideState = await assertOnlySheet('showGuide', 'detail-guide');
      assert.equal((await data()).detail.participation, null, 'Interrupting card preparation created an unintended participation');
      await capture('r10-guide-survives-stale-wallet-response', guideState);
      await native(`.guide-image-button[data-id="${value.assets[0].id}"]`).click();
      await page.locator('#platform-layer img').waitFor({ state: 'visible' });
      const previewCalls = await page.evaluate(() => window.__acceptanceCardInterruption.previewCalls);
      assert.deepEqual(previewCalls, [{ urls: value.assets.map(asset => asset.fileId), current: value.assets[0].fileId }], 'The current guide image click was ignored or opened the wrong image');
      await capture('r10-guide-preview-after-card-interruption', { previewCalls });
      await page.locator('#platform-layer button').filter({ hasText: '关闭预览' }).click();
      await native('.sheet-close').click();
      await waitUntil(async () => !(await data()).showGuide, 'The guide did not close');
      assert.equal(await native('.sheet-layer').count(), 0);
      await clickDetailAction('join');
      await waitUntil(async () => {
        const state = await data();
        return state.showCards && !state.busy;
      }, 'A fresh join did not open the card chooser');
      await assertOnlySheet('showCards', 'detail-card-picker');
      const eligible = (await data()).cards.find(card => card.id === value.expectedCardId);
      assert.equal(eligible?.matches, true, 'The qualifying card was no longer selectable after interruption');
      await native(`.card-option[data-id="${value.expectedCardId}"]`).click();
      assert.equal((await data()).selectedCardId, value.expectedCardId);
      assert.equal(await native('.sheet-confirm:enabled').count(), 1);
      await native('.sheet-confirm').click();
      await waitUntil(async () => {
        const state = await data();
        return !state.busy && !state.loading && !state.refreshing && state.detail?.participation?.cardId === value.expectedCardId;
      }, 'Confirming the fresh card selection did not join with that card');
      await settled();
      assert.equal((await data()).showCards, false);
      assert.equal(await native('.sheet-layer').count(), 0);
      const stored = await page.evaluate(async activityId => window.Prototype.api.query('activity.get', { activityId }), value.activityId);
      assert.equal(stored.participation?.cardId, value.expectedCardId, 'The displayed card choice was not persisted by the real demo service');
      assert.equal(stored.participation.snapshot.scope, 'card');
      const walletQueries = await page.evaluate(() => window.__acceptanceCardInterruption.queryCalls.filter(item => item.action === 'wallet.get').length);
      assert.ok(walletQueries >= 2, 'The fresh join did not request current wallet data');
      await capture('r10-fresh-card-choice-joined', { participationId: stored.participation.id, cardId: stored.participation.cardId, walletQueries });
    } finally {
      await page.evaluate(async () => {
        const state = window.__acceptanceCardInterruption;
        if (!state) return;
        state.api.query = state.originalQuery;
        wx.previewImage = state.originalPreview;
        for (const item of state.pending) item.resolve(item.result);
        delete window.__acceptanceCardInterruption;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
    }
  });
}

// Drop into the remote acceptance runner and invoke once after the R11 source build.
// Required globals: browser, baseUrl, page, native, data, check, reset, openPage,
// waitUntil, settled, capture, assert, and attachDiagnostics.
async function runR11PreferencesRegressions() {
  const controls = ['#refresh-page', '#slow-next', '#fail-next'];
  const atRoute = name => page.evaluate(value => window.Prototype.current?.route === `pages/${value}/index`, name);
  const expectRoute = async name => {
    await waitUntil(() => atRoute(name), `The preference regression did not reach ${name}`);
    await settled();
  };
  const snapshot = () => page.evaluate(() => {
    const owner = window.Prototype.current;
    const d = owner.data;
    return {
      instance: owner._instanceId, route: owner.route, hash: location.hash,
      scrollTop: document.getElementById('native-page').scrollTop,
      newActivities: d.newActivities, deadlines: d.deadlines, rewards: d.rewards, repayments: d.repayments,
      helpExpanded: d.helpExpanded,
      dirty: d.dirty, saved: d.saved, saving: d.saving, loading: d.loading, ready: d.ready,
      error: d.error, leaveMessage: owner._leaveMessage, loadSequence: owner.loadSequence,
      inputs: [...window.Prototype.shadow.querySelectorAll('input[role="switch"]')].map(input => input.checked),
    };
  });
  const dialogs = () => page.evaluate(() => [...window.__r11PreferenceDialogs.titles]);
  const noDialog = async () => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0, 'A queued platform dialog was left open');
  };
  const queryPreferences = () => page.evaluate(async () => {
    const started = performance.now();
    try {
      const result = await window.Prototype.api.query('preferences.get', {});
      return { result, elapsedMs: performance.now() - started };
    } catch (error) { return { error: { code: error.code, message: error.message }, elapsedMs: performance.now() - started }; }
  });
  const assertImmediateQuery = async expectedValue => {
    const query = await queryPreferences();
    assert.equal(query.error, undefined, 'A rejected refresh leaked its simulated read failure');
    assert.ok(query.elapsedMs < 1200, `A rejected refresh leaked its 1600 ms delay: ${query.elapsedMs} ms`);
    if (expectedValue !== undefined) assert.equal(query.result.newActivities, expectedValue);
    return query;
  };
  const openFromMine = async () => {
    await openPage('pages/mine/index');
    await native('.menu-row[data-handler="openPreferences"]').click();
    await expectRoute('preferences');
  };
  const toggleNewActivity = async () => {
    await native('input[role="switch"]').first().setChecked(!(await data()).newActivities);
    await waitUntil(async () => (await data()).dirty, 'The source switch did not dirty preferences');
  };
  const scrollPreferenceContent = async () => {
    if (!(await data()).helpExpanded) await native('.note-toggle').click();
    await native('#reminder-help .note-copy').last().scrollIntoViewIfNeeded();
  };
  const cancelDialog = async () => {
    await page.locator('#platform-layer button').filter({ hasText: /^继续填写$/ }).click();
    await waitUntil(async () => page.evaluate(() => !window.Prototype.current?._prototypeRefreshing), 'The cancelled refresh lock was not released');
    await settled();
    await noDialog();
  };
  const freshCase = async (name, action) => {
    const previousPage = page;
    let context;
    let isolatedPage;
    try {
      await check(name, async () => {
        context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
        isolatedPage = await context.newPage();
        page = isolatedPage;
        page.setDefaultTimeout(12000);
        attachDiagnostics(page);
        await page.goto(baseUrl, { waitUntil: 'load' });
        await page.waitForFunction(() => window.Prototype?.ready);
        await settled();
        await reset();
        await page.evaluate(() => {
          const state = window.__r11PreferenceDialogs = { titles: [], known: new WeakSet(), observer: null };
          state.observer = new MutationObserver(records => {
            for (const record of records) for (const added of record.addedNodes) {
              if (!(added instanceof Element)) continue;
              const panels = added.matches('.platform-dialog') ? [added] : [...added.querySelectorAll('.platform-dialog')];
              for (const panel of panels) if (!state.known.has(panel)) {
                state.known.add(panel);
                state.titles.push(panel.getAttribute('aria-label'));
              }
            }
          });
          state.observer.observe(document.getElementById('platform-layer'), { childList: true, subtree: true });
        });
        await action();
      });
    } finally {
      if (isolatedPage && !isolatedPage.isClosed()) {
        await isolatedPage.evaluate(() => {
          const gate = window.__r11PreferenceGate;
          if (gate) {
            gate.release?.();
            gate.api.command = gate.originalCommand;
            delete window.__r11PreferenceGate;
          }
          window.__r11PreferenceDialogs?.observer?.disconnect();
          delete window.__r11PreferenceDialogs;
        }).catch(() => {});
      }
      page = previousPage;
      await context?.close();
    }
  };
  const installGate = kind => page.evaluate(kind => {
    const api = window.Prototype.api;
    const state = window.__r11PreferenceGate = {
      api, originalCommand: api.command, calls: [], held: false, released: false,
      returned: false, release: null, owner: null, kind,
    };
    api.command = async function (...args) {
      const call = { action: args[0], payload: JSON.parse(JSON.stringify(args[1])), options: args[2] === undefined ? null : JSON.parse(JSON.stringify(args[2])) };
      state.calls.push(call);
      // The real service commits first; only delivery of its successful result is delayed.
      const result = await state.originalCommand.apply(this, args);
      call.result = JSON.parse(JSON.stringify(result));
      const selected = kind === 'preferences' ? args[0] === 'preferences.save'
        : args[0] === 'submission.save' && args[1]?.draft?.title?.startsWith('分页演示活动 ');
      if (selected && !state.held) {
        state.held = true;
        state.owner = window.Prototype.current;
        await new Promise(resolve => {
          state.release = () => { if (!state.released) { state.released = true; resolve(); } };
        });
        state.returned = true;
      }
      return result;
    };
  }, kind);
  const releaseGate = () => page.evaluate(() => { window.__r11PreferenceGate.release(); });

  await freshCase('R11 workbench refresh choices protect dirty preferences and isolate cancelled read effects', async () => {
    for (const control of controls) {
      await reset();
      await openFromMine();
      const original = await data();
      await toggleNewActivity();
      await scrollPreferenceContent();
      const before = await snapshot();
      assert.ok(before.scrollTop > 0, 'The refresh-cancel case did not establish a nonzero native scroll position');
      assert.equal(before.dirty, true);
      assert.ok(before.leaveMessage);
      const initialCount = (await dialogs()).length;
      await page.locator(control).click();
      await page.locator('#platform-layer [role="dialog"][aria-label="重新加载当前页面？"]').waitFor({ state: 'visible' });
      assert.equal((await dialogs()).length, initialCount + 1, 'The refresh did not show exactly one confirmation');
      await page.locator(control).click();
      await page.locator(control).click();
      assert.equal((await dialogs()).length, initialCount + 1, 'Repeated refresh clicks opened another confirmation');
      await cancelDialog();
      assert.deepEqual(await snapshot(), before, 'Cancelling refresh changed the page instance, URL, scroll, inputs, or dirty warning');
      assert.equal((await dialogs()).length, initialCount + 1, 'A repeated click queued a second confirmation after cancellation');
      const query = await assertImmediateQuery(original.newActivities);
      assert.deepEqual(await snapshot(), before, 'An unrelated preference query changed the cancelled editor');
      await capture(`r11-preferences-${control.slice(1)}-cancel`, { queryLatencyMs: query.elapsedMs, preserved: before });

      await page.locator(control).click();
      await page.locator('#platform-layer [role="dialog"][aria-label="重新加载当前页面？"]').waitFor({ state: 'visible' });
      await page.locator('#platform-layer button').filter({ hasText: /^重新加载$/ }).click();
      if (control === '#slow-next') {
        await waitUntil(async () => (await data()).loading === true, 'Accepted slow refresh did not expose loading');
        await capture('r11-preferences-slow-refresh-loading');
      }
      await settled();
      if (control === '#fail-next') {
        assert.equal((await data()).ready, false, 'The accepted load failure incorrectly exposed ready controls');
        assert.ok((await data()).error.includes('网络'), 'The accepted failure did not explain the network error');
        await capture('r11-preferences-accepted-read-failure');
        await native('.error .text-button').click();
        await settled();
      }
      const completed = await snapshot();
      for (const field of ['newActivities', 'deadlines', 'rewards', 'repayments']) assert.equal(completed[field], original[field]);
      assert.equal(completed.dirty, false, 'A completed refresh retained dirty state');
      assert.equal(completed.saved, false);
      assert.equal(completed.leaveMessage, '', 'A completed refresh retained an obsolete leave warning');
      assert.equal(completed.error, '');
      assert.equal(completed.ready, true);
      await noDialog();
      assert.equal((await dialogs()).length, initialCount + 2, 'Accepting one refresh caused a second confirmation');
      await capture(`r11-preferences-${control.slice(1)}-accepted`);
    }
  });

  await freshCase('R11 a completed save on an abandoned preferences page cannot clear a newer editor warning', async () => {
    await openFromMine();
    await toggleNewActivity();
    await installGate('preferences');
    await native('.primary-button').click();
    await waitUntil(async () => page.evaluate(() => window.__r11PreferenceGate.held), 'The preference save did not commit before its response was held');
    const savingA = await snapshot();
    assert.equal(savingA.saving, true);
    const dialogCount = (await dialogs()).length;
    for (const control of controls) {
      await page.locator(control).click();
      await noDialog();
      assert.deepEqual(await snapshot(), savingA, `Busy editor A changed after ${control}`);
      assert.equal((await dialogs()).length, dialogCount, 'A busy refresh requested confirmation');
      await assertImmediateQuery(savingA.newActivities);
    }
    await capture('r11-preferences-busy-refresh-blocked');
    await page.locator('#native-back').click();
    await page.locator('#platform-layer [role="dialog"][aria-label="离开当前页面？"]').waitFor({ state: 'visible' });
    await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click();
    await expectRoute('mine');
    await native('.menu-row[data-handler="openPreferences"]').click();
    await expectRoute('preferences');
    assert.equal((await data()).newActivities, savingA.newActivities, 'The first preference save did not really commit');
    await toggleNewActivity();
    const dirtyB = await snapshot();
    assert.notEqual(dirtyB.instance, savingA.instance, 'The second editor reused abandoned instance A');
    assert.equal(dirtyB.saved, false);
    assert.ok(dirtyB.leaveMessage);
    await releaseGate();
    await waitUntil(async () => page.evaluate(() => window.__r11PreferenceGate.returned), 'The held response was not delivered');
    await settled();
    assert.deepEqual(await snapshot(), dirtyB, 'The old save completion changed the new editor or its leave warning');
    const beforeBackDialogs = (await dialogs()).length;
    await page.locator('#native-back').click();
    await page.locator('#platform-layer [role="dialog"][aria-label="离开当前页面？"]').waitFor({ state: 'visible' });
    assert.equal((await dialogs()).length, beforeBackDialogs + 1, 'The new dirty editor did not receive one leave confirmation');
    await capture('r11-preferences-late-save-keeps-new-leave-warning');
    await cancelDialog();
    assert.deepEqual(await snapshot(), dirtyB, 'Cancelling leave did not retain editor B');
    assert.equal((await dialogs()).length, beforeBackDialogs + 1);
    await capture('r11-preferences-new-editor-retained');
  });

  await freshCase('R11 pagination fixture completion does not reload a different dirty preferences page', async () => {
    const originalSession = await page.evaluate(() => window.Prototype.api.query('session.get', {}));
    await assertImmediateQuery();
    await installGate('pagination');
    await page.locator('.scenario-button[data-scenario="pagination"]').click();
    await waitUntil(async () => page.evaluate(() => window.__r11PreferenceGate.held), 'The real pagination fixture did not reach its first committed submission');
    assert.equal(await atRoute('activities'), true, 'The pagination scenario did not begin on activities');
    const committedSeed = await page.evaluate(() => window.wx.getStorageSync('card-benefits.native.demo.v1').seed);
    const firstSubmission = await page.evaluate(() => window.__r11PreferenceGate.calls.find(call => call.action === 'submission.save').result.id);
    assert.ok(committedSeed.submissions[firstSubmission], 'The interrupted fixture did not commit its first real submission');
    await page.locator('.atlas-link[data-route="pages/preferences/index"]').click();
    await expectRoute('preferences');
    await toggleNewActivity();
    await scrollPreferenceContent();
    const dirty = await snapshot();
    const beforeDialogs = (await dialogs()).length;
    assert.ok(dirty.leaveMessage);
    await releaseGate();
    await waitUntil(async () => page.evaluate(() => {
      const button = document.querySelector('.scenario-button[data-scenario="pagination"]');
      return !button.disabled;
    }), 'The abandoned pagination fixture did not settle');
    await settled();
    assert.deepEqual(await snapshot(), dirty, 'Completing the background fixture changed or reloaded the current dirty preferences page');
    assert.equal((await dialogs()).length, beforeDialogs, 'Completing the background fixture prompted the unrelated editor');
    await noDialog();
    const trace = await page.evaluate(() => ({
      submissions: window.__r11PreferenceGate.calls.filter(call => call.action === 'submission.save' && call.result).length,
      actions: window.__r11PreferenceGate.calls.map(call => call.action),
      seeded: window.wx.getStorageSync('scenario.pagination.v1') || false,
      feedback: document.getElementById('scenario-feedback').textContent,
    }));
    // R13 scopes fixture setup to its starting page. Ownership changes stop all
    // later writes; uninterrupted 32-record setup is covered by the pagination cases.
    assert.equal(trace.submissions, 1, 'An abandoned fixture continued creating submissions');
    assert.deepEqual(trace.actions, ['submission.save'], 'An abandoned fixture continued publishing or recording rewards');
    assert.equal(trace.seeded, false, 'An incomplete fixture was marked as fully initialized');
    assert.deepEqual(await page.evaluate(() => window.wx.getStorageSync('card-benefits.native.demo.v1').seed), committedSeed,
      'Cancelling fixture ownership altered already committed records or created later records');
    const finalSession = await page.evaluate(() => window.Prototype.api.query('session.get', {}));
    assert.equal(finalSession.isModerator, originalSession.isModerator, 'The abandoned fixture left its temporary demo role active');
    assert.deepEqual(await snapshot(), dirty, 'Restoring the temporary role changed the protected preferences editor');
    await capture('r11-preferences-background-pagination-retains-editor', { preserved: dirty, fixture: trace });
  });
}

async function runR11MonthStartRegressions() {
  const originalPage = page;
  for (const day of ['2026-10-01', '2026-10-02', '2026-10-03']) {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    try {
      await context.addInitScript(iso => {
        const NativeDate = window.Date;
        const now = NativeDate.parse(iso);
        window.Date = new Proxy(NativeDate, {
          construct(target, args) { return Reflect.construct(target, args.length ? args : [now]); },
          apply() { return new NativeDate(now).toString(); },
          get(target, property, receiver) {
            return property === 'now' ? () => now : Reflect.get(target, property, receiver);
          },
        });
        window.__r11StorageAtStart = Object.keys(localStorage);
      }, day + 'T04:00:00.000Z');
      page = await context.newPage();
      page.setDefaultTimeout(10000);
      const runtimeErrors = [];
      page.on('pageerror', error => runtimeErrors.push(error.message));
      if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
      await check('Fresh demo bootstrap succeeds on China ' + day + ' with valid owned card bills', async () => {
        await page.goto(baseUrl, { waitUntil: 'load' });
        await page.waitForFunction(() => Prototype.ready && Prototype.current?.data, null, { timeout: 10000 });
        await settled();
        await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{width:375px!important;height:812px!important;min-height:812px!important;max-height:812px!important;max-width:none!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
        const state = await page.evaluate(() => {
          const seed = wx.getStorageSync('card-benefits.native.demo.v1')?.seed;
          const cards = Object.values(seed?.cards || {}).filter(card => !card.archivedAt);
          const accounts = Object.values(seed?.billing_accounts || {});
          const bills = Object.values(seed?.bills || {});
          return {
            ready: Prototype.ready, route: Prototype.current?.route,
            browserNow: new Date().toISOString(), storageAtStart: window.__r11StorageAtStart,
            nativeText: Prototype.shadow.querySelector('.prototype-native-content')?.innerText || '',
            cards, accounts, bills,
          };
        });
        assert.deepEqual(state.storageAtStart, [], 'The month-start fixture did not begin with empty storage');
        assert.equal(state.browserNow, day + 'T04:00:00.000Z');
        assert.equal(state.ready, true);
        assert.equal(state.route, 'pages/todo/index');
        assert.equal((await data()).loading, false);
        assert.ok(state.nativeText.includes('我的待办'), 'The booted demo did not render its source todo page');
        assert.equal(state.cards.length, 3, 'Fresh bootstrap did not persist the three source demo cards');
        const ownedBills = [];
        for (const card of state.cards) {
          assert.equal(card.ownerId, 'demo-user');
          assert.equal(card.kind, 'credit');
          const account = state.accounts.find(account => account.id === card.billingAccountId);
          assert.ok(account && account.enabled, 'The fresh card has no active billing account');
          assert.equal(account.ownerId, card.ownerId);
          assert.equal(account.bankId, card.bankId);
          assert.equal(account.issuerId, card.issuerId);
          const bills = state.bills.filter(bill =>
            bill.billingAccountId === account.id && bill.periodKey === day.slice(0, 7));
          assert.equal(bills.length, 1, 'Fresh bootstrap must create one current bill per demo account');
          const bill = bills[0];
          assert.equal(bill.ownerId, card.ownerId);
          assert.match(bill.statementOn, /^\d{4}-\d{2}-\d{2}$/);
          assert.match(bill.dueOn, /^\d{4}-\d{2}-\d{2}$/);
          assert.ok(bill.statementOn <= bill.dueOn,
            'The seeded bill is due before its statement date on ' + day);
          assert.equal(bill.paidAt, null);
          ownedBills.push({ id: bill.id, periodKey: bill.periodKey, statementOn: bill.statementOn, dueOn: bill.dueOn });
        }
        assert.deepEqual(runtimeErrors, [], 'Fresh month-start demo bootstrap raised a browser exception');
        await capture('r11-demo-month-start-' + day, { browserDate: day, ownedBills });
      });
    } finally {
      // Context closure discards the controlled clock and all demo storage.
      try { await context.close(); } finally { page = originalPage; }
    }
  }
}

async function runR11DeepLinkRegressions() {
  const mainPage = page;
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, deviceScaleFactor: 1,
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
  });
  const errors = [];
  async function ready() {
    await waitUntil(async () => page.evaluate(() => Boolean(window.Prototype?.ready && window.Prototype?.current?.data)),
      'The isolated reminder destination did not initialize');
    await settled();
    await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{width:375px!important;height:812px!important;min-height:812px!important;max-height:812px!important;max-width:none!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  try {
    page = await context.newPage();
    page.on('pageerror', error => errors.push({ message: error.message, stack: error.stack }));
    await page.goto(baseUrl, { waitUntil: 'load' });
    await ready();
    for (const kind of ['deadline', 'reward']) {
      await check(kind === 'deadline'
        ? 'A cold deadline notification link resolves its owned current participation without an activity parameter'
        : 'A cold reward notification link retains the owned historical period and activity snapshot', async () => {
        const initialErrors = errors.length;
        await reset();
        const fixture = await page.evaluate(async kind => {
          const api = window.Prototype.api;
          const session = await api.query('session.get', {});
          const current = await api.query('activity.get', { activityId: 'monthly' });
          const history = await api.query('history.list', { activityId: current.activity.id, filter: 'pending' });
          const target = kind === 'deadline' ? current.participation : history.items.find(record =>
            record.ownerId === session.userId && record.stage === 'completed' && record.periodKey < current.participation.periodKey);
          return { session, currentParticipation: current.participation, liveActivity: current.activity, target };
        }, kind);
        assert.ok(fixture.currentParticipation && fixture.target, 'The real demo API did not provide the required owned participation');
        assert.equal(fixture.target.ownerId, fixture.session.userId);
        assert.equal(fixture.target.activityId, fixture.liveActivity.id);
        if (kind === 'deadline') assert.equal(fixture.target.periodKey, fixture.session.month);
        else {
          assert.equal(fixture.target.stage, 'completed');
          assert.notEqual(fixture.target.id, fixture.currentParticipation.id);
          assert.ok(fixture.target.periodKey < fixture.currentParticipation.periodKey, 'The reward fixture must be an earlier participation period');
        }
        // This matches the independently reproduced real worker page format. No worker or cloud sender runs in this browser check.
        const workerFormatPage = `pages/detail/index?participationId=${encodeURIComponent(fixture.target.id)}`;
        assert.deepEqual([...new URLSearchParams(workerFormatPage.split('?')[1]).keys()], ['participationId']);
        // Leaving the document first ensures a genuine cold bootstrap while retaining only this isolated context's demo storage.
        await page.goto('about:blank');
        await page.goto(`${baseUrl}/#/${workerFormatPage}`, { waitUntil: 'load' });
        await ready();
        const state = await data();
        const originalOptions = await page.evaluate(() => window.Prototype.current.options);
        assert.deepEqual(originalOptions, { participationId: fixture.target.id }, 'The cold entry must not supply an activity ID');
        assert.equal(state.error, '');
        assert.ok(state.detail && state.view, 'The worker-format destination did not resolve an activity detail');
        assert.equal(state.activityId, fixture.target.activityId, 'The controller must recover the activity ID for subsequent actions');
        assert.equal(state.participationId, fixture.target.id);
        assert.equal(state.detail.participation.id, fixture.target.id);
        assert.equal(state.detail.participation.ownerId, fixture.session.userId);
        assert.equal(state.detail.participation.activityId, fixture.target.activityId);
        assert.equal(state.detail.participation.periodKey, fixture.target.periodKey);
        assert.deepEqual(state.detail.participation.snapshot, fixture.target.snapshot);
        assert.deepEqual(state.view.activity, fixture.target.snapshot, 'The destination must render the participation snapshot');
        assert.equal(state.view.endsOn, fixture.target.endsOn);
        if (kind === 'reward') {
          assert.equal(state.view.isPast, true);
          assert.notEqual(state.detail.participation.periodKey, fixture.currentParticipation.periodKey);
          assert.ok((await native('.prototype-native-content').textContent()).includes('正在查看历史参与期'), 'The historical destination must communicate its period scope');
        }
        assert.deepEqual(errors.slice(initialErrors), [], 'The cold notification destination raised a runtime exception');
        await capture(`r11-notification-deeplink-${kind}-cold-success`, {
          route: workerFormatPage, reminderKind: kind, ownerId: fixture.session.userId,
          participationId: fixture.target.id, activityId: fixture.target.activityId, periodKey: fixture.target.periodKey,
          targetProvenance: 'Worker-format link; actual worker generation was independently proven in r11-notification-deeplink-repro.json.',
          cloudOrNotificationSent: false,
        });
      });
    }
  } finally {
    page = mainPage;
    await context.close();
  }
}

// Integrate into the remote acceptance runner only after the R12 source freeze/build.
// Required globals: assert, browser, baseUrl, page, native, data, check, reset,
// waitUntil, settled, capture, and attachDiagnostics. This file does not execute itself.
async function runR12LegacyCardRegressions() {
  for (const committed of [true, false]) {
    const previousPage = page;
    let context;
    let isolatedPage;
    const branch = committed ? 'committed' : 'uncommitted';
    try {
      await check(committed
        ? 'R12 a committed legacy card creation resolves its original ID without changing either billing period'
        : 'R12 an unresolved legacy card creation preserves its intent and cannot create a bill in the new period', async () => {
        context = await browser.newContext({ viewport: { width: 1180, height: 1100 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
        await context.addInitScript(() => {
          const NativeDate = window.Date;
          window.__r12LegacyClock = { NativeDate, now: NativeDate.parse('2026-09-30T04:00:00.000Z') };
          window.Date = new Proxy(NativeDate, {
            construct(target, args) { return Reflect.construct(target, args.length ? args : [window.__r12LegacyClock.now]); },
            apply() { return new NativeDate(window.__r12LegacyClock.now).toString(); },
            get(target, property, receiver) { return property === 'now' ? () => window.__r12LegacyClock.now : Reflect.get(target, property, receiver); },
          });
        });
        isolatedPage = await context.newPage();
        page = isolatedPage;
        page.setDefaultTimeout(12000);
        attachDiagnostics(page);
        await page.goto(baseUrl, { waitUntil: 'load' });
        await page.waitForFunction(() => window.Prototype?.ready);
        await settled();
        await reset();
        const atRoute = name => page.evaluate(value => window.Prototype.current?.route === `pages/${value}/index`, name);
        const expectRoute = async name => {
          await waitUntil(() => atRoute(name), `The legacy card regression did not reach ${name}`);
          await settled();
        };
        const nickname = committed ? 'R12 Resolved Legacy Card' : 'R12 Unresolved Legacy Card';
        const ledger = () => page.evaluate(nickname => {
          const seed = window.wx.getStorageSync('card-benefits.native.demo.v1')?.seed || {};
          const cards = Object.values(seed.cards || {}).filter(card => card.nickname === nickname);
          const cardIds = cards.map(card => card.id), accountIds = cards.map(card => card.billingAccountId);
          return {
            cards, accounts: Object.values(seed.billing_accounts || {}).filter(account => accountIds.includes(account.id)),
            bills: Object.values(seed.bills || {}).filter(bill => accountIds.includes(bill.billingAccountId)),
            requests: Object.values(seed.requests || {}).filter(request => cardIds.includes(request.result?.id)),
            audit: Object.values(seed.audit_events || {}).filter(event => cardIds.includes(event.entityId) || accountIds.includes(event.entityId)),
            allRecordIds: {
              cards: Object.keys(seed.cards || {}).sort(), accounts: Object.keys(seed.billing_accounts || {}).sort(),
              bills: Object.keys(seed.bills || {}).sort(), requests: Object.keys(seed.requests || {}).sort(),
              audit: Object.keys(seed.audit_events || {}).sort(),
            },
          };
        }, nickname);
        await page.locator('#native-tabs button').filter({ hasText: '卡包' }).click();
        await expectRoute('wallet');
        await native('.page-heading button[data-handler="addCard"]').click();
        await expectRoute('card-edit');
        await native('#card-nickname').fill(nickname);
        await native('#field-billing input[role="switch"]').check();
        await native('#field-statementDay select').selectOption({ label: '5' });
        await native('#field-dueOn input').fill('2026-10-10');
        await native('#field-dueOn input').press('Tab');
        const septemberForm = await data();
        assert.equal(septemberForm.currentMonth, '2026-09');
        assert.equal(septemberForm.statementDay, 5);
        assert.equal(septemberForm.dueDay, 10);
        assert.equal(septemberForm.dueMonthOffset, 1);
        assert.equal(septemberForm.dueOn, '2026-10-10');
        const fixture = await page.evaluate(() => {
          const controller = window.Prototype.current, d = controller.data;
          const key = ['card-benefits.form-draft.v1', 'card', d.userId, d.draftEntityId].map(encodeURIComponent).join(':');
          const saved = JSON.parse(JSON.stringify(window.wx.getStorageSync(key)));
          const currentPayload = controller.commandPayload();
          const legacyPayload = JSON.parse(JSON.stringify(currentPayload));
          delete legacyPayload.billing.periodKey;
          delete legacyPayload.billing.billId;
          delete saved.value.billingTarget;
          delete saved.value.dateNeedsReview;
          delete saved.value.pendingCreationPeriod;
          saved.value.periodKey = '2026-09';
          saved.value.intentKey = d.intentKey;
          saved.value.pendingCreation = { pending: true, intentKey: d.intentKey, payloadSignature: JSON.stringify(legacyPayload) };
          saved.revision = `legacy-pending-${d.intentKey}`;
          return { key, saved, currentPayload, legacyPayload, intentKey: d.intentKey };
        });
        assert.equal(fixture.currentPayload.billing.periodKey, '2026-09');
        assert.equal(fixture.legacyPayload.billing.periodKey, undefined);
        assert.equal(fixture.legacyPayload.billing.billId, undefined);
        const readSaved = () => page.evaluate(key => window.wx.getStorageSync(key) || null, fixture.key);
        await page.locator('#native-back').click();
        await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click();
        await expectRoute('wallet');

        // Both branches share the same persisted old-schema fixture. Only the control
        // executes the original September command, using the actual demo service.
        const originalResult = committed ? await page.evaluate(async ({ legacyPayload, intentKey }) =>
          window.Prototype.api.command('card.save', legacyPayload, { intentKey }), fixture) : null;
        const septemberLedger = await ledger();
        assert.equal(septemberLedger.cards.length, committed ? 1 : 0);
        if (committed) {
          assert.equal(septemberLedger.cards[0].id, originalResult.id);
          assert.equal(septemberLedger.bills.find(bill => bill.periodKey === '2026-09')?.dueOn, '2026-10-10');
          assert.equal(septemberLedger.requests.length, 1);
          assert.match(septemberLedger.requests[0].requestId, /^intent_[0-9a-f]{32}$/);
        }
        // Persist only after the source form is closed, so no lifecycle write can
        // overwrite the legacy fixture before the next real UI recovery.
        await page.evaluate(({ key, saved }) => { window.wx.setStorageSync(key, saved); }, fixture);
        await page.evaluate(() => { window.__r12LegacyClock.now = window.__r12LegacyClock.NativeDate.parse('2026-10-01T04:00:00.000Z'); });
        await native('.page-heading button[data-handler="addCard"]').click();
        await waitUntil(() => atRoute('card-edit'), 'The new card editor did not open for legacy draft recovery');
        await page.locator('#platform-layer button').filter({ hasText: '恢复核对' }).waitFor({ state: 'visible' });
        await page.locator('#platform-layer button').filter({ hasText: '恢复核对' }).click();
        await settled();
        const recovered = await data();
        assert.equal(recovered.currentMonth, '2026-10');
        assert.equal(recovered.billingTarget.periodKey, '2026-09');
        assert.equal(recovered.intentKey, fixture.intentKey);
        assert.equal(recovered.pendingCreationSignature, JSON.stringify(fixture.legacyPayload));
        assert.equal(recovered.pendingLookupOnly, true, 'The ambiguous legacy request was not restricted to result lookup');
        assert.equal(await native('.save-button').innerText(), '核对上次保存结果');
        assert.equal(await native('#card-nickname').isDisabled(), true, 'Legacy result lookup allowed changes to the original card intent');
        assert.equal(await native('#field-dueOn input').isDisabled(), true, 'Legacy result lookup allowed date reinterpretation');
        assert.equal(await native('button[data-handler="rebaseBillingPeriod"]').count(), 0, 'The ambiguous legacy request exposed a fresh-period mutation path');
        const savedBeforeLookup = await readSaved();
        assert.equal(savedBeforeLookup.value.intentKey, fixture.intentKey);
        assert.deepEqual(savedBeforeLookup.value.pendingCreation, fixture.saved.value.pendingCreation);
        const beforeLookup = await ledger();
        if (committed) {
          assert.equal(beforeLookup.cards.length, 1);
          assert.equal(beforeLookup.bills.find(bill => bill.periodKey === '2026-09')?.dueOn, '2026-10-10');
          assert.equal(beforeLookup.bills.find(bill => bill.periodKey === '2026-10')?.dueOn, '2026-11-10');
        } else assert.equal(beforeLookup.cards.length, 0);
        await native('.save-button').scrollIntoViewIfNeeded();
        await capture(`r12-legacy-card-${branch}-lookup-ready`);

        await page.evaluate(() => {
          const api = window.Prototype.api;
          const state = window.__r12LegacyLookupTrace = { api, originalCommand: api.command, calls: [] };
          api.command = async function (...args) {
            const call = {
              action: args[0], payload: JSON.parse(JSON.stringify(args[1])),
              options: args[2] === undefined ? null : JSON.parse(JSON.stringify(args[2])), argumentCount: args.length,
            };
            state.calls.push(call);
            try { const result = await state.originalCommand.apply(this, args); call.result = JSON.parse(JSON.stringify(result)); return result; }
            catch (error) { call.error = { code: error.code, field: error.field, message: error.message }; throw error; }
          };
        });
        await native('.save-button').click();
        await waitUntil(async () => page.evaluate(() => {
          const call = window.__r12LegacyLookupTrace.calls[0];
          return !!call && (!!call.result || !!call.error);
        }), 'The legacy result lookup did not complete');
        await settled();
        const calls = await page.evaluate(() => window.__r12LegacyLookupTrace.calls);
        assert.equal(calls.length, 1, 'One legacy result lookup dispatched multiple commands');
        const call = calls[0];
        assert.equal(call.action, 'card.save');
        assert.equal(call.argumentCount, 3);
        assert.deepEqual(call.payload, fixture.legacyPayload, 'The result lookup changed the original request payload');
        assert.deepEqual(call.options, { intentKey: fixture.intentKey, replayOnly: true }, 'The legacy request was not sent in lookup-only mode with its original intent');
        const afterLookup = await ledger();
        assert.deepEqual(afterLookup, beforeLookup, 'Looking up a legacy result changed cards, accounts, bills, requests, or audit history');

        if (committed) {
          assert.equal(call.error, undefined);
          assert.equal(call.result.id, originalResult.id, 'The committed lookup returned a different card');
          await expectRoute('wallet');
          assert.equal(await readSaved(), null, 'An acknowledged unchanged legacy draft was not cleared');
          const group = native('.account-group').filter({ hasText: nickname });
          await group.scrollIntoViewIfNeeded();
          await group.locator('.account-settings').click();
          await settled();
          await group.scrollIntoViewIfNeeded();
          await capture('r12-legacy-card-committed-original-ledger', { cardId: originalResult.id, requestId: septemberLedger.requests[0].requestId, call });
        } else {
          assert.equal(call.result, undefined, 'An unresolved legacy request unexpectedly returned a created card');
          assert.equal(call.error?.code, 'REQUEST_UNRESOLVED', 'An uncommitted legacy request did not fail closed');
          await expectRoute('card-edit');
          const unresolved = await data();
          assert.equal(unresolved.pendingLookupOnly, true);
          assert.equal(unresolved.intentKey, fixture.intentKey);
          assert.equal(unresolved.pendingCreationSignature, JSON.stringify(fixture.legacyPayload));
          assert.equal(unresolved.pendingLookupNotice, '暂未查到上次保存结果，原操作仍可能稍后完成。草稿已保留，请稍后再核对或到卡包查看。');
          assert.equal(unresolved.dirty, true);
          assert.deepEqual(await readSaved(), savedBeforeLookup, 'An unresolved lookup changed or removed the original saved intent evidence');
          assert.equal(await native('.save-button').innerText(), '核对上次保存结果');
          const verify = native('button[data-handler="openWalletForVerification"]');
          assert.equal(await verify.innerText(), '去卡包核对');
          await verify.scrollIntoViewIfNeeded();
          await capture('r12-legacy-card-unresolved-preserved', { call, pendingIntent: fixture.intentKey });
          await verify.click();
          await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click();
          await expectRoute('wallet');
          assert.equal(await native('.account-group').filter({ hasText: nickname }).count(), 0, 'The verification destination contains an unintended new card');
          assert.deepEqual(await readSaved(), savedBeforeLookup, 'Opening the wallet removed unresolved legacy evidence');
          assert.deepEqual(await ledger(), beforeLookup, 'Opening the wallet after unresolved lookup created a card or bill');
          await capture('r12-legacy-card-unresolved-wallet-empty');
        }
      });
    } finally {
      if (isolatedPage && !isolatedPage.isClosed()) await isolatedPage.evaluate(() => {
        const trace = window.__r12LegacyLookupTrace;
        if (trace) { trace.api.command = trace.originalCommand; delete window.__r12LegacyLookupTrace; }
        if (window.__r12LegacyClock) { window.Date = window.__r12LegacyClock.NativeDate; delete window.__r12LegacyClock; }
      }).catch(() => {});
      page = previousPage;
      await context?.close();
    }
  }
}


async function runR12ReceiptRegressions() {
  const originalPage = page;
  const receiptKey = (ownerId, entityId) => [
    'card-benefits.form-draft.v1', 'receipt', ownerId, entityId,
  ].map(encodeURIComponent).join(':');
  const readDraft = async key => page.evaluate(key => wx.getStorageSync(key) ?? null, key);
  const expectRoute = async name => {
    await waitUntil(async () => page.evaluate(name =>
      Prototype.current?.route === 'pages/' + name + '/index', name),
    'Receipt regression did not reach ' + name);
  };
  const setDay = async day => page.evaluate(day => {
    window.__r12Clock.now = window.__r12Clock.NativeDate.parse(day + 'T04:00:00.000Z');
  }, day);
  const ledger = async activityId => page.evaluate(activityId => {
    const seed = wx.getStorageSync('card-benefits.native.demo.v1').seed;
    const records = Object.values(seed.participations || {}).filter(record => record.activityId === activityId);
    const recordIds = records.map(record => record.id);
    const rewards = Object.values(seed.rewards || {}).filter(reward => recordIds.includes(reward.participationId));
    const rewardIds = rewards.map(reward => reward.id);
    const requests = Object.values(seed.requests || {}).filter(request => {
      try {
        const fingerprint = JSON.parse(request.fingerprint);
        return fingerprint.action === 'reward.confirm' &&
          (fingerprint.payload.activityId === activityId || recordIds.includes(fingerprint.payload.participationId));
      } catch { return false; }
    });
    return {
      records, rewards, requests,
      trackings: Object.values(seed.trackings || {}).filter(tracking => tracking.activityId === activityId),
      audit: Object.values(seed.audit_events || {}).filter(event =>
        recordIds.includes(event.entityId) || rewardIds.includes(event.entityId)),
    };
  }, activityId);
  const setupActivity = async ({ received = false } = {}) => {
    await page.evaluate(() => Prototype.scenarios.review());
    await settled();
    const fixture = await page.evaluate(async received => {
      const detail = await Prototype.api.query('activity.get', { activityId: 'monthly' });
      const { id, revision, status, publishedAt, updatedAt, publishedBy, ...draft } = detail.activity;
      draft.title = '到账草稿账期验收活动';
      draft.startsOn = '2026-01-01'; draft.endsOn = '2026-12-31';
      draft.frequency = 'monthly'; draft.scope = 'user'; draft.target = 1;
      draft.requiresRegistration = false; draft.requiresInvitation = false;
      draft.rewardMinor = 1000; draft.rewardKind = 'cashback';
      draft.sourceNote = '仅用于演示模式到账草稿账期验收。';
      const submission = await Prototype.api.command('submission.save', { draft });
      const published = await Prototype.api.command('submission.review', {
        id: submission.id, expectedVersion: submission.version, decision: 'publish', sourceVerified: true, draft,
      });
      const prior = received ? await Prototype.api.command('reward.confirm', {
        activityId: published.id, amountMinor: 1000, receivedOn: '2026-09-20',
        expectNew: true, expectedPeriodKey: '2026-09',
      }) : null;
      const session = await Prototype.api.query('session.get', {});
      return { activityId: published.id, priorId: prior?.id || '', ownerId: session.userId };
    }, received);
    // Mine reads no dashboard/catalog and therefore does not materialize a later period.
    await page.evaluate(() => Prototype.openPage('pages/mine/index'));
    await settled();
    return fixture;
  };
  const openReceipt = async ({ activityId, id } = {}) => {
    const url = id ? 'pages/receipt/index?id=' + encodeURIComponent(id)
      : 'pages/receipt/index?activityId=' + encodeURIComponent(activityId);
    await page.evaluate(url => Prototype.openPage(url), url);
    await expectRoute('receipt');
  };
  const fillReceipt = async (amount, date) => {
    await native('#amount').fill(amount);
    await native('#receipt-date-field input').fill(date);
  };
  const leaveReceipt = async dirty => {
    await page.locator('#native-back').click();
    if (dirty) {
      const leave = page.locator('#platform-layer button').filter({ hasText: /^离开$/ });
      await leave.waitFor({ state: 'visible' });
      await leave.click();
    }
    await expectRoute('mine'); await settled();
  };
  const recoverReceipt = async activityId => {
    await openReceipt({ activityId });
    const recover = page.locator('#platform-layer button').filter({ hasText: /^(恢复草稿|恢复核对)$/ });
    await recover.waitFor({ state: 'visible' });
    await recover.click(); await settled();
  };
  const installTrace = async ({ activityId, failAfterCommit = false }) => {
    await page.evaluate(({ activityId, failAfterCommit }) => {
      const api = Prototype.api;
      const state = window.__r12Receipt = {
        api, command: api.command, setStorageSync: wx.setStorageSync,
        commands: [], committedFailure: null,
      };
      api.command = function (...args) {
        const record = {
          action: args[0], payload: JSON.parse(JSON.stringify(args[1])),
          options: args[2] === undefined ? null : JSON.parse(JSON.stringify(args[2])),
          argumentCount: args.length,
        };
        state.commands.push(record);
        const pending = state.command.apply(this, args);
        // Observe outcomes while returning the original promise and all original arguments.
        pending.then(result => { record.result = JSON.parse(JSON.stringify(result)); },
          error => { record.error = { code: error.code, field: error.field, message: error.message }; });
        return pending;
      };
      if (!failAfterCommit) return;
      wx.setStorageSync = function (...args) {
        const result = state.setStorageSync.apply(this, args);
        if (args[0] !== 'card-benefits.native.demo.v1' || state.committedFailure) return result;
        const seed = args[1]?.seed;
        const participation = Object.values(seed?.participations || {}).find(record =>
          record.activityId === activityId && record.periodKey === '2026-09' && record.stage === 'received');
        const request = participation && Object.values(seed?.requests || {}).find(record => {
          try {
            const fingerprint = JSON.parse(record.fingerprint);
            return record.result?.id === participation.id && fingerprint.action === 'reward.confirm' &&
              fingerprint.payload.activityId === activityId && fingerprint.payload.expectNew === true;
          } catch { return false; }
        });
        if (!request) return result;
        state.committedFailure = { participationId: participation.id, requestId: request.requestId };
        throw Object.assign(new Error('到账已写入，但响应未收到，请重试。'), { code: 'NETWORK_ERROR' });
      };
    }, { activityId, failAfterCommit });
  };
  const trace = async () => page.evaluate(() => ({
    commands: window.__r12Receipt.commands, committedFailure: window.__r12Receipt.committedFailure,
  }));
  const restorePersistWrapper = async () => page.evaluate(() => {
    if (window.__r12Receipt) wx.setStorageSync = window.__r12Receipt.setStorageSync;
  });
  const restoreTrace = async () => page.evaluate(() => {
    const state = window.__r12Receipt;
    if (!state) return;
    wx.setStorageSync = state.setStorageSync;
    state.api.command = state.command;
    delete window.__r12Receipt;
  });
  const createPendingReceipt = async (fixture, failAfterCommit) => {
    await openReceipt({ activityId: fixture.activityId }); await settled();
    assert.equal((await data()).participation, null);
    await fillReceipt('88.88', '2026-09-30');
    const value = await data();
    const key = receiptKey(value.ownerId, value.draftEntityId);
    await installTrace({ activityId: fixture.activityId, failAfterCommit });
    if (!failAfterCommit) {
      // The workbench fault stops transport before the real domain command is dispatched.
      await page.locator('#fail-save').evaluate(button => button.click());
    }
    await native('.entry-primary').click();
    await waitUntil(async () => {
      const state = await data(), calls = (await trace()).commands;
      return !!state.pendingCreation && !state.busy && calls.length === 1 && !!calls[0].error;
    }, 'The original receipt attempt did not retain its pending creation');
    const pending = await data();
    assert.equal(pending.pendingCreation.payload.expectedPeriodKey, '2026-09');
    assert.equal(pending.pendingCreation.target.periodKey, '2026-09');
    assert.equal(pending.pendingCreation.payload.receivedOn, '2026-09-30');
    assert.equal(await native('#amount').isDisabled(), true);
    assert.equal(await native('#receipt-date-field input').isDisabled(), true);
    const first = (await trace()).commands[0];
    assert.equal(first.error.code, 'NETWORK_ERROR');
    assert.equal(first.argumentCount, 3);
    assert.equal(first.options.intentKey, pending.pendingCreation.intentKey);
    await restorePersistWrapper();
    return { key, pending, first };
  };
  const isolatedCheck = async (name, action) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    try {
      await context.addInitScript(() => {
        const NativeDate = window.Date;
        window.__r12Clock = { NativeDate, now: NativeDate.parse('2026-09-30T04:00:00.000Z') };
        window.Date = new Proxy(NativeDate, {
          construct(target, args) { return Reflect.construct(target, args.length ? args : [window.__r12Clock.now]); },
          apply() { return new NativeDate(window.__r12Clock.now).toString(); },
          get(target, property, receiver) {
            return property === 'now' ? () => window.__r12Clock.now : Reflect.get(target, property, receiver);
          },
        });
      });
      page = await context.newPage(); page.setDefaultTimeout(10000);
      const exceptions = [];
      page.on('pageerror', error => exceptions.push(error.message));
      if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
      await check(name, async () => {
        await page.goto(baseUrl, { waitUntil: 'load' });
        await page.waitForFunction(() => Prototype.ready && Prototype.current?.data);
        await settled();
        await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{width:375px!important;height:812px!important;min-height:812px!important;max-height:812px!important;max-width:none!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
        await action();
        assert.deepEqual(exceptions, [], 'The isolated receipt regression raised a browser exception');
      });
    } finally {
      try { await restoreTrace(); } catch {}
      try { await context.close(); } finally { page = originalPage; }
    }
  };

  await isolatedCheck('An October receipt creation draft cannot migrate into an explicit September record', async () => {
    const fixture = await setupActivity({ received: true });
    const before = await ledger(fixture.activityId);
    await setDay('2026-10-01');
    await openReceipt({ activityId: fixture.activityId }); await settled();
    assert.equal((await data()).participation, null);
    await fillReceipt('99.99', '2026-10-01');
    const october = await data();
    const key = receiptKey(october.ownerId, october.draftEntityId);
    const saved = await readDraft(key);
    assert.equal(saved.value.draftTarget.periodKey, '2026-10');
    assert.equal(saved.value.draftTarget.participationId, '');
    await leaveReceipt(true);
    await installTrace({ activityId: fixture.activityId });
    await openReceipt({ id: fixture.priorId }); await settled();
    assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0,
      'An incompatible October creation draft was offered to the explicit September editor');
    assert.equal((await data()).participation.periodKey, '2026-09');
    assert.equal(await native('#amount').inputValue(), '10.00');
    assert.equal(await native('#receipt-date-field input').inputValue(), '2026-09-20');
    assert.deepEqual(await readDraft(key), saved, 'Opening history changed or deleted the unrelated October draft');
    assert.equal(await readDraft(receiptKey(fixture.ownerId, fixture.priorId)), null);
    assert.deepEqual(await ledger(fixture.activityId), before);
    assert.equal((await trace()).commands.length, 0);
    await capture('r12-explicit-september-ignores-october-draft');
    await leaveReceipt(false);
    await recoverReceipt(fixture.activityId);
    assert.equal(await native('#amount').inputValue(), '99.99');
    assert.equal(await native('#receipt-date-field input').inputValue(), '2026-10-01');
    assert.equal((await data()).receiptTarget.periodKey, '2026-10');
    assert.equal((await data()).targetReviewRequired, false);
    assert.deepEqual(await ledger(fixture.activityId), before);
    await capture('r12-october-draft-remains-recoverable');
  });

  await isolatedCheck('A same-scope draft from another period keeps its original target until explicit confirmation', async () => {
    const fixture = await setupActivity();
    await openReceipt({ activityId: fixture.activityId }); await settled();
    await fillReceipt('55.55', '2026-09-30');
    const september = await data();
    const key = receiptKey(september.ownerId, september.draftEntityId);
    const saved = await readDraft(key);
    await leaveReceipt(true);
    await setDay('2026-10-01');
    await installTrace({ activityId: fixture.activityId });
    await recoverReceipt(fixture.activityId);
    const recovered = await data();
    assert.equal(recovered.receiptTarget.periodKey, '2026-09');
    assert.equal(recovered.currentTarget.periodKey, '2026-10');
    assert.equal(recovered.targetReviewRequired, true);
    assert.equal(await native('#amount').inputValue(), '55.55');
    assert.equal(await native('#receipt-date-field input').inputValue(), '2026-09-30');
    assert.equal(await native('#amount').isDisabled(), true);
    assert.equal(await native('.entry-primary').isDisabled(), true);
    assert.equal(await native('[data-handler="confirmDraftTarget"]').isVisible(), true);
    const retained = await readDraft(key);
    assert.deepEqual(retained.value.draftTarget, saved.value.draftTarget);
    assert.equal(retained.value.amountInput, saved.value.amountInput);
    assert.equal(retained.value.receivedOn, saved.value.receivedOn);
    assert.equal((await trace()).commands.length, 0);
    assert.equal((await ledger(fixture.activityId)).records.length, 0);
    await capture('r12-different-period-draft-requires-target-confirmation');
    await leaveReceipt(true);
    assert.equal((await readDraft(key)).value.draftTarget.periodKey, '2026-09');
  });

  await isolatedCheck('A committed September receipt is resolved across October without changing its record or snapshot', async () => {
    const fixture = await setupActivity();
    const initial = await createPendingReceipt(fixture, true);
    const committed = (await trace()).committedFailure;
    assert.ok(committed);
    const before = await ledger(fixture.activityId);
    assert.equal(before.records.length, 1);
    assert.equal(before.records[0].id, committed.participationId);
    assert.equal(before.records[0].periodKey, '2026-09');
    assert.equal(before.rewards[0].amountMinor, 8888);
    const snapshot = before.records[0].snapshot;
    await setDay('2026-10-01');
    await leaveReceipt(true);
    await recoverReceipt(fixture.activityId);
    const recovered = await data();
    assert.equal(recovered.pendingReplayOnly, true);
    assert.equal(recovered.receiptTarget.periodKey, '2026-09');
    assert.equal(recovered.title, snapshot.title);
    assert.equal(recovered.currency, snapshot.currency);
    assert.equal(await native('#amount').isDisabled(), true);
    assert.equal(await native('#receipt-date-field input').isDisabled(), true);
    assert.ok((await native('.entry-primary').innerText()).includes('核对上次保存结果'));
    await capture('r12-cross-period-pending-receipt-lookup');
    await native('.entry-primary').click();
    await expectRoute('mine'); await settled();
    const calls = (await trace()).commands;
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].payload, initial.first.payload);
    assert.deepEqual(calls[1].options, { intentKey: initial.first.options.intentKey, replayOnly: true });
    assert.equal(calls[1].result.id, committed.participationId);
    assert.deepEqual(await ledger(fixture.activityId), before,
      'Resolving the committed old-period request changed business state');
    assert.equal(await readDraft(initial.key), null);
    await openReceipt({ id: committed.participationId }); await settled();
    assert.equal((await data()).participation.id, committed.participationId);
    assert.deepEqual((await data()).participation.snapshot, snapshot);
    assert.equal(await native('#amount').inputValue(), '88.88');
    assert.equal(await native('#receipt-date-field input').inputValue(), '2026-09-30');
    await capture('r12-resolved-original-september-receipt');
  });

  await isolatedCheck('An uncommitted old-period receipt lookup preserves its pending draft and performs no writes', async () => {
    const fixture = await setupActivity();
    const initial = await createPendingReceipt(fixture, false);
    const before = await ledger(fixture.activityId);
    assert.equal(before.records.length, 0);
    assert.equal(before.requests.length, 0);
    await setDay('2026-10-01');
    await leaveReceipt(true);
    await recoverReceipt(fixture.activityId);
    assert.equal((await data()).pendingReplayOnly, true);
    const retained = await readDraft(initial.key);
    for (let attempt = 0; attempt < 2; attempt++) {
      await native('.entry-primary').click();
      await waitUntil(async () => {
        const state = await data();
        return !state.busy && !!state.formError && (await trace()).commands.length === attempt + 2;
      }, 'The read-only pending lookup did not settle');
      assert.equal((await data()).pendingReplayOnly, true);
      assert.ok((await data()).formError.includes('暂未查到上次保存结果'));
      assert.equal((await data()).pendingCreation.intentKey, initial.first.options.intentKey);
      assert.deepEqual(await readDraft(initial.key), retained,
        'A missing request result changed the retained pending draft revision or payload');
      assert.deepEqual(await ledger(fixture.activityId), before,
        'An unresolved old-period lookup created or changed business state');
    }
    const calls = (await trace()).commands;
    for (const call of calls.slice(1)) {
      assert.deepEqual(call.payload, initial.first.payload);
      assert.deepEqual(call.options, { intentKey: initial.first.options.intentKey, replayOnly: true });
      assert.equal(call.error.code, 'REQUEST_UNRESOLVED');
    }
    assert.equal(await native('#amount').isDisabled(), true);
    await capture('r12-uncommitted-old-period-lookup-keeps-draft');
  });

  await isolatedCheck('An uncommitted same-period receipt retries its original intent and creates one record', async () => {
    const fixture = await setupActivity();
    const initial = await createPendingReceipt(fixture, false);
    assert.equal((await ledger(fixture.activityId)).records.length, 0);
    await leaveReceipt(true);
    await recoverReceipt(fixture.activityId);
    assert.equal((await data()).pendingReplayOnly, false);
    assert.ok((await native('.entry-primary').innerText()).includes('重试上次保存'));
    await native('.entry-primary').click();
    await expectRoute('mine'); await settled();
    const calls = (await trace()).commands;
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].payload, initial.first.payload);
    assert.deepEqual(calls[1].options, { intentKey: initial.first.options.intentKey });
    const after = await ledger(fixture.activityId);
    assert.equal(after.records.length, 1);
    assert.equal(after.records[0].id, calls[1].result.id);
    assert.equal(after.records[0].periodKey, '2026-09');
    assert.equal(after.records[0].receivedMinor, 8888);
    assert.equal(after.rewards.length, 1);
    assert.equal(after.rewards[0].amountMinor, 8888);
    assert.equal(after.requests.length, 1);
    assert.equal(await readDraft(initial.key), null);
    await openReceipt({ id: after.records[0].id }); await settled();
    await capture('r12-same-period-retry-creates-one-receipt');
  });

  await isolatedCheck('Legacy receipt drafts stay out of explicit history and require a target and valid date before new creation', async () => {
    const fixture = await setupActivity({ received: true });
    const before = await ledger(fixture.activityId);
    await setDay('2026-10-01');
    const entityId = 'new:' + fixture.activityId + ':user';
    const key = receiptKey(fixture.ownerId, entityId);
    // Only this fixture uses the genuine old schema, which current UI no longer creates.
    await page.evaluate(({ key, entityId, ownerId }) => wx.setStorageSync(key, {
      version: 1, ownerId, entityId, baseVersion: null,
      value: { amountInput: '44.44', receivedOn: '2026-09-30' },
      updatedAt: new Date().toISOString(), revision: 'r12-legacy-without-period',
    }), { key, entityId, ownerId: fixture.ownerId });
    const legacyDraft = await readDraft(key);
    await installTrace({ activityId: fixture.activityId });
    await openReceipt({ id: fixture.priorId }); await settled();
    assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0,
      'An explicit historical editor offered an unscoped legacy creation draft');
    assert.equal(await native('#amount').inputValue(), '10.00');
    assert.equal(await native('#receipt-date-field input').inputValue(), '2026-09-20');
    assert.deepEqual(await readDraft(key), legacyDraft,
      'Opening explicit history changed or removed the legacy creation draft');
    assert.equal(await readDraft(receiptKey(fixture.ownerId, fixture.priorId)), null);
    assert.deepEqual(await ledger(fixture.activityId), before);
    assert.equal((await trace()).commands.length, 0);
    await capture('r12-explicit-history-ignores-legacy-creation-draft');
    await leaveReceipt(false);

    await recoverReceipt(fixture.activityId);
    const recovered = await data();
    assert.equal(recovered.targetReviewRequired, true);
    assert.equal(recovered.receiptTarget, null,
      'The legacy draft guessed an activity period from its September received date');
    assert.equal(recovered.currentTarget.periodKey, '2026-10');
    assert.equal(recovered.currentTarget.participationId, '');
    assert.equal(await native('#amount').inputValue(), '44.44');
    assert.equal(await native('#receipt-date-field input').inputValue(), '2026-09-30');
    assert.equal(await native('#amount').isDisabled(), true);
    assert.equal(await native('.entry-primary').isDisabled(), true);
    assert.ok(await readDraft(key));
    assert.deepEqual(await ledger(fixture.activityId), before);
    assert.equal((await trace()).commands.length, 0);
    const confirm = native('[data-handler="confirmDraftTarget"]');
    assert.ok((await confirm.innerText()).includes('2026年10月'));
    await capture('r12-legacy-draft-requires-explicit-october-target');
    await confirm.click();
    assert.equal((await data()).targetReviewRequired, false);
    assert.equal((await data()).receiptTarget.periodKey, '2026-10');
    assert.equal((await data()).receiptTarget.participationId, '');
    assert.equal(await native('#receipt-date-field input').inputValue(), '2026-09-30',
      'Choosing an activity period must not silently change the actual receipt date');
    const targeted = await readDraft(key);
    assert.equal(targeted.value.draftTarget.periodKey, '2026-10');
    await native('.entry-primary').click(); await settled();
    assert.ok((await data()).dateError.includes('2026-10-01'));
    assert.equal((await trace()).commands.length, 0,
      'Target confirmation bypassed the independent received-date validation');
    assert.deepEqual(await ledger(fixture.activityId), before);
    await capture('r12-legacy-date-still-requires-user-correction');
    await native('#receipt-date-field input').fill('2026-10-01');
    await native('.entry-primary').click();
    await expectRoute('mine'); await settled();
    const calls = (await trace()).commands;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload.activityId, fixture.activityId);
    assert.equal(calls[0].payload.expectNew, true);
    assert.equal(calls[0].payload.expectedPeriodKey, '2026-10');
    assert.equal(calls[0].payload.amountMinor, 4444);
    assert.equal(calls[0].payload.receivedOn, '2026-10-01');
    const after = await ledger(fixture.activityId);
    assert.equal(after.records.length, 2);
    assert.deepEqual(after.records.find(record => record.id === fixture.priorId), before.records[0]);
    assert.deepEqual(after.rewards.find(reward => reward.participationId === fixture.priorId), before.rewards[0]);
    const october = after.records.find(record => record.periodKey === '2026-10');
    assert.ok(october);
    assert.equal(october.receivedMinor, 4444);
    assert.equal(october.receivedOn, '2026-10-01');
    assert.equal(after.rewards.find(reward => reward.participationId === october.id).activityPeriod, '2026-10');
    assert.equal(await readDraft(key), null);
    await openReceipt({ id: october.id }); await settled();
    await capture('r12-legacy-created-only-after-target-and-date-confirmation');
  });
}


// Integrate into the remote acceptance runner after the final R13 source build.
// Required globals: assert, browser, baseUrl, page, native, data, check, reset,
// waitUntil, settled, capture, and attachDiagnostics. No standalone execution.
async function runR13BusyNavigationRegression() {
  const previousPage = page;
  let context;
  let isolatedPage;
  try {
    await check('R13 workbench navigation and setup stay blocked until the source card save finishes', async () => {
      context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
      isolatedPage = await context.newPage();
      page = isolatedPage;
      page.setDefaultTimeout(12000);
      attachDiagnostics(page);
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.waitForFunction(() => window.Prototype?.ready);
      await settled();
      await reset();
      const atRoute = name => page.evaluate(value => window.Prototype.current?.route === `pages/${value}/index`, name);
      const expectRoute = async name => {
        await waitUntil(() => atRoute(name), `The busy navigation regression did not reach ${name}`);
        await settled();
      };
      const snapshot = () => page.evaluate(() => {
        const summarize = owner => ({
          instance: owner._instanceId, route: owner.route, disposed: owner.disposed,
          dirty: owner.data.dirty, saving: owner.data.saving, nickname: owner.data.nickname, leaveMessage: owner._leaveMessage,
        });
        return { current: summarize(window.Prototype.current), hash: location.hash,
          stack: window.getCurrentPages().map(summarize), nativeScroll: document.getElementById('native-page').scrollTop };
      });
      const seed = () => page.evaluate(() => window.wx.getStorageSync('card-benefits.native.demo.v1'));
      const trace = () => page.evaluate(() => ({
        held: window.__r13BusyGuardTrace.held, returned: window.__r13BusyGuardTrace.returned,
        calls: window.__r13BusyGuardTrace.calls, dialogs: window.__r13BusyGuardTrace.dialogs,
      }));
      await page.locator('#native-tabs button').filter({ hasText: '卡包' }).click();
      await expectRoute('wallet');
      const accountId = (await data()).raw.cards.find(card => card.id === 'demo-card-cmb').billingAccountId;
      await native(`.account-settings[data-id="${accountId}"]`).click();
      await native('.account-edit[data-id="demo-card-cmb"]').click();
      await expectRoute('card-edit');
      const nickname = 'R13 Busy Save Guard';
      await native('#card-nickname').fill(nickname);
      assert.equal((await data()).dirty, true);
      const draftKey = await page.evaluate(() => {
        const d = window.Prototype.current.data;
        return ['card-benefits.form-draft.v1', 'card', d.userId, d.draftEntityId].map(encodeURIComponent).join(':');
      });
      const originalSession = await page.evaluate(() => window.Prototype.api.query('session.get', {}));
      assert.equal(originalSession.isModerator, false, 'The isolated fixture did not start as an ordinary demo user');
      await page.evaluate(() => {
        const api = window.Prototype.api;
        const state = window.__r13BusyGuardTrace = {
          api, originalCommand: api.command, held: false, released: false, returned: false,
          release: null, calls: [], dialogs: [], observer: null,
        };
        api.command = async function (...args) {
          const call = { action: args[0], payload: JSON.parse(JSON.stringify(args[1])),
            options: args[2] === undefined ? null : JSON.parse(JSON.stringify(args[2])) };
          state.calls.push(call);
          // Commit through the actual domain service, delaying only result delivery.
          const result = await state.originalCommand.apply(this, args);
          call.result = JSON.parse(JSON.stringify(result));
          if (args[0] === 'card.save' && args[1].id === 'demo-card-cmb' && !state.held) {
            state.held = true;
            await new Promise(resolve => {
              state.release = () => { if (!state.released) { state.released = true; resolve(); } };
            });
            state.returned = true;
          }
          return result;
        };
        const known = new WeakSet();
        state.observer = new MutationObserver(records => {
          for (const record of records) for (const added of record.addedNodes) {
            if (!(added instanceof Element)) continue;
            const panels = added.matches('.platform-dialog') ? [added] : [...added.querySelectorAll('.platform-dialog')];
            for (const panel of panels) if (!known.has(panel)) {
              known.add(panel); state.dialogs.push(panel.getAttribute('aria-label'));
            }
          }
        });
        state.observer.observe(document.getElementById('platform-layer'), { childList: true, subtree: true });
      });
      await native('.save-button').click();
      await waitUntil(async () => (await trace()).held, 'The real card save was not committed before its response was held');
      const savingCard = await snapshot();
      const committedSeed = await seed();
      const pendingDraft = await page.evaluate(key => window.wx.getStorageSync(key), draftKey);
      const fixtureMarker = await page.evaluate(() => window.wx.getStorageSync('scenario.pagination.v1') || null);
      assert.equal(savingCard.current.route, 'pages/card-edit/index');
      assert.equal(savingCard.current.saving, true);
      assert.equal(savingCard.current.dirty, true);
      assert.ok(savingCard.current.leaveMessage);
      assert.equal(committedSeed.seed.cards['demo-card-cmb'].nickname, nickname, 'The held save did not actually persist the edited card');
      assert.equal((await trace()).calls.length, 1);
      const interactions = [];
      for (const selector of [
        '.atlas-link[data-route="pages/preferences/index"]',
        '.scenario-button[data-scenario="review"]',
        '#reset-prototype',
      ]) {
        const control = page.locator(selector);
        const disabled = await control.isDisabled();
        if (disabled) {
          assert.equal(await control.isDisabled(), true, 'A blocked workbench control unexpectedly became interactive');
        } else {
          // Use the actual control; never force dispatch through a disabled button.
          await control.click();
          assert.equal(await page.locator('#scenario-feedback').innerText(), '请等待当前操作完成后再切换页面。');
        }
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.deepEqual(await snapshot(), savingCard, `Workbench action ${selector} replaced, hid, or changed the busy source editor`);
        assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0, `Workbench action ${selector} opened a dialog during the source save`);
        assert.deepEqual((await trace()).dialogs, [], `Workbench action ${selector} queued a departure or reset confirmation`);
        assert.equal((await trace()).calls.length, 1, `Workbench action ${selector} began a scenario mutation`);
        assert.deepEqual(await seed(), committedSeed, `Workbench action ${selector} changed the committed demo store`);
        assert.deepEqual(await page.evaluate(key => window.wx.getStorageSync(key), draftKey), pendingDraft, `Workbench action ${selector} modified the pending card draft`);
        assert.equal(await page.evaluate(() => window.wx.getStorageSync('scenario.pagination.v1') || null), fixtureMarker);
        const session = await page.evaluate(() => window.Prototype.api.query('session.get', {}));
        assert.equal(session.userId, originalSession.userId);
        assert.equal(session.isModerator, originalSession.isModerator, `Workbench action ${selector} changed the demo role before navigation was allowed`);
        assert.deepEqual(await seed(), committedSeed, 'The guarded workbench action introduced delayed domain side effects');
        interactions.push({ selector, disabled, feedback: await page.locator('#scenario-feedback').innerText() });
      }
      await capture('r13-busy-card-workbench-actions-blocked', { savingCard, interactions });

      await page.evaluate(() => { window.__r13BusyGuardTrace.release(); });
      await waitUntil(async () => (await trace()).returned, 'The source card save result was not released');
      await expectRoute('wallet');
      const complete = await snapshot();
      assert.ok(!complete.stack.some(owner => owner.instance === savingCard.current.instance), 'The successful source save did not pop its own editor');
      assert.ok(!complete.stack.some(owner => owner.route === 'pages/preferences/index'), 'A blocked atlas navigation was replayed after the save');
      assert.ok(!complete.stack.some(owner => owner.route === 'pages/review/index'), 'A blocked review scenario was replayed after the save');
      assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0, 'The source save required an unexpected completion confirmation');
      assert.deepEqual((await trace()).dialogs, [], 'A blocked workbench action queued a late dialog');
      assert.equal((await trace()).calls.length, 1, 'A blocked scenario dispatched after the save completed');
      assert.equal((await data()).raw.cards.find(card => card.id === 'demo-card-cmb').nickname, nickname);
      assert.equal(await page.evaluate(key => window.wx.getStorageSync(key) || null, draftKey), null, 'The source save did not clear its acknowledged draft');
      assert.deepEqual(await seed(), committedSeed, 'Completing the save unexpectedly changed the committed domain records');
      const finalSession = await page.evaluate(() => window.Prototype.api.query('session.get', {}));
      assert.equal(finalSession.isModerator, false);
      const group = native('.account-group').filter({ hasText: nickname });
      await group.scrollIntoViewIfNeeded();
      await capture('r13-busy-card-source-save-returns-wallet', { complete, call: (await trace()).calls[0] });
    });
  } finally {
    if (isolatedPage && !isolatedPage.isClosed()) await isolatedPage.evaluate(() => {
      const state = window.__r13BusyGuardTrace;
      if (state) {
        state.release?.(); state.api.command = state.originalCommand; state.observer?.disconnect();
        delete window.__r13BusyGuardTrace;
      }
    }).catch(() => {});
    page = previousPage;
    await context?.close();
  }
}

// Run alongside runR13BusyNavigationRegression. The runner's reset() helper must
// call Prototype.resetFixture(), while the reset control remains a guarded UI action.
async function runR13WorkbenchEntryBoundaryRegressions() {
  const controls = ['.atlas-link[data-route="pages/preferences/index"]', '.scenario-button[data-scenario="review"]', '#reset-prototype'];
  const snapshot = () => page.evaluate(() => {
    const summarize = owner => ({ instance: owner._instanceId, route: owner.route, disposed: owner.disposed,
      dirty: owner.data.dirty, loading: owner.data.loading, saving: owner.data.saving, saved: owner.data.saved,
      nickname: owner.data.nickname, newActivities: owner.data.newActivities, leaveMessage: owner._leaveMessage });
    return { current: summarize(window.Prototype.current), stack: window.getCurrentPages().map(summarize),
      hash: location.hash, scrollTop: document.getElementById('native-page').scrollTop };
  });
  const atRoute = name => page.evaluate(value => window.Prototype.current?.route === `pages/${value}/index`, name);
  const expectRoute = async name => {
    await waitUntil(() => atRoute(name), `The workbench boundary did not reach ${name}`);
    await settled();
  };
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const release = () => page.evaluate(() => { window.__r13EntryBoot.gate.release?.(); });
  const freshCase = async (name, action) => {
    const previousPage = page;
    let context;
    let isolatedPage;
    try {
      await check(name, async () => {
        context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
        // The runtime captures raw preparation reads during start(). Install a
        // pass-through timing fixture before that capture, preserving real results.
        await context.addInitScript(() => {
          const state = window.__r13EntryBoot = { active: true, observe: false, commandCalls: [], dialogs: [], observer: null,
            gate: { kind: '', held: false, returned: false, release: null, result: null }, originalStart: null };
          let prototype;
          Object.defineProperty(window, 'Prototype', {
            configurable: true,
            get() { return prototype; },
            set(value) {
              prototype = value;
              const originalStart = value.start;
              state.originalStart = originalStart;
              value.start = async function (exports, ...rest) {
                const rawQuery = exports.api.query;
                const rawCommand = exports.api.command;
                exports.api.query = async function (...args) {
                  const result = await rawQuery.apply(this, args);
                  const gate = state.gate;
                  const matches = gate.kind === 'card-loading'
                    ? args[0] === 'wallet.get' && window.Prototype.current?.route === 'pages/card-edit/index'
                    : gate.kind === 'progress-preparation' && args[0] === 'activity.get' && args[1]?.activityId === 'monthly';
                  if (state.active && matches && !gate.held) {
                    gate.held = true;
                    gate.result = JSON.parse(JSON.stringify(result));
                    await new Promise(resolve => { gate.release = () => resolve(); });
                    gate.returned = true;
                  }
                  return result;
                };
                exports.api.command = function (...args) {
                  if (state.active && state.observe) state.commandCalls.push({ action: args[0], payload: JSON.parse(JSON.stringify(args[1])),
                    options: args[2] === undefined ? null : JSON.parse(JSON.stringify(args[2])) });
                  return rawCommand.apply(this, args);
                };
                return originalStart.apply(this, [exports, ...rest]);
              };
            },
          });
        });
        isolatedPage = await context.newPage();
        page = isolatedPage;
        page.setDefaultTimeout(12000);
        attachDiagnostics(page);
        await page.goto(baseUrl, { waitUntil: 'load' });
        await page.waitForFunction(() => window.Prototype?.ready);
        await settled();
        await reset();
        await page.evaluate(() => {
          const state = window.__r13EntryBoot, known = new WeakSet();
          state.observe = true;
          state.observer = new MutationObserver(records => {
            for (const record of records) for (const added of record.addedNodes) {
              if (!(added instanceof Element)) continue;
              const panels = added.matches('.platform-dialog') ? [added] : [...added.querySelectorAll('.platform-dialog')];
              for (const panel of panels) if (!known.has(panel)) { known.add(panel); state.dialogs.push(panel.getAttribute('aria-label')); }
            }
          });
          state.observer.observe(document.getElementById('platform-layer'), { childList: true, subtree: true });
        });
        await action();
      });
    } finally {
      if (isolatedPage && !isolatedPage.isClosed()) await isolatedPage.evaluate(() => {
        const state = window.__r13EntryBoot;
        if (state) {
          state.active = false; state.observe = false; state.gate.release?.(); state.observer?.disconnect();
          const prototype = window.Prototype;
          prototype.start = state.originalStart;
          Object.defineProperty(window, 'Prototype', { configurable: true, writable: true, value: prototype });
        }
      }).catch(() => {});
      page = previousPage;
      await context?.close();
    }
  };
  const openCard = async () => {
    await page.locator('#native-tabs button').filter({ hasText: '卡包' }).click();
    await expectRoute('wallet');
    const accountId = (await data()).raw.cards.find(card => card.id === 'demo-card-cmb').billingAccountId;
    await native(`.account-settings[data-id="${accountId}"]`).click();
    await native('.account-edit[data-id="demo-card-cmb"]').click();
    await expectRoute('card-edit');
  };

  await freshCase('R13 initial form loading blocks workbench navigation before source fields are ready', async () => {
    await page.locator('#native-tabs button').filter({ hasText: '卡包' }).click();
    await expectRoute('wallet');
    const accountId = (await data()).raw.cards.find(card => card.id === 'demo-card-cmb').billingAccountId;
    await native(`.account-settings[data-id="${accountId}"]`).click();
    await page.evaluate(() => { window.__r13EntryBoot.gate.kind = 'card-loading'; });
    await native('.account-edit[data-id="demo-card-cmb"]').click();
    await waitUntil(async () => page.evaluate(() => window.__r13EntryBoot.gate.held), 'The initial card read was not held before load completion');
    const loading = await snapshot();
    assert.equal(loading.current.route, 'pages/card-edit/index');
    assert.equal(loading.current.loading, true);
    const beforeSeed = await page.evaluate(() => window.wx.getStorageSync('card-benefits.native.demo.v1'));
    for (const selector of [...controls, '#fail-read']) {
      await page.locator(selector).click();
      await frame();
      assert.equal(await page.locator('#scenario-feedback').innerText(), '请等待当前操作完成后再切换页面。');
      assert.deepEqual(await snapshot(), loading, 'A workbench action left or changed the initially loading form');
      assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0);
      assert.deepEqual(await page.evaluate(() => window.__r13EntryBoot.dialogs), []);
      assert.deepEqual(await page.evaluate(() => window.__r13EntryBoot.commandCalls), []);
      assert.deepEqual(await page.evaluate(() => window.wx.getStorageSync('card-benefits.native.demo.v1')), beforeSeed);
    }
    const session = await page.evaluate(() => window.Prototype.api.query('session.get', {}));
    assert.equal(session.isModerator, false, 'A blocked loading-time scenario changed the demo role');
    await capture('r13-initial-card-load-workbench-blocked', { loading });
    await release();
    await expectRoute('card-edit');
    assert.equal((await data()).failed, false);
    assert.equal((await snapshot()).current.instance, loading.current.instance);
    assert.equal(await native('#card-nickname').isEnabled(), true);
    assert.deepEqual(await page.evaluate(() => window.__r13EntryBoot.dialogs), []);
    await capture('r13-initial-card-load-resumes');
  });

  await freshCase('R13 an active source dialog cannot be bypassed by workbench scenarios or injected failures', async () => {
    await openCard();
    await native('#card-nickname').fill('R13 Modal Ownership');
    const dirty = await snapshot();
    const beforeSeed = await page.evaluate(() => window.wx.getStorageSync('card-benefits.native.demo.v1'));
    await page.locator('#native-back').click();
    await page.locator('#platform-layer [aria-label="离开当前页面？"]').waitFor({ state: 'visible' });
    await page.evaluate(() => { window.__r13EntryBoot.originalDialog = document.querySelector('#platform-layer .platform-dialog'); });
    for (const selector of [...controls, '#privacy-scenario', '#fail-read', '#fail-save', '#conflict-record']) {
      await page.locator(selector).click();
      await frame();
      assert.equal(await page.locator('#scenario-feedback').innerText(), '请先完成当前对话框。');
      assert.equal(await page.evaluate(() => document.querySelector('#platform-layer .platform-dialog') === window.__r13EntryBoot.originalDialog), true, 'A workbench action replaced the active source dialog');
      assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 1);
      assert.deepEqual(await page.evaluate(() => window.__r13EntryBoot.dialogs), ['离开当前页面？']);
      assert.deepEqual(await snapshot(), dirty, 'A workbench action changed the owner while its leave dialog was active');
      assert.deepEqual(await page.evaluate(() => window.__r13EntryBoot.commandCalls), []);
      assert.deepEqual(await page.evaluate(() => window.wx.getStorageSync('card-benefits.native.demo.v1')), beforeSeed);
    }
    await capture('r13-source-dialog-owns-workbench-entry');
    await page.locator('#platform-layer button').filter({ hasText: /^继续填写$/ }).click();
    await settled();
    assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0);
    assert.deepEqual(await snapshot(), dirty, 'Cancelling the original dialog lost the edited card');
    const session = await page.evaluate(() => window.Prototype.api.query('session.get', {}));
    assert.equal(session.isModerator, false, 'The modal-time scenario or read-failure control leaked an effect');
    await native('.save-button').click();
    await expectRoute('wallet');
    assert.equal((await data()).raw.cards.find(card => card.id === 'demo-card-cmb').nickname, 'R13 Modal Ownership', 'The modal-time fail-save control leaked into the next legitimate save');
    assert.equal((await page.evaluate(() => window.__r13EntryBoot.commandCalls)).length, 1);
    assert.deepEqual(await page.evaluate(() => window.__r13EntryBoot.dialogs), ['离开当前页面？']);
    await capture('r13-source-dialog-cancel-and-real-save');
  });

  await freshCase('R13 a late progress preparation preserves the new editor and leaves the next-read failure for source loading', async () => {
    const source = await snapshot();
    await page.evaluate(() => { window.__r13EntryBoot.gate.kind = 'progress-preparation'; });
    await page.locator('#fail-read').click();
    await page.locator('.scenario-button[data-scenario="progress"]').click();
    await waitUntil(async () => page.evaluate(() => window.__r13EntryBoot.gate.held), 'The read-only progress preparation consumed the fault or failed to reach its actual query');
    const prepared = await page.evaluate(() => ({ activityId: window.__r13EntryBoot.gate.result.activity.id,
      participationId: window.__r13EntryBoot.gate.result.participation.id }));
    assert.equal(prepared.activityId, 'monthly');
    assert.ok(prepared.participationId);
    assert.deepEqual(await snapshot(), source, 'Preparing progress navigated before its real read completed');
    await page.locator('.atlas-link[data-route="pages/preferences/index"]').click();
    await expectRoute('preferences');
    assert.equal((await data()).ready, false);
    assert.ok((await data()).error.includes('网络'), 'The progress preparation consumed the armed source read failure');
    await capture('r13-progress-preparation-preserves-source-read-fault');
    await native('.error .text-button').click();
    await settled();
    assert.equal((await data()).ready, true, 'The source preferences retry did not recover after consuming its own fault');
    await native('input[role="switch"]').first().setChecked(!(await data()).newActivities);
    const destination = await snapshot();
    assert.equal(destination.current.dirty, true);
    assert.ok(destination.current.leaveMessage);
    assert.notEqual(destination.current.instance, source.current.instance);
    await release();
    await waitUntil(async () => page.evaluate(() => !document.querySelector('.scenario-button[data-scenario="progress"]').disabled), 'The obsolete progress preparation did not finish');
    await settled();
    assert.deepEqual(await snapshot(), destination, 'The old progress preparation navigated away from or changed the new dirty preferences editor');
    assert.equal(await page.locator('#scenario-feedback').innerText(), '页面已变化，请重新选择操作。');
    assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__r13EntryBoot.dialogs), []);
    assert.deepEqual(await page.evaluate(() => window.__r13EntryBoot.commandCalls), []);
    await page.evaluate(() => window.Prototype.api.query('preferences.get', {}));
    assert.deepEqual(await snapshot(), destination, 'A follow-up read changed the protected editor');
    await capture('r13-progress-preparation-keeps-new-editor', { source, destination, prepared });
  });
}


async function runR13ReceiptScopeRegressions() {
  const originalPage = page;
  const receiptKey = (ownerId, entityId) => [
    'card-benefits.form-draft.v1', 'receipt', ownerId, entityId,
  ].map(encodeURIComponent).join(':');
  const readDraft = async key => page.evaluate(key => wx.getStorageSync(key) ?? null, key);
  const expectRoute = async name => {
    await waitUntil(async () => page.evaluate(name =>
      Prototype.current?.route === 'pages/' + name + '/index', name),
    'Receipt scope regression did not reach ' + name);
  };
  const ledger = async activityId => page.evaluate(activityId => {
    const seed = wx.getStorageSync('card-benefits.native.demo.v1').seed;
    const records = Object.values(seed.participations || {}).filter(record => record.activityId === activityId);
    const ids = records.map(record => record.id);
    const rewards = Object.values(seed.rewards || {}).filter(reward => ids.includes(reward.participationId));
    const rewardIds = rewards.map(reward => reward.id);
    return {
      records, rewards,
      trackings: Object.values(seed.trackings || {}).filter(tracking => tracking.activityId === activityId),
      requests: Object.values(seed.requests || {}).filter(request => {
        try {
          const fingerprint = JSON.parse(request.fingerprint);
          return fingerprint.action === 'reward.confirm' &&
            (fingerprint.payload.activityId === activityId || ids.includes(fingerprint.payload.participationId));
        } catch { return false; }
      }),
      audit: Object.values(seed.audit_events || {}).filter(event =>
        ids.includes(event.entityId) || rewardIds.includes(event.entityId)),
    };
  }, activityId);
  const setupActivity = async scope => {
    await page.evaluate(() => Prototype.scenarios.review()); await settled();
    const fixture = await page.evaluate(async scope => {
      const detail = await Prototype.api.query('activity.get', { activityId: 'monthly' });
      const { id, revision, status, publishedAt, updatedAt, publishedBy, ...draft } = detail.activity;
      draft.title = scope === 'card' ? '同卡同期待办到账验收活动' : '同人同期待办到账验收活动';
      draft.startsOn = '2026-01-01'; draft.endsOn = '2026-12-31';
      draft.frequency = 'monthly'; draft.scope = scope; draft.target = 1;
      draft.requiresRegistration = false; draft.requiresInvitation = false;
      draft.rewardMinor = 1000; draft.rewardKind = 'cashback';
      draft.sourceNote = '仅用于演示模式同一期到账入口衔接验收。';
      const submission = await Prototype.api.command('submission.save', { draft });
      const published = await Prototype.api.command('submission.review', {
        id: submission.id, expectedVersion: submission.version, decision: 'publish', sourceVerified: true, draft,
      });
      const session = await Prototype.api.query('session.get', {});
      return { activityId: published.id, scope, cardId: scope === 'card' ? 'demo-card-cmb' : '', ownerId: session.userId };
    }, scope);
    await page.evaluate(id => Prototype.openPage('pages/detail/index?id=' + encodeURIComponent(id)), fixture.activityId);
    await settled();
    assert.equal((await data()).detail.participation, null);
    return fixture;
  };
  const selectFixtureCard = async fixture => {
    await waitUntil(async () => (await data()).showCards && !(await data()).busy,
      'The source card selector did not open');
    await native('[data-handler="chooseCard"][data-id="' + fixture.cardId + '"]').click();
    await native('[data-handler="confirmCard"]').click();
  };
  const receiptFromDetail = async fixture => {
    const needsCard = fixture.scope === 'card' && !(await data()).detail.participation;
    await clickDetailAction('receipt');
    if (needsCard) await selectFixtureCard(fixture);
    await expectRoute('receipt');
  };
  const joinFromDetail = async fixture => {
    assert.equal((await data()).detail.participation, null);
    await clickDetailAction('join');
    if (fixture.scope === 'card') await selectFixtureCard(fixture);
    await waitUntil(async () => (await data()).detail?.participation && !(await data()).busy &&
      !(await data()).refreshing, 'The source join action did not produce the current participation');
    await settled();
    return (await data()).detail.participation;
  };
  const leaveReceipt = async () => {
    await page.locator('#native-back').click();
    const leave = page.locator('#platform-layer button').filter({ hasText: /^离开$/ });
    await leave.waitFor({ state: 'visible' }); await leave.click();
    await expectRoute('detail'); await settled();
  };
  const fillReceipt = async (amount, date) => {
    await native('#amount').fill(amount);
    await native('#receipt-date-field input').fill(date);
  };
  const recover = async pending => {
    const label = pending ? '恢复核对' : '恢复草稿';
    const button = page.locator('#platform-layer button').filter({ hasText: label });
    await button.waitFor({ state: 'visible' }); await button.click(); await settled();
  };
  const installTrace = async ({ activityId, failAfterCommit = false }) => {
    await page.evaluate(({ activityId, failAfterCommit }) => {
      const api = Prototype.api;
      const state = window.__r13Receipt = {
        api, command: api.command, setStorageSync: wx.setStorageSync,
        commands: [], committedFailure: null,
      };
      api.command = function (...args) {
        const call = {
          action: args[0], payload: JSON.parse(JSON.stringify(args[1])),
          options: args[2] === undefined ? null : JSON.parse(JSON.stringify(args[2])),
          argumentCount: args.length,
        };
        state.commands.push(call);
        const pending = state.command.apply(this, args);
        pending.then(result => { call.result = JSON.parse(JSON.stringify(result)); },
          error => { call.error = { code: error.code, field: error.field, message: error.message }; });
        return pending;
      };
      if (!failAfterCommit) return;
      wx.setStorageSync = function (...args) {
        // The actual domain result and idempotency record must be persisted before response loss.
        const result = state.setStorageSync.apply(this, args);
        if (args[0] !== 'card-benefits.native.demo.v1' || state.committedFailure) return result;
        const seed = args[1]?.seed;
        const participation = Object.values(seed?.participations || {}).find(record =>
          record.activityId === activityId && record.periodKey === '2026-09' && record.stage === 'received');
        const request = participation && Object.values(seed?.requests || {}).find(record => {
          try {
            const fingerprint = JSON.parse(record.fingerprint);
            return record.result?.id === participation.id && fingerprint.action === 'reward.confirm' &&
              fingerprint.payload.activityId === activityId && fingerprint.payload.expectNew === true;
          } catch { return false; }
        });
        if (!request) return result;
        state.committedFailure = { participationId: participation.id, requestId: request.requestId };
        throw Object.assign(new Error('到账已写入，但响应未收到，请重试。'), { code: 'NETWORK_ERROR' });
      };
    }, { activityId, failAfterCommit });
  };
  const trace = async () => page.evaluate(() => ({
    commands: window.__r13Receipt.commands, committedFailure: window.__r13Receipt.committedFailure,
  }));
  const restorePersistWrapper = async () => page.evaluate(() => {
    if (window.__r13Receipt) wx.setStorageSync = window.__r13Receipt.setStorageSync;
  });
  const restoreTrace = async () => page.evaluate(() => {
    const state = window.__r13Receipt;
    if (!state) return;
    wx.setStorageSync = state.setStorageSync;
    state.api.command = state.command;
    delete window.__r13Receipt;
  });
  const isolatedCheck = async (name, action) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    try {
      await context.addInitScript(() => {
        const NativeDate = window.Date;
        window.__r13Clock = { NativeDate, now: NativeDate.parse('2026-09-30T04:00:00.000Z') };
        window.Date = new Proxy(NativeDate, {
          construct(target, args) { return Reflect.construct(target, args.length ? args : [window.__r13Clock.now]); },
          apply() { return new NativeDate(window.__r13Clock.now).toString(); },
          get(target, key, receiver) {
            return key === 'now' ? () => window.__r13Clock.now : Reflect.get(target, key, receiver);
          },
        });
      });
      page = await context.newPage(); page.setDefaultTimeout(10000);
      const exceptions = [];
      page.on('pageerror', error => exceptions.push(error.message));
      if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
      await check(name, async () => {
        await page.goto(baseUrl, { waitUntil: 'load' });
        await page.waitForFunction(() => Prototype.ready && Prototype.current?.data); await settled();
        await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{width:375px!important;height:812px!important;min-height:812px!important;max-height:812px!important;max-width:none!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
        await action();
        assert.deepEqual(exceptions, [], 'The isolated receipt scope regression raised a browser exception');
      });
    } finally {
      try { await restoreTrace(); } catch {}
      try { await context.close(); } finally { page = originalPage; }
    }
  };

  for (const scope of ['user', 'card']) {
    await isolatedCheck('A same-period ' + scope + ' creation draft follows the real Detail join into its explicit record', async () => {
      const fixture = await setupActivity(scope);
      await installTrace({ activityId: fixture.activityId });
      await receiptFromDetail(fixture); await settled();
      assert.equal((await data()).participation, null);
      await fillReceipt('77.77', '2026-09-29');
      const draftPage = await data();
      const creationKey = receiptKey(draftPage.ownerId, draftPage.draftEntityId);
      const saved = await readDraft(creationKey);
      assert.equal(saved.value.draftTarget.scope, scope);
      assert.equal(saved.value.draftTarget.cardId, fixture.cardId);
      assert.equal(saved.value.draftTarget.periodKey, '2026-09');
      assert.equal(saved.value.draftTarget.participationId, '');
      await leaveReceipt();
      const joined = await joinFromDetail(fixture);
      assert.equal(joined.ownerId, fixture.ownerId);
      assert.equal(joined.periodKey, '2026-09');
      assert.equal(joined.scopeKey, scope === 'card' ? 'card:' + fixture.cardId : 'user');
      assert.deepEqual(await readDraft(creationKey), saved,
        'Joining the activity changed the receipt draft before the user chose recovery');
      await receiptFromDetail(fixture);
      await page.locator('#platform-layer button').filter({ hasText: '恢复草稿' }).waitFor({ state: 'visible' });
      assert.equal((await data()).participationId, joined.id);
      await recover(false);
      const recovered = await data();
      assert.equal(recovered.participation.id, joined.id);
      assert.equal(recovered.receiptTarget.participationId, joined.id);
      assert.equal(recovered.receiptTarget.periodKey, '2026-09');
      assert.equal(recovered.receiptTarget.scope, scope);
      assert.equal(recovered.receiptTarget.cardId, fixture.cardId);
      assert.equal(recovered.targetReviewRequired, false);
      assert.equal(await native('#amount').inputValue(), '77.77');
      assert.equal(await native('#receipt-date-field input').inputValue(), '2026-09-29');
      assert.equal(await readDraft(creationKey), null);
      const recordKey = receiptKey(fixture.ownerId, joined.id);
      assert.equal((await readDraft(recordKey)).value.draftTarget.participationId, joined.id);
      await capture('r13-' + scope + '-joined-record-recovers-original-draft');
      await native('.entry-primary').click();
      await expectRoute('detail'); await settled();
      const receiptCalls = (await trace()).commands.filter(call => call.action === 'reward.confirm');
      assert.equal(receiptCalls.length, 1);
      assert.equal(receiptCalls[0].payload.participationId, joined.id);
      assert.equal(receiptCalls[0].payload.expectedVersion, joined.version);
      assert.equal(receiptCalls[0].payload.expectNew, undefined);
      const after = await ledger(fixture.activityId);
      assert.equal(after.records.length, 1);
      assert.equal(after.records[0].id, joined.id);
      assert.equal(after.records[0].receivedMinor, 7777);
      assert.equal(after.records[0].receivedOn, '2026-09-29');
      assert.equal(after.rewards.length, 1);
      assert.equal(await readDraft(recordKey), null);
      await capture('r13-' + scope + '-joined-record-saves-one-receipt');
    });

    await isolatedCheck('An unknown committed ' + scope + ' receipt reconnects from the explicit same-period record through the original intent', async () => {
      const fixture = await setupActivity(scope);
      await receiptFromDetail(fixture); await settled();
      await fillReceipt('88.88', '2026-09-30');
      const draftPage = await data();
      const creationKey = receiptKey(draftPage.ownerId, draftPage.draftEntityId);
      await installTrace({ activityId: fixture.activityId, failAfterCommit: true });
      await native('.entry-primary').click();
      await waitUntil(async () => {
        const value = await data(), logged = await trace();
        return logged.committedFailure && !value.busy && !!value.pendingCreation;
      }, 'The original receipt did not persist before the simulated response loss');
      const logged = await trace();
      const first = logged.commands[0];
      const recordId = logged.committedFailure.participationId;
      assert.equal(first.options.intentKey, (await data()).pendingCreation.intentKey);
      assert.equal(first.payload.expectNew, true);
      const before = await ledger(fixture.activityId);
      assert.equal(before.records.length, 1);
      assert.equal(before.records[0].id, recordId);
      assert.equal(before.records[0].scopeKey, scope === 'card' ? 'card:' + fixture.cardId : 'user');
      assert.equal(before.records[0].receivedMinor, 8888);
      await restorePersistWrapper();
      await leaveReceipt();
      assert.equal((await data()).detail.participation.id, recordId);
      await receiptFromDetail(fixture);
      const pendingRecovery = page.locator('#platform-layer button').filter({ hasText: '恢复核对' });
      await pendingRecovery.waitFor({ state: 'visible' });
      assert.equal((await data()).participationId, recordId);
      await recover(true);
      const recovered = await data();
      assert.equal(recovered.pendingCreation.intentKey, first.options.intentKey);
      assert.deepEqual(recovered.pendingCreation.payload, first.payload);
      assert.equal(recovered.pendingReplayOnly, true,
        'An explicit existing-record entry must not attempt another first write');
      assert.equal(recovered.receiptTarget.periodKey, '2026-09');
      assert.equal(recovered.receiptTarget.scope, scope);
      assert.equal(recovered.receiptTarget.cardId, fixture.cardId);
      assert.equal(await native('#amount').isDisabled(), true);
      assert.equal(await native('#receipt-date-field input').isDisabled(), true);
      assert.ok((await native('.entry-primary').innerText()).includes('核对上次保存结果'));
      await capture('r13-' + scope + '-explicit-record-reconnects-pending-intent');
      await native('.entry-primary').click();
      await expectRoute('detail'); await settled();
      const calls = (await trace()).commands;
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1].payload, first.payload);
      assert.deepEqual(calls[1].options, { intentKey: first.options.intentKey, replayOnly: true });
      assert.equal(calls[1].result.id, recordId);
      assert.deepEqual(await ledger(fixture.activityId), before,
        'Resolving an existing record changed its receipt, snapshot, or idempotency result');
      assert.equal(await readDraft(creationKey), null);
      assert.equal(await readDraft(receiptKey(fixture.ownerId, recordId)), null);
      await capture('r13-' + scope + '-explicit-record-lookup-does-not-write');
    });
  }

  await isolatedCheck('A never-submitted September form can explicitly choose October and perform its first write', async () => {
    const fixture = await setupActivity('user');
    await receiptFromDetail(fixture); await settled();
    await fillReceipt('33.33', '2026-09-30');
    const before = await data();
    const oldIntent = before.intentKey;
    assert.equal(before.receiptTarget.periodKey, '2026-09');
    assert.equal(before.pendingCreation, null);
    await installTrace({ activityId: fixture.activityId });
    await page.evaluate(() => {
      window.__r13Clock.now = window.__r13Clock.NativeDate.parse('2026-10-01T04:00:00.000Z');
    });
    await native('.entry-primary').click();
    await waitUntil(async () => !(await data()).busy && (await data()).targetReviewRequired,
      'The live form did not request an explicit target choice after the month changed');
    const review = await data();
    assert.equal(review.pendingCreation, null,
      'A form with no mutation attempt became an unresolved pending request');
    assert.equal(review.currentTarget.periodKey, '2026-10');
    assert.equal(review.receiptTarget.periodKey, '2026-09');
    assert.equal(await native('#amount').inputValue(), '33.33');
    assert.equal(await native('#receipt-date-field input').inputValue(), '2026-09-30');
    assert.equal((await trace()).commands.length, 0);
    assert.equal((await ledger(fixture.activityId)).records.length, 0);
    assert.equal((await ledger(fixture.activityId)).requests.length, 0);
    const confirm = native('[data-handler="confirmDraftTarget"]');
    assert.ok((await confirm.innerText()).includes('2026年10月'));
    await capture('r13-never-submitted-form-requests-current-period');
    await confirm.click();
    assert.equal((await data()).targetReviewRequired, false);
    assert.equal((await data()).pendingCreation, null);
    assert.equal((await data()).receiptTarget.periodKey, '2026-10');
    assert.notEqual((await data()).intentKey, oldIntent);
    assert.equal(await native('#receipt-date-field input').inputValue(), '2026-09-30');
    await native('.entry-primary').click(); await settled();
    assert.ok((await data()).dateError.includes('2026-10-01'));
    assert.equal((await data()).pendingCreation, null);
    assert.equal((await trace()).commands.length, 0,
      'Confirming the new target bypassed receipt-date validation');
    await capture('r13-never-submitted-form-requires-correct-date');
    await native('#receipt-date-field input').fill('2026-10-01');
    const creationIntent = (await data()).intentKey;
    await native('.entry-primary').click();
    await expectRoute('detail'); await settled();
    const calls = (await trace()).commands;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'reward.confirm');
    assert.equal(calls[0].payload.activityId, fixture.activityId);
    assert.equal(calls[0].payload.expectNew, true);
    assert.equal(calls[0].payload.expectedPeriodKey, '2026-10');
    assert.equal(calls[0].payload.amountMinor, 3333);
    assert.equal(calls[0].payload.receivedOn, '2026-10-01');
    assert.deepEqual(calls[0].options, { intentKey: creationIntent });
    const after = await ledger(fixture.activityId);
    assert.equal(after.records.length, 1);
    assert.equal(after.records[0].periodKey, '2026-10');
    assert.equal(after.records[0].receivedMinor, 3333);
    assert.equal(after.records[0].receivedOn, '2026-10-01');
    assert.equal(after.rewards.length, 1);
    assert.equal(after.requests.length, 1);
    await capture('r13-never-submitted-form-performs-one-current-period-write');
  });
}



async function runR13PaginationRoleRegression() {
  const originalPage = page;
  const context = await originalPage.context().browser().newContext({
    viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1,
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
  });
  try {
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
    await check('A newer explicit review role survives cancelled pagination and retains its already committed submission', async () => {
      await page.goto(new URL(originalPage.url()).origin, { waitUntil: 'load' });
      await page.waitForFunction(() => window.Prototype?.ready && window.Prototype.current?.data);
      await settled();
      const initialSession = await page.evaluate(() => window.Prototype.api.query('session.get', {}));
      assert.equal(initialSession.isModerator, false, 'The pagination fixture must start as an ordinary demo user');
      try {
        await page.evaluate(() => {
          const api = window.Prototype.api;
          const state = window.__acceptancePaginationRole = {
            api, originalCommand: api.command, originalQuery: api.query,
            held: false, pending: [], attempts: [], commits: [],
          };
          api.command = async function (...args) {
            const [action, payload] = args;
            state.attempts.push({ action, title: payload.draft?.title || payload.lead?.title });
            const result = await state.originalCommand.apply(api, args);
            state.commits.push({ action, id: result?.id, version: result?.version });
            if (!state.held && action === 'submission.save' && payload.draft?.title?.startsWith('分页演示活动')) {
              state.held = true;
              state.firstCommitted = await state.originalQuery.call(api, 'submission.get', { id: result.id });
              return new Promise(resolve => state.pending.push({ result, resolve }));
            }
            return result;
          };
        });
        await page.locator('.scenario-button[data-scenario="pagination"]').click();
        await waitUntil(async () => page.evaluate(() => window.__acceptancePaginationRole.pending.length === 1), 'The first pagination submission did not really commit before its response was deferred');
        await settled();
        const committed = await page.evaluate(() => window.__acceptancePaginationRole.firstCommitted);
        assert.equal(committed.status, 'pending');
        assert.equal(committed.version, 1);
        assert.ok(!committed.activityId, 'The held first submission was already published');
        assert.equal(await page.locator('.scenario-button[data-scenario="pagination"]').isDisabled(), true);
        await page.locator('.scenario-button[data-scenario="review"]').click();
        await waitUntil(async () => page.evaluate(() => window.Prototype.current?.route === 'pages/review/index'
          && !window.Prototype.current.data.loading && window.Prototype.current.data.sessionVerified && !window.Prototype.current.data.denied), 'The explicit review scenario did not become ready');
        await settled();
        await waitUntil(async () => !(await page.locator('.scenario-button[data-scenario="review"]').isDisabled()), 'The new review scenario did not finish its own setup');
        const reviewBefore = await page.evaluate(async () => ({
          session: await window.Prototype.api.query('session.get', {}),
          instance: window.Prototype.current._instanceId,
          hash: location.hash,
          stack: getCurrentPages().map(item => ({ route: item.route, instance: item._instanceId })),
          status: window.Prototype.current.data.status,
          attempts: window.__acceptancePaginationRole.attempts,
          commits: window.__acceptancePaginationRole.commits,
          feedback: document.getElementById('scenario-feedback').textContent,
          itemIds: window.Prototype.current.data.items.map(item => item.id),
        }));
        assert.equal(reviewBefore.session.isModerator, true, 'The explicit review scenario did not claim its moderator role');
        assert.ok(reviewBefore.itemIds.includes(committed.id), 'Review did not read the already committed pending submission');
        await capture('r13-review-role-claimed-before-pagination-release', { role: reviewBefore.session.isModerator, committedSubmissionId: committed.id });
        await page.evaluate(async () => {
          for (const item of window.__acceptancePaginationRole.pending) item.resolve(item.result);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        await waitUntil(async () => !(await page.locator('.scenario-button[data-scenario="pagination"]').isDisabled()), 'The abandoned pagination operation did not finish cleanup', 20000);
        await settled();
        const after = await page.evaluate(async id => {
          const state = window.__acceptancePaginationRole;
          let moderation;
          try {
            const result = await window.Prototype.api.query('submissions.list', { moderation: true, status: 'pending', limit: 50 });
            moderation = { allowed: true, items: result.items };
          } catch (error) { moderation = { allowed: false, items: [], code: error.code, message: error.message }; }
          return {
            session: await window.Prototype.api.query('session.get', {}),
            stored: await window.Prototype.api.query('submission.get', { id }),
            moderation,
            route: window.Prototype.current.route,
            instance: window.Prototype.current._instanceId,
            hash: location.hash,
            stack: getCurrentPages().map(item => ({ route: item.route, instance: item._instanceId })),
            status: window.Prototype.current.data.status,
            denied: window.Prototype.current.data.denied,
            sessionVerified: window.Prototype.current.data.sessionVerified,
            feedback: document.getElementById('scenario-feedback').textContent,
            paginationComplete: wx.getStorageSync('scenario.pagination.v1'),
            attempts: state.attempts,
            commits: state.commits,
          };
        }, committed.id);
        assert.equal(after.session.isModerator, true, 'Old pagination cleanup revoked the newer explicit review role');
        assert.equal(after.route, 'pages/review/index');
        assert.equal(after.instance, reviewBefore.instance, 'Old pagination completion replaced the active review page');
        assert.equal(after.hash, reviewBefore.hash, 'Old pagination completion changed the active URL');
        assert.deepEqual(after.stack, reviewBefore.stack, 'Old pagination completion changed the navigation stack');
        assert.equal(after.status, reviewBefore.status, 'Old pagination completion changed the review filter');
        assert.equal(after.feedback, reviewBefore.feedback, 'Old pagination completion replaced feedback owned by the newer review scenario');
        assert.equal(after.denied, false);
        assert.equal(after.sessionVerified, true);
        // The newer review scenario may legitimately seed its own fixtures before becoming ready.
        assert.deepEqual(after.attempts, reviewBefore.attempts, 'Abandoned pagination attempted more business mutations after the newer review scenario was ready');
        assert.deepEqual(after.commits, reviewBefore.commits, 'Abandoned pagination continued to commit records after the newer review scenario was ready');
        assert.ok(after.commits.some(item => item.action === 'submission.save' && item.id === committed.id && item.version === 1));
        assert.deepEqual(after.stored, committed, 'Cancellation discarded or rewrote the already committed submission');
        assert.equal(after.moderation.allowed, true, 'The newer moderator can no longer read the moderation queue');
        assert.ok(after.moderation.items.some(item => item.id === committed.id), 'The new moderator lost access to the committed pending submission');
        assert.notEqual(after.paginationComplete, true, 'An interrupted partial fixture was marked complete');
        await capture('r13-new-review-role-survives-old-pagination-finally', {
          role: after.session.isModerator, committedSubmissionId: committed.id,
          attempts: after.attempts, commits: after.commits, feedbackBefore: reviewBefore.feedback, feedbackAfter: after.feedback,
        });
        await native('.tab[data-status="published"]').click();
        await settled();
        assert.equal((await data()).denied, false, 'The active review role failed after a real status-tab read');
        assert.equal((await data()).sessionVerified, true);
        await native('.tab[data-status="pending"]').click();
        await settled();
        assert.equal((await data()).denied, false);
        assert.equal((await data()).sessionVerified, true);
        assert.ok((await data()).items.some(item => item.id === committed.id));
        await capture('r13-review-remains-authorized-and-committed-draft-retained', { committedSubmissionId: committed.id });
      } finally {
        await page.evaluate(() => {
          const state = window.__acceptancePaginationRole;
          if (!state) return;
          state.api.command = state.originalCommand;
          for (const item of state.pending) item.resolve(item.result);
          delete window.__acceptancePaginationRole;
        });
        await waitUntil(async () => !(await page.locator('.scenario-button[data-scenario="pagination"]').isDisabled()), 'Pagination cleanup did not settle', 20000);
      }
    });
  } finally {
    page = originalPage;
    await context.close();
  }
}


async function runR14ReviewRoleRegressions() {
  const originalPage = page;
  async function freshCase(name, action) {
    const context = await originalPage.context().browser().newContext({
      viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    try {
      page = await context.newPage();
      page.setDefaultTimeout(10000);
      if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
      await page.addInitScript(() => {
        // Wrap the real service before runtime startup captures its independent scenario query channel.
        Object.defineProperty(window, 'Prototype', {
          configurable: true,
          set(value) {
            const originalStart = value.start;
            value.start = function (exports) {
              value.start = originalStart;
              const api = exports.api;
              const state = window.__r14ReviewGuard = {
                api, ApiError: exports.ApiError, actor: exports.demoActor,
                originalQuery: api.query, originalCommand: api.command,
                record: false, gateNext: false, pending: [], queries: [], commands: [], toasts: [],
              };
              api.query = async function (...args) {
                const [action, payload] = args;
                if (state.record) state.queries.push({ action, payload, moderator: state.actor.isModerator });
                const result = await state.originalQuery.apply(api, args);
                if (state.gateNext && action === 'submissions.list' && payload.moderation === true && payload.status === 'pending' && payload.limit === 50) {
                  state.gateNext = false;
                  return new Promise((resolve, reject) => state.pending.push({ action, payload, result, resolve, reject }));
                }
                return result;
              };
              api.command = async function (...args) {
                const [action, payload] = args;
                const entry = { action, payload, moderator: state.actor.isModerator };
                if (state.record) state.commands.push(entry);
                try { const result = await state.originalCommand.apply(api, args); entry.result = result; return result; }
                catch (error) { entry.error = { code: error.code, message: error.message }; throw error; }
              };
              return originalStart.call(value, exports);
            };
            Object.defineProperty(window, 'Prototype', { configurable: true, writable: true, value });
          },
        });
      });
      await check(name, async () => {
        await page.goto(new URL(originalPage.url()).origin, { waitUntil: 'load' });
        await page.waitForFunction(() => window.Prototype?.ready && window.Prototype.current?.data);
        await settled();
        await page.evaluate(() => {
          const state = window.__r14ReviewGuard;
          state.record = true;
          state.observer = new MutationObserver(() => {
            const message = document.getElementById('toast').textContent;
            if (message) state.toasts.push(message);
          });
          state.observer.observe(document.getElementById('toast'), { childList: true, characterData: true, subtree: true });
        });
        try { await action(); }
        finally {
          await page.evaluate(() => {
            const state = window.__r14ReviewGuard;
            if (!state) return;
            state.record = false; state.gateNext = false;
            state.observer?.disconnect();
            state.api.query = state.originalQuery;
            state.api.command = state.originalCommand;
            for (const item of state.pending) item.resolve(item.result);
          });
        }
      });
    } finally {
      page = originalPage;
      await context.close();
    }
  }
  async function snapshot() {
    return page.evaluate(async () => {
      const state = window.__r14ReviewGuard;
      const owner = window.Prototype.current;
      return {
        route: owner.route, instance: owner._instanceId, hash: location.hash,
        stack: getCurrentPages().map(item => ({ route: item.route, instance: item._instanceId })),
        session: await state.originalQuery.call(state.api, 'session.get', {}),
        ownSubmissions: (await state.originalQuery.call(state.api, 'submissions.list', { limit: 50 })).items,
        page: { loading: owner.data.loading, denied: owner.data.denied, sessionVerified: owner.data.sessionVerified, status: owner.data.status, itemIds: owner.data.items?.map(item => item.id), requestGeneration: owner.requestGeneration },
        feedback: document.getElementById('scenario-feedback').textContent,
        toast: document.getElementById('toast').textContent,
        toasts: state.toasts,
        queries: state.queries,
        commands: state.commands,
      };
    });
  }
  async function startHeldReview(expectedCount) {
    await page.evaluate(() => { window.__r14ReviewGuard.gateNext = true; });
    await page.locator('.scenario-button[data-scenario="review"]').click();
    await waitUntil(async () => page.evaluate(count => window.__r14ReviewGuard.pending.length === count
      && window.Prototype.current.route === 'pages/review/index' && !window.Prototype.current.data.loading
      && window.Prototype.current.data.sessionVerified && !window.Prototype.current.data.denied, expectedCount), 'The real scenario preparation read was not held independently of the ready Review controller');
    const held = await page.evaluate(index => {
      const item = window.__r14ReviewGuard.pending[index];
      return { action: item.action, payload: item.payload, result: item.result };
    }, expectedCount - 1);
    assert.equal(held.payload.limit, 50);
    assert.deepEqual(held.result.items, [], 'The fresh scenario preparation must observe an empty moderation queue');
    return snapshot();
  }
  async function settleHeldReview(index, errorMessage) {
    await page.evaluate(async ({ index, errorMessage }) => {
      const state = window.__r14ReviewGuard;
      const item = state.pending[index];
      if (errorMessage) item.reject(new state.ApiError('NETWORK_ERROR', errorMessage));
      else item.resolve(item.result);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, { index, errorMessage });
    await waitUntil(async () => !(await page.locator('.scenario-button[data-scenario="review"]').isDisabled()), 'The retired review scenario did not finish');
    await settled();
  }
  async function retireToOrdinaryUser(before) {
    assert.equal(before.session.isModerator, true);
    assert.deepEqual(before.commands, []);
    assert.ok(before.queries.some(item => item.action === 'submissions.list' && item.payload.limit === 20), 'The source Review list did not complete its own normal read');
    await page.locator('.scenario-button[data-scenario="denied"]').click();
    await waitUntil(async () => page.evaluate(() => !window.Prototype.current.data.loading && window.Prototype.current.data.denied
      && !document.querySelector('.scenario-button[data-scenario="denied"]').disabled), 'The newer ordinary-user scenario did not revalidate Review');
    await settled();
    const retired = await snapshot();
    assert.equal(retired.instance, before.instance, 'The scenario must retire the old work on the same Review instance');
    assert.equal(retired.hash, before.hash);
    assert.deepEqual(retired.stack, before.stack);
    assert.equal(retired.session.isModerator, false);
    assert.deepEqual(retired.ownSubmissions, []);
    assert.equal(retired.page.denied, true);
    assert.ok(retired.feedback.includes('普通演示用户'));
    return retired;
  }
  async function freshReviewStillWorks(suffix) {
    await page.locator('.scenario-button[data-scenario="review"]').click();
    await waitUntil(async () => page.evaluate(() => !document.querySelector('.scenario-button[data-scenario="review"]').disabled
      && window.Prototype.current.route === 'pages/review/index' && !window.Prototype.current.data.loading
      && window.Prototype.current.data.sessionVerified && !window.Prototype.current.data.denied
      && window.Prototype.current.data.items.length === 2), 'A fresh authorized review scenario did not prepare and display its real submissions');
    await settled();
    const current = await snapshot();
    assert.equal(current.session.isModerator, true);
    assert.deepEqual(current.commands.map(item => item.action), ['submission.lead.save', 'submission.save']);
    assert.ok(current.commands.every(item => item.moderator && item.result?.id && !item.error), 'Fresh scenario setup did not commit through the real moderator service');
    assert.equal(current.ownSubmissions.length, 2);
    assert.ok(current.ownSubmissions.every(item => item.status === 'pending'));
    const full = current.ownSubmissions.find(item => item.draft);
    assert.ok(full, 'The normal review scenario did not create a complete submission');
    await native(`.review-row[data-id="${full.id}"]`).click();
    await waitUntil(async () => page.evaluate(id => window.Prototype.current.route === 'pages/submission-edit/index'
      && window.Prototype.current.data.ready && !window.Prototype.current.data.loading && !window.Prototype.current.data.denied
      && window.Prototype.current.data.reviewMode && window.Prototype.current.data.submission?.id === id, full.id), 'The fresh full submission was not reviewable through the source UI');
    await capture(`r14-review-fresh-authorized-editor-${suffix}`, { submissionId: full.id, committedActions: current.commands.map(item => item.action) });
  }

  await freshCase('A retired review preparation success preserves the newer ordinary-user page and creates no submissions', async () => {
    const before = await startHeldReview(1);
    const retired = await retireToOrdinaryUser(before);
    await settleHeldReview(0);
    const after = await snapshot();
    assert.deepEqual(after, retired, 'The stale review success wrote data, refreshed the same page, changed authorization, or replaced newer feedback');
    assert.equal(await native('.empty-title').innerText(), '此账号没有审核权限');
    await capture('r14-review-retired-success-is-silent', { feedback: after.feedback, commands: after.commands, queryCount: after.queries.length, role: after.session.isModerator });
    await freshReviewStillWorks('after-retired-success');
  });

  await freshCase('A retired review preparation failure is silent while a current failure remains visible and recoverable', async () => {
    const before = await startHeldReview(1);
    const retired = await retireToOrdinaryUser(before);
    await settleHeldReview(0, '旧审核准备请求失败，请重试。');
    const after = await snapshot();
    assert.deepEqual(after, retired, 'The retired review failure changed the page or surfaced a stale error toast');
    await capture('r14-review-retired-failure-is-silent', { feedback: after.feedback, toastEvents: after.toasts, commands: after.commands });
    await startHeldReview(2);
    const message = '当前审核准备读取失败，请重试。';
    await settleHeldReview(1, message);
    await waitUntil(async () => (await page.locator('#toast').innerText()) === message, 'A current legitimate scenario failure was incorrectly suppressed');
    const failure = await snapshot();
    assert.equal(failure.session.isModerator, true);
    assert.deepEqual(failure.commands, []);
    assert.deepEqual(failure.ownSubmissions, []);
    assert.ok(failure.toasts.includes(message));
    await capture('r14-review-current-error-remains-visible', { message, toastEvents: failure.toasts });
    await freshReviewStillWorks('after-current-error');
  });
}


async function runR14ReceiptDateRegressions() {
  const originalPage = page;
  const receiptKey = value => [
    'card-benefits.form-draft.v1', 'receipt', value.ownerId, value.draftEntityId,
  ].map(encodeURIComponent).join(':');
  const readDraft = async key => page.evaluate(key => wx.getStorageSync(key) ?? null, key);
  const expectRoute = async name => {
    await waitUntil(async () => page.evaluate(name =>
      Prototype.current?.route === 'pages/' + name + '/index', name),
    'Receipt date regression did not reach ' + name);
  };
  const dateSettled = async () => {
    await settled();
    await waitUntil(async () => !(await data()).dateRefreshing,
      'The source date freshness check remained busy');
  };
  const ledger = async fixture => page.evaluate(({ activityId, participationId }) => {
    const seed = wx.getStorageSync('card-benefits.native.demo.v1').seed;
    const records = Object.values(seed.participations || {}).filter(record => record.activityId === activityId);
    return {
      records,
      rewards: Object.values(seed.rewards || {}).filter(reward => reward.participationId === participationId),
      requests: Object.values(seed.requests || {}).filter(request => request.result?.id === participationId),
      audit: Object.values(seed.audit_events || {}).filter(event => event.entityId === participationId),
    };
  }, fixture);
  const setupKnownReceipt = async () => {
    await page.evaluate(() => Prototype.scenarios.review()); await settled();
    const fixture = await page.evaluate(async () => {
      const detail = await Prototype.api.query('activity.get', { activityId: 'monthly' });
      const { id, revision, status, publishedAt, updatedAt, publishedBy, ...draft } = detail.activity;
      draft.title = '已有记录日期更新验收活动';
      draft.startsOn = '2026-01-01'; draft.endsOn = '2026-12-31';
      draft.frequency = 'monthly'; draft.scope = 'user'; draft.target = 1;
      draft.requiresRegistration = false; draft.requiresInvitation = false;
      draft.rewardMinor = 1000; draft.rewardKind = 'cashback';
      draft.sourceNote = '仅用于演示模式已有参与记录的跨日日期验收。';
      const submission = await Prototype.api.command('submission.save', { draft });
      const published = await Prototype.api.command('submission.review', {
        id: submission.id, expectedVersion: submission.version, decision: 'publish', sourceVerified: true, draft,
      });
      const joined = await Prototype.api.command('activity.join', { activityId: published.id });
      const completed = await Prototype.api.command('participation.complete', { participationId: joined.id });
      return { activityId: published.id, participationId: completed.id, version: completed.version };
    });
    await page.evaluate(() => Prototype.openPage('pages/mine/index')); await settled();
    await page.evaluate(id => Prototype.openPage('pages/receipt/index?id=' + encodeURIComponent(id)), fixture.participationId);
    await expectRoute('receipt'); await dateSettled();
    assert.equal((await data()).participation.periodKey, '2026-09');
    assert.equal((await data()).participation.stage, 'completed');
    assert.equal((await data()).maxDate, '2026-09-30');
    return fixture;
  };
  const installTrace = async () => {
    await page.evaluate(() => {
      const api = Prototype.api;
      const state = window.__r14ReceiptDate = {
        api, query: api.query, command: api.command,
        queries: [], commands: [], sessionMode: 'normal', releaseDateCheck: null,
      };
      api.query = async function (...args) {
        const call = { action: args[0], payload: args[1], browserNow: new Date().toISOString() };
        state.queries.push(call);
        if (args[0] === 'session.get' && state.sessionMode !== 'normal') {
          if (state.sessionMode === 'hold-fail') {
            await new Promise(resolve => { state.releaseDateCheck = resolve; });
            state.releaseDateCheck = null;
          }
          call.error = { code: 'NETWORK_ERROR', message: '日期服务暂时不可用' };
          throw Object.assign(new Error('日期服务暂时不可用'), { code: 'NETWORK_ERROR' });
        }
        const result = await state.query.apply(this, args);
        if (args[0] === 'session.get') call.result = { today: result.today, month: result.month, userId: result.userId };
        return result;
      };
      api.command = function (...args) {
        const call = {
          action: args[0], payload: JSON.parse(JSON.stringify(args[1])),
          options: args[2] === undefined ? null : JSON.parse(JSON.stringify(args[2])),
        };
        state.commands.push(call);
        const pending = state.command.apply(this, args);
        pending.then(result => { call.result = result; },
          error => { call.error = { code: error.code, message: error.message }; });
        return pending;
      };
    });
  };
  const trace = async () => page.evaluate(() => ({
    queries: window.__r14ReceiptDate.queries, commands: window.__r14ReceiptDate.commands,
  }));
  const restoreTrace = async () => {
    await page.evaluate(() => {
      const state = window.__r14ReceiptDate;
      if (!state) return;
      state.releaseDateCheck?.();
      state.api.query = state.query;
      state.api.command = state.command;
      delete window.__r14ReceiptDate;
    });
  };
  const foregroundOnOctober = async (sessionMode = 'normal') => {
    await page.evaluate(sessionMode => {
      const hostPage = Prototype.current;
      // Simulate the WeChat host lifecycle; this is not an OS foreground or physical-device check.
      hostPage.onHide();
      window.__r14DateClock.now = window.__r14DateClock.NativeDate.parse('2026-10-01T04:00:00.000Z');
      window.__r14ReceiptDate.sessionMode = sessionMode;
      void hostPage.onShow();
    }, sessionMode);
  };
  const pickerState = async () => native('#receipt-date-field input').evaluate(input => ({
    value: input.value, min: input.min, max: input.max, disabled: input.disabled,
    rangeOverflow: input.validity.rangeOverflow,
    projectedPickerEnd: input.closest('[data-wx-tag="picker"]')?.getAttribute('end'),
  }));
  const assertInputAndTargetPreserved = async (before, key, savedDraft) => {
    const current = await data();
    assert.equal(await native('#amount').inputValue(), before.amountInput);
    assert.equal(await native('#receipt-date-field input').inputValue(), before.receivedOn);
    assert.deepEqual(current.receiptTarget, before.receiptTarget);
    assert.deepEqual(current.currentTarget, before.currentTarget);
    assert.deepEqual(current.participation, before.participation);
    assert.equal(current.minDate, before.minDate);
    assert.equal(current.pendingCreation, null);
    assert.deepEqual(await readDraft(key), savedDraft,
      'Refreshing only date freshness changed the saved draft or its revision');
  };
  const saveOctoberReceipt = async (fixture, beforeLedger, amountMinor, key) => {
    await native('#receipt-date-field input').fill('2026-10-01');
    const picker = await pickerState();
    assert.equal(picker.max, '2026-10-01');
    assert.equal(picker.projectedPickerEnd, '2026-10-01');
    assert.equal(picker.rangeOverflow, false,
      'The browser picker still considers the new valid received date out of range');
    await native('.entry-primary').click();
    await expectRoute('mine'); await settled();
    const calls = (await trace()).commands;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'reward.confirm');
    assert.equal(calls[0].payload.participationId, fixture.participationId);
    assert.equal(calls[0].payload.expectedVersion, fixture.version);
    assert.equal(calls[0].payload.amountMinor, amountMinor);
    assert.equal(calls[0].payload.receivedOn, '2026-10-01');
    assert.equal(calls[0].payload.expectNew, undefined);
    const after = await ledger(fixture);
    assert.equal(after.records.length, 1);
    assert.equal(after.records[0].id, fixture.participationId);
    assert.equal(after.records[0].periodKey, '2026-09');
    assert.equal(after.records[0].receivedOn, '2026-10-01');
    assert.equal(after.records[0].receivedMinor, amountMinor);
    assert.deepEqual(after.records[0].snapshot, beforeLedger.records[0].snapshot);
    assert.equal(after.rewards.length, 1);
    assert.equal(after.rewards[0].activityPeriod, '2026-09');
    assert.equal(after.rewards[0].receivedOn, '2026-10-01');
    assert.equal(await readDraft(key), null);
    await page.evaluate(id => Prototype.openPage('pages/receipt/index?id=' + encodeURIComponent(id)), fixture.participationId);
    await dateSettled();
    assert.equal((await data()).participation.periodKey, '2026-09');
    return after;
  };
  const isolatedCheck = async (name, action) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    try {
      await context.addInitScript(() => {
        const NativeDate = window.Date;
        window.__r14DateClock = { NativeDate, now: NativeDate.parse('2026-09-30T04:00:00.000Z') };
        window.Date = new Proxy(NativeDate, {
          construct(target, args) { return Reflect.construct(target, args.length ? args : [window.__r14DateClock.now]); },
          apply() { return new NativeDate(window.__r14DateClock.now).toString(); },
          get(target, key, receiver) {
            return key === 'now' ? () => window.__r14DateClock.now : Reflect.get(target, key, receiver);
          },
        });
      });
      page = await context.newPage(); page.setDefaultTimeout(10000);
      const exceptions = [];
      page.on('pageerror', error => exceptions.push(error.message));
      if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
      await check(name, async () => {
        await page.goto(baseUrl, { waitUntil: 'load' });
        await page.waitForFunction(() => Prototype.ready && Prototype.current?.data); await settled();
        await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{width:375px!important;height:812px!important;min-height:812px!important;max-height:812px!important;max-width:none!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
        await action();
        assert.deepEqual(exceptions, [], 'The receipt date lifecycle regression raised a browser exception');
      });
    } finally {
      try { await restoreTrace(); } catch {}
      try { await context.close(); } finally { page = originalPage; }
    }
  };

  await isolatedCheck('An existing receipt refreshes its date range on foreground without changing the old participation or draft', async () => {
    const fixture = await setupKnownReceipt();
    await native('#amount').fill('12.50');
    await native('#receipt-date-field input').fill('2026-09-30');
    const before = await data();
    const key = receiptKey(before), savedDraft = await readDraft(key);
    const beforeLedger = await ledger(fixture);
    await installTrace();
    await foregroundOnOctober();
    await waitUntil(async () => !(await data()).dateRefreshing && (await data()).maxDate === '2026-10-01',
      'Foreground did not update the existing receipt date range');
    await assertInputAndTargetPreserved(before, key, savedDraft);
    const picker = await pickerState();
    assert.equal(picker.min, '2026-09-01');
    assert.equal(picker.max, '2026-10-01');
    assert.equal(picker.projectedPickerEnd, '2026-10-01');
    assert.equal(picker.disabled, false);
    assert.equal((await data()).serverToday, '2026-10-01');
    assert.equal((await data()).dateRefreshError, '');
    assert.equal((await trace()).commands.length, 0);
    assert.ok((await trace()).queries.some(call =>
      call.action === 'session.get' && call.result?.today === '2026-10-01'));
    assert.ok((await trace()).queries.every(call => call.action === 'session.get'),
      'A date-only foreground update reloaded the business record');
    assert.deepEqual(await ledger(fixture), beforeLedger);
    await capture('r14-existing-receipt-foreground-updates-picker-only');
    await saveOctoberReceipt(fixture, beforeLedger, 1250, key);
    await capture('r14-existing-september-record-accepts-october-received-date');
  });

  await isolatedCheck('A failed date freshness read visibly blocks stale-date use and retries without losing receipt input', async () => {
    const fixture = await setupKnownReceipt();
    await native('#amount').fill('12.75');
    await native('#receipt-date-field input').fill('2026-09-30');
    const before = await data();
    const key = receiptKey(before), savedDraft = await readDraft(key);
    const beforeLedger = await ledger(fixture);
    await installTrace();
    await foregroundOnOctober('hold-fail');
    await waitUntil(async () => (await data()).dateRefreshing &&
      await native('#receipt-date-field input').isDisabled() && await native('.entry-primary').isDisabled(),
    'The date freshness request did not own the picker and save busy state');
    await assertInputAndTargetPreserved(before, key, savedDraft);
    await capture('r14-date-freshness-busy-state');
    await page.evaluate(() => {
      const state = window.__r14ReceiptDate;
      state.sessionMode = 'fail';
      state.releaseDateCheck();
    });
    await waitUntil(async () => !(await data()).dateRefreshing && !!(await data()).dateRefreshError,
      'Date freshness failure did not expose a visible recovery state');
    assert.equal(await native('#receipt-date-field input').isDisabled(), true);
    const retry = native('[data-handler="refreshDateRange"]');
    assert.equal(await retry.isVisible(), true);
    assert.ok((await native('#receipt-date-field [role="alert"]').innerText()).includes('填写内容已保留'));
    await assertInputAndTargetPreserved(before, key, savedDraft);
    assert.equal((await trace()).commands.length, 0);
    assert.deepEqual(await ledger(fixture), beforeLedger);
    // Save may offer another freshness attempt, but it cannot mutate using the stale range.
    if (await native('.entry-primary').isEnabled()) {
      await native('.entry-primary').click();
      await waitUntil(async () => !(await data()).dateRefreshing && !!(await data()).dateRefreshError &&
        (await trace()).queries.filter(call => call.error).length >= 2,
      'Saving after a freshness error did not re-check the server date');
    }
    assert.equal((await trace()).commands.length, 0,
      'A failed date freshness check allowed a business save with stale date context');
    await assertInputAndTargetPreserved(before, key, savedDraft);
    assert.deepEqual(await ledger(fixture), beforeLedger);
    await capture('r14-date-freshness-failure-keeps-input-and-retry');

    await page.evaluate(() => { window.__r14ReceiptDate.sessionMode = 'normal'; });
    await retry.click();
    await waitUntil(async () => !(await data()).dateRefreshing &&
      !(await data()).dateRefreshError && (await data()).maxDate === '2026-10-01',
    'The visible retry action did not restore a fresh date range');
    await assertInputAndTargetPreserved(before, key, savedDraft);
    assert.equal(await native('#receipt-date-field input').isDisabled(), false);
    assert.equal((await trace()).commands.length, 0);
    assert.deepEqual(await ledger(fixture), beforeLedger);
    await capture('r14-date-freshness-retry-restores-october-choice');
    await saveOctoberReceipt(fixture, beforeLedger, 1275, key);
    await capture('r14-date-freshness-recovered-save-keeps-september-snapshot');
  });
}



async function runR14LongSheetRegressions() {
  const originalPage = page;
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1,
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
  const title = 'W'.repeat(60);
  try {
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    attachDiagnostics(page);
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.Prototype?.ready);
    await settled();
    await reset();
    await page.evaluate(() => window.Prototype.scenarios.review());
    await waitRoute('review');
    const fixture = await page.evaluate(async title => {
      const api = window.Prototype.api;
      const session = await api.query('session.get', {});
      const { activity } = await api.query('activity.get', { activityId: 'monthly' });
      const { id, revision, status, publishedAt, updatedAt, publishedBy, ...base } = activity;
      const draft = { ...base, title, frequency: 'once', startsOn: session.today, endsOn: session.today,
        target: 1, unit: '次', rewardMinor: 100, scope: 'user', requiresRegistration: false, requiresInvitation: false,
        conditions: 'Browser layout acceptance fixture.', sourceUrl: '', sourceNote: 'Demo source for legal title-length layout acceptance.',
        entrance: { kind: 'guide', label: '参与入口', instructions: 'Bank app > Credit card > Offers.', imageIds: [] } };
      const submission = await api.command('submission.save', { draft });
      const publication = await api.command('submission.review', { id: submission.id, expectedVersion: submission.version,
        decision: 'publish', sourceVerified: true, draft });
      const joined = await api.command('activity.join', { activityId: publication.id });
      const detail = await api.query('activity.get', { participationId: joined.id });
      return { joined, title: detail.participation.snapshot.title, ownerId: detail.participation.ownerId,
        currentUserId: session.userId, published: detail.activity.status };
    }, title);
    assert.equal(fixture.title, title);
    assert.equal(fixture.ownerId, fixture.currentUserId);
    assert.equal(fixture.published, 'published');
    await page.evaluate(() => window.Prototype.scenarios.submit());
    await waitRoute('submission-lead');
    await openPage('pages/todo/index');
    assert.equal((await page.evaluate(() => window.Prototype.api.query('session.get', {}))).isModerator, false);
    await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption,.flow-overview{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{max-width:none!important;min-height:0!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
    const measure = () => page.evaluate(() => {
      const panel = window.Prototype.shadow.querySelector('[data-sheet-dialog="todo-actions"]');
      const header = panel.querySelector('.sheet-head'), label = header.querySelector('[data-wx-tag="text"]');
      const close = header.querySelector('.sheet-close'), body = panel.querySelector('.sheet-body');
      const host = document.getElementById('native-page');
      const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right,
        bottom: r.bottom, width: r.width, height: r.height }; };
      const closeRect = rect(close), point = { x: closeRect.left + closeRect.width / 2, y: closeRect.top + closeRect.height / 2 };
      const hit = window.Prototype.shadow.elementFromPoint(point.x, point.y);
      return { device: rect(document.getElementById('device')), panel: rect(panel), header: rect(header), title: rect(label),
        close: closeRect, point, closeHit: hit === close || close.contains(hit), text: label.textContent,
        accessibleTitle: panel.getAttribute('aria-label'), body: rect(body),
        viewport: { height: host.clientHeight, cssHeight: parseFloat(getComputedStyle(host).getPropertyValue('--prototype-vh')) * 100 },
        background: { windowX: scrollX, windowY: scrollY, hostTop: host.scrollTop, hostLeft: host.scrollLeft },
        horizontal: { panelLeft: panel.scrollLeft, panelWidth: panel.scrollWidth, panelClientWidth: panel.clientWidth,
          headerLeft: header.scrollLeft, headerWidth: header.scrollWidth, headerClientWidth: header.clientWidth },
        bodyScroll: { top: body.scrollTop, height: body.scrollHeight, clientHeight: body.clientHeight } };
    });
    for (const size of [{ width: 320, height: 812 }, { width: 375, height: 812 }, { width: 375, height: 375 }]) {
      await check(`A legal 60-character sheet title keeps its full text and visible close control at ${size.width}x${size.height}`, async () => {
        await resize(size);
        await native(`.more-button[data-id="${fixture.joined.id}"]`).click();
        await waitUntil(async () => (await data()).showActions, 'The real Todo More action did not open its sheet');
        // Hiding the native tab bar changes the host height. Wait for its
        // ResizeObserver and the resulting sheet layout before measuring scroll.
        let initial, previousLayout;
        const layoutSettling = [];
        await waitUntil(async () => {
          const next = await measure();
          layoutSettling.push({ viewport: next.viewport, panel: next.panel, close: next.close, background: next.background });
          const layout = JSON.stringify([next.viewport, next.panel, next.header, next.close, next.body]);
          const ready = Math.abs(next.viewport.height - next.viewport.cssHeight) < 1 && layout === previousLayout;
          previousLayout = layout;
          if (ready) initial = next;
          return ready;
        }, 'The sheet did not settle after its native tab bar was hidden', 3000);
        currentCase.measurements.layoutSettling = layoutSettling;
        assert.equal((await data()).actionTitle, title);
        assert.equal(initial.text, title, 'The long title was truncated or replaced');
        assert.equal(initial.accessibleTitle, title, 'The full accessible sheet title was lost');
        assert.ok(initial.title.right <= initial.close.left + 1, 'The title overlaps its close target');
        assert.ok(initial.title.left >= initial.panel.left && initial.title.bottom <= initial.header.bottom,
          'The wrapped title is clipped by its header');
        assert.ok(initial.close.left >= initial.device.left && initial.close.right <= initial.device.right,
          'The close target is outside the initial visible device');
        assert.ok(initial.close.width >= 48 && initial.close.height >= 48, 'Wrapping reduced the close target size');
        assert.equal(initial.closeHit, true, 'The initial visible close center cannot receive a pointer event');
        assert.equal(initial.horizontal.panelLeft, 0, 'The panel was horizontally scrolled before the close assertion');
        assert.equal(initial.horizontal.headerLeft, 0);
        assert.ok(initial.horizontal.panelWidth <= initial.horizontal.panelClientWidth + 1, 'The title created hidden horizontal panel overflow');
        assert.ok(initial.horizontal.headerWidth <= initial.horizontal.headerClientWidth + 1, 'The title created hidden horizontal header overflow');
        if (size.height === 375) {
          assert.ok(initial.bodyScroll.height > initial.bodyScroll.clientHeight, 'The short viewport fixture did not require body scrolling');
          await page.mouse.move(initial.body.left + initial.body.width / 2, initial.body.top + Math.min(initial.body.height / 2, 60));
          await page.mouse.wheel(0, 700);
          await waitUntil(async () => (await measure()).bodyScroll.top > 0, 'The long header prevented scrolling the sheet body');
          const afterScroll = await measure();
          assert.equal(afterScroll.closeHit, true);
          assert.deepEqual(afterScroll.close, initial.close, 'Scrolling the body moved the close target out of its fixed header');
          assert.deepEqual(afterScroll.header, initial.header, 'Scrolling the body moved the sheet header');
          assert.deepEqual(afterScroll.background, initial.background, 'Scrolling the sheet body also scrolled its background');
          assert.equal(afterScroll.horizontal.panelLeft, 0);
          const last = await native('[data-sheet-dialog="todo-actions"] .sheet-actions > button').last().boundingBox();
          assert.ok(last && last.y >= afterScroll.body.top - 1 && last.y + last.height <= afterScroll.body.bottom + 1,
            'The final sheet action is not reachable in the short viewport');
        }
        await capture(`r14-long-title-visible-close-${size.width}x${size.height}`, { fixture, initial });
        // A raw pointer at the already-visible position avoids locator auto-scroll,
        // which concealed the original overflow by scrolling an overflow:hidden panel.
        const closeReady = await measure();
        assert.equal(closeReady.closeHit, true);
        await page.mouse.click(closeReady.point.x, closeReady.point.y);
        await waitUntil(async () => !(await data()).showActions, 'The visible close target did not dismiss the source sheet');
        assert.equal(await native('[data-sheet-dialog="todo-actions"]').count(), 0);
      });
    }
  } finally {
    page = originalPage;
    await context.close();
  }
}


// Required runner globals: assert, browser, baseUrl, page, native, data, check,
// reset, waitUntil, settled, capture, and attachDiagnostics.
// reset() must use Prototype.resetFixture(). This snippet has no standalone run.
async function runR14CardDraftRegressions() {
  const lookupSelector = 'button[data-handler="resolveRecoveredDraftCreation"]';
  const atRoute = name => page.evaluate(value => window.Prototype.current?.route === `pages/${value}/index`, name);
  const expectRoute = async name => { await waitUntil(() => atRoute(name), `The recovered-card check did not reach ${name}`); await settled(); };
  const seed = () => page.evaluate(() => window.wx.getStorageSync('card-benefits.native.demo.v1'));
  const saved = key => page.evaluate(key => window.wx.getStorageSync(key) || null, key);
  const info = () => page.evaluate(() => {
    const owner = window.Prototype.current, d = owner.data;
    const key = ['card-benefits.form-draft.v1', 'card', d.userId, d.draftEntityId].map(encodeURIComponent).join(':');
    return { key, intentKey: d.intentKey, payload: owner.commandPayload(), draft: window.wx.getStorageSync(key) || null,
      nickname: d.nickname, dirty: d.dirty, draftSaved: d.draftSaved, leaveMessage: owner._leaveMessage,
      pendingCreationSignature: d.pendingCreationSignature, recoveredDraftLookupAvailable: d.recoveredDraftLookupAvailable,
      recoveredDraftLookupNotice: d.recoveredDraftLookupNotice };
  });
  const trace = () => page.evaluate(() => ({ commands: window.__r14RecoveredCardTrace.commands,
    queries: window.__r14RecoveredCardTrace.queries, pendingWriteFailures: window.__r14RecoveredCardTrace.pendingWriteFailures,
    committedLoss: window.__r14RecoveredCardTrace.committedLoss }));
  const installTrace = options => page.evaluate(options => {
    const api = window.Prototype.api;
    const state = window.__r14RecoveredCardTrace = { api, command: api.command, query: api.query,
      setStorageSync: window.wx.setStorageSync, commands: [], queries: [], pendingWriteFailures: [], committedLoss: null, options };
    api.command = async function (...args) {
      const call = { action: args[0], payload: JSON.parse(JSON.stringify(args[1])),
        options: args[2] === undefined ? null : JSON.parse(JSON.stringify(args[2])), argumentCount: args.length };
      state.commands.push(call);
      try { const result = await state.command.apply(this, args); call.result = JSON.parse(JSON.stringify(result)); return result; }
      catch (error) { call.error = { code: error.code, message: error.message }; throw error; }
    };
    api.query = async function (...args) {
      const call = { action: args[0] }; state.queries.push(call);
      try { return await state.query.apply(this, args); }
      catch (error) { call.error = { code: error.code, message: error.message }; throw error; }
    };
    window.wx.setStorageSync = function (...args) {
      if (options.failPending && args[0] === options.key && args[1]?.value?.pendingCreation) {
        state.pendingWriteFailures.push(JSON.parse(JSON.stringify(args[1])));
        // This is a native storage API failure outside the browser adapter's fallback.
        throw new Error('Native draft storage rejected pending creation evidence.');
      }
      const result = state.setStorageSync.apply(this, args);
      if (!options.loseResponse || args[0] !== 'card-benefits.native.demo.v1' || state.committedLoss) return result;
      const nextSeed = args[1]?.seed;
      const card = Object.values(nextSeed?.cards || {}).find(card => card.nickname === options.nickname && card.kind === 'debit');
      const request = card && Object.values(nextSeed?.requests || {}).find(record => {
        try { const value = JSON.parse(record.fingerprint); return record.result?.id === card.id && value.action === 'card.save' && !value.payload.id && value.payload.nickname === options.nickname; }
        catch { return false; }
      });
      if (!request) return result;
      state.committedLoss = { cardId: card.id, requestId: request.requestId };
      throw Object.assign(new Error('验收模拟：卡片已保存，但网络响应丢失，请重试。'), { code: 'NETWORK_ERROR' });
    };
  }, options);
  const freshCase = async (name, action) => {
    const previousPage = page;
    let context;
    let isolatedPage;
    try {
      await check(name, async () => {
        context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
        isolatedPage = await context.newPage(); page = isolatedPage; page.setDefaultTimeout(12000); attachDiagnostics(page);
        await page.goto(baseUrl, { waitUntil: 'load' }); await page.waitForFunction(() => window.Prototype?.ready); await settled(); await reset();
        await action();
      });
    } finally {
      if (isolatedPage && !isolatedPage.isClosed()) await isolatedPage.evaluate(() => {
        const state = window.__r14RecoveredCardTrace;
        if (state) { state.api.command = state.command; state.api.query = state.query; window.wx.setStorageSync = state.setStorageSync; delete window.__r14RecoveredCardTrace; }
      }).catch(() => {});
      page = previousPage; await context?.close();
    }
  };
  const ordinaryDebit = async nickname => {
    await page.locator('#native-tabs button').filter({ hasText: '卡包' }).click(); await expectRoute('wallet');
    await native('.page-heading button[data-handler="addCard"]').click(); await expectRoute('card-edit');
    await native('.kind-button[data-kind="debit"]').click(); await native('#card-nickname').fill(nickname);
    const original = await info();
    assert.equal(original.draftSaved, true); assert.equal(original.draft.value.pendingCreation, undefined);
    assert.equal(original.draft.value.intentKey, original.intentKey);
    return original;
  };
  const leaveCard = async () => {
    await page.locator('#native-back').click(); await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click(); await expectRoute('wallet');
  };
  const recover = async original => {
    await native('.page-heading button[data-handler="addCard"]').click();
    await waitUntil(() => atRoute('card-edit'), 'The original draft recovery did not open');
    await page.locator('#platform-layer button').filter({ hasText: '恢复草稿' }).click(); await settled();
    const recovered = await info();
    assert.equal(recovered.intentKey, original.intentKey); assert.deepEqual(recovered.payload, original.payload);
    assert.equal(recovered.pendingCreationSignature, ''); assert.equal(recovered.recoveredDraftLookupAvailable, true);
    assert.equal(await native(lookupSelector).innerText(), '核对这份草稿是否已保存');
    return recovered;
  };

  await freshCase('Product review unknown debit-card creation locks changes and confirms one original card without bills', async () => {
    const nickname = 'Unknown Debit Creation';
    const original = await ordinaryDebit(nickname);
    const before = (await seed()).seed;
    assert.equal(original.payload.kind, 'debit'); assert.equal(original.payload.billing, undefined);
    await installTrace({ key: original.key, nickname, failPending: false, loseResponse: true });
    await native('.save-button').click();
    await waitUntil(async () => (await trace()).committedLoss && !(await data()).saving,
      'The debit-card fixture did not persist a real card before losing the response');
    const failed = await info(), firstTrace = await trace();
    const first = firstTrace.commands[0];
    const id = firstTrace.committedLoss.cardId;
    assert.equal(firstTrace.commands.length, 1); assert.equal(first.error?.code, 'NETWORK_ERROR');
    assert.equal(first.action, 'card.save'); assert.deepEqual(first.payload, original.payload);
    assert.deepEqual(first.options, { intentKey: original.intentKey });
    assert.equal(failed.draftSaved, true); assert.equal(failed.dirty, true);
    assert.equal((await data()).pendingCreationUnconfirmed, true);
    assert.deepEqual(JSON.parse(failed.pendingCreationSignature), original.payload);
    assert.equal(failed.draft.value.pendingCreation.intentKey, original.intentKey);
    assert.equal(failed.draft.value.pendingCreation.payloadSignature, failed.pendingCreationSignature);
    assert.equal(await native('.save-button').innerText(), '确认上次保存');
    assert.ok(await native('input, select').evaluateAll(elements => elements.length >= 3 && elements.every(element => element.disabled)),
      'An unconfirmed debit creation left an editable identity control');
    assert.ok(await native('.kind-button').evaluateAll(elements => elements.length === 2 && elements.every(element => element.disabled)),
      'An unconfirmed debit creation could switch card kinds');
    await native('#card-nickname').evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    const bounds = await native('#card-nickname').boundingBox();
    assert.equal(await native('#card-nickname').evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.getRootNode().elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
    }), true, 'The nickname pointer must hit the input instead of the fixed save bar');
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.keyboard.type('ChangedPayload');
    const afterTyping = await info();
    assert.equal(afterTyping.nickname, nickname); assert.equal(afterTyping.intentKey, original.intentKey);
    assert.equal(afterTyping.pendingCreationSignature, failed.pendingCreationSignature);
    assert.deepEqual(afterTyping.draft.value, failed.draft.value, 'Typing through a locked control changed the durable pending draft');
    const committed = (await seed()).seed;
    const created = committed.cards[id];
    assert.equal(created.ownerId, (await data()).userId); assert.equal(created.kind, 'debit');
    assert.equal(created.nickname, nickname); assert.equal(created.billingAccountId, undefined);
    assert.equal(Object.keys(committed.cards).length, Object.keys(before.cards).length + 1);
    assert.deepEqual(committed.billing_accounts, before.billing_accounts, 'A debit creation introduced a billing account');
    assert.deepEqual(committed.bills, before.bills, 'A debit creation introduced a bill');
    const creationRequests = Object.values(committed.requests).filter(request => request.result?.id === id);
    assert.equal(creationRequests.length, 1); assert.equal(creationRequests[0].requestId, firstTrace.committedLoss.requestId);
    await capture('product-card-unknown-result-inputs-locked', { id, intentKey: original.intentKey, signature: failed.pendingCreationSignature });
    await leaveCard();
    await native('.page-heading button[data-handler="addCard"]').click();
    await waitUntil(() => atRoute('card-edit'), 'The pending debit recovery editor did not open');
    const modal = page.locator('#platform-layer [role="dialog"]');
    await modal.waitFor({ state: 'visible' });
    assert.ok((await modal.innerText()).includes('放弃草稿不会取消已发出的操作'), 'Pending recovery hides the risk of an already committed request');
    await page.locator('#platform-layer button').filter({ hasText: '恢复核对' }).click(); await settled();
    const recovered = await info();
    assert.equal((await data()).pendingCreationUnconfirmed, true);
    assert.equal(recovered.intentKey, original.intentKey); assert.equal(recovered.pendingCreationSignature, failed.pendingCreationSignature);
    assert.deepEqual(recovered.payload, first.payload); assert.equal(recovered.nickname, nickname);
    assert.equal(await native('#card-nickname').isDisabled(), true);
    await native('.save-button').click(); await expectRoute('wallet');
    const commands = (await trace()).commands;
    assert.equal(commands.length, 2); assert.deepEqual(commands[1].payload, first.payload);
    assert.deepEqual(commands[1].options, { intentKey: original.intentKey }); assert.equal(commands[1].result.id, id);
    assert.deepEqual((await seed()).seed, committed, 'Exact debit confirmation changed cards, bills, requests, or audit records');
    assert.equal((await data()).raw.cards.filter(card => card.id === id).length, 1);
    assert.equal((await data()).cardCount, Object.values(before.cards).filter(card => !card.archivedAt).length + 1);
    assert.equal(await saved(original.key), null, 'Acknowledging the original card left its pending creation draft');
    await capture('product-card-unknown-result-one-original-card', { id, requestId: creationRequests[0].requestId, commands });
  });

  await freshCase('R14 a recovered ordinary card draft finds its committed result and keeps read/write failure fixtures separate', async () => {
    const nickname = 'R14 Recovered Original Card';
    const original = await ordinaryDebit(nickname);
    const beforeBlockedSave = await seed();
    await installTrace({ key: original.key, nickname, failPending: true, loseResponse: true });
    await native('.save-button').click();
    await waitUntil(async () => (await trace()).pendingWriteFailures.length > 0 && !(await data()).saving, 'The pending recovery marker was not rejected by the declared storage fault');
    const failure = await info(), blockedTrace = await trace();
    assert.equal(failure.draftSaved, false); assert.ok(failure.leaveMessage.includes('修改将丢失'));
    assert.deepEqual(failure.draft, original.draft, 'Pending-only storage failure replaced the ordinary draft');
    assert.ok(blockedTrace.pendingWriteFailures.length > 0);
    assert.equal(blockedTrace.commands.length, 0, 'The current client dispatched a creation without durable recovery evidence');
    assert.equal(blockedTrace.committedLoss, null);
    assert.deepEqual(await seed(), beforeBlockedSave, 'A rejected pending-marker write changed cards, bills, requests, or audit records');
    assert.equal(failure.pendingCreationSignature, ''); assert.equal((await data()).pendingCreationUnconfirmed, false);
    assert.equal(await native('#card-nickname').isEnabled(), true);
    await leaveCard();
    // An older client could submit its durable ordinary draft before pending markers were required.
    // Use the saved API function to separate this declared historical fixture from current source dispatches.
    const historical = await page.evaluate(async ({ payload, intentKey }) => {
      const state = window.__r14RecoveredCardTrace;
      try { return { result: await state.command.call(state.api, 'card.save', payload, { intentKey }) }; }
      catch (error) { return { error: { code: error.code, message: error.message } }; }
    }, original);
    assert.equal(historical.error?.code, 'NETWORK_ERROR', 'The historical fixture did not lose its response after a real commit');
    const firstTrace = await trace();
    assert.equal(firstTrace.commands.length, 0, 'The historical fixture was misclassified as a current UI dispatch');
    assert.deepEqual(await saved(original.key), original.draft, 'The historical submission changed the durable ordinary draft');
    const originalId = firstTrace.committedLoss.cardId;
    assert.match(firstTrace.committedLoss.requestId, /^intent_[0-9a-f]{32}$/);
    const recovered = await recover(original);
    const beforeLookup = await seed();
    assert.equal(Object.values(beforeLookup.seed.cards).filter(card => card.nickname === nickname).length, 1);
    await capture('r14-card-ordinary-recovery-offers-result-lookup', { originalId, originalIntent: original.intentKey });

    // This direct read-only control isolates the runtime replayOnly classification:
    // the source action itself first refreshes session, which can consume a read fault.
    await page.locator('#fail-read').click();
    const readControl = await page.evaluate(async ({ payload, intentKey }) => {
      try { return { result: await window.Prototype.api.command('card.save', payload, { intentKey, replayOnly: true }) }; }
      catch (error) { return { error: { code: error.code, message: error.message } }; }
    }, original);
    assert.equal(readControl.error?.code, 'NETWORK_ERROR', 'A replayOnly lookup did not consume the next-read fixture');
    assert.deepEqual(await seed(), beforeLookup); assert.deepEqual(await saved(original.key), recovered.draft);
    await page.locator('#fail-read').click();
    await native(lookupSelector).click(); await settled();
    const failedLookup = await info();
    assert.equal(await atRoute('card-edit'), true); assert.equal(failedLookup.intentKey, original.intentKey);
    assert.deepEqual(failedLookup.payload, original.payload); assert.deepEqual(failedLookup.draft, recovered.draft);
    assert.equal(failedLookup.recoveredDraftLookupAvailable, true);
    assert.ok(failedLookup.recoveredDraftLookupNotice.includes('目前无法核对'));
    assert.deepEqual(await seed(), beforeLookup);
    await native(lookupSelector).scrollIntoViewIfNeeded(); await capture('r14-card-result-read-failure-preserves-draft');

    await page.locator('#fail-save').click();
    await native(lookupSelector).click(); await expectRoute('wallet');
    const resolved = (await trace()).commands.at(-1);
    assert.deepEqual(resolved.payload, original.payload);
    assert.deepEqual(resolved.options, { intentKey: original.intentKey, replayOnly: true });
    assert.equal(resolved.result?.id, originalId, 'The UI lookup did not return the original creation result');
    assert.deepEqual(await seed(), beforeLookup, 'Read-only result confirmation modified the ledger');
    assert.equal(await saved(original.key), null, 'Confirmed original draft was not cleared');
    await native(`.loose-card button[data-id="${originalId}"]`).click(); await expectRoute('card-edit');
    assert.equal((await data()).id, originalId, 'The original card could not be opened from the result destination');
    const editedName = 'R14 Verified Original Card';
    await native('#card-nickname').fill(editedName);
    await native('.save-button').click(); await settled();
    assert.equal(await atRoute('card-edit'), true, 'The write-failure fixture was consumed by read-only lookup');
    const blockedWrite = (await trace()).commands.at(-1);
    assert.equal(blockedWrite.payload.id, originalId); assert.equal(blockedWrite.options, null);
    assert.equal(blockedWrite.error?.code, 'NETWORK_ERROR');
    assert.equal(await native('#card-nickname').inputValue(), editedName);
    assert.equal((await data()).dirty, true); assert.equal((await seed()).seed.cards[originalId].nickname, nickname);
    await capture('r14-card-read-lookup-preserves-next-write-failure', { originalId, blockedWrite });
    await native('.save-button').click(); await expectRoute('wallet');
    assert.equal((await seed()).seed.cards[originalId].nickname, editedName);
    assert.equal(Object.values((await seed()).seed.cards).filter(card => card.id === originalId).length, 1);
    await capture('r14-card-original-record-remains-editable');
  });

  await freshCase('R14 a recovered ordinary draft with no matching request remains editable after result lookup misses', async () => {
    const nickname = 'R14 Unsubmitted Same Name';
    const original = await ordinaryDebit(nickname);
    await leaveCard();
    // A separately created same-name card establishes a legitimate collision while
    // the recovered draft's own original intent has never been dispatched.
    const other = await page.evaluate(async ({ payload, intentKey }) => window.Prototype.api.command('card.save', payload,
      { intentKey: `fixture_other_${intentKey}` }), original);
    const recovered = await recover(original);
    await installTrace({ failPending: false, loseResponse: false });
    const beforeLookup = await seed();
    await native(lookupSelector).click(); await settled();
    assert.equal(await atRoute('card-edit'), true);
    const missing = (await trace()).commands.at(-1);
    assert.deepEqual(missing.payload, original.payload);
    assert.deepEqual(missing.options, { intentKey: original.intentKey, replayOnly: true });
    assert.equal(missing.error?.code, 'REQUEST_UNRESOLVED');
    const unresolved = await info();
    assert.equal(unresolved.intentKey, original.intentKey); assert.deepEqual(unresolved.draft, recovered.draft);
    assert.ok(unresolved.recoveredDraftLookupNotice.includes('暂未查到这份草稿的保存记录'));
    assert.equal(await native('#card-nickname').isEnabled(), true);
    assert.deepEqual(await seed(), beforeLookup, 'An unmatched lookup created or changed domain records');
    assert.equal(Object.values(beforeLookup.seed.cards).filter(card => card.nickname === nickname).length, 1);
    assert.ok(beforeLookup.seed.cards[other.id]);
    await native(lookupSelector).scrollIntoViewIfNeeded(); await capture('r14-card-unmatched-result-preserves-editable-draft');
    await native('#card-nickname').fill('R14 Distinct Editable Draft');
    assert.equal((await data()).recoveredDraftLookupAvailable, false, 'A changed draft retained the original-payload lookup offer');
    assert.equal(await native('.save-button').isEnabled(), true);
    assert.equal((await saved(original.key)).value.nickname, 'R14 Distinct Editable Draft');
    assert.deepEqual(await seed(), beforeLookup, 'Editing the local draft unexpectedly wrote a card');
    assert.equal((await trace()).commands.length, 1);
    await capture('r14-card-unmatched-draft-normal-editing');
  });
}


async function runR15SwitchLabelRegressions() {
  const originalPage = page;
  async function freshCase(name, action) {
    const context = await originalPage.context().browser().newContext({
      viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    try {
      page = await context.newPage();
      page.setDefaultTimeout(10000);
      if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
      await check(name, async () => {
        await page.goto(new URL(originalPage.url()).origin, { waitUntil: 'load' });
        await page.waitForFunction(() => window.Prototype?.ready && window.Prototype.current?.data);
        await settled();
        await page.evaluate(() => { window.__r15SwitchTrace = { handlers: [], events: [], pending: [] }; });
        try { await action(); }
        finally {
          await page.evaluate(() => {
            const state = window.__r15SwitchTrace;
            if (!state) return;
            for (const item of state.handlers) item.owner[item.name] = item.original;
            if (state.api && state.originalCommand) state.api.command = state.originalCommand;
            for (const item of state.pending) item.resolve(item.result);
            delete window.__r15SwitchTrace;
          });
        }
      });
    } finally {
      page = originalPage;
      await context.close();
    }
  }
  async function observeHandler(name) {
    await page.evaluate(name => {
      const owner = window.Prototype.current;
      const original = owner[name];
      const state = window.__r15SwitchTrace;
      state.handlers.push({ owner, name, original });
      owner[name] = function (event) {
        state.events.push({
          handler: name,
          currentTarget: { id: event.currentTarget.id, dataset: { ...event.currentTarget.dataset } },
          target: { id: event.target.id, dataset: { ...event.target.dataset } },
          detail: JSON.parse(JSON.stringify(event.detail)),
        });
        return original.call(this, event);
      };
    }, name);
  }
  async function events() { return page.evaluate(() => window.__r15SwitchTrace.events); }
  async function frames() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function hitBlankArea(hit) {
    await hit.scrollIntoViewIfNeeded();
    const measured = await hit.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const root = element.getRootNode();
      const input = element.querySelector('input');
      const inputBounds = input.getBoundingClientRect();
      const label = element.closest('label');
      const activationTarget = label?.control === input ? label : element;
      const activationBounds = activationTarget.getBoundingClientRect();
      const candidates = [
        { x: bounds.width / 2, y: 2 }, { x: bounds.width / 2, y: bounds.height - 2 },
        { x: 2, y: bounds.height / 2 }, { x: bounds.width - 2, y: bounds.height / 2 },
      ];
      const position = candidates.find(point => root.elementFromPoint(bounds.x + point.x, bounds.y + point.y) === element);
      return {
        width: bounds.width, height: bounds.height, position,
        point: position ? { x: bounds.x + position.x, y: bounds.y + position.y } : null,
        activationTarget: { tag: activationTarget.tagName, width: activationBounds.width, height: activationBounds.height,
          labelAssociation: activationTarget === label },
        input: { x: inputBounds.x - bounds.x, y: inputBounds.y - bounds.y, width: inputBounds.width, height: inputBounds.height },
      };
    });
    // Source CSS may scale the visual switch. Its associated label is the
    // complete pointer target, including the space around that smaller track.
    assert.ok(measured.activationTarget.width >= 48 && measured.activationTarget.height >= 48,
      'The complete switch activation target is smaller than 48 CSS pixels');
    assert.ok(measured.position, 'The expanded switch area does not expose a hittable point outside its input');
    await page.mouse.click(measured.point.x, measured.point.y);
    return measured;
  }
  async function hitLabelBoundary(label) {
    await label.scrollIntoViewIfNeeded();
    const measured = await label.evaluate(element => {
      const input = element.querySelector('input[role="switch"]');
      const wrapper = element.querySelector('.prototype-switch-hit');
      const bounds = element.getBoundingClientRect(), wrapperBounds = wrapper.getBoundingClientRect();
      const root = element.getRootNode();
      const candidates = [{ x: wrapperBounds.left + wrapperBounds.width / 2, y: bounds.top + 1 },
        { x: wrapperBounds.left + wrapperBounds.width / 2, y: bounds.bottom - 1 }];
      const point = candidates.find(point => root.elementFromPoint(point.x, point.y) === element
        && (point.y < wrapperBounds.top || point.y > wrapperBounds.bottom));
      return { width: bounds.width, height: bounds.height, associated: element.control === input, point };
    });
    assert.equal(measured.associated, true);
    assert.ok(measured.width >= 48 && measured.height >= 48);
    assert.ok(measured.point, 'The label does not expose its claimed target area outside the scaled switch');
    await page.mouse.click(measured.point.x, measured.point.y);
    return measured;
  }

  await freshCase('Activities switch label, native input, and expanded hit area each toggle once with the source event identity', async () => {
    await openPage('pages/activities/index');
    await observeHandler('changeMine');
    const mapping = async () => native('.mine-control').evaluate(label => {
      const input = label.querySelector('input[role="switch"]');
      const wrapper = label.querySelector('.prototype-switch-hit');
      return {
        labelFor: label.htmlFor, inputId: input.id, wrapperId: wrapper.id,
        labelControlsInput: label.control === input,
        idCount: label.getRootNode().querySelectorAll('[id="mine-switch"]').length,
        wrapperHandler: wrapper.dataset.handler, inputName: input.getAttribute('aria-label'),
      };
    });
    const expectedMapping = { labelFor: 'mine-switch', inputId: 'mine-switch', wrapperId: '', labelControlsInput: true, idCount: 1, wrapperHandler: 'changeMine', inputName: '只看我的卡' };
    assert.deepEqual(await mapping(), expectedMapping);
    let expected = (await data()).mineOnly;
    const steps = [
      ['label-text', async () => { await native('.mine-control > [data-wx-tag="text"]').click(); }],
      ['input', async () => { await native('.mine-control input#mine-switch').click(); }],
      ['expanded-hit', async () => hitBlankArea(native('.mine-control .prototype-switch-hit'))],
      ['label-boundary', async () => hitLabelBoundary(native('.mine-control'))],
    ];
    for (const [index, [name, click]] of steps.entries()) {
      const geometry = await click();
      expected = !expected;
      await waitUntil(async () => (await data()).mineOnly === expected && !(await data()).loading, `The ${name} activation did not toggle the source filter`);
      await frames();
      const calls = await events();
      assert.equal(calls.length, index + 1, `The ${name} activation invoked the source handler more than once`);
      assert.deepEqual(calls[index], { handler: 'changeMine', currentTarget: { id: 'mine-switch', dataset: {} }, target: { id: 'mine-switch', dataset: {} }, detail: { value: expected } });
      assert.equal(await native('.mine-control input#mine-switch').isChecked(), expected);
      assert.deepEqual(await mapping(), expectedMapping, 'A source rerender broke the switch label association');
      await capture(`r15-switch-${name}-single-change`, { sourceEvent: calls[index], mineOnly: expected, geometry });
    }
  });

  await freshCase('Saving reminder preferences disables label, input, and expanded switch activation without changing the committed settings', async () => {
    await openPage('pages/preferences/index');
    await observeHandler('change');
    const row = () => native('.setting-row').filter({ hasText: '匹配到新活动' });
    const initial = (await data()).newActivities;
    await row().locator('.setting-title').click();
    await waitUntil(async () => (await data()).newActivities === !initial && (await data()).dirty, 'The enabled preference label did not change its source field');
    assert.deepEqual(await events(), [{ handler: 'change', currentTarget: { id: '', dataset: { field: 'newActivities' } }, target: { id: '', dataset: { field: 'newActivities' } }, detail: { value: !initial } }]);
    await page.evaluate(() => {
      const state = window.__r15SwitchTrace;
      const api = window.Prototype.api;
      state.api = api; state.originalCommand = api.command;
      api.command = async function (...args) {
        const result = await state.originalCommand.apply(api, args);
        if (args[0] === 'preferences.save' && !state.held) {
          state.held = true;
          state.committed = await api.query('preferences.get', {});
          return new Promise(resolve => state.pending.push({ result, resolve }));
        }
        return result;
      };
    });
    await native('.primary-button').click();
    await waitUntil(async () => page.evaluate(() => window.__r15SwitchTrace.pending.length === 1 && window.Prototype.current.data.saving), 'The real preference save did not commit before its response was held');
    const savingSnapshot = async () => page.evaluate(() => {
      const owner = window.Prototype.current;
      const state = window.__r15SwitchTrace;
      const controls = [...window.Prototype.shadow.querySelectorAll('.setting-row input[role="switch"]')];
      return {
        values: { newActivities: owner.data.newActivities, deadlines: owner.data.deadlines, rewards: owner.data.rewards, repayments: owner.data.repayments },
        saving: owner.data.saving, dirty: owner.data.dirty, saved: owner.data.saved, leaveMessage: owner._leaveMessage,
        controls: controls.map(input => ({ checked: input.checked, disabled: input.disabled })), events: state.events,
      };
    });
    const held = await savingSnapshot();
    assert.ok(held.controls.every(input => input.disabled));
    const activations = [
      ['label', async () => {
        const text = row().locator('.setting-title');
        await text.scrollIntoViewIfNeeded();
        const bounds = await text.boundingBox();
        assert.ok(bounds);
        await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      }],
      ['input', async () => {
        const input = row().locator('input[role="switch"]');
        await input.scrollIntoViewIfNeeded();
        const bounds = await input.boundingBox();
        assert.ok(bounds);
        // Real pointer delivery leaves the browser's native disabled-control behavior intact.
        await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      }],
      ['expanded-hit', async () => hitBlankArea(row().locator('.prototype-switch-hit'))],
    ];
    for (const [name, click] of activations) {
      await click();
      await frames();
      assert.deepEqual(await savingSnapshot(), held, `The disabled ${name} activation changed the source settings or invoked its handler`);
    }
    await capture('r15-disabled-preference-switch-surfaces', held);
    await page.evaluate(() => { for (const item of window.__r15SwitchTrace.pending) item.resolve(item.result); });
    await waitUntil(async () => !(await data()).saving && (await data()).saved, 'The held preference save did not finish normally');
    const committed = await page.evaluate(() => window.Prototype.api.query('preferences.get', {}));
    for (const [field, value] of Object.entries(held.values)) assert.equal(committed[field], value, `Disabled input changed persisted ${field}`);
    assert.equal((await events()).length, 1);
    assert.equal(await row().locator('input[role="switch"]').isDisabled(), false);
    await capture('r15-preference-save-restores-enabled-switch', { committed, sourceEvents: await events() });
  });

  await freshCase('Existing checkbox labels still toggle once and preserve checkbox-group values', async () => {
    await openPage('pages/submission-edit/index');
    await observeHandler('selectNetworks');
    assert.deepEqual((await data()).draft.networks, []);
    const label = () => native('.network-options label.check-option').filter({ hasText: /^Visa$/ });
    assert.equal(await label().evaluate(element => element.control === element.querySelector('input[type="checkbox"]')), true);
    await label().locator('[data-wx-tag="text"]').click();
    await waitUntil(async () => (await data()).draft.networks.includes('visa'), 'The existing Visa checkbox label stopped selecting its source value');
    await frames();
    assert.equal(await label().locator('input[type="checkbox"]').isChecked(), true);
    assert.deepEqual(await events(), [{ handler: 'selectNetworks', currentTarget: { id: '', dataset: {} }, target: { id: '', dataset: {} }, detail: { value: ['visa'] } }]);
    await label().locator('input[type="checkbox"]').click();
    await waitUntil(async () => (await data()).draft.networks.length === 0, 'The checkbox input did not clear its selected group value');
    await frames();
    const calls = await events();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], { handler: 'selectNetworks', currentTarget: { id: '', dataset: {} }, target: { id: '', dataset: {} }, detail: { value: [] } });
    assert.equal(await label().locator('input[type="checkbox"]').isChecked(), false);
    await capture('r15-checkbox-label-group-control', { sourceEvents: calls });
  });
}


async function runR15ReceiptMidnightRegressions() {
  const originalPage = page;
  const expectRoute = async name => {
    await waitUntil(async () => page.evaluate(name =>
      Prototype.current?.route === 'pages/' + name + '/index', name),
    'Receipt midnight regression did not reach ' + name);
  };
  const ledger = async fixture => page.evaluate(({ activityId, participationId }) => {
    const seed = wx.getStorageSync('card-benefits.native.demo.v1').seed;
    return {
      records: Object.values(seed.participations || {}).filter(record => record.activityId === activityId),
      rewards: Object.values(seed.rewards || {}).filter(reward => reward.participationId === participationId),
      requests: Object.values(seed.requests || {}).filter(request => request.result?.id === participationId),
      audit: Object.values(seed.audit_events || {}).filter(event => event.entityId === participationId),
    };
  }, fixture);
  const setupKnownParticipation = async () => {
    await page.evaluate(() => Prototype.scenarios.review()); await settled();
    const fixture = await page.evaluate(async () => {
      const detail = await Prototype.api.query('activity.get', { activityId: 'monthly' });
      const { id, revision, status, publishedAt, updatedAt, publishedBy, ...draft } = detail.activity;
      draft.title = '首次加载跨午夜日期验收活动';
      draft.startsOn = '2026-01-01'; draft.endsOn = '2026-12-31';
      draft.frequency = 'monthly'; draft.scope = 'user'; draft.target = 1;
      draft.requiresRegistration = false; draft.requiresInvitation = false;
      draft.rewardMinor = 1000; draft.rewardKind = 'cashback';
      draft.sourceNote = '仅用于演示模式首次读取跨午夜的日期验收。';
      const submission = await Prototype.api.command('submission.save', { draft });
      const published = await Prototype.api.command('submission.review', {
        id: submission.id, expectedVersion: submission.version, decision: 'publish', sourceVerified: true, draft,
      });
      const joined = await Prototype.api.command('activity.join', { activityId: published.id });
      const completed = await Prototype.api.command('participation.complete', { participationId: joined.id });
      return { activityId: published.id, participationId: completed.id, version: completed.version };
    });
    await page.evaluate(() => Prototype.openPage('pages/mine/index')); await settled();
    return fixture;
  };
  const installInitialReadRace = async (fixture, failRefresh) => {
    await page.evaluate(({ fixture, failRefresh }) => {
      const api = Prototype.api;
      const state = window.__r15Receipt = {
        api, query: api.query, command: api.command, setTimeout: window.setTimeout,
        queries: [], commands: [], timers: [], sequence: 0, sessionCalls: 0,
        activityHeld: false, releaseActivity: null, failRefresh,
      };
      const lifecycle = () => {
        const host = Prototype.current;
        return { route: host?.route, hasShown: host?.hasShown, visible: host?.visible, hidden: host?.hidden,
          loading: host?.data.loading, serverToday: host?.data.serverToday };
      };
      api.query = async function (...args) {
        const call = { sequence: ++state.sequence, action: args[0], payload: args[1],
          requestedAt: new Date().toISOString(), lifecycle: lifecycle() };
        state.queries.push(call);
        if (args[0] === 'session.get') {
          state.sessionCalls++;
          if (state.sessionCalls > 1 && state.failRefresh) {
            call.error = { code: 'NETWORK_ERROR', message: '日期服务暂时不可用' };
            throw Object.assign(new Error('日期服务暂时不可用'), { code: 'NETWORK_ERROR' });
          }
        }
        const result = await state.query.apply(this, args);
        call.resolvedAt = new Date().toISOString();
        call.summary = args[0] === 'session.get' ? { today: result.today, month: result.month }
          : args[0] === 'activity.get' ? { participationId: result.participation?.id, periodKey: result.participation?.periodKey } : null;
        if (args[0] === 'activity.get' && args[1].participationId === fixture.participationId && !state.activityHeld) {
          state.activityHeld = true;
          call.heldLifecycle = lifecycle();
          await new Promise(resolve => { state.releaseActivity = resolve; });
          call.releasedAt = new Date().toISOString();
          call.releasedLifecycle = lifecycle();
        }
        return result;
      };
      api.command = function (...args) {
        const call = { action: args[0], payload: JSON.parse(JSON.stringify(args[1])),
          options: args[2] === undefined ? null : JSON.parse(JSON.stringify(args[2])) };
        state.commands.push(call);
        const pending = state.command.apply(this, args);
        pending.then(result => { call.result = result; },
          error => { call.error = { code: error.code, message: error.message }; });
        return pending;
      };
      window.setTimeout = function (callback, delay, ...args) {
        const id = state.setTimeout.call(window, callback, delay, ...args);
        if (Number(delay) >= 1000) state.timers.push({
          sequence: ++state.sequence, id, delay: Number(delay),
          scheduledAt: new Date().toISOString(), dueAt: new Date(Date.now() + Number(delay)).toISOString(),
        });
        return id;
      };
    }, { fixture, failRefresh });
  };
  const trace = async () => page.evaluate(() => ({
    queries: window.__r15Receipt.queries, commands: window.__r15Receipt.commands,
    timers: window.__r15Receipt.timers, sessionCalls: window.__r15Receipt.sessionCalls,
  }));
  const restoreTrace = async () => page.evaluate(() => {
    const state = window.__r15Receipt;
    if (!state) return;
    state.releaseActivity?.();
    state.api.query = state.query;
    state.api.command = state.command;
    window.setTimeout = state.setTimeout;
    delete window.__r15Receipt;
  });
  const runInitialReadAcrossMidnight = async (fixture, failRefresh = false) => {
    await installInitialReadRace(fixture, failRefresh);
    await page.evaluate(id => Prototype.openPage('pages/receipt/index?id=' + encodeURIComponent(id)), fixture.participationId);
    await waitUntil(async () => page.evaluate(() =>
      !!window.__r15Receipt.releaseActivity && window.__r15Receipt.activityHeld),
    'The initial real activity result was not held after the September session');
    const held = await page.evaluate(() => ({
      browserNow: new Date().toISOString(), serverToday: Prototype.current.data.serverToday,
      loading: Prototype.current.data.loading, hasShown: Prototype.current.hasShown,
      visible: Prototype.current.visible, hidden: Prototype.current.hidden,
    }));
    assert.equal(held.browserNow, '2026-09-30T15:59:59.000Z');
    assert.equal(held.serverToday, '2026-09-30');
    assert.equal(held.loading, true);
    assert.equal(held.hasShown, true);
    assert.equal(held.visible, true);
    assert.equal(held.hidden, false);
    assert.equal((await trace()).sessionCalls, 1);
    // Advance only the browser clock and release the original result; never call onShow, onHide, or Save here.
    await page.evaluate(() => {
      window.__r15MidnightClock.now = window.__r15MidnightClock.NativeDate.parse('2026-09-30T16:00:01.000Z');
      window.__r15Receipt.releaseActivity();
    });
    return held;
  };
  const pickerState = async () => native('#receipt-date-field input').evaluate(input => ({
    value: input.value, min: input.min, max: input.max, disabled: input.disabled,
    valid: input.validity.valid, rangeOverflow: input.validity.rangeOverflow,
    projectedEnd: input.closest('[data-wx-tag="picker"]')?.getAttribute('end'),
  }));
  const assertKnownContext = async (fixture, beforeLedger) => {
    const value = await data();
    assert.equal(value.participation.id, fixture.participationId);
    assert.deepEqual(value.participation, beforeLedger.records[0]);
    assert.equal(value.receiptTarget.participationId, fixture.participationId);
    assert.equal(value.receiptTarget.periodKey, '2026-09');
    assert.equal(value.currentTarget.periodKey, '2026-09');
    assert.equal(value.minDate, '2026-09-01');
    assert.equal(value.pendingCreation, null);
    assert.equal(await native('#amount').inputValue(), '10.00');
    assert.equal(await native('#receipt-date-field input').inputValue(), '2026-09-30');
    assert.deepEqual(await ledger(fixture), beforeLedger);
    assert.equal((await trace()).commands.length, 0);
  };
  const saveLegalOctoberDate = async (fixture, beforeLedger, amount) => {
    await native('#amount').fill(amount);
    await native('#receipt-date-field input').fill('2026-10-01');
    const picker = await pickerState();
    assert.equal(picker.max, '2026-10-01');
    assert.equal(picker.projectedEnd, '2026-10-01');
    assert.equal(picker.valid, true);
    assert.equal(picker.rangeOverflow, false);
    await native('.entry-primary').click();
    await expectRoute('mine'); await settled();
    const calls = (await trace()).commands;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'reward.confirm');
    assert.equal(calls[0].payload.participationId, fixture.participationId);
    assert.equal(calls[0].payload.expectedVersion, fixture.version);
    assert.equal(calls[0].payload.receivedOn, '2026-10-01');
    assert.equal(calls[0].payload.expectNew, undefined);
    const after = await ledger(fixture);
    assert.equal(after.records.length, 1);
    assert.equal(after.records[0].id, fixture.participationId);
    assert.equal(after.records[0].periodKey, '2026-09');
    assert.equal(after.records[0].receivedOn, '2026-10-01');
    assert.equal(after.records[0].receivedMinor, Math.round(Number(amount) * 100));
    assert.deepEqual(after.records[0].snapshot, beforeLedger.records[0].snapshot);
    assert.equal(after.rewards.length, 1);
    assert.equal(after.rewards[0].activityPeriod, '2026-09');
    assert.equal(after.rewards[0].receivedOn, '2026-10-01');
  };
  const isolatedCheck = async (name, action) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    try {
      await context.addInitScript(() => {
        const NativeDate = window.Date;
        window.__r15MidnightClock = { NativeDate, now: NativeDate.parse('2026-09-30T15:59:59.000Z') };
        window.Date = new Proxy(NativeDate, {
          construct(target, args) { return Reflect.construct(target, args.length ? args : [window.__r15MidnightClock.now]); },
          apply() { return new NativeDate(window.__r15MidnightClock.now).toString(); },
          get(target, key, receiver) {
            return key === 'now' ? () => window.__r15MidnightClock.now : Reflect.get(target, key, receiver);
          },
        });
      });
      page = await context.newPage(); page.setDefaultTimeout(10000);
      const exceptions = [];
      page.on('pageerror', error => exceptions.push(error.message));
      if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
      await check(name, async () => {
        await page.goto(baseUrl, { waitUntil: 'load' });
        await page.waitForFunction(() => Prototype.ready && Prototype.current?.data); await settled();
        await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{width:375px!important;height:812px!important;min-height:812px!important;max-height:812px!important;max-width:none!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
        await action();
        assert.deepEqual(exceptions, [], 'The initial-load midnight regression raised a browser exception');
      });
    } finally {
      try { await restoreTrace(); } catch {}
      try { await context.close(); } finally { page = originalPage; }
    }
  };

  await isolatedCheck('Initial receipt loading across China midnight refreshes the picker before any extra lifecycle or save action', async () => {
    const fixture = await setupKnownParticipation();
    const beforeLedger = await ledger(fixture);
    const held = await runInitialReadAcrossMidnight(fixture);
    await waitUntil(async () => {
      const value = await data();
      return !value.loading && !value.dateRefreshing && value.serverToday === '2026-10-01' && value.maxDate === '2026-10-01';
    }, 'Initial loading finished across midnight without refreshing the picker date range');
    await assertKnownContext(fixture, beforeLedger);
    const picker = await pickerState();
    assert.equal(picker.min, '2026-09-01');
    assert.equal(picker.max, '2026-10-01');
    assert.equal(picker.projectedEnd, '2026-10-01');
    assert.equal(picker.disabled, false);
    assert.equal((await data()).dateRefreshError, '');
    const logged = await trace();
    const sessions = logged.queries.filter(query => query.action === 'session.get');
    assert.equal(sessions[0].summary.today, '2026-09-30');
    assert.ok(sessions.slice(1).some(query => query.summary?.today === '2026-10-01'),
      'The initial read did not request a new server date after midnight');
    assert.equal(logged.queries.filter(query => query.action === 'activity.get').length, 1,
      'Date freshness correction unnecessarily reloaded the activity record');
    assert.equal(logged.commands.length, 0);
    const lifecycle = await page.evaluate(() => ({
      hasShown: Prototype.current.hasShown, visible: Prototype.current.visible, hidden: Prototype.current.hidden,
    }));
    assert.deepEqual(lifecycle, { hasShown: true, visible: true, hidden: false });
    await capture('r15-initial-midnight-load-refreshes-picker-automatically', {
      initialLifecycle: held, queries: logged.queries, timers: logged.timers,
    });
    await saveLegalOctoberDate(fixture, beforeLedger, '12.50');
    await page.evaluate(id => Prototype.openPage('pages/receipt/index?id=' + encodeURIComponent(id)), fixture.participationId);
    await settled();
    await waitUntil(async () => !(await data()).dateRefreshing, 'The saved known receipt did not settle');
    await capture('r15-initial-midnight-legal-october-date-saved-to-september');
  });

  await isolatedCheck('A failed automatic midnight date check blocks the stale picker and recovers through the visible retry', async () => {
    const fixture = await setupKnownParticipation();
    const beforeLedger = await ledger(fixture);
    await runInitialReadAcrossMidnight(fixture, true);
    await waitUntil(async () => {
      const value = await data();
      return !value.loading && !value.dateRefreshing && !!value.dateRefreshError;
    }, 'The automatic post-midnight date failure was not surfaced');
    await assertKnownContext(fixture, beforeLedger);
    const failedPicker = await pickerState();
    assert.equal(failedPicker.disabled, true,
      'A failed midnight check silently left its stale picker usable');
    const retry = native('[data-handler="refreshDateRange"]');
    assert.equal(await retry.isVisible(), true);
    assert.ok((await native('#receipt-date-field [role="alert"]').innerText()).includes('填写内容已保留'));
    const failedQueries = (await trace()).queries;
    assert.equal(failedQueries.filter(query => query.action === 'activity.get').length, 1);
    assert.ok(failedQueries.some(query => query.action === 'session.get' && query.error));
    await capture('r15-initial-midnight-date-failure-shows-retry', { queries: failedQueries });
    await page.evaluate(() => { window.__r15Receipt.failRefresh = false; });
    await retry.click();
    await waitUntil(async () => {
      const value = await data();
      return !value.dateRefreshing && !value.dateRefreshError && value.maxDate === '2026-10-01';
    }, 'The visible retry did not obtain the new server date');
    await assertKnownContext(fixture, beforeLedger);
    const refreshedPicker = await pickerState();
    assert.equal(refreshedPicker.max, '2026-10-01');
    assert.equal(refreshedPicker.projectedEnd, '2026-10-01');
    assert.equal(refreshedPicker.disabled, false);
    await capture('r15-initial-midnight-date-retry-keeps-record-and-values');
    await saveLegalOctoberDate(fixture, beforeLedger, '12.75');
  });
}



async function runR16DetailWarningRegressions() {
  const originalPage = page;
  async function freshCase(name, action) {
    const context = await originalPage.context().browser().newContext({
      viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    try {
      page = await context.newPage();
      page.setDefaultTimeout(10000);
      if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
      await check(name, async () => {
        await page.goto(new URL(originalPage.url()).origin, { waitUntil: 'load' });
        await page.waitForFunction(() => window.Prototype?.ready && window.Prototype.current?.data);
        await settled();
        try { await action(); }
        finally {
          await page.evaluate(() => {
            const state = window.__r16WarningGuard;
            if (!state) return;
            state.api.query = state.originalQuery;
            wx.enableAlertBeforeUnload = state.originalEnable;
            wx.disableAlertBeforeUnload = state.originalDisable;
            wx.showToast = state.originalToast;
            state.observer?.disconnect();
            state.pending?.resolve(state.pending.result);
          });
        }
      });
    } finally {
      page = originalPage;
      await context.close();
    }
  }
  async function atRoute(name) {
    await waitUntil(async () => page.evaluate(name => window.Prototype.current.route === `pages/${name}/index`, name), `The source UI did not reach ${name}`);
  }
  async function currentSnapshot() {
    return page.evaluate(() => {
      const owner = window.Prototype.current;
      return {
        instance: owner._instanceId, route: owner.route, visible: owner.visible, disposed: owner.disposed,
        hash: location.hash, stack: getCurrentPages().map(item => ({ route: item.route, instance: item._instanceId })),
        dirty: owner.data.dirty, saved: owner.data.saved, leaveMessage: owner._leaveMessage,
        serializedDraft: JSON.stringify({ newActivities: owner.data.newActivities, deadlines: owner.data.deadlines, rewards: owner.data.rewards, repayments: owner.data.repayments }),
        serializedData: JSON.stringify(owner.data),
        controls: [...window.Prototype.shadow.querySelectorAll('.setting-row input[role="switch"]')].map(input => ({ checked: input.checked, disabled: input.disabled, label: input.getAttribute('aria-label') })),
        feedback: document.getElementById('scenario-feedback').textContent,
      };
    });
  }
  async function trace() {
    return page.evaluate(() => {
      const state = window.__r16WarningGuard;
      const owner = state.owner;
      return {
        owner: { instance: owner._instanceId, route: owner.route, disposed: owner.disposed, visible: owner.visible,
          loadSequence: owner.loadSequence, visibilitySequence: owner.visibilitySequence,
          refreshing: owner.data.refreshing, outdated: owner.data.outdated, refreshError: owner.data.refreshError,
          showExpected: owner.data.showExpected, expectedDirty: owner.data.expectedDirty,
          expectedOn: owner.data.expectedOn, expectedBase: owner.data.expectedBase, leaveMessage: owner._leaveMessage },
        queries: state.queries, alerts: state.alerts, toasts: state.toasts, dialogs: state.dialogs,
      };
    });
  }
  async function prepare() {
    assert.equal(await page.evaluate(() => window.Prototype.current.route), 'pages/todo/index');
    await native('.tab[data-filter="all"]').click();
    await settled();
    const participationId = (await data()).raw.tasks.find(item => item.activityId === 'quarterly' && item.stage === 'completed')?.id;
    assert.ok(participationId, 'The real Todo fixture does not contain its completed quarterly participation');
    await native(`.task-open[data-id="${participationId}"]`).click();
    await atRoute('detail'); await settled();
    await native('.date-setting[data-handler="openExpected"]').click();
    await waitUntil(async () => (await data()).showExpected, 'The clean expected-date sheet did not open');
    const initial = await page.evaluate(() => ({
      instance: window.Prototype.current._instanceId,
      activityId: window.Prototype.current.data.detail.activity.id,
      stage: window.Prototype.current.data.detail.participation.stage,
      showExpected: window.Prototype.current.data.showExpected,
      expectedDirty: window.Prototype.current.data.expectedDirty,
      expectedOn: window.Prototype.current.data.expectedOn,
      expectedBase: window.Prototype.current.data.expectedBase,
      leaveMessage: window.Prototype.current._leaveMessage,
    }));
    assert.equal(initial.activityId, 'quarterly'); assert.equal(initial.stage, 'completed');
    assert.equal(initial.expectedDirty, false); assert.equal(initial.leaveMessage, '');
    await page.locator('.atlas-link[data-route="pages/history/index"]').click();
    await atRoute('history'); await settled();
    await page.evaluate(instance => {
      const api = window.Prototype.api;
      const state = window.__r16WarningGuard = {
        api, originalQuery: api.query, originalEnable: wx.enableAlertBeforeUnload,
        originalDisable: wx.disableAlertBeforeUnload, originalToast: wx.showToast,
        owner: getCurrentPages().find(item => item._instanceId === instance),
        held: false, returned: false, released: false, queries: [], alerts: [], toasts: [], dialogs: [],
      };
      api.query = async function (...args) {
        const call = { action: args[0], payload: args[1], currentInstance: window.Prototype.current._instanceId };
        state.queries.push(call);
        const result = await state.originalQuery.apply(api, args);
        if (args[0] === 'activity.get' && window.Prototype.current === state.owner && !state.held) {
          state.held = true;
          call.realResult = { activityId: result.activity.id, participationId: result.participation?.id, expectedOn: result.participation?.expectedOn };
          try { return await new Promise((resolve, reject) => { state.pending = { result, resolve, reject }; }); }
          finally { state.returned = true; }
        }
        return result;
      };
      for (const [name, original] of [['enableAlertBeforeUnload', state.originalEnable], ['disableAlertBeforeUnload', state.originalDisable]]) {
        wx[name] = function (...args) {
          const owner = window.Prototype.current;
          const call = { method: name, released: state.released, currentInstance: owner._instanceId, before: owner._leaveMessage, message: args[0]?.message };
          state.alerts.push(call);
          const result = original.apply(wx, args); call.after = owner._leaveMessage; return result;
        };
      }
      wx.showToast = function (options) {
        state.toasts.push({ title: options.title, currentInstance: window.Prototype.current._instanceId, released: state.released });
        return state.originalToast.call(wx, options);
      };
      const known = new WeakSet();
      state.observer = new MutationObserver(records => {
        for (const record of records) for (const added of record.addedNodes) {
          if (!(added instanceof Element)) continue;
          const panels = added.matches('.platform-dialog') ? [added] : [...added.querySelectorAll('.platform-dialog')];
          for (const panel of panels) if (!known.has(panel)) { known.add(panel); state.dialogs.push({ title: panel.getAttribute('aria-label'), released: state.released }); }
        }
      });
      state.observer.observe(document.getElementById('platform-layer'), { childList: true, subtree: true });
    }, initial.instance);
    await page.locator('#native-back').click();
    await atRoute('detail');
    await waitUntil(async () => page.evaluate(() => window.__r16WarningGuard.held), 'Native Back did not hold the retained Detail onShow read');
    const held = await trace();
    assert.equal(held.owner.instance, initial.instance);
    assert.equal(held.owner.visible, true); assert.equal(held.owner.refreshing, true);
    assert.equal(held.owner.showExpected, true); assert.equal(held.owner.expectedDirty, false);
    await page.locator('.atlas-link[data-route="pages/preferences/index"]').click();
    await atRoute('preferences'); await settled();
    const originalPreference = (await data()).newActivities;
    await native('.setting-row input[role="switch"]').first().click();
    await waitUntil(async () => (await data()).dirty && (await data()).newActivities === !originalPreference, 'The new preferences page did not become dirty through its real switch');
    const dirty = await currentSnapshot();
    assert.equal(dirty.visible, true); assert.equal(dirty.dirty, true); assert.ok(dirty.leaveMessage);
    const hidden = await trace();
    assert.equal(hidden.owner.instance, initial.instance); assert.equal(hidden.owner.visible, false); assert.equal(hidden.owner.disposed, false);
    return { initial, originalPreference, dirty };
  }
  async function cancelRealBack(expected, captureName) {
    const count = (await trace()).dialogs.length;
    await page.locator('#native-back').click();
    await page.locator('#platform-layer [role="dialog"][aria-label="离开当前页面？"]').waitFor({ state: 'visible' });
    assert.equal((await trace()).dialogs.length, count + 1, 'The dirty preferences page did not receive exactly one real departure confirmation');
    assert.equal((await currentSnapshot()).instance, expected.instance);
    await capture(captureName, { current: await currentSnapshot(), lifecycle: (await trace()).owner });
    await page.locator('#platform-layer button').filter({ hasText: /^继续填写$/ }).click();
    await settled();
    assert.deepEqual(await currentSnapshot(), expected, 'Cancelling departure did not retain the dirty preferences values and warning');
    assert.equal((await trace()).dialogs.length, count + 1, 'Cancelling departure opened an extra confirmation');
  }
  async function releaseRead(errorMessage) {
    await page.evaluate(({ errorMessage }) => {
      const state = window.__r16WarningGuard;
      state.released = true;
      if (errorMessage) { const error = new Error(errorMessage); error.code = 'NETWORK_ERROR'; state.pending.reject(error); }
      else state.pending.resolve(state.pending.result);
    }, { errorMessage });
    await waitUntil(async () => page.evaluate(() => window.__r16WarningGuard.returned && !window.__r16WarningGuard.owner.data.refreshing), 'The old Detail read did not finish its own lifecycle');
    await settled();
  }
  async function assertDestinationRetained(prepared, baseline) {
    assert.deepEqual(await currentSnapshot(), prepared.dirty, 'The old Detail read changed the newer preferences page, draft, warning, URL, or feedback');
    const after = await trace();
    assert.equal(after.owner.visible, false); assert.equal(after.owner.disposed, false);
    assert.equal(after.owner.instance, prepared.initial.instance);
    assert.deepEqual(after.alerts, baseline.alerts, 'The hidden Detail wrote a global leave warning owned by the newer page');
    assert.deepEqual(after.toasts, baseline.toasts, 'The hidden Detail surfaced a toast on the newer page');
    assert.deepEqual(after.dialogs, baseline.dialogs, 'The old Detail read opened a dialog on the newer page');
    assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0);
    const persisted = await page.evaluate(() => window.Prototype.api.query('preferences.get', {}));
    assert.equal(persisted.newActivities, prepared.originalPreference, 'The unsaved preferences change unexpectedly persisted');
    return after;
  }

  await freshCase('A hidden retained Detail success cannot clear the newer dirty preferences departure warning', async () => {
    const prepared = await prepare();
    await cancelRealBack(prepared.dirty, 'r16-preferences-warning-before-old-detail-success');
    const baseline = await trace();
    await releaseRead();
    const after = await assertDestinationRetained(prepared, baseline);
    assert.equal(after.owner.expectedOn, prepared.initial.expectedOn);
    assert.equal(after.owner.expectedDirty, false);
    await cancelRealBack(prepared.dirty, 'r16-preferences-warning-after-old-detail-success');
  });

  await freshCase('A hidden Detail failure stays private and foreground return restores and refreshes its expected-date sheet', async () => {
    const prepared = await prepare();
    const baseline = await trace();
    await releaseRead('旧详情读取失败，请重试。');
    const after = await assertDestinationRetained(prepared, baseline);
    assert.equal(after.owner.outdated, true); assert.ok(after.owner.refreshError);
    await cancelRealBack(prepared.dirty, 'r16-preferences-warning-after-old-detail-failure');
    await page.locator('#native-back').click();
    await page.locator('#platform-layer [role="dialog"][aria-label="离开当前页面？"]').waitFor({ state: 'visible' });
    await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click();
    await atRoute('detail'); await settled();
    const restored = await trace();
    assert.equal(restored.owner.instance, prepared.initial.instance);
    assert.equal(restored.owner.visible, true); assert.equal(restored.owner.showExpected, true);
    assert.equal(restored.owner.expectedOn, prepared.initial.expectedOn); assert.equal(restored.owner.expectedBase, prepared.initial.expectedBase);
    assert.equal(restored.owner.expectedDirty, false); assert.equal(restored.owner.leaveMessage, '');
    assert.equal(restored.owner.outdated, false); assert.equal(restored.owner.refreshError, '');
    const readCount = restored.queries.filter(item => item.action === 'activity.get' && item.currentInstance === prepared.initial.instance).length;
    await page.locator('#refresh-page').click();
    await waitUntil(async () => {
      const state = await trace();
      return !state.owner.refreshing && state.queries.filter(item => item.action === 'activity.get' && item.currentInstance === prepared.initial.instance).length > readCount;
    }, 'The real foreground refresh did not read Detail again');
    await settled();
    const refreshed = await trace();
    assert.equal(refreshed.owner.instance, prepared.initial.instance); assert.equal(refreshed.owner.visible, true);
    assert.equal(refreshed.owner.showExpected, true); assert.equal(refreshed.owner.expectedOn, prepared.initial.expectedOn);
    assert.equal(refreshed.owner.expectedDirty, false); assert.equal(refreshed.owner.leaveMessage, '');
    assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0);
    await capture('r16-detail-foreground-return-and-refresh-retain-clean-sheet', { lifecycle: refreshed.owner, activityReadCount: refreshed.queries.filter(item => item.action === 'activity.get').length });
  });
}


// Required runner globals: assert, browser, baseUrl, page, native, data, check,
// reset, waitUntil, settled, capture, attachDiagnostics, and currentCase.
// reset() must call Prototype.resetFixture(). Run only against the frozen R16 build.
async function runR16ImeRegressions() {
  const calibrated = new Map();
  const fixtures = [
    { name: 'plain input', control: true, tag: 'input', selector: '#ime-control' },
    { name: 'plain textarea', control: true, tag: 'textarea', selector: '#ime-control' },
    { name: 'lead title', tag: 'input', selector: '#title', field: 'lead.title', scope: 'submission-lead', route: 'submission-lead' },
    { name: 'full conditions', tag: 'textarea', selector: '#conditions', field: 'draft.conditions', scope: 'submission', route: 'submission-edit' },
  ];
  for (const fixture of fixtures) {
    const previousPage = page;
    let context;
    let isolatedPage;
    let cdp;
    try {
      await check(`R16 browser CDP composition commits, cancels, and continues correctly in ${fixture.name}`, async () => {
        context = await browser.newContext({ viewport: { width: 1180, height: 1100 }, deviceScaleFactor: 1,
          locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
        isolatedPage = await context.newPage(); page = isolatedPage;
        page.setDefaultTimeout(12000); attachDiagnostics(page);
        cdp = await context.newCDPSession(page);
        const atRoute = name => page.evaluate(value => window.Prototype.current?.route === `pages/${value}/index`, name);
        const expectRoute = async name => { await waitUntil(() => atRoute(name), `IME navigation did not reach ${name}`); await settled(); };
        const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const evidence = { kind: 'Chromium CDP composition, not OS or native WeChat IME', fixture, steps: [], events: [], navigation: [] };
        currentCase.measurements.ime = evidence;
        if (fixture.control) {
          await page.setContent(`<html><meta charset="utf-8"><body><label>Browser CDP calibration<${fixture.tag} id="ime-control" style="display:block;width:600px;height:120px;font-size:24px"></${fixture.tag}></label></body></html>`);
          await page.locator(fixture.selector).click();
        } else {
          assert.equal(calibrated.get(fixture.tag), true, 'The same browser input type did not pass CDP commit/cancel calibration');
          await page.goto(baseUrl, { waitUntil: 'load' });
          await page.waitForFunction(() => window.Prototype?.ready); await settled(); await reset();
          await page.locator('#native-tabs button').filter({ hasText: '我的' }).click(); await expectRoute('mine');
          await native('.menu-row[data-handler="openSubmission"]').click(); await expectRoute('submission-lead');
          if (fixture.route === 'submission-edit') {
            await native('.full-form-link').click();
            await waitUntil(async () => await atRoute('submission-edit') || await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).count() > 0,
              'The full-form entry did not navigate or request confirmation');
            if (await atRoute('submission-lead')) await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click();
            await expectRoute('submission-edit');
          }
          await native(fixture.selector).click();
        }
        await page.evaluate(({ selector, control, field }) => {
          const root = control ? document : window.Prototype.shadow;
          const original = root.querySelector(selector);
          let sequence = 0;
          const identities = new WeakMap();
          const identity = node => { if (!node) return null; if (!identities.has(node)) identities.set(node, ++sequence); return identities.get(node); };
          const state = window.__r16ImeAcceptance = { root, original, selector, field, control, phase: 'initial', phaseNode: original, events: [], listeners: [] };
          state.snapshot = () => {
            const node = root.querySelector(selector), active = root.activeElement;
            return { phase: state.phase, domValue: node?.value,
              sourceValue: control ? null : field.split('.').reduce((value, key) => value?.[key], window.Prototype.current.data),
              originalConnected: original.isConnected, originalIdentity: identity(original), currentIdentity: identity(node),
              phaseIdentity: identity(state.phaseNode), phaseNodeConnected: !!state.phaseNode?.isConnected,
              currentIsPhaseNode: node === state.phaseNode, activeIdentity: identity(active), activeId: active?.id || '',
              activeTag: active?.tagName || '', focusedCurrentNode: active === node,
              selectionStart: node?.selectionStart, selectionEnd: node?.selectionEnd };
          };
          for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'focusin', 'focusout']) {
            const listener = event => {
              if (event.target.id !== original.id) return;
              state.events.push({ type, data: event.data ?? null, inputType: event.inputType ?? null,
                isComposing: event.isComposing ?? null, isTrusted: event.isTrusted, targetIdentity: identity(event.target),
                targetConnected: event.target.isConnected, targetValue: event.target.value, time: performance.now(), ...state.snapshot() });
            };
            root.addEventListener(type, listener, true); state.listeners.push({ type, listener });
          }
        }, fixture);
        const snapshot = () => page.evaluate(() => window.__r16ImeAcceptance.snapshot());
        const readDraftValue = async () => {
          if (fixture.control) return null;
          return page.evaluate(({ scope, field }) => {
            const owner = window.Prototype.current.data.ownerId;
            const key = ['card-benefits.form-draft.v1', scope, owner, 'new'].map(encodeURIComponent).join(':');
            const saved = window.wx.getStorageSync(key);
            return field.split('.').reduce((value, part) => value?.[part], saved?.value) ?? null;
          }, fixture);
        };
        const assertCommitted = async (value, label) => {
          await frame();
          const current = await snapshot();
          assert.equal(current.domValue, value, `${label} changed the committed DOM value`);
          assert.equal(current.focusedCurrentNode, true, `${label} lost focus from its current source control`);
          assert.equal(current.selectionStart, value.length, `${label} moved the insertion point`);
          assert.equal(current.selectionEnd, value.length, `${label} left an unexpected selection`);
          if (!fixture.control) {
            await waitUntil(async () => (await snapshot()).sourceValue === value && await readDraftValue() === value,
              `${label} did not propagate the committed value to the source controller and draft`);
            assert.equal((await snapshot()).sourceValue, value);
            assert.equal(await readDraftValue(), value);
          }
          return current;
        };
        const compose = async (name, base, candidates) => {
          await assertCommitted(base, `${name} baseline`);
          await page.evaluate(name => {
            const state = window.__r16ImeAcceptance;
            state.phase = name;
            state.phaseNode = state.root.querySelector(state.selector);
          }, name);
          for (const text of candidates) {
            const step = { phase: name, command: 'Input.imeSetComposition', params: { text, selectionStart: text.length, selectionEnd: text.length } };
            await cdp.send(step.command, step.params);
            await frame();
            step.observed = await snapshot(); evidence.steps.push(step);
            assert.equal(step.observed.domValue, base + text, 'Composition candidates were accumulated rather than replaced');
            assert.equal(step.observed.phaseNodeConnected, true, 'The active composition node was detached before commit or cancel');
            assert.equal(step.observed.currentIsPhaseNode, true, 'The active composition node was replaced before commit or cancel');
            assert.equal(step.observed.focusedCurrentNode, true, 'The active composition lost focus');
          }
        };
        const initial = await snapshot();
        assert.equal(initial.domValue, '');
        // Empty application fields may not have a persisted draft until the first commit.
        assert.equal(initial.focusedCurrentNode, true);
        await page.evaluate(() => {
          const state = window.__r16ImeAcceptance;
          state.phase = 'first Chinese preedit'; state.phaseNode = state.root.querySelector(state.selector);
        });
        for (const text of ['z', 'zh', 'zhong', 'zhongw', 'zhongwen', '中文']) {
          const params = { text, selectionStart: text.length, selectionEnd: text.length };
          await cdp.send('Input.imeSetComposition', params); await frame();
          const observed = await snapshot(); evidence.steps.push({ phase: 'first Chinese preedit', command: 'Input.imeSetComposition', params, observed });
          assert.equal(observed.domValue, text);
          assert.equal(observed.phaseNodeConnected, true);
          assert.equal(observed.currentIsPhaseNode, true);
          assert.equal(observed.focusedCurrentNode, true);
        }
        await cdp.send('Input.insertText', { text: '中文' });
        evidence.steps.push({ phase: 'first Chinese commit', command: 'Input.insertText', params: { text: '中文' }, observed: await assertCommitted('中文', 'First Chinese commit') });

        await compose('cancelled preedit', '中文', ['q', 'qu', 'qux', 'quxiao', '取消']);
        const cancelParams = { text: '', selectionStart: 0, selectionEnd: 0 };
        await cdp.send('Input.imeSetComposition', cancelParams);
        evidence.steps.push({ phase: 'cancel', command: 'Input.imeSetComposition', params: cancelParams, observed: await assertCommitted('中文', 'Composition cancellation') });
        await page.evaluate(() => { window.__r16ImeAcceptance.phase = 'English continuation'; });
        await page.keyboard.type('ABC', { delay: 20 });
        evidence.steps.push({ phase: 'English continuation', command: 'keyboard.type', text: 'ABC', observed: await assertCommitted('中文ABC', 'English continuation') });
        await compose('second Chinese preedit', '中文ABC', ['s', 'sh', 'shi', 'shij', 'shijie', '世界']);
        await cdp.send('Input.insertText', { text: '世界' });
        const finalValue = '中文ABC世界';
        evidence.steps.push({ phase: 'second Chinese commit', command: 'Input.insertText', params: { text: '世界' }, observed: await assertCommitted(finalValue, 'Second Chinese commit') });
        evidence.events = await page.evaluate(() => window.__r16ImeAcceptance.events);
        const inputEvents = evidence.events.filter(event => event.type === 'beforeinput' || event.type === 'input');
        assert.ok(inputEvents.length > 0 && inputEvents.every(event => event.isTrusted), 'The composition evidence did not come from trusted browser input events');
        assert.ok(evidence.events.some(event => event.type === 'input' && event.isComposing === true));
        assert.ok(evidence.events.filter(event => event.type === 'compositionstart').length >= 3);
        assert.ok(evidence.events.filter(event => event.type === 'compositionend').length >= 3, 'Commit/cancel did not terminate all composition sessions');
        evidence.final = await snapshot();
        if (fixture.control) { calibrated.set(fixture.tag, true); return; }

        await capture(`r16-ime-${fixture.route}-committed-value`);
        const instance = await page.evaluate(() => window.Prototype.current._instanceId);
        await page.locator('#native-back').click();
        await page.locator('#platform-layer [aria-label="离开当前页面？"]').waitFor({ state: 'visible' });
        evidence.navigation.push({ action: 'Back after composition', modal: await page.locator('#platform-layer').innerText() });
        await capture(`r16-ime-${fixture.route}-leave-confirmation`);
        await page.locator('#platform-layer button').filter({ hasText: /^继续填写$/ }).click(); await settled();
        assert.equal(await page.evaluate(() => window.Prototype.current._instanceId), instance);
        assert.equal(await atRoute(fixture.route), true);
        assert.equal(await native(fixture.selector).inputValue(), finalValue);
        assert.equal(fixture.field.split('.').reduce((value, key) => value?.[key], await data()), finalValue);
        assert.equal(await readDraftValue(), finalValue);
        assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0);
        await page.locator('#native-back').click();
        await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click();
        await expectRoute(fixture.route === 'submission-lead' ? 'mine' : 'submission-lead');
        if (fixture.route === 'submission-lead') await native('.menu-row[data-handler="openSubmission"]').click();
        else {
          await native('.full-form-link').click();
          await waitUntil(async () => await atRoute('submission-edit') || await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).count() > 0,
            'The full form could not be reopened after completed composition');
          if (await atRoute('submission-lead')) await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click();
        }
        await waitUntil(() => atRoute(fixture.route), 'The composition draft did not reopen for recovery');
        await page.locator('#platform-layer button').filter({ hasText: '恢复草稿' }).click(); await settled();
        assert.equal(await native(fixture.selector).inputValue(), finalValue);
        assert.equal(fixture.field.split('.').reduce((value, key) => value?.[key], await data()), finalValue);
        assert.equal(await readDraftValue(), finalValue);
        evidence.navigation.push({ action: 'Leave and recover actual draft', route: fixture.route, value: finalValue });
        await native(fixture.selector).scrollIntoViewIfNeeded();
        await capture(`r16-ime-${fixture.route}-recovered-draft`);
      });
    } finally {
      if (cdp) await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }).catch(() => {});
      if (isolatedPage && !isolatedPage.isClosed()) await isolatedPage.evaluate(() => {
        const state = window.__r16ImeAcceptance;
        if (state) for (const { type, listener } of state.listeners) state.root.removeEventListener(type, listener, true);
        delete window.__r16ImeAcceptance;
      }).catch(() => {});
      await cdp?.detach().catch(() => {});
      page = previousPage; await context?.close();
    }
  }
}


// Required runner globals: assert, browser, baseUrl, page, native, data, check,
// reset, waitUntil, settled, capture, attachDiagnostics, and currentCase.
// Run only after the root task freezes/builds R17. No standalone execution.
async function runR17CardBillingRebaseRegressions() {
  for (const failFirstRead of [false, true]) {
    const previousPage = page;
    let context;
    let clientA;
    let clientB;
    const branch = failFirstRead ? 'read-retry' : 'direct';
    try {
      await check(failFirstRead
        ? 'R17 re-reading a changed billing target preserves the ordinary draft after a read failure and retries safely'
        : 'R17 a same-month restored card draft exposes target re-reading and confirms the current bill before saving', async () => {
        context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1,
          locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
        clientA = await context.newPage(); clientB = await context.newPage(); page = clientA;
        clientA.setDefaultTimeout(12000); clientB.setDefaultTimeout(12000);
        attachDiagnostics(clientA); attachDiagnostics(clientB);
        const evidence = { branch, approach: 'Two same-owner browser pages, real source draft input/recovery and ordinary demo card commands; no seed or draft injection.', commandsB: [] };
        currentCase.measurements.billingRebase = evidence;
        const atRoute = name => page.evaluate(value => window.Prototype.current?.route === `pages/${value}/index`, name);
        const expectRoute = async name => { await waitUntil(() => atRoute(name), `The billing target flow did not reach ${name}`); await settled(); };
        const query = (client, action, payload = {}) => client.evaluate(({ action, payload }) => window.Prototype.api.query(action, payload), { action, payload });
        const commandB = async (payload, label) => {
          const result = await clientB.evaluate(payload => window.Prototype.api.command('card.save', payload), payload);
          evidence.commandsB.push({ label, payload, result }); return result;
        };
        const inputSnapshot = () => page.evaluate(() => {
          const d = window.Prototype.current.data;
          return { dueOn: d.dueOn, nickname: d.nickname, statementDay: d.statementDay, dueDay: d.dueDay,
            dueMonthOffset: d.dueMonthOffset, remindDays: d.remindOptions[d.remindIndex],
            bankId: d.banks[d.bankIndex].id, issuerId: d.issuerOptions[d.issuerIndex].id,
            network: d.networks[d.networkIndex].value, kind: d.kind, reminderEnabled: d.reminderEnabled };
        });
        const draftKey = () => page.evaluate(() => {
          const d = window.Prototype.current.data;
          return ['card-benefits.form-draft.v1', 'card', d.userId, d.draftEntityId].map(encodeURIComponent).join(':');
        });
        const readDraft = key => page.evaluate(key => window.wx.getStorageSync(key) || null, key);
        const trace = () => page.evaluate(() => ({ commands: window.__r17RebaseTrace.commands, queries: window.__r17RebaseTrace.queries }));
        const reloadA = async () => { await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => window.Prototype?.ready); await settled(); };
        const openCard = async accountId => {
          await native(`.account-settings[data-id="${accountId}"]`).click();
          await native('.account-edit[data-id="demo-card-cmb"]').click();
          await waitUntil(() => atRoute('card-edit'), 'The actual card editor did not open');
        };
        await page.goto(baseUrl, { waitUntil: 'load' }); await page.waitForFunction(() => window.Prototype?.ready); await settled(); await reset();
        await page.locator('#native-tabs button').filter({ hasText: '卡包' }).click(); await expectRoute('wallet');
        const originalWallet = await query(page, 'wallet.get');
        const session = await query(page, 'session.get');
        const originalCard = originalWallet.cards.find(card => card.id === 'demo-card-cmb');
        const accountX = originalWallet.accounts.find(account => account.id === originalCard.billingAccountId);
        const billX = originalWallet.bills.find(bill => bill.billingAccountId === accountX.id && bill.periodKey === session.month);
        const identity = { bankId: originalCard.bankId, issuerId: originalCard.issuerId,
          network: originalCard.network, kind: originalCard.kind, nickname: originalCard.nickname };
        const billing = { statementDay: accountX.statementDay, dueDay: accountX.dueDay, dueMonthOffset: accountX.dueMonthOffset,
          dueOn: billX.dueOn, periodKey: session.month, remindDays: accountX.remindDays };
        await clientB.goto(baseUrl, { waitUntil: 'load' });
        await clientB.waitForFunction(() => window.Prototype?.ready && !window.Prototype.current.data.loading);
        assert.equal((await query(clientB, 'session.get')).userId, session.userId);
        const member = await commandB({ ...identity, nickname: `R17 Shared Member ${branch}`, billing }, 'Create shared-account member Y');
        const withMember = await query(clientB, 'wallet.get');
        const accountYId = withMember.cards.find(card => card.id === member.id).billingAccountId;
        assert.notEqual(accountYId, accountX.id);
        await reloadA(); await expectRoute('wallet'); await openCard(accountX.id); await settled();
        const date = new Date(`${billX.dueOn}T04:00:00Z`); date.setUTCDate(date.getUTCDate() + 2);
        const desiredDueOn = date.toISOString().slice(0, 10);
        const desiredNickname = `R17 Preserved Card ${branch}`;
        await native('#card-nickname').fill(desiredNickname);
        await native('#field-dueOn input').fill(desiredDueOn); await native('#field-dueOn input').press('Tab');
        const remindIndex = (await data()).remindOptions.indexOf(5);
        assert.ok(remindIndex >= 0);
        await native('#field-remindDays select').selectOption(String(remindIndex));
        const entered = await inputSnapshot();
        assert.equal(entered.remindDays, 5); assert.equal(entered.dueOn, desiredDueOn);
        const key = await draftKey();
        const ordinaryDraft = await readDraft(key);
        assert.equal(ordinaryDraft.value.pendingCreation, undefined);
        assert.equal(ordinaryDraft.value.billingTarget.accountId, accountX.id);
        assert.equal(ordinaryDraft.value.billingTarget.billId, billX.id);
        await page.locator('#native-back').click();
        await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click(); await expectRoute('wallet');

        await commandB({ ...identity, id: originalCard.id, billingAccountId: accountYId }, 'Move the target card from X to shared Y');
        const shared = await query(clientB, 'wallet.get');
        assert.equal(shared.cards.filter(card => card.billingAccountId === accountYId && !card.archivedAt).length, 2);
        await commandB({ ...identity, id: originalCard.id, billing }, 'Create independent Z while another card remains on Y');
        const changedWallet = await query(clientB, 'wallet.get');
        const accountZId = changedWallet.cards.find(card => card.id === originalCard.id).billingAccountId;
        const billZ = changedWallet.bills.find(bill => bill.billingAccountId === accountZId && bill.periodKey === session.month);
        assert.ok(accountZId !== accountX.id && accountZId !== accountYId);
        evidence.targets = { X: accountX.id, Y: accountYId, Z: accountZId, billX: billX.id, billZ: billZ.id, periodKey: session.month };
        evidence.originalDraft = ordinaryDraft; evidence.entered = entered;
        await reloadA(); await expectRoute('wallet'); await openCard(accountZId);
        await page.locator('#platform-layer button').filter({ hasText: '恢复草稿' }).click(); await settled();
        const recovered = await data();
        assert.equal(recovered.card.billingAccountId, accountZId);
        assert.equal(recovered.billingTarget.accountId, accountX.id);
        assert.equal(recovered.billingTarget.periodKey, recovered.currentMonth, 'The fixture did not preserve the same-month boundary');
        assert.equal(recovered.pendingCreationSignature, '');
        assert.deepEqual(await inputSnapshot(), entered);
        assert.equal(recovered.billingTargetUnavailable, true);
        assert.equal(recovered.periodRebaseNeeded, true, 'The restored mismatched target did not expose recovery immediately');
        const rebase = native('button[data-handler="rebaseBillingPeriod"]');
        assert.equal(await rebase.innerText(), '保留填写，重新读取账单');
        assert.equal(await rebase.isEnabled(), true);
        await rebase.scrollIntoViewIfNeeded(); await capture(`r17-card-${branch}-changed-target-recovery-visible`, evidence.targets);
        await page.evaluate(() => {
          const api = window.Prototype.api;
          const state = window.__r17RebaseTrace = { api, command: api.command, query: api.query, commands: [], queries: [] };
          api.command = async function (...args) {
            const call = { action: args[0], payload: JSON.parse(JSON.stringify(args[1])), options: args[2] === undefined ? null : JSON.parse(JSON.stringify(args[2])) };
            state.commands.push(call);
            try { const result = await state.command.apply(this, args); call.result = result; return result; }
            catch (error) { call.error = { code: error.code, field: error.field, message: error.message }; throw error; }
          };
          api.query = async function (...args) {
            const call = { action: args[0], payload: JSON.parse(JSON.stringify(args[1])) }; state.queries.push(call);
            try { const result = await state.query.apply(this, args); call.completed = true; return result; }
            catch (error) { call.error = { code: error.code, message: error.message }; throw error; }
          };
        });
        if (failFirstRead) {
          const beforeFailure = { inputs: await inputSnapshot(), target: (await data()).billingTarget, draft: await readDraft(key) };
          await page.locator('#fail-read').click();
          await rebase.click();
          await waitUntil(async () => !(await data()).rebasing && (await trace()).queries.some(call => call.error?.code === 'NETWORK_ERROR'),
            'The re-read did not expose the injected real session/wallet query failure');
          await settled();
          assert.equal(await atRoute('card-edit'), true);
          assert.deepEqual(await inputSnapshot(), beforeFailure.inputs);
          assert.deepEqual((await data()).billingTarget, beforeFailure.target);
          assert.deepEqual(await readDraft(key), beforeFailure.draft, 'A failed target read rewrote the saved draft');
          assert.equal((await data()).periodRebaseNeeded, true);
          assert.equal(await rebase.isEnabled(), true, 'The failed target read did not allow an actual retry');
          assert.ok((await page.locator('#toast').innerText()).includes('网络'));
          assert.equal((await trace()).commands.length, 0);
          evidence.failedRead = await trace();
          await capture('r17-card-target-read-failure-retains-draft');
        }
        await rebase.click();
        await waitUntil(async () => !(await data()).rebasing && (await data()).billingTarget.accountId === accountZId,
          'The real re-read did not select the currently associated bill');
        await settled();
        assert.deepEqual(await inputSnapshot(), entered, 'Refreshing the target changed the retained date, nickname, or reminder inputs');
        const reread = await data();
        assert.equal(reread.billingTarget.billId, billZ.id);
        assert.equal(reread.billingTarget.periodKey, session.month);
        assert.equal(reread.billingTarget.originalDueOn, billZ.dueOn);
        assert.equal(reread.dateNeedsReview, true, 'The newly selected bill did not require an explicit date confirmation');
        assert.equal(reread.billingTargetUnavailable, false);
        assert.ok(reread.billingContextNotice.includes(billZ.dueOn) && reread.billingContextNotice.includes(desiredDueOn), 'The new target context did not distinguish the recorded date from the retained draft date');
        assert.equal((await trace()).commands.length, 0);
        const confirmedDateButton = native('button[data-handler="confirmDueDate"]');
        assert.equal(await confirmedDateButton.innerText(), '确认使用已填日期');
        // A premature save must not write to the newly selected target.
        await native('.save-button').click(); await settled();
        assert.equal((await trace()).commands.length, 0, 'Saving before date confirmation wrote the new bill target');
        assert.equal((await data()).dateNeedsReview, true);
        assert.ok((await data()).errors.dueOn.includes('核对'));
        await confirmedDateButton.scrollIntoViewIfNeeded(); await capture(`r17-card-${branch}-new-target-needs-date-confirmation`);
        await confirmedDateButton.click();
        assert.equal((await data()).dateNeedsReview, false);
        assert.deepEqual(await inputSnapshot(), entered);
        await native('.save-button').click(); await expectRoute('wallet');
        evidence.trace = await trace();
        assert.equal(evidence.trace.commands.length, 1);
        const command = evidence.trace.commands[0];
        assert.equal(command.action, 'card.save'); assert.equal(command.payload.id, originalCard.id);
        assert.equal(command.payload.billing.billId, billZ.id);
        assert.equal(command.payload.billing.periodKey, session.month);
        assert.equal(command.payload.billing.dueOn, desiredDueOn);
        assert.equal(command.payload.billing.remindDays, 5);
        assert.equal(command.payload.nickname, desiredNickname);
        assert.equal(command.result.id, originalCard.id);
        const finalWallet = await query(page, 'wallet.get');
        assert.equal(finalWallet.cards.find(card => card.id === originalCard.id).billingAccountId, accountZId);
        assert.equal(finalWallet.bills.find(bill => bill.id === billZ.id).dueOn, desiredDueOn);
        assert.deepEqual(finalWallet.bills.find(bill => bill.id === billX.id), changedWallet.bills.find(bill => bill.id === billX.id), 'Rebasing altered the original unrelated bill X');
        const billsY = changedWallet.bills.filter(bill => bill.billingAccountId === accountYId);
        assert.deepEqual(finalWallet.bills.filter(bill => bill.billingAccountId === accountYId), billsY, 'Rebasing altered shared account Y bills');
        assert.equal(finalWallet.accounts.length, changedWallet.accounts.length, 'Rebasing created another account instead of reusing Z');
        assert.equal(await readDraft(key), null, 'The acknowledged editing draft was not cleared');
        evidence.final = { card: finalWallet.cards.find(card => card.id === originalCard.id), bill: finalWallet.bills.find(bill => bill.id === billZ.id) };
        const group = native('.account-group').filter({ hasText: desiredNickname });
        await group.scrollIntoViewIfNeeded(); await capture(`r17-card-${branch}-only-current-bill-updated`, evidence.final);
      });
    } finally {
      if (clientA && !clientA.isClosed()) await clientA.evaluate(() => {
        const state = window.__r17RebaseTrace;
        if (state) { state.api.command = state.command; state.api.query = state.query; delete window.__r17RebaseTrace; }
      }).catch(() => {});
      page = previousPage; await context?.close();
    }
  }
}


async function runR18ReceiptSaveDateRegressions() {
  const originalPage = page;
  const receiptKey = value => [
    'card-benefits.form-draft.v1', 'receipt', value.ownerId, value.draftEntityId,
  ].map(encodeURIComponent).join(':');
  const readDraft = async key => page.evaluate(key => wx.getStorageSync(key) ?? null, key);
  const expectRoute = async name => {
    await waitUntil(async () => page.evaluate(name =>
      Prototype.current?.route === 'pages/' + name + '/index', name),
    'Receipt save-date regression did not reach ' + name);
  };
  const dateSettled = async () => {
    await settled();
    await waitUntil(async () => !(await data()).dateRefreshing,
      'The receipt date check did not settle');
  };
  const ledger = async fixture => page.evaluate(({ activityId, participationId }) => {
    const seed = wx.getStorageSync('card-benefits.native.demo.v1').seed;
    return {
      records: Object.values(seed.participations || {}).filter(record => record.activityId === activityId),
      rewards: Object.values(seed.rewards || {}).filter(reward => reward.participationId === participationId),
      requests: Object.values(seed.requests || {}).filter(request => request.result?.id === participationId),
      audit: Object.values(seed.audit_events || {}).filter(event => event.entityId === participationId),
    };
  }, fixture);
  const setupKnownReceipt = async () => {
    await page.evaluate(() => Prototype.scenarios.review()); await settled();
    const fixture = await page.evaluate(async () => {
      const detail = await Prototype.api.query('activity.get', { activityId: 'monthly' });
      const { id, revision, status, publishedAt, updatedAt, publishedBy, ...draft } = detail.activity;
      draft.title = '到账保存与日期核对状态验收活动';
      draft.startsOn = '2026-01-01'; draft.endsOn = '2026-12-31';
      draft.frequency = 'monthly'; draft.scope = 'user'; draft.target = 1;
      draft.requiresRegistration = false; draft.requiresInvitation = false;
      draft.rewardMinor = 1000; draft.rewardKind = 'cashback';
      draft.sourceNote = '仅用于演示模式保存与纯日期刷新交互验收。';
      const submission = await Prototype.api.command('submission.save', { draft });
      const published = await Prototype.api.command('submission.review', {
        id: submission.id, expectedVersion: submission.version, decision: 'publish', sourceVerified: true, draft,
      });
      const joined = await Prototype.api.command('activity.join', { activityId: published.id });
      const completed = await Prototype.api.command('participation.complete', { participationId: joined.id });
      return { activityId: published.id, participationId: completed.id, version: completed.version };
    });
    await page.evaluate(() => Prototype.openPage('pages/mine/index')); await settled();
    await page.evaluate(id => Prototype.openPage('pages/receipt/index?id=' + encodeURIComponent(id)), fixture.participationId);
    await expectRoute('receipt'); await dateSettled();
    await native('#amount').fill('18');
    const value = await data();
    assert.equal(value.participation.periodKey, '2026-09');
    assert.equal(value.participation.stage, 'completed');
    return { fixture, source: value, key: receiptKey(value) };
  };
  const installGate = async (failAfterRelease = false) => {
    await page.evaluate(failAfterRelease => {
      const api = Prototype.api;
      const state = window.__r18Receipt = {
        api, query: api.query, command: api.command,
        queries: [], commands: [], saveClicks: [], release: null, held: false, failAfterRelease,
      };
      state.captureClick = event => {
        const button = event.target.closest?.('.entry-primary[data-handler="save"]');
        if (button) state.saveClicks.push({
          amountAtClick: Prototype.current.data.amountInput,
          dateAtClick: Prototype.current.data.receivedOn, labelAtClick: button.innerText,
        });
      };
      Prototype.shadow.addEventListener('click', state.captureClick, { capture: true });
      api.query = async function (...args) {
        const call = { action: args[0], payload: args[1], phase: 'requested' };
        state.queries.push(call);
        const result = await state.query.apply(this, args);
        call.phase = 'actual-result-received';
        if (args[0] === 'session.get') call.result = { today: result.today, month: result.month, userId: result.userId };
        if (args[0] === 'session.get' && !state.held) {
          state.held = true;
          await new Promise(resolve => { state.release = resolve; });
          if (state.failAfterRelease) {
            call.phase = 'response-failed';
            call.error = { code: 'NETWORK_ERROR', message: '日期核对响应暂时不可用' };
            throw Object.assign(new Error('日期核对响应暂时不可用'), { code: 'NETWORK_ERROR' });
          }
          call.phase = 'released-unmodified';
        }
        return result;
      };
      api.command = function (...args) {
        const call = {
          action: args[0], payload: JSON.parse(JSON.stringify(args[1])),
          options: args[2] === undefined ? null : JSON.parse(JSON.stringify(args[2])),
        };
        state.commands.push(call);
        const pending = state.command.apply(this, args);
        pending.then(result => { call.result = result; },
          error => { call.error = { code: error.code, message: error.message }; });
        return pending;
      };
    }, failAfterRelease);
  };
  const trace = async () => page.evaluate(() => ({
    queries: window.__r18Receipt.queries, commands: window.__r18Receipt.commands,
    saveClicks: window.__r18Receipt.saveClicks,
  }));
  const releaseGate = async () => page.evaluate(() => { window.__r18Receipt.release(); });
  const waitHeld = async () => {
    await waitUntil(async () => page.evaluate(() =>
      !!window.__r18Receipt.release && Prototype.current.data.dateRefreshing),
    'The actual session response was not held during the source date check');
  };
  const restoreGate = async () => page.evaluate(() => {
    const state = window.__r18Receipt;
    if (!state) return;
    state.release?.();
    state.api.query = state.query;
    state.api.command = state.command;
    Prototype.shadow.removeEventListener('click', state.captureClick, { capture: true });
    delete window.__r18Receipt;
  });
  const verifySaveLock = async () => {
    assert.equal(await native('#amount').isDisabled(), true,
      'Save-triggered date checking left the amount editable');
    assert.equal(await native('#receipt-date-field input').isDisabled(), true);
    assert.equal(await native('.entry-primary').isDisabled(), true);
    assert.equal(await native('.entry-primary').getAttribute('aria-busy'), 'true');
    assert.ok((await native('.entry-primary').innerText()).includes('正在核对日期'));
    assert.equal((await data()).busy, true);
    assert.equal((await data()).dateRefreshing, true);
    assert.equal(await native('.entry-actions [data-handler="back"]').isDisabled(), true);
  };
  const attemptRawEdit = async () => {
    // Use physical pointer/keyboard input instead of bypassing the disabled state with fill or a handler call.
    await native('#amount').scrollIntoViewIfNeeded();
    const bounds = await native('#amount').boundingBox();
    assert.ok(bounds);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('23');
    assert.equal(await native('#amount').inputValue(), '18',
      'Raw keyboard input changed the amount after Save had locked the form');
    assert.equal((await data()).amountInput, '18');
  };
  const verifyKnownReceiptSaved = async (fixture, beforeLedger, amountMinor) => {
    const logged = await trace();
    assert.equal(logged.commands.length, 1);
    const command = logged.commands[0];
    assert.equal(command.action, 'reward.confirm');
    assert.equal(command.payload.participationId, fixture.participationId);
    assert.equal(command.payload.expectedVersion, fixture.version);
    assert.equal(command.payload.amountMinor, amountMinor);
    assert.equal(command.payload.receivedOn, '2026-09-30');
    assert.equal(command.payload.expectNew, undefined);
    assert.equal(command.result.id, fixture.participationId);
    const after = await ledger(fixture);
    assert.equal(after.records.length, 1);
    assert.equal(after.records[0].id, fixture.participationId);
    assert.equal(after.records[0].periodKey, '2026-09');
    assert.equal(after.records[0].receivedMinor, amountMinor);
    assert.equal(after.records[0].receivedOn, '2026-09-30');
    assert.deepEqual(after.records[0].snapshot, beforeLedger.records[0].snapshot);
    assert.equal(after.rewards.length, 1);
    assert.equal(after.rewards[0].amountMinor, amountMinor);
    assert.equal(after.rewards[0].activityPeriod, '2026-09');
    assert.equal(after.rewards[0].receivedOn, '2026-09-30');
  };
  const isolatedCheck = async (name, action) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    try {
      await context.addInitScript(() => {
        const NativeDate = window.Date, now = NativeDate.parse('2026-09-30T04:00:00.000Z');
        window.Date = new Proxy(NativeDate, {
          construct(target, args) { return Reflect.construct(target, args.length ? args : [now]); },
          apply() { return new NativeDate(now).toString(); },
          get(target, key, receiver) {
            return key === 'now' ? () => now : Reflect.get(target, key, receiver);
          },
        });
      });
      page = await context.newPage(); page.setDefaultTimeout(10000);
      const exceptions = [];
      page.on('pageerror', error => exceptions.push(error.message));
      if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
      await check(name, async () => {
        await page.goto(baseUrl, { waitUntil: 'load' });
        await page.waitForFunction(() => Prototype.ready && Prototype.current?.data); await settled();
        await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{width:375px!important;height:812px!important;min-height:812px!important;max-height:812px!important;max-width:none!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
        await action();
        assert.deepEqual(exceptions, [], 'The receipt save-date regression raised a browser exception');
      });
    } finally {
      try { await restoreGate(); } catch {}
      try { await context.close(); } finally { page = originalPage; }
    }
  };

  await isolatedCheck('A known receipt Save locks eighteen throughout date checking and commits that single click', async () => {
    const { fixture, source, key } = await setupKnownReceipt();
    const savedDraft = await readDraft(key), beforeLedger = await ledger(fixture);
    await installGate();
    await native('.entry-primary').click(); await waitHeld();
    await verifySaveLock();
    assert.equal((await trace()).saveClicks.length, 1);
    assert.equal((await trace()).saveClicks[0].amountAtClick, '18');
    assert.equal((await trace()).commands.length, 0);
    await capture('r18-known-receipt-save-locks-eighteen-during-date-check');
    await attemptRawEdit();
    assert.deepEqual((await data()).receiptTarget, source.receiptTarget);
    assert.deepEqual(await readDraft(key), savedDraft);
    assert.deepEqual(await ledger(fixture), beforeLedger);
    await capture('r18-raw-edit-cannot-change-saving-receipt');
    await releaseGate();
    await expectRoute('mine'); await settled();
    assert.equal((await trace()).saveClicks.length, 1);
    await verifyKnownReceiptSaved(fixture, beforeLedger, 1800);
    assert.equal(await readDraft(key), null);
    await page.evaluate(id => Prototype.openPage('pages/receipt/index?id=' + encodeURIComponent(id)), fixture.participationId);
    await dateSettled();
    assert.equal(await native('#amount').inputValue(), '18.00');
    await capture('r18-single-save-keeps-clicked-amount');
  });

  await isolatedCheck('A failed Save date check unlocks the retained amount and requires a new click to save edits', async () => {
    const { fixture, source, key } = await setupKnownReceipt();
    const savedDraft = await readDraft(key), beforeLedger = await ledger(fixture);
    await installGate(true);
    await native('.entry-primary').click(); await waitHeld();
    await verifySaveLock();
    await releaseGate();
    await waitUntil(async () => {
      const value = await data();
      return !value.busy && !value.dateRefreshing && !!value.dateRefreshError;
    }, 'The failed Save date check did not release its operation lock');
    assert.equal(await native('#amount').isEnabled(), true);
    assert.equal(await native('.entry-primary').isEnabled(), true);
    assert.equal(await native('.entry-actions [data-handler="back"]').isEnabled(), true);
    assert.equal(await native('#receipt-date-field input').isDisabled(), true,
      'A failed date read must keep the date picker unavailable until freshness is restored');
    assert.equal(await native('[data-handler="refreshDateRange"]').isVisible(), true);
    assert.equal(await native('#amount').inputValue(), '18');
    assert.equal(await native('#receipt-date-field input').inputValue(), '2026-09-30');
    assert.deepEqual((await data()).receiptTarget, source.receiptTarget);
    assert.deepEqual(await readDraft(key), savedDraft);
    assert.deepEqual(await ledger(fixture), beforeLedger);
    assert.equal((await trace()).commands.length, 0);
    assert.equal((await trace()).saveClicks.length, 1);
    await capture('r18-failed-save-date-check-releases-amount-lock');
    await native('#amount').fill('23');
    assert.equal((await readDraft(key)).value.amountInput, '23');
    assert.equal((await trace()).commands.length, 0,
      'Editing after a failed date check automatically resumed the old Save');
    await native('.entry-primary').click();
    await expectRoute('mine'); await settled();
    const logged = await trace();
    assert.equal(logged.saveClicks.length, 2);
    assert.deepEqual(logged.saveClicks.map(click => click.amountAtClick), ['18', '23']);
    await verifyKnownReceiptSaved(fixture, beforeLedger, 2300);
    assert.equal(await readDraft(key), null);
    await page.evaluate(id => Prototype.openPage('pages/receipt/index?id=' + encodeURIComponent(id)), fixture.participationId);
    await dateSettled();
    assert.equal(await native('#amount').inputValue(), '23.00');
    await capture('r18-edited-amount-saved-only-by-second-click');
  });

  await isolatedCheck('A foreground-only date refresh permits amount editing and keeps the result as a draft', async () => {
    const { fixture, source, key } = await setupKnownReceipt();
    const beforeLedger = await ledger(fixture);
    await installGate();
    await page.evaluate(() => {
      const hostPage = Prototype.current;
      // Host lifecycle simulation only; no OS or physical WeChat foreground gesture is claimed.
      hostPage.onHide();
      void hostPage.onShow();
    });
    await waitHeld();
    assert.equal((await data()).dateRefreshing, true);
    assert.equal((await data()).busy, false);
    assert.equal(await native('#amount').isEnabled(), true,
      'A pure date refresh unnecessarily locked amount editing');
    assert.equal(await native('#receipt-date-field input').isDisabled(), true);
    assert.equal(await native('.entry-primary').isDisabled(), true);
    await native('#amount').fill('23');
    assert.equal((await data()).amountInput, '23');
    assert.equal((await readDraft(key)).value.amountInput, '23');
    await capture('r18-foreground-date-refresh-still-allows-draft-editing');
    await releaseGate(); await dateSettled();
    assert.equal((await data()).participation.id, fixture.participationId);
    assert.equal(await native('#amount').inputValue(), '23');
    assert.equal(await native('#amount').isEnabled(), true);
    assert.equal((await readDraft(key)).value.amountInput, '23');
    assert.deepEqual((await data()).receiptTarget, source.receiptTarget);
    assert.equal((await trace()).saveClicks.length, 0);
    assert.equal((await trace()).commands.length, 0);
    assert.deepEqual(await ledger(fixture), beforeLedger);
    await capture('r18-foreground-refresh-retains-unsaved-twenty-three');
  });
}



// Run the acceptance process with TMPDIR=/var/tmp/wankapai-browser-r19 after the unified source freeze.
async function runR19UrlEncodingRegressions() {
  const originalPage = page;
  const origin = new URL(originalPage.url()).origin;
  async function withPage(fragment, action) {
    const context = await originalPage.context().browser().newContext({
      viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    const unexpectedRequests = [];
    let target;
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      target = await context.newPage(); page = target;
      page.setDefaultTimeout(10000);
      if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
      await page.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(origin + '/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
        unexpectedRequests.push(url);
        return route.abort();
      });
      await page.goto(origin + '/' + (fragment || ''), { waitUntil: 'load' });
      await page.waitForFunction(() => window.Prototype?.ready && window.Prototype.current?.data);
      await settled();
      await installClipboardTrace();
      await action();
      assert.deepEqual(unexpectedRequests, [], 'The demo boundary attempted to request an external website');
    } finally {
      if (target && !target.isClosed()) await target.evaluate(() => {
        const state = window.__r19UrlClipboard;
        if (state) wx.setClipboardData = state.original;
      }).catch(() => {});
      page = originalPage;
      await context.close();
    }
  }
  async function installClipboardTrace() {
    await page.evaluate(() => {
      const original = wx.setClipboardData;
      const state = window.__r19UrlClipboard = { original, calls: [] };
      wx.setClipboardData = async function (options) {
        const call = { data: options.data };
        state.calls.push(call);
        try { const result = await original.call(wx, options); call.result = result; return result; }
        catch (error) { call.error = { message: error.message, errMsg: error.errMsg }; throw error; }
      };
    });
  }
  function routeForUrl(url) { return 'pages/web-entry/index?url=' + encodeURIComponent(url); }
  async function snapshot() {
    return page.evaluate(() => {
      const owner = window.Prototype.current;
      const route = location.hash.replace(/^#\//, '');
      const query = route.includes('?') ? route.slice(route.indexOf('?') + 1) : '';
      return {
        route: owner.route, instance: owner._instanceId, options: owner.options,
        sourceUrl: owner.data.sourceUrl, url: owner.data.url, error: owner.data.error, canRetry: owner.data.canRetry,
        hash: location.hash, decodedHashUrl: new URLSearchParams(query).get('url'),
        stack: getCurrentPages().map(item => ({ route: item.route, instance: item._instanceId })),
      };
    });
  }
  async function assertValidUrl(url) {
    await waitUntil(async () => page.evaluate(() => window.Prototype.current.route === 'pages/web-entry/index' && !window.Prototype.current.data.loading), 'The actual Web Entry page did not settle');
    const state = await snapshot();
    assert.equal(state.options.url, url, 'Canonical route options changed the URL bytes');
    assert.equal(state.decodedHashUrl, url, 'The canonical hash changed the URL after one transport decode');
    assert.equal(state.sourceUrl, url, 'The prototype-to-source onLoad boundary changed the original URL');
    assert.equal(state.url, '', 'The demo fixture unexpectedly enabled an external web-view');
    assert.equal(state.canRetry, false);
    assert.ok(state.error.includes('复制地址'), 'The valid demo URL did not retain its copy fallback');
    assert.equal(await native('[data-handler="copyUrl"]').count(), 1);
    return state;
  }
  async function copyAndAssert(url) {
    const count = await page.evaluate(() => window.__r19UrlClipboard.calls.length);
    await native('[data-handler="copyUrl"]').click();
    await waitUntil(async () => page.evaluate(count => window.__r19UrlClipboard.calls.length === count + 1
      && !!window.__r19UrlClipboard.calls[count].result, count), 'The real clipboard adapter did not complete');
    const evidence = await page.evaluate(async count => ({ call: window.__r19UrlClipboard.calls[count], clipboard: await navigator.clipboard.readText() }), count);
    assert.equal(evidence.call.data, url, 'The copy action passed altered bytes to wx.setClipboardData');
    assert.equal(evidence.clipboard, url, 'The original browser clipboard adapter copied altered URL bytes');
    assert.equal(evidence.call.result.errMsg, 'setClipboardData:ok');
    assert.equal(await page.locator('#platform-layer [role="dialog"]').count(), 0, 'Authorized browser clipboard unexpectedly required a fallback dialog');
    return evidence;
  }

  await check('Prototype cold routes preserve encoded URL bytes and reject invalid public-web addresses', async () => {
    const entries = [
      { name: 'path-space', url: 'https://cc.cmbchina.com/promo%20offer', valid: true },
      { name: 'query-ampersand', url: 'https://cc.cmbchina.com/promotion/?next=a%26b', valid: true },
      { name: 'percent-sign', url: 'https://cc.cmbchina.com/promo%25offer?rate=20%25', valid: true },
      { name: 'unicode', url: 'https://cc.cmbchina.com/活动?名称=权益&next=a%26b', valid: true },
      { name: 'plain', url: 'https://cc.cmbchina.com/promotion/', valid: true },
      { name: 'invalid-http', url: 'http://cc.cmbchina.com/promotion/', valid: false },
      { name: 'invalid-space', url: 'https://cc.cmbchina.com/promo offer', valid: false },
      { name: 'invalid-private', url: 'https://localhost/private', valid: false },
    ];
    for (const entry of entries) {
      await withPage('#/' + routeForUrl(entry.url), async () => {
        const state = await snapshot();
        assert.equal(state.options.url, entry.url, 'Cold routing did not retain its canonical decoded option');
        assert.equal(state.decodedHashUrl, entry.url);
        if (entry.valid) {
          await assertValidUrl(entry.url);
          const clipboard = await copyAndAssert(entry.url);
          if (entry.name === 'query-ampersand') {
            assert.deepEqual([...new URL(clipboard.clipboard).searchParams.entries()], [['next', 'a&b']], 'Encoded ampersand became a different query parameter');
          }
          await capture(`r19-cold-url-${entry.name}`, { originalUrl: entry.url, canonical: await snapshot(), clipboard });
        } else {
          assert.equal(state.sourceUrl, ''); assert.equal(state.url, ''); assert.equal(state.canRetry, false);
          assert.ok(state.error.includes('地址无效'));
          assert.equal(await native('[data-handler="copyUrl"]').count(), 0);
          assert.deepEqual(await page.evaluate(() => window.__r19UrlClipboard.calls), []);
          await capture(`r19-cold-url-${entry.name}`, { originalUrl: entry.url, canonical: state });
        }
      });
    }
  });

  await check('Prototype navigation, platform navigation, Back, refresh, and reload retain canonical web URLs without encoding drift', async () => {
    await withPage('', async () => {
      const url = 'https://cc.cmbchina.com/活动%20offer?next=a%26b&rate=20%25#规则%20说明';
      for (const boundary of ['prototype', 'platform']) {
        const route = routeForUrl(url);
        if (boundary === 'prototype') await page.evaluate(route => window.Prototype.navigate(route), route);
        else await page.evaluate(route => wx.navigateTo({ url: '/' + route }), route);
        await settled();
        const entered = await assertValidUrl(url);
        await copyAndAssert(url);
        await page.locator('.atlas-link[data-route="pages/history/index"]').click();
        await waitUntil(async () => page.evaluate(() => window.Prototype.current.route === 'pages/history/index'), 'The real atlas control did not push the next page');
        await settled();
        await page.locator('#native-back').click();
        await settled();
        const returned = await assertValidUrl(url);
        assert.equal(returned.instance, entered.instance, 'Native Back did not restore the retained Web Entry instance');
        assert.equal(returned.hash, entered.hash);
        await copyAndAssert(url);
        await page.locator('#refresh-page').click();
        await settled();
        const refreshed = await assertValidUrl(url);
        assert.notEqual(refreshed.instance, returned.instance, 'Web Entry refresh did not exercise its actual replacement load path');
        assert.equal(refreshed.hash, entered.hash, 'Replacement refresh accumulated another URL encoding layer');
        await copyAndAssert(url);
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.Prototype?.ready && window.Prototype.current?.data);
        await settled();
        await installClipboardTrace();
        const reloaded = await assertValidUrl(url);
        assert.equal(reloaded.hash, entered.hash, 'Browser reload changed the canonical hash');
        const clipboard = await copyAndAssert(url);
        await capture(`r19-${boundary}-url-back-refresh-reload`, { url, entered, returned, refreshed, reloaded, clipboard });
      }
      const standard = 'https://cc.cmbchina.com/promotion/';
      await page.locator('.atlas-link[data-route="pages/web-entry/index"]').click();
      await settled();
      await assertValidUrl(standard);
      await copyAndAssert(standard);
      await page.locator('.atlas-link[data-route="pages/detail/index"]').click();
      await waitUntil(async () => page.evaluate(() => window.Prototype.current.route === 'pages/detail/index' && !window.Prototype.current.data.loading), 'The standard detail source page did not load');
      const expected = (await data()).detail.activity.entrance.url;
      assert.equal(expected, standard);
      const count = await page.evaluate(() => window.__r19UrlClipboard.calls.length);
      await native('.entry-open').click();
      await waitUntil(async () => page.evaluate(count => window.__r19UrlClipboard.calls.length === count + 1
        && !!window.__r19UrlClipboard.calls[count].result, count), 'The normal source entrance copy action did not complete');
      await page.locator('#platform-layer [role="dialog"][aria-label="活动地址已复制"]').waitFor({ state: 'visible' });
      const normal = await page.evaluate(async count => ({ call: window.__r19UrlClipboard.calls[count], clipboard: await navigator.clipboard.readText() }), count);
      assert.equal(normal.call.data, standard); assert.equal(normal.clipboard, standard);
      await capture('r19-standard-bank-source-copy-control', normal);
      await page.locator('#platform-layer button').filter({ hasText: '知道了' }).click();
    });
  });
}


// Run the unified acceptance process with TMPDIR=/var/tmp/wankapai-browser-r20.
// Store remote evidence beneath /var/tmp/wankapai-evidence/candidate-r20.
async function runR20SessionRoleCacheRegressions() {
  const originalPage = page;
  async function currentSnapshot() {
    return page.evaluate(async () => {
      const state = window.__r20SessionGuard;
      const owner = window.Prototype.current;
      const realSession = await state.originalQuery.call(state.api, 'session.get', {});
      return {
        at: new Date().toISOString(), route: owner.route, instance: owner._instanceId, options: owner.options,
        hash: location.hash, realSession, sourceSession: owner.data.session,
        sourcePage: { loading: owner.data.loading, changingRole: owner.data.changingRole, denied: owner.data.denied, sessionVerified: owner.data.sessionVerified, error: owner.data.error },
        rolePickerValue: window.Prototype.shadow.querySelector('.demo-heading select')?.value,
        rolePickerText: window.Prototype.shadow.querySelector('.role-picker')?.textContent,
        reviewMenuCount: window.Prototype.shadow.querySelectorAll('[data-handler="openReview"]').length,
        stack: getCurrentPages().map(item => ({ route: item.route, instance: item._instanceId })),
        oldReview: state.owner ? { instance: state.owner._instanceId, requestGeneration: state.owner.requestGeneration, loading: state.owner.data.loading, stillInStack: getCurrentPages().includes(state.owner) } : null,
      };
    });
  }
  async function trace() {
    return page.evaluate(() => ({ queries: window.__r20SessionGuard.queries, commands: window.__r20SessionGuard.commands }));
  }
  async function waitRoute(name) {
    await waitUntil(async () => page.evaluate(name => window.Prototype.current.route === `pages/${name}/index`, name), `The real source UI did not reach ${name}`);
  }
  async function chooseRole(moderator) {
    await native('.demo-heading select.prototype-picker-control').selectOption(moderator ? '1' : '0');
    await waitUntil(async () => {
      const state = await data();
      return !state.loading && !state.changingRole && state.session?.isModerator === moderator;
    }, 'The source role picker did not finish loading its selected session');
    await settled();
  }
  async function assertMineRole(moderator) {
    await waitRoute('mine'); await settled();
    const state = await currentSnapshot();
    assert.equal(state.sourceSession.isModerator, moderator, 'Mine reused the superseded session result');
    assert.equal(state.realSession.isModerator, moderator, 'The source role display differs from the real demo actor');
    assert.equal(state.rolePickerValue, moderator ? '1' : '0');
    assert.equal(state.reviewMenuCount, moderator ? 1 : 0, 'The review menu contradicts the latest explicit role');
    assert.ok(state.rolePickerText.includes(moderator ? '运营审核' : '普通用户'));
    return state;
  }
  async function realModerationAccess() {
    return page.evaluate(async () => {
      const state = window.__r20SessionGuard;
      try { const result = await state.originalQuery.call(state.api, 'submissions.list', { moderation: true, status: 'pending', limit: 20 }); return { allowed: true, count: result.items.length }; }
      catch (error) { return { allowed: false, code: error.code, message: error.message }; }
    });
  }

  for (const oldModerator of [true, false]) {
    const newModerator = !oldModerator;
    const direction = oldModerator ? 'moderator-to-user' : 'user-to-moderator';
    const context = await originalPage.context().browser().newContext({
      viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    try {
      page = await context.newPage(); page.setDefaultTimeout(10000);
      if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
      await check(`A retired ${oldModerator ? 'moderator' : 'ordinary-user'} session response cannot replace the newer ${newModerator ? 'moderator' : 'ordinary-user'} cache`, async () => {
        await page.goto(new URL(originalPage.url()).origin, { waitUntil: 'load' });
        await page.waitForFunction(() => window.Prototype?.ready && window.Prototype.current?.data);
        await settled();
        await page.locator('#native-tabs button').filter({ hasText: /^我的$/ }).click();
        await waitRoute('mine'); await settled();
        if (oldModerator) await chooseRole(true);
        else assert.equal((await data()).session.isModerator, false);
        await page.evaluate(() => {
          const api = window.Prototype.api;
          const state = window.__r20SessionGuard = {
            api, originalQuery: api.query, originalCommand: api.command,
            held: false, returned: false, released: false, pending: null, owner: null, queries: [], commands: [],
          };
          api.query = async function (...args) {
            const [action, payload] = args;
            const call = { action, payload, route: window.Prototype.current.route, instance: window.Prototype.current._instanceId, startedAt: new Date().toISOString() };
            state.queries.push(call);
            const result = await state.originalQuery.apply(api, args);
            call.calculatedAt = new Date().toISOString();
            if (action === 'session.get') call.result = JSON.parse(JSON.stringify(result));
            if (action === 'session.get' && window.Prototype.current.route === 'pages/review/index' && !state.held) {
              state.held = true; state.owner = window.Prototype.current; call.held = true;
              await new Promise(resolve => { state.pending = { result, resolve }; });
              state.returned = true; call.deliveredAt = new Date().toISOString();
            }
            return result;
          };
          api.command = async function (...args) {
            state.commands.push({ action: args[0], payload: args[1] });
            return state.originalCommand.apply(api, args);
          };
        });
        try {
          const starting = await assertMineRole(oldModerator);
          if (oldModerator) await native('[data-handler="openReview"]').click();
          else {
            // The public atlas only opens the ordinary user's authorization boundary; it does not assign a role.
            await page.locator('.atlas-link[data-route="pages/review/index"]').click();
          }
          await waitRoute('review');
          await waitUntil(async () => page.evaluate(() => window.__r20SessionGuard.held), 'The Review session result was not computed and deferred before shared cache publication');
          const held = await currentSnapshot();
          const heldResult = await page.evaluate(() => window.__r20SessionGuard.pending.result);
          assert.equal(heldResult.isModerator, oldModerator);
          assert.equal(held.realSession.isModerator, oldModerator, 'Opening the ordinary review boundary changed the actor role');
          assert.equal(held.sourcePage.loading, true);
          assert.equal(held.oldReview.stillInStack, true);
          await capture(`r20-${direction}-old-review-session-held`, { starting, held, heldResult });
          await page.locator('#native-back').click();
          await waitRoute('mine'); await settled();
          const returned = await currentSnapshot();
          assert.equal(returned.instance, starting.instance);
          assert.equal(returned.oldReview.stillInStack, false, 'Native Back did not unload the held Review page');
          assert.ok(returned.oldReview.requestGeneration > held.oldReview.requestGeneration);
          await chooseRole(newModerator);
          const selected = await assertMineRole(newModerator);
          const beforeReleaseTrace = await trace();
          assert.ok(beforeReleaseTrace.queries.some(item => item.action === 'session.get' && item.instance === selected.instance && item.result?.isModerator === newModerator), 'The newer role did not complete its own real session query');
          await capture(`r20-${direction}-new-role-before-old-return`, selected);
          await page.evaluate(async () => {
            const state = window.__r20SessionGuard;
            state.released = true; state.pending.resolve();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          });
          await waitUntil(async () => page.evaluate(() => window.__r20SessionGuard.returned), 'The old session response was not delivered');
          const afterReturn = await assertMineRole(newModerator);
          assert.equal(afterReturn.instance, selected.instance);
          assert.deepEqual(afterReturn.stack, selected.stack);
          await page.locator('#native-tabs button').filter({ hasText: /^活动$/ }).click();
          await waitRoute('activities'); await settled();
          await page.locator('#native-tabs button').filter({ hasText: /^我的$/ }).click();
          await waitRoute('mine'); await settled();
          const reentered = await assertMineRole(newModerator);
          assert.equal(reentered.instance, selected.instance, 'The source tab revisit should reuse its cached Mine page');
          assert.ok(Date.parse(reentered.at) - Date.parse(selected.at) < 30000,
            'The role-cache regression reached its assertion after the cache lifetime expired');
          const authorization = await realModerationAccess();
          assert.equal(authorization.allowed, newModerator, 'Real moderation authority contradicts the latest source role');
          if (!newModerator) assert.equal(authorization.code, 'FORBIDDEN');
          assert.deepEqual((await trace()).commands, [], 'The read-only role scenario unexpectedly wrote business data');
          await capture(`r20-${direction}-mine-cache-keeps-new-role`, { reentered, authorization, trace: await trace() });
          if (!newModerator) {
            // Ordinary users can still inspect the real denied page through the public prototype atlas.
            await page.locator('.atlas-link[data-route="pages/review/index"]').click();
            await waitRoute('review'); await settled();
            assert.equal((await data()).denied, true);
            assert.equal((await data()).sessionVerified, false);
            await page.locator('#native-back').click();
            await waitRoute('mine'); await settled();
            await chooseRole(true);
            await assertMineRole(true);
          }
          await native('[data-handler="openReview"]').click();
          await waitRoute('review'); await settled();
          assert.equal((await data()).denied, false);
          assert.equal((await data()).sessionVerified, true, 'A fresh legitimate moderator can no longer enter the source Review page');
          const finalAuthority = await realModerationAccess();
          assert.equal(finalAuthority.allowed, true);
          const finalTrace = await trace();
          assert.deepEqual(finalTrace.commands, []);
          assert.ok(finalTrace.queries.some(item => item.action === 'session.get' && !item.held && item.route === 'pages/review/index' && item.result?.isModerator === true));
          await capture(`r20-${direction}-fresh-review-authorized`, { authority: finalAuthority, trace: finalTrace });
        } finally {
          await page.evaluate(() => {
            const state = window.__r20SessionGuard;
            if (!state) return;
            state.api.query = state.originalQuery;
            state.api.command = state.originalCommand;
            state.pending?.resolve();
          });
        }
      });
    } finally {
      page = originalPage;
      await context.close();
    }
  }
}


// Run after the unified source freeze with TMPDIR=/var/tmp/wankapai-browser-r21.
async function runR21MineCountsRegressions() {
  const originalPage = page;
  async function freshCase(name, action) {
    const context = await originalPage.context().browser().newContext({
      viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
    });
    try {
      page = await context.newPage(); page.setDefaultTimeout(10000);
      if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
      await check(name, async () => {
        await page.goto(new URL(originalPage.url()).origin, { waitUntil: 'load' });
        await page.waitForFunction(() => window.Prototype?.ready && window.Prototype.current?.data);
        await settled();
        // One real setup mutation creates a meaningful prior badge; interaction writes are traced separately.
        const submission = await page.evaluate(() => window.Prototype.api.command('submission.lead.save', {
          lead: { title: '账号与投稿状态分离验收线索', bankId: 'cmb', sourceUrl: '', sourceNote: '仅用于演示状态验收，尚未审核公开。', imageIds: [] },
        }));
        await page.locator('#native-tabs button').filter({ hasText: /^我的$/ }).click();
        await waitUntil(async () => page.evaluate(() => window.Prototype.current.route === 'pages/mine/index'
          && !window.Prototype.current.data.loading && !window.Prototype.current.data.countsLoading
          && window.Prototype.current.data.countsReady), 'The Mine setup counts did not become ready');
        await settled();
        assert.equal((await data()).pendingCount, 1);
        assert.ok((await native('[data-handler="openSubmissions"] .menu-description').innerText()).includes('有投稿等待审核'));
        try { await action(submission); }
        finally {
          await page.evaluate(() => {
            const state = window.__r21MineCounts;
            if (!state) return;
            state.api.query = state.originalQuery;
            state.api.command = state.originalCommand;
            state.pending?.resolve(state.pending.result);
          });
        }
      });
    } finally {
      page = originalPage;
      await context.close();
    }
  }
  async function chooseRole(moderator) {
    await native('.demo-heading select.prototype-picker-control').selectOption(moderator ? '1' : '0');
    await waitUntil(async () => {
      const state = await data();
      return !state.loading && !state.countsLoading && !state.changingRole && state.session?.isModerator === moderator;
    }, 'The source role selection did not finish');
    await settled();
  }
  async function installGate(mode, status) {
    await page.evaluate(({ mode, status }) => {
      const api = window.Prototype.api;
      const state = window.__r21MineCounts = { api, originalQuery: api.query, originalCommand: api.command, mode, status, held: false, pending: null, queries: [], commands: [] };
      api.query = async function (...args) {
        const [action, payload] = args;
        const call = { action, payload, route: window.Prototype.current.route };
        state.queries.push(call);
        const result = await state.originalQuery.apply(api, args);
        call.realResult = action === 'session.get' ? JSON.parse(JSON.stringify(result)) : result?.items ? { itemIds: result.items.map(item => item.id) } : undefined;
        const matches = mode === 'session' ? action === 'session.get'
          : action === 'submissions.list' && payload.status === status && payload.limit === 1;
        if (!state.held && matches) {
          state.held = true; call.held = true;
          return new Promise((resolve, reject) => { state.pending = { result, resolve, reject }; });
        }
        return result;
      };
      api.command = async function (...args) {
        state.commands.push({ action: args[0], payload: args[1] });
        return state.originalCommand.apply(api, args);
      };
    }, { mode, status });
  }
  async function failHeldRead(message) {
    await page.evaluate(message => {
      const state = window.__r21MineCounts;
      const error = new Error(message); error.code = 'NETWORK_ERROR';
      state.pending.reject(error);
    }, message);
    await waitUntil(async () => {
      const state = await data();
      return !state.loading && !state.countsLoading && !state.changingRole;
    }, 'The source page did not leave its failed read state');
    await settled();
  }
  async function snapshot() {
    return page.evaluate(async () => {
      const state = window.__r21MineCounts, owner = window.Prototype.current;
      return {
        route: owner.route, instance: owner._instanceId, hash: location.hash,
        realSession: await state.originalQuery.call(state.api, 'session.get', {}),
        session: owner.data.session, loading: owner.data.loading, changingRole: owner.data.changingRole,
        error: owner.data.error, countsLoading: owner.data.countsLoading, countsReady: owner.data.countsReady,
        countsError: owner.data.countsError, pendingCount: owner.data.pendingCount, returnedCount: owner.data.returnedCount,
        pickerValue: window.Prototype.shadow.querySelector('.demo-heading select')?.value,
        pickerCount: window.Prototype.shadow.querySelectorAll('.demo-heading select').length,
        reviewMenuCount: window.Prototype.shadow.querySelectorAll('[data-handler="openReview"]').length,
        submissionDescription: window.Prototype.shadow.querySelector('[data-handler="openSubmissions"] .menu-description')?.textContent,
        queries: state.queries, interactionCommands: state.commands,
      };
    });
  }
  async function assertCommonControlsAvailable() {
    for (const handler of ['openHistory', 'openSubmissions', 'openSubmission', 'openPreferences', 'showPrivacy']) {
      const control = native(`[data-handler="${handler}"]`);
      assert.equal(await control.count(), 1, `The common ${handler} action disappeared during an unrelated read`);
      assert.equal(await control.isEnabled(), true);
    }
  }
  async function authority() {
    return page.evaluate(async () => {
      const state = window.__r21MineCounts;
      try { const result = await state.originalQuery.call(state.api, 'submissions.list', { moderation: true, status: 'pending', limit: 20 }); return { allowed: true, count: result.items.length }; }
      catch (error) { return { allowed: false, code: error.code }; }
    });
  }

  for (const oldModerator of [false, true]) {
    const newModerator = !oldModerator, status = oldModerator ? 'returned' : 'pending';
    const direction = oldModerator ? 'moderator-to-user' : 'user-to-moderator';
    await freshCase(`Mine keeps the new ${newModerator ? 'moderator' : 'ordinary-user'} role when ${status} submission counts fail`, async submission => {
      if (oldModerator) await chooseRole(true);
      await installGate('counts', status);
      const before = await snapshot();
      assert.equal(before.session.isModerator, oldModerator); assert.equal(before.pendingCount, 1);
      await native('.demo-heading select.prototype-picker-control').selectOption(newModerator ? '1' : '0');
      await waitUntil(async () => page.evaluate(() => !!window.__r21MineCounts.pending
        && window.Prototype.current.data.countsLoading && !window.Prototype.current.data.loading), 'The count read was not held after successful session binding');
      const loading = await snapshot();
      assert.equal(loading.session.isModerator, newModerator);
      assert.equal(loading.realSession.isModerator, newModerator);
      assert.equal(loading.reviewMenuCount, newModerator ? 1 : 0);
      assert.equal(loading.pickerValue, newModerator ? '1' : '0');
      assert.equal(loading.countsReady, false); assert.equal(loading.pendingCount, 0); assert.equal(loading.returnedCount, 0);
      assert.equal(loading.submissionDescription, '正在更新投稿状态…');
      await assertCommonControlsAvailable();
      await capture(`r21-mine-${direction}-role-bound-before-counts`, loading);
      await failHeldRead('投稿统计读取失败，请重试。');
      const failed = await snapshot();
      assert.equal(failed.session.isModerator, newModerator); assert.equal(failed.realSession.isModerator, newModerator);
      assert.equal(failed.reviewMenuCount, newModerator ? 1 : 0); assert.equal(failed.pickerValue, newModerator ? '1' : '0');
      assert.equal(failed.error, ''); assert.ok(failed.countsError.includes('投稿状态暂时无法读取'));
      assert.equal(failed.countsReady, false); assert.equal(failed.pendingCount, 0); assert.equal(failed.returnedCount, 0);
      assert.equal(failed.submissionDescription, '查看投稿与审核结果', 'A failed counter still advertises the prior pending badge');
      assert.equal((await authority()).allowed, newModerator);
      await assertCommonControlsAvailable();
      assert.deepEqual(failed.interactionCommands, []);
      await capture(`r21-mine-${direction}-counts-error-keeps-new-role`, failed);
      await native('.feedback.error button[data-handler="load"]').filter({ hasText: '重试投稿状态' }).click();
      await waitUntil(async () => {
        const state = await data();
        return !state.loading && !state.countsLoading && state.countsReady && !state.countsError;
      }, 'The source count retry did not restore the real pending badge');
      await settled();
      const retried = await snapshot();
      assert.equal(retried.session.isModerator, newModerator); assert.equal(retried.pendingCount, 1);
      assert.ok(retried.submissionDescription.includes('有投稿等待审核'));
      assert.deepEqual(retried.interactionCommands, []);
      await capture(`r21-mine-${direction}-counts-retry-restores-badge`, { ...retried, setupSubmissionId: submission.id });
      await native('[data-handler="openSubmissions"]').click();
      await waitUntil(async () => page.evaluate(() => window.Prototype.current.route === 'pages/submissions/index' && !window.Prototype.current.data.loading), 'The ordinary submission navigation stopped working after counter recovery');
      assert.ok((await data()).items.some(item => item.id === submission.id), 'The real setup submission was lost');
    });
  }

  await freshCase('Mine clears unverified role controls after a real session failure while common actions and account retry remain usable', async submission => {
    await chooseRole(true);
    await installGate('session');
    const before = await snapshot();
    assert.equal(before.session.isModerator, true); assert.equal(before.reviewMenuCount, 1);
    await native('.demo-heading select.prototype-picker-control').selectOption('0');
    await waitUntil(async () => page.evaluate(() => !!window.__r21MineCounts.pending && window.Prototype.current.data.loading), 'The new ordinary-user session read was not held');
    const loading = await snapshot();
    assert.equal(loading.realSession.isModerator, false);
    assert.equal(loading.session, null); assert.equal(loading.reviewMenuCount, 0); assert.equal(loading.pickerCount, 0);
    await assertCommonControlsAvailable();
    await failHeldRead('账号读取网络失败，请重试。');
    const failed = await snapshot();
    assert.equal(failed.realSession.isModerator, false); assert.equal(failed.session, null);
    assert.equal(failed.reviewMenuCount, 0); assert.equal(failed.pickerCount, 0);
    assert.ok(failed.error.includes('账号信息暂时无法确认'));
    assert.equal(failed.countsLoading, false); assert.equal(failed.countsReady, false); assert.equal(failed.countsError, '');
    assert.equal(failed.submissionDescription, '查看投稿与审核结果');
    assert.equal(failed.queries.filter(item => item.action === 'submissions.list').length, 0, 'Count reads started before the session was confirmed');
    assert.deepEqual(failed.interactionCommands, []);
    await assertCommonControlsAvailable();
    await capture('r21-mine-session-failure-hides-unverified-role', failed);
    await native('[data-handler="showPrivacy"]').click();
    await page.locator('#platform-layer [role="dialog"][aria-label="你的数据如何使用"]').waitFor({ state: 'visible' });
    await page.locator('#platform-layer button').filter({ hasText: '知道了' }).click();
    await native('.feedback.error button[data-handler="load"]').filter({ hasText: '重新读取账号' }).click();
    await waitUntil(async () => {
      const state = await data();
      return !state.loading && !state.countsLoading && !state.changingRole && state.session?.isModerator === false && state.countsReady;
    }, 'The source account retry did not recover the ordinary-user session and counts');
    await settled();
    const retried = await snapshot();
    assert.equal(retried.error, ''); assert.equal(retried.countsError, ''); assert.equal(retried.pendingCount, 1);
    assert.equal(retried.reviewMenuCount, 0); assert.equal(retried.pickerValue, '0');
    assert.deepEqual(retried.interactionCommands, []);
    const permission = await authority(); assert.equal(permission.allowed, false); assert.equal(permission.code, 'FORBIDDEN');
    await capture('r21-mine-account-retry-recovers-ordinary-session', { ...retried, permission, setupSubmissionId: submission.id });
    await native('[data-handler="openHistory"]').click();
    await waitUntil(async () => page.evaluate(() => window.Prototype.current.route === 'pages/history/index' && !window.Prototype.current.data.loading), 'Common history navigation was blocked after account recovery');
  });
}


// Run after the unified source freeze with TMPDIR=/var/tmp/wankapai-browser-r21.
async function runR21PaginationFeedbackRegression() {
  const originalPage = page;
  const context = await originalPage.context().browser().newContext({
    viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1,
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
  });
  try {
    page = await context.newPage(); page.setDefaultTimeout(10000);
    if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
    await check('A retired pagination lead response cannot overwrite feedback owned by the newer review scenario', async () => {
      await page.goto(new URL(originalPage.url()).origin, { waitUntil: 'load' });
      await page.waitForFunction(() => window.Prototype?.ready && window.Prototype.current?.data);
      await settled();
      assert.equal(await page.evaluate(async () => (await window.Prototype.api.query('session.get', {})).isModerator), false);
      await page.evaluate(() => {
        const api = window.Prototype.api;
        const state = window.__r21PaginationFeedbackGuard = { api, originalCommand: api.command, held: false, commands: [], pending: null };
        api.command = async function (...args) {
          const [action, payload] = args;
          const call = { action, payload };
          state.commands.push(call);
          const result = await state.originalCommand.apply(api, args);
          call.result = result;
          if (!state.held && action === 'submission.lead.save' && payload.lead?.title === '分页演示线索 01') {
            state.held = true;
            state.lead = await api.query('submission.get', { id: result.id });
            return new Promise(resolve => { state.pending = { result, resolve }; });
          }
          return result;
        };
      });
      const snapshot = () => page.evaluate(async () => {
        const state = window.__r21PaginationFeedbackGuard;
        return {
          route: window.Prototype.current.route, instance: window.Prototype.current._instanceId,
          options: window.Prototype.current.options, hash: location.hash,
          stack: getCurrentPages().map(item => ({ route: item.route, instance: item._instanceId })),
          session: await window.Prototype.api.query('session.get', {}),
          serializedPage: JSON.stringify(window.Prototype.current.data),
          feedback: document.getElementById('scenario-feedback').textContent,
          paginationComplete: wx.getStorageSync('scenario.pagination.v1') === true,
          commands: state.commands,
        };
      });
      try {
        await page.locator('.scenario-button[data-scenario="pagination"]').click();
        await waitUntil(async () => page.evaluate(() => !!window.__r21PaginationFeedbackGuard.pending), 'The first pagination lead response was not held after its actual commit');
        const lead = await page.evaluate(() => window.__r21PaginationFeedbackGuard.lead);
        const committed = await snapshot();
        assert.equal(lead.status, 'pending');
        assert.deepEqual(committed.commands.map(item => item.action), ['submission.save', 'submission.review', 'activity.join', 'reward.confirm', 'submission.lead.save']);
        assert.ok(committed.commands.every(item => item.result?.id));
        assert.equal(committed.paginationComplete, false);
        const persistedBefore = await page.evaluate(async leadId => {
          const state = window.__r21PaginationFeedbackGuard;
          const activityId = state.commands.find(item => item.action === 'submission.review').result.id;
          return {
            lead: await state.api.query('submission.get', { id: leadId }),
            detail: await state.api.query('activity.get', { activityId }),
          };
        }, lead.id);
        await page.locator('.scenario-button[data-scenario="review"]').click();
        await waitUntil(async () => page.evaluate(() => window.Prototype.current.route === 'pages/review/index'
          && !window.Prototype.current.data.loading && window.Prototype.current.data.sessionVerified
          && !window.Prototype.current.data.denied && !document.querySelector('.scenario-button[data-scenario="review"]').disabled), 'The newer Review scenario did not finish its own preparation');
        await settled();
        const newer = await snapshot();
        assert.equal(newer.session.isModerator, true);
        assert.ok((await data()).items.some(item => item.id === lead.id));
        assert.ok(newer.feedback.includes('已切换为演示运营身份'));
        assert.equal(newer.commands.length, 5, 'The existing pending lead should make new review seeding unnecessary');
        await capture('r21-new-review-feedback-before-old-lead-response', { feedback: newer.feedback, committedLeadId: lead.id });
        await page.evaluate(async () => {
          const state = window.__r21PaginationFeedbackGuard;
          state.pending.resolve(state.pending.result);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        await waitUntil(async () => !(await page.locator('.scenario-button[data-scenario="pagination"]').isDisabled()), 'The abandoned pagination operation did not finish cleanup');
        await settled();
        const after = await snapshot();
        assert.deepEqual(after, newer, 'The retired lead response changed newer feedback, current page, role, or persisted-command trace');
        assert.equal(after.paginationComplete, false);
        assert.equal(after.commands.length, 5, 'The retired pagination operation continued writing');
        const persistedAfter = await page.evaluate(async leadId => {
          const state = window.__r21PaginationFeedbackGuard;
          const activityId = state.commands.find(item => item.action === 'submission.review').result.id;
          return {
            lead: await state.api.query('submission.get', { id: leadId }),
            detail: await state.api.query('activity.get', { activityId }),
          };
        }, lead.id);
        assert.deepEqual(persistedAfter, persistedBefore, 'Cancellation changed already committed pagination records');
        assert.equal(persistedAfter.lead.status, 'pending');
        assert.equal(persistedAfter.detail.activity.status, 'published');
        assert.equal(persistedAfter.detail.participation.stage, 'received');
        assert.equal(persistedAfter.detail.participation.receivedMinor, 100);
        await capture('r21-new-review-feedback-survives-retired-pagination', { feedback: after.feedback, commands: after.commands.map(item => item.action), committedLeadId: lead.id });
      } finally {
        await page.evaluate(() => {
          const state = window.__r21PaginationFeedbackGuard;
          if (!state) return;
          state.api.command = state.originalCommand;
          state.pending?.resolve(state.pending.result);
        });
      }
    });
  } finally {
    page = originalPage;
    await context.close();
  }
}


async function runR21DetailReminderDemoRegression() {
  await check('Demo deadline and reward reminder entries retain an explanatory dialog without preference writes or subscription calls', async () => {
    await reset();
    const fixture = await page.evaluate(async () => {
      const api = window.Prototype.api;
      const session = await api.query('session.get', {});
      const current = await api.query('activity.get', { activityId: 'monthly' });
      const history = await api.query('history.list', { activityId: 'monthly', filter: 'pending' });
      const prior = history.items.find(record => record.stage === 'completed' && record.expectedOn && record.ownerId === session.userId);
      return { session, deadline: current.participation, reward: prior };
    });
    assert.equal(fixture.session.demo, true, 'This case verifies the actual demo branch only');
    assert.ok(fixture.deadline && fixture.reward, 'The demo fixture must expose both reminder kinds');
    const evidence = [];
    for (const kind of ['deadline', 'reward']) {
      const record = fixture[kind];
      await openPage(`pages/detail/index?participationId=${encodeURIComponent(record.id)}`);
      const before = await page.evaluate(() => structuredClone(wx.getStorageSync('card-benefits.native.demo.v1')));
      await page.evaluate(() => {
        const api = window.Prototype.api;
        const state = window.__r21DemoReminderProbe = {
          api, query: api.query, command: api.command,
          subscribe: wx.requestSubscribeMessage, nativeCalls: [], queries: [], commands: [],
        };
        api.query = async function (...args) { state.queries.push(structuredClone(args)); return state.query.apply(this, args); };
        api.command = async function (...args) { state.commands.push(structuredClone(args)); return state.command.apply(this, args); };
        wx.requestSubscribeMessage = options => { state.nativeCalls.push({ tmplIds: options.tmplIds }); throw new Error('Demo reminders must not invoke native subscription authorization'); };
      });
      try {
        await native('.reminder-link').filter({ hasText: kind === 'deadline' ? '开启本期截止提醒' : '开启预计到账提醒' }).click();
        await page.locator('#platform-layer h2').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#platform-layer h2').textContent(), '演示提醒');
        const dialogText = await page.locator('#platform-layer').innerText();
        assert.ok(dialogText.includes('演示模式不发送微信消息'), 'Demo mode must explain its notification boundary');
        assert.ok(dialogText.includes('配置正式模板'), 'The explanation must preserve the real configuration dependency');
        await capture(`r21-demo-${kind}-reminder-explanation`, { reminderKind: kind, participationId: record.id,
          evidenceScope: 'Browser demo branch only; cloud preference gating is covered by the separate source/native-callback harness.' });
        await page.locator('#platform-layer button').filter({ hasText: '知道了' }).click();
        await settled();
        const result = await page.evaluate(() => ({
          nativeCalls: window.__r21DemoReminderProbe.nativeCalls,
          queries: window.__r21DemoReminderProbe.queries,
          commands: window.__r21DemoReminderProbe.commands,
          seed: wx.getStorageSync('card-benefits.native.demo.v1'),
          busy: window.Prototype.current.data.busy,
          reminderChecking: window.Prototype.current.data.reminderChecking,
          reminderReady: window.Prototype.current.data.reminderReady,
          reminderError: window.Prototype.current.data.reminderError,
        }));
        assert.deepEqual(result.nativeCalls, []);
        assert.deepEqual(result.commands, [], 'The demo reminder must not write a grant or global preference');
        assert.equal(result.queries.some(query => query[0] === 'preferences.get'), false, 'The real demo explanation must not be blocked by cloud preference gating');
        assert.deepEqual(result.seed, before);
        assert.equal(result.busy, false);
        assert.equal(result.reminderChecking, false);
        assert.equal(result.reminderReady, false, 'The demo explanation must not prepare a real authorization step');
        assert.equal(result.reminderError, '');
        evidence.push({ kind, dialogText, queries: result.queries, nativeCalls: result.nativeCalls, commands: result.commands });
      } finally {
        await page.evaluate(() => {
          const state = window.__r21DemoReminderProbe;
          if (!state) return;
          state.api.query = state.query;
          state.api.command = state.command;
          if (state.subscribe === undefined) delete wx.requestSubscribeMessage;
          else wx.requestSubscribeMessage = state.subscribe;
          delete window.__r21DemoReminderProbe;
        });
      }
    }
    currentCase.measurements.demoReminderBoundary = evidence;
  });
}


// Run after the unified source freeze with TMPDIR=/var/tmp/wankapai-browser-r22.
async function runR22ConcurrentFeedbackRegression() {
  const originalPage = page;
  const context = await originalPage.context().browser().newContext({
    viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1,
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce',
  });
  try {
    page = await context.newPage(); page.setDefaultTimeout(10000);
    if (typeof attachDiagnostics === 'function') attachDiagnostics(page);
    await check('A retired concurrent simulation stays silent while a current simulation still preserves input and exposes a real version conflict', async () => {
      await page.goto(new URL(originalPage.url()).origin, { waitUntil: 'load' });
      await page.waitForFunction(() => window.Prototype?.ready && window.Prototype.current?.data);
      await settled();
      async function openDirtyProgress() {
        await page.locator('.scenario-button[data-scenario="progress"]').click();
        await waitUntil(async () => page.evaluate(() => window.Prototype.current.route === 'pages/progress/index' && !window.Prototype.current.data.loading), 'The real progress scenario did not load');
        await settled();
        await native('#progress').fill('3');
        await waitUntil(async () => page.evaluate(() => window.Prototype.current.data.progressInput === '3'
          && window.Prototype.current.data.dirty && !!window.Prototype.current._leaveMessage), 'The source progress editor did not retain the changed input');
      }
      async function installTrace(hold) {
        await page.evaluate(hold => {
          const api = window.Prototype.api;
          const state = window.__r22ConcurrentGuard = {
            api, originalCommand: api.command, owner: window.Prototype.current,
            participationId: window.Prototype.current.data.participation.id,
            hold, held: false, returned: false, commands: [], pending: null,
          };
          api.command = async function (...args) {
            const [action, payload] = args;
            const call = { action, payload };
            state.commands.push(call);
            try {
              const result = await state.originalCommand.apply(api, args);
              call.result = result;
              if (hold && !state.held && action === 'participation.progress' && payload.participationId === state.participationId) {
                state.held = true;
                state.committedParticipation = (await api.query('activity.get', { participationId: state.participationId })).participation;
                await new Promise(resolve => { state.pending = { resolve }; });
                state.returned = true;
              }
              return result;
            } catch (error) {
              call.error = { code: error.code, message: error.message };
              throw error;
            }
          };
        }, hold);
      }
      async function restoreTrace() {
        await page.evaluate(() => {
          const state = window.__r22ConcurrentGuard;
          if (!state) return;
          state.api.command = state.originalCommand;
          state.pending?.resolve();
        });
      }
      const snapshot = () => page.evaluate(async () => {
        const state = window.__r22ConcurrentGuard;
        return {
          route: window.Prototype.current.route, instance: window.Prototype.current._instanceId,
          hash: location.hash, options: window.Prototype.current.options,
          stack: getCurrentPages().map(item => ({ route: item.route, instance: item._instanceId })),
          session: await window.Prototype.api.query('session.get', {}),
          serializedPage: JSON.stringify(window.Prototype.current.data),
          feedback: document.getElementById('scenario-feedback').textContent,
          commands: state.commands,
          oldEditor: { instance: state.owner._instanceId, route: state.owner.route, disposed: state.owner.disposed,
            progressInput: state.owner.data.progressInput, registered: state.owner.data.registered,
            dirty: state.owner.data.dirty, leaveMessage: state.owner._leaveMessage },
        };
      });
      try {
        await openDirtyProgress();
        await installTrace(true);
        await page.locator('#conflict-record').click();
        await waitUntil(async () => page.evaluate(() => !!window.__r22ConcurrentGuard.pending), 'The real concurrent command did not commit before its response was held');
        const committed = await page.evaluate(() => window.__r22ConcurrentGuard.committedParticipation);
        assert.equal(committed.progress, 2, 'The concurrent fixture should preserve the stored progress while incrementing its version');
        await page.locator('.scenario-button[data-scenario="review"]').click();
        await page.locator('#platform-layer [role="dialog"][aria-label="离开当前页面？"]').waitFor({ state: 'visible' });
        await page.locator('#platform-layer button').filter({ hasText: /^离开$/ }).click();
        await waitUntil(async () => page.evaluate(() => window.Prototype.current.route === 'pages/review/index'
          && !window.Prototype.current.data.loading && window.Prototype.current.data.sessionVerified
          && !window.Prototype.current.data.denied && !document.querySelector('.scenario-button[data-scenario="review"]').disabled), 'The newer review scenario did not finish');
        await settled();
        const newer = await snapshot();
        assert.ok(newer.feedback.includes('已切换为演示运营身份'));
        assert.equal(newer.session.isModerator, true);
        assert.equal(newer.oldEditor.progressInput, '3'); assert.equal(newer.oldEditor.dirty, true);
        assert.deepEqual(newer.commands.map(item => item.action), ['participation.progress', 'submission.lead.save', 'submission.save']);
        await capture('r22-new-review-feedback-before-old-concurrent-response', { feedback: newer.feedback, commands: newer.commands.map(item => item.action) });
        await page.evaluate(async () => {
          window.__r22ConcurrentGuard.pending.resolve();
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        await waitUntil(async () => page.evaluate(() => window.__r22ConcurrentGuard.returned), 'The old concurrent response was not delivered');
        await settled();
        const after = await snapshot();
        assert.deepEqual(after, newer, 'The retired simulation changed newer feedback, page state, authorization, retained input, or command trace');
        const persisted = await page.evaluate(async () => {
          const state = window.__r22ConcurrentGuard;
          return (await state.api.query('activity.get', { participationId: state.participationId })).participation;
        });
        assert.deepEqual(persisted, committed, 'Retiring the workbench message changed its already committed record');
        await capture('r22-new-review-feedback-survives-old-concurrent-response', { feedback: after.feedback, retainedProgressInput: after.oldEditor.progressInput, committedVersion: persisted.version });
      } finally { await restoreTrace(); }

      // Reset is test setup for an independent positive control, not a user action under test.
      await page.evaluate(() => window.Prototype.resetFixture());
      await settled();
      try {
        await openDirtyProgress();
        const instance = await page.evaluate(() => window.Prototype.current._instanceId);
        const initialRecord = (await data()).participation;
        await installTrace(false);
        await page.locator('#conflict-record').click();
        await waitUntil(async () => page.evaluate(() => document.getElementById('scenario-feedback').textContent.includes('已通过同一业务服务模拟另一端更新')), 'A valid current-owner concurrent simulation lost its normal feedback');
        await settled();
        assert.equal(await page.evaluate(() => window.Prototype.current._instanceId), instance);
        assert.equal((await data()).progressInput, '3'); assert.equal((await data()).dirty, true);
        assert.ok(await page.evaluate(() => window.Prototype.current._leaveMessage));
        const simulated = await page.evaluate(async () => {
          const state = window.__r22ConcurrentGuard;
          return (await state.api.query('activity.get', { participationId: state.participationId })).participation;
        });
        assert.equal(simulated.progress, initialRecord.progress);
        assert.ok(simulated.version > initialRecord.version, 'The positive control did not commit a real concurrent version');
        await capture('r22-current-concurrent-feedback-preserves-dirty-input', { feedback: await page.locator('#scenario-feedback').innerText(), priorVersion: initialRecord.version, currentVersion: simulated.version });
        await native('.entry-primary[data-handler="save"]').click();
        await waitUntil(async () => (await data()).conflict && !(await data()).busy, 'Saving the retained draft did not expose the real version conflict');
        await settled();
        assert.equal((await data()).progressInput, '3'); assert.equal((await data()).dirty, true);
        assert.ok((await native('#record-conflict').innerText()).includes('你的输入仍然保留'));
        const final = await page.evaluate(async () => {
          const state = window.__r22ConcurrentGuard;
          return { commands: state.commands, participation: (await state.api.query('activity.get', { participationId: state.participationId })).participation };
        });
        assert.equal(final.commands.length, 2);
        assert.ok(final.commands[0].result?.id);
        assert.equal(final.commands[1].error?.code, 'VERSION_CONFLICT');
        assert.deepEqual(final.participation, simulated, 'The stale draft overwrote the already committed concurrent record');
        await capture('r22-current-concurrent-control-version-conflict', { commands: final.commands, retainedInput: (await data()).progressInput });
      } finally { await restoreTrace(); }
    });
  } finally {
    page = originalPage;
    await context.close();
  }
}


async function contactSheets() {
  for (const size of sizes) {
    const galleryPage = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 });
    try {
      const shots = report.screenshots.filter(item => item.matrix && item.size === size.name);
      const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;padding:22px;background:#e9eef5;font:13px/1.5 system-ui,sans-serif;color:#20334a}h1{font-size:23px;margin:0 0 5px}p{margin:0 0 18px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:17px}figure{margin:0;background:white;padding:10px;border-radius:8px}img{display:block;width:100%;height:auto;box-shadow:0 0 0 1px #c6d2df}figcaption{padding:8px 0 0;font-weight:600;overflow-wrap:anywhere}</style><h1>完整页面原型 · ${escapeHtml(size.name.replace('-landscape', ' 横屏'))}</h1><p>使用演示数据的浏览器预览；不代表微信真机或云端验收。</p><div class="grid">${shots.map(item => `<figure><img src="${baseUrl}/evidence/${item.file}"><figcaption>${escapeHtml(item.route)}</figcaption></figure>`).join('')}</div></html>`;
      await galleryPage.setContent(html);
      await galleryPage.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
      await galleryPage.screenshot({ path: path.join(output, `contact-sheet-${size.name}.png`), fullPage: true });
    } finally { await galleryPage.close(); }
  }
}
async function saveReport() {
  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.cases.filter(item => item.status === 'passed').length,
    failed: report.cases.filter(item => item.status === 'failed').length,
    screenshots: report.screenshots.length,
    runtimeExceptions: report.exceptions.length,
    sourceHandlersExercised: exercisedHandlers.size,
  };
  report.exercisedHandlers = [...exercisedHandlers].sort();
  report.status = report.fatal || !report.cases.length || report.summary.failed || report.summary.runtimeExceptions ? 'failed' : 'passed';
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>交互原型验收报告</title>
<style>body{max-width:1200px;margin:32px auto;padding:0 20px;font:15px/1.6 system-ui,sans-serif;color:#1c334c;background:#f3f6fa}table{border-collapse:collapse;width:100%;background:white}td,th{padding:10px;text-align:left;border:1px solid #d8e2ee}.passed{color:#087047}.failed{color:#ab2733}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px}figure{margin:0}img{width:100%;border:1px solid #c4d1e0}pre{white-space:pre-wrap;overflow-wrap:anywhere}code{overflow-wrap:anywhere}</style>
<h1>交互原型验收报告</h1><p>${escapeHtml(report.startedAt)} · ${report.summary.passed} 项通过 · ${report.summary.failed} 项未通过 · ${report.summary.runtimeExceptions} 个运行时异常</p>
<p>通过远程 Chromium 检查原生 WXML、WXSS、页面控制器和演示业务服务生成的交互原型。</p><ul>${displayLimits.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
${report.sourceProvenance ? `<h2>验收版本</h2><p>原型 SHA-256：<code>${escapeHtml(report.prototypeSha256)}</code></p><p>源码指纹：<code>${escapeHtml(report.sourceProvenance.sha256)}</code>，共 ${report.sourceProvenance.fileCount} 个文件。验收期间源码与原型${report.sourceProvenance.unchangedDuringRun ? '保持一致' : '尚未确认一致'}。</p><p><a href="interactive-prototype.html">打开本次交互原型</a> · <a href="coverage.json">来源页面与操作覆盖</a> · <a href="source-manifest.sha256">逐文件校验清单</a> · <a href="source-fingerprint.txt">源码指纹文件</a></p>` : ''}
${report.fatal ? `<pre class="failed">${escapeHtml(report.fatal)}</pre>` : ''}
<h2>验收结果</h2><table><thead><tr><th>用例</th><th>结果</th><th>详情</th></tr></thead><tbody>${report.cases.map(item => `<tr><td>${escapeHtml(item.name)}</td><td class="${item.status}">${item.status === 'passed' ? '通过' : '未通过'}</td><td>${escapeHtml(item.error || '')}</td></tr>`).join('')}</tbody></table>
<h2>不同尺寸的完整页面图</h2><div class="gallery">${sizes.map(size => `<figure><a href="contact-sheet-${size.name}.png"><img src="contact-sheet-${size.name}.png"></a><figcaption>${size.name.replace('-landscape', ' 横屏')}</figcaption></figure>`).join('')}</div>
<h2>交互工作台</h2><a href="workbench-overview.png"><img src="workbench-overview.png" alt="完整原型工作台概览"></a>
<h2>操作与反馈截图</h2><div class="gallery">${report.screenshots.filter(item => !item.matrix).map(item => `<figure><a href="${item.file}"><img src="${item.file}"></a><figcaption>${escapeHtml(item.name)}</figcaption></figure>`).join('')}</div>`);
  await mkdir(path.join(root, '.qa-native', 'prototype'), { recursive: true });
  await writeFile(path.join(root, '.qa-native', 'prototype', 'latest.json'), JSON.stringify({ output, report: path.join(output, 'report.json'), html: path.join(output, 'index.html') }, null, 2) + '\n');
  console.log(`REPORT ${path.join(output, 'index.html')}`);
  console.log(`RESULT ${JSON.stringify(report.summary)}`);
}

await mkdir(path.join(output, 'screenshots'), { recursive: true });
try {
  assert.equal(process.platform, 'linux', 'Run prototype acceptance only on the designated remote Linux test environment.');
  const coverageContent = await readFile(path.join(prototypeRoot, 'coverage.json'), 'utf8');
  const coverage = JSON.parse(coverageContent);
  const prototypeContent = await readFile(path.join(prototypeRoot, 'index.html'));
  report.prototypeSha256 = createHash('sha256').update(prototypeContent).digest('hex');
  await writeFile(path.join(output, 'interactive-prototype.html'), prototypeContent);
  await writeFile(path.join(output, 'coverage.json'), coverageContent, 'utf8');
  const initialSource = await sourceSnapshot();
  report.sourceProvenance = { sha256: initialSource.sha256, fileCount: initialSource.fileCount,
    directories: fingerprintDirectories, files: fingerprintFiles,
    excludedDirectories: [...fingerprintExcludedDirectories], unchangedDuringRun: false };
  await writeFile(path.join(output, 'source-manifest.sha256'), initialSource.manifest, 'utf8');
  await writeFile(path.join(output, 'source-fingerprint.txt'), initialSource.sha256 + '\n', 'utf8');
  const routes = Object.keys(coverage.pages);
  assert.equal(routes.length, 19, 'The prototype must cover all 19 source routes');
  const sourceUnits = [...Object.values(coverage.pages), ...Object.values(coverage.components || {})];
  report.coverage = { routes, components: Object.keys(coverage.components || {}),
    sourceBindings: sourceUnits.reduce((count, value) => count + value.actions.length, 0),
    uniqueSourceHandlers: sourceUnits.reduce((count, value) => count + new Set(value.actions.map(action => action.handler)).size, 0) };
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const directory = pathname.startsWith('/evidence/') ? output : prototypeRoot;
      const relative = pathname.startsWith('/evidence/') ? pathname.slice('/evidence/'.length) : pathname.slice(1) || 'index.html';
      const target = path.resolve(directory, relative);
      assert.ok(target.startsWith(directory + path.sep), 'Path must remain inside the artifact directory');
      const content = await readFile(target);
      response.writeHead(200, { 'content-type': target.endsWith('.png') ? 'image/png' : target.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8' });
      response.end(content);
    } catch {
      report.httpErrors.push({ case: currentCase?.name, source: 'acceptance-server', url: new URL(request.url, baseUrl).href, status: 404 });
      response.writeHead(404); response.end('Not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: browserArgs, executablePath: process.env.PROTOTYPE_CHROMIUM_PATH || undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  attachDiagnostics(page);
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Prototype?.current?.data);
  await settled();
  await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{max-width:none!important;min-height:0!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
  report.environment = { platform: process.platform, node: process.version, browser: await browser.version(), browserArgs, origin: baseUrl, sizes };
  await allRoutesMatrix(routes);
  await runInteractions();
  await runR5Regressions();
  await runDepartureRegressions();
  await runR6Regressions();
  await runR7ImageRegressions();
  await runR7InteractionRegressions();
  await runR7LocatorRegression();
  await runR8CardRegressions();
  await runR8StorageRegressions();
  await runR8LeadTransferRegression();
  await runR8GalleryRegressions();
  await runR9RetryIntentRegressions();
  await runR9PreviewCancellationRegressions();
  await runR9CardIntentRegression();
  await runR10CardDateRegressions();
  await runR10FullPendingDateRegression();
  await runR10SheetInterruptionRegression();
  await runR11PreferencesRegressions();
  await runR11MonthStartRegressions();
  await runR11DeepLinkRegressions();
  await runR11ArchivedBillRegression();
  await runR12LegacyCardRegressions();
  await runR12ReceiptRegressions();
  await runR13BusyNavigationRegression();
  await runR13WorkbenchEntryBoundaryRegressions();
  await runR13ReceiptScopeRegressions();
  await runR13PaginationRoleRegression();
  await runR14ReviewRoleRegressions();
  await runR14ReceiptDateRegressions();
  await runR14LongSheetRegressions();
  await runR14CardDraftRegressions();
  await runR15SwitchLabelRegressions();
  await runR15ReceiptMidnightRegressions();
  await runR16DetailWarningRegressions();
  await runR16ImeRegressions();
  await runR17CardBillingRebaseRegressions();
  await runR18ReceiptSaveDateRegressions();
  await runR19UrlEncodingRegressions();
  await runR20SessionRoleCacheRegressions();
  await runR21MineCountsRegressions();
  await runR21PaginationFeedbackRegression();
  await runR21DetailReminderDemoRegression();
  await runR22ConcurrentFeedbackRegression();
  await runSubmissionResultRecoveryRegressions();
  await runReviewTwoContextRegressions();
  await runFinalReminderBoundaryRegression();
  await runFinalAccessibilityRegression();
  await runProductUxRegressions();
  await workbenchAcceptance();
  await contactSheets();
  const finalSource = await sourceSnapshot();
  assert.equal(finalSource.sha256, initialSource.sha256, 'Source files changed during browser acceptance; regenerate the prototype and rerun on a frozen source snapshot.');
  assert.equal(createHash('sha256').update(await readFile(path.join(prototypeRoot, 'index.html'))).digest('hex'), report.prototypeSha256,
    'The generated prototype changed during browser acceptance.');
  report.sourceProvenance.unchangedDuringRun = true;
} catch (error) {
  report.fatal = error.stack || error.message;
  console.error(error.stack || error.message);
} finally {
  await saveReport();
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
}
if (report.status !== 'passed') process.exitCode = 1;
