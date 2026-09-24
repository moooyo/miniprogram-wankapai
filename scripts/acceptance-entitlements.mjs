import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run only after the remote source and generated prototype have been frozen.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.ENTITLEMENT_ACCEPTANCE_OUTPUT || '/var/tmp/wankapai-entitlements-evidence');
const prototypeRoot = path.join(root, 'dist', 'prototype');
const require = createRequire(import.meta.url);
const sizes = [{ name: '320', width: 320, height: 720 }, { name: '375', width: 375, height: 812 }, { name: '768-landscape', width: 768, height: 375 }];
const sourceDirectories = ['miniprogram', 'domain', 'shared', 'cloudfunctions', 'prototype', 'scripts'];
const sourceFiles = ['package.json', 'package-lock.json', 'tsconfig.json'];
const excluded = new Set(['node_modules', 'dist', '.qa-native', '.git']);
const report = { startedAt: new Date().toISOString(), cases: [], screenshots: [], exceptions: [], consoleErrors: [], httpErrors: [], fixtures: [],
  approach: 'Remote Chromium projection of source WXML, WXSS, page controllers, and the real persisted demo service.',
  limitations: ['Browser projection is not WeChat Developer Tools, a physical device, or operating-system UI proof.',
    'Native navigation, pickers, dialogs, and storage are browser adapters. No cloud deployment, actual notification, publishing, or external navigation occurs.',
    'Explicit fixtures use normal API commands. Read-only assertions inspect page data and persisted request records.',
    'The response-loss fixture persists a real service result before raising a transport error; it does not fabricate ledger state.'] };
const displayLimits = ['这是远端 Chromium 对原生页面源码的浏览器投影验收，不等同于微信开发者工具、真机或操作系统交互证明。',
  '原生导航、选择器、对话框与存储由浏览器适配；未部署云端、发送真实通知、发布或跳转外部页面。',
  '并发数据通过正常业务 API 构造；账本、版本与请求记录均读取真实演示业务服务。',
  '响应丢失用例先持久保存真实业务结果，再制造传输错误，不伪造次数或使用记录。'];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const hash = content => createHash('sha256').update(content).digest('hex');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let browser, server, page, baseUrl, currentCase, initialSource, initialPrototype;

async function sourceSnapshot() {
  const files = [...sourceFiles];
  async function collect(directory) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) { if (!excluded.has(entry.name)) await collect(relative); }
      else { assert.ok(entry.isFile(), `Expected regular source file: ${relative}`); files.push(relative); }
    }
  }
  for (const directory of sourceDirectories) await collect(directory);
  files.sort();
  const entries = [];
  for (const file of files) entries.push(`${hash(await readFile(path.join(root, file)))}  ${file}`);
  const manifest = entries.join('\n') + '\n';
  return { manifest, sha256: hash(manifest), fileCount: files.length };
}
async function until(predicate, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch (error) { lastError = error.message; }
    await pause(45);
  }
  throw new Error(`${message}${lastError ? `: ${lastError}` : ''}`);
}
const native = selector => page.locator('#native-page').locator(selector);
const handler = name => native(`[data-handler~="${name}"]`);
const data = () => page.evaluate(() => window.Prototype.current?.data || {});
const currentRoute = () => page.evaluate(() => window.Prototype.current?.route || '');
const query = (action, payload = {}) => page.evaluate(({ action, payload }) => window.Prototype.api.query(action, payload), { action, payload });
async function fixture(action, payload) {
  currentCase.fixtures.push({ action, payload });
  return page.evaluate(({ action, payload }) => window.Prototype.api.command(action, payload), { action, payload });
}
async function settled() {
  await until(async () => {
    const value = await data();
    return Object.keys(value).length && !['loading', 'refreshing', 'reloading', 'saving', 'busy', 'detailLoading', 'confirming', 'changingRole', 'countsLoading'].some(key => value[key]);
  }, 'The source page did not settle');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function waitRoute(name) {
  await until(async () => await currentRoute() === `pages/${name}/index`, `Expected route ${name}`);
  await settled();
}
async function open(name) {
  await page.evaluate(name => window.Prototype.openPage(name), name);
  await waitRoute(name);
}
async function action(name) { await handler(name).first().click(); }
async function fill(id, value) { await native(`#${id}`).fill(String(value)); }
async function section(name) {
  if ((await data()).openSection !== name) await native(`.section-heading[data-section="${name}"]`).click();
}
async function select(field, label, lounge = false) {
  await native(`#${lounge ? 'lounge-' : ''}field-${field} select`).selectOption({ label });
}
async function date(field, value) { await native(`#field-${field} input[type="date"]`).fill(value); }
async function text(selector, value) {
  await until(async () => (await native(selector).allTextContents()).join(' ').includes(value), `Expected rendered text ${selector}: ${value}`);
}
async function modal(label) {
  await page.locator('#platform-layer [role="dialog"]').waitFor();
  await page.locator('#platform-layer').getByRole('button', { name: label, exact: true }).click();
}
const card = title => native('.benefit-card').filter({ hasText: title });
async function expandCardInfo(title) {
  const toggle = card(title).locator('[data-handler~="toggleInfo"]');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await until(async () => await toggle.getAttribute('aria-expanded') === 'true', 'The entitlement details did not expand');
}
async function cardAction(title, name) {
  if (name === 'editEntitlement') await expandCardInfo(title);
  await card(title).locator(`[data-handler~="${name}"]`).click(); await settled();
}
async function capture(name, metadata = {}) {
  const file = `screenshots/${String(report.screenshots.length + 1).padStart(3, '0')}-${name.replace(/[^a-zA-Z0-9_-]+/g, '-')}.png`;
  await page.locator('#device').screenshot({ path: path.join(output, file) });
  report.screenshots.push({ name, file, ...metadata });
  currentCase?.screenshots.push(file);
}
async function preparePage(target, size = sizes[1]) {
  page = await target.newPage();
  page.setDefaultTimeout(9000);
  page.on('pageerror', error => report.exceptions.push({ case: currentCase?.id, message: error.message, stack: error.stack }));
  page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ case: currentCase?.id, message: event.text() }); });
  page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ case: currentCase?.id, url: response.url(), status: response.status() }); });
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Prototype?.ready);
  await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{max-width:none!important;min-height:0!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
  await resize(size);
  await settled();
}
async function resize(size) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.evaluate(({ width, height }) => {
    const device = document.querySelector('#device');
    for (const [key, value] of Object.entries({ width, height, 'min-height': height, 'max-height': height })) device.style.setProperty(key, `${value}px`, 'important');
  }, size);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function check(id, label, run, size = sizes[1]) {
  const started = Date.now();
  currentCase = { id, label, status: 'running', screenshots: [], fixtures: [], measurements: {} };
  const result = currentCase;
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
  try {
    await preparePage(context, size);
    await run();
    result.status = 'passed';
    console.log(`PASS ${id}`);
  } catch (error) {
    result.status = 'failed'; result.error = error.message; result.stack = error.stack;
    console.error(`FAIL ${id}: ${error.message}`);
    try { await capture(`failure-${id}`); } catch (failure) { result.captureError = failure.message; }
  } finally {
    result.durationMs = Date.now() - started;
    result.handlers = await page?.evaluate(() => window.Prototype?.performed || []).catch(() => []) || [];
    report.cases.push(result);
    await writeFile(path.join(output, 'cases.json'), JSON.stringify(report.cases, null, 2) + '\n');
    await context.close(); page = undefined; currentCase = undefined;
  }
}
async function geometry() {
  const measured = await page.evaluate(() => {
    const host = document.querySelector('#native-page'), bounds = host.getBoundingClientRect(), device = document.querySelector('#device').getBoundingClientRect();
    const elements = [...host.shadowRoot.querySelectorAll('*')];
    const overflow = elements.flatMap(node => {
      if (!(node instanceof HTMLElement)) return [];
      const box = node.getBoundingClientRect();
      if (!box.width || !box.height || node.closest('[hidden]') || box.bottom < bounds.top || box.top > bounds.bottom) return [];
      return box.left < bounds.left - 2 || box.right > bounds.right + 2 ? [{ tag: node.tagName, className: node.className, text: node.textContent.slice(0, 80), x: box.x - bounds.x, width: box.width }] : [];
    });
    const unlabeled = elements.filter(node => node.tagName === 'BUTTON' && node.getClientRects().length && !node.textContent.trim() && !node.getAttribute('aria-label')?.trim()).map(node => node.dataset.handler);
    return { width: device.width, height: device.height, scrollWidth: host.scrollWidth, clientWidth: host.clientWidth, overflow, unlabeled,
      content: host.shadowRoot.querySelector('.prototype-native-content')?.innerText || '' };
  });
  assert.ok(measured.scrollWidth <= measured.clientWidth + 2, `Horizontal scroll: ${JSON.stringify(measured)}`);
  assert.deepEqual(measured.overflow, [], `Overflowing source elements: ${JSON.stringify(measured.overflow)}`);
  assert.deepEqual(measured.unlabeled, [], 'Visible buttons require text or accessible names');
  assert.ok(!/\b(?:undefined|NaN)\b/.test(measured.content), 'A raw JavaScript sentinel leaked into the interface');
  assert.ok(!measured.content.includes('{{') && !measured.content.includes('}}'), 'An unresolved source expression leaked into the interface');
  return measured;
}
async function freshEntitlements() { await open('entitlements'); return query('entitlements.list'); }
async function sample(kind = 'lounge') { return (await query('entitlements.list')).items.find(item => item.kind === kind); }
async function editSample(kind = 'lounge') {
  await freshEntitlements();
  const item = await sample(kind);
  await cardAction(item.title, 'editEntitlement'); await waitRoute('entitlement-edit'); return item;
}
async function beginHealth(title = '验收体检权益') {
  await freshEntitlements(); await action('addEntitlement'); await waitRoute('entitlement-edit');
  await fill('title', title); await select('kind', '体检');
  await section('quota'); await fill('totalUses', '5'); await fill('initialUsed', '1');
  const today = (await data()).today;
  await date('startsOn', `${today.slice(0, 4)}-01-01`); await date('endsOn', `${today.slice(0, 4)}-12-31`);
  await section('transfer'); await select('transferability', '不可转让'); await fill('notes', '验收输入：请提前核实体检机构和套餐。');
}
async function saveEditor() { await action('save'); await waitRoute('entitlements'); }
async function useOne(item, quantity = '1', note = '') {
  await cardAction(item.title, 'recordUse'); await fill('usage-quantity', quantity); if (note) await fill('usage-note', note);
  await action('submitUsage'); await settled(); await until(async () => !(await data()).sheet, 'Usage sheet remained open');
}
async function selectUsageLounge(item, loungeId) {
  const lounge = item.lounges.find(entry => entry.id === loungeId);
  assert.ok(lounge, 'The source entitlement must contain the selected lounge');
  await cardAction(item.title, 'recordUse');
  await native('select[data-handler~="changeLounge"]').selectOption({ label: `${lounge.airportName} · ${lounge.loungeName}` });
  assert.equal((await data()).loungeIds[(await data()).loungeIndex], loungeId);
}
async function expectAirportInformationOnly() {
  assert.equal(await native('.result-actions, .benefit-context, .balance-number, .transfer-row, .grey-qualification').count(), 0, 'Airport lookup must omit personal balances, transfer rules, and result actions');
  assert.equal(await handler('recordUse').count(), 0, 'Airport lookup must not offer usage recording');
  assert.equal(await handler('editEntitlement').count(), 0, 'Airport lookup must not offer entitlement editing');
}
async function expectRegisteredBanks(item) {
  const allBanks = [...new Set(item.lounges.flatMap(lounge => lounge.supportedBanks || []))];
  for (const lounge of item.lounges) {
    assert.ok(Array.isArray(lounge.supportedBanks) && lounge.supportedBanks.length > 0, 'This fixture must explicitly register supported banks');
    const region = native('.lounge-card').filter({ hasText: lounge.loungeName }).locator('.supported-banks');
    const content = await region.innerText();
    assert.deepEqual(await region.locator('.bank-label').allTextContents(), lounge.supportedBanks, 'Each result must display exactly its own registered banks');
    for (const bank of lounge.supportedBanks) assert.ok(content.includes(bank), `Missing explicitly registered bank: ${bank}`);
    for (const bank of allBanks.filter(bank => !lounge.supportedBanks.includes(bank))) assert.ok(!content.includes(bank), `A bank registered for another lounge leaked into this result: ${bank}`);
  }
}
async function loadAfterReload() {
  await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => window.Prototype?.ready);
  await page.addStyleTag({ content: '.workbench-header,.atlas-panel,.inspection-panel,.preview-toolbar,.device-caption{display:none!important}.workbench{display:block!important;padding:0!important;margin:0!important;max-width:none!important}.device-column{display:flex!important;align-items:center!important}.device{max-width:none!important;min-height:0!important;border-radius:0!important;box-shadow:none!important;flex:none!important}' });
  await resize(sizes[1]);
}

async function runCases() {
  for (const size of sizes) for (const name of ['entitlements', 'entitlement-edit', 'lounges']) {
    await check(`layout-${name}-${size.name}`, `${{ entitlements: '权益列表', 'entitlement-edit': '权益编辑', lounges: '机场速查' }[name]} · ${size.name.replace('-landscape', ' 横屏')}`, async () => {
      await open(name); const value = await data(); assert.ok(!value.failed && !value.loadError, 'Page failed to load');
      currentCase.measurements.layout = await geometry();
      assert.equal(Math.round(currentCase.measurements.layout.width), size.width); assert.equal(Math.round(currentCase.measurements.layout.height), size.height);
      await capture(`${name}-${size.name}`, { matrix: true, route: name, size: size.name });
    }, size);
  }
  await check('entry-and-back', '卡包与我的入口、页面返回', async () => {
    for (const origin of ['wallet', 'mine']) {
      await open(origin); await action('openEntitlements'); await waitRoute('entitlements');
      await page.locator('#native-back').click(); await waitRoute(origin);
      await action('openLounges'); await waitRoute('lounges');
      await page.locator('#native-back').click(); await waitRoute(origin);
    }
    await capture('mine-entries');
  });
  await check('list-scopes-and-types', '当前可用、类型与全部权益筛选', async () => {
    const initial = await freshEntitlements(), source = initial.items.find(item => item.kind === 'health_check');
    const { id, ownerId, usedUses, version, createdAt, updatedAt, archivedAt, ...draft } = source;
    const year = Number(initial.today.slice(0, 4));
    for (const scenario of [
      { title: '验收尚未生效权益', startsOn: `${year + 1}-01-01`, endsOn: `${year + 1}-12-31`, totalUses: 1, initialUsed: 0 },
      { title: '验收已经过期权益', startsOn: `${year - 1}-01-01`, endsOn: `${year - 1}-12-31`, totalUses: 1, initialUsed: 0 },
      { title: '验收次数用完权益', startsOn: `${year}-01-01`, endsOn: `${year}-12-31`, totalUses: 1, initialUsed: 1 },
    ]) await fixture('entitlement.save', { draft: { ...draft, ...scenario } });
    await open('entitlements'); assert.equal((await data()).scope, 'valid'); assert.equal(await native('.benefit-card').count(), 3);
    for (const kind of ['lounge', 'health_check', 'other']) {
      await native(`.kind-filter[data-value="${kind}"]`).click(); assert.equal(await native('.benefit-card').count(), 1); assert.equal((await data()).rows[0].kind, kind);
    }
    await action('clearFilters'); await native('.tab[data-value="all"]').click(); assert.equal(await native('.benefit-card').count(), 6);
    await text('.benefit-card', '尚未生效'); await text('.benefit-card', '已过期'); await text('.benefit-card', '次数已用完');
    await capture('list-all-types');
  });
  await check('list-empty-states', '归档空态与空搜索可恢复', async () => {
    await freshEntitlements(); await native('.tab[data-value="archived"]').click(); await text('.empty', '还没有归档权益');
    await native('.tab[data-value="valid"]').click(); await fill('entitlement-search', '不存在的权益 987');
    await text('.empty', '没有符合筛选条件的权益'); assert.equal(await native('.benefit-card').count(), 0);
    await action('clearFilters'); assert.equal(await native('.benefit-card').count(), 3); await capture('list-filters-restored');
  });
  await check('remaining-and-transfer-states', '剩余次数与三种转让状态', async () => {
    await freshEntitlements(); const lounge = await sample(), health = await sample('health_check'), other = await sample('other');
    assert.equal((await data()).expandedId, ''); assert.equal(await native('.benefit-details, .manage-actions').count(), 0);
    assert.equal(await handler('editEntitlement').count(), 0, 'Management actions must remain collapsed on initial entry');
    assert.equal(await handler('toggleArchive').count(), 0, 'Archive management must remain collapsed on initial entry');
    assert.equal(await card(lounge.title).locator('.remaining-number').innerText(), '4');
    assert.ok((await card(lounge.title).innerText()).includes('可转让（灰）')); assert.ok((await card(lounge.title).innerText()).includes('非官方'));
    assert.ok((await card(health.title).innerText()).includes('不可转让')); assert.ok((await card(other.title).innerText()).includes('明确可转让'));
    assert.ok(await card(lounge.title).locator('.transfer-caution').isVisible());
    assert.ok(await card(lounge.title).locator('[data-handler~="recordUse"]').isVisible()); assert.ok(await card(lounge.title).locator('[data-handler~="openHistory"]').isVisible());
    await capture('remaining-and-transfer');
    await expandCardInfo(lounge.title);
    assert.ok(await card(lounge.title).locator('[data-handler~="editEntitlement"]').isVisible()); assert.ok(await card(lounge.title).locator('[data-handler~="toggleArchive"]').isVisible());
    assert.ok((await card(lounge.title).locator('.qualification').innerText()).includes('本人登记的非官方可行性'));
    assert.ok((await card(lounge.title).locator('.qualification').innerText()).includes('不代表银行或服务商认可'));
    assert.ok((await card(lounge.title).locator('.benefit-details').innerText()).includes(lounge.transferNote)); await capture('entitlement-details-expanded');
    await card(lounge.title).locator('[data-handler~="toggleInfo"]').click(); assert.equal(await card(lounge.title).locator('.benefit-details').count(), 0);
  });
  await check('editor-validation', '创建时校验名称、整数次数、已用次数和日期', async () => {
    await freshEntitlements(); await action('addEntitlement'); await waitRoute('entitlement-edit'); await action('save');
    let state = await data(); assert.ok(state.errors.title && state.errors.totalUses && state.errors.endsOn); assert.equal((await query('entitlements.list')).items.length, 3);
    await section('basic'); await fill('title', '校验权益'); await select('kind', '体检');
    await section('quota'); await fill('totalUses', '2'); await fill('initialUsed', '3'); await date('endsOn', `${state.today.slice(0, 4)}-01-01`); await action('save');
    state = await data(); assert.ok(state.errors.totalUses && state.errors.endsOn);
    await section('quota'); await fill('initialUsed', '-1'); await action('save'); assert.ok((await data()).errors.initialUsed);
    await section('quota'); await fill('initialUsed', '0'); await fill('totalUses', '1.5'); await action('save'); assert.ok((await data()).errors.totalUses);
    assert.equal((await query('entitlements.list')).items.length, 3); await capture('editor-validation');
  });
  await check('create-edit-reload', '体检权益新增、编辑与刷新持久保存', async () => {
    await beginHealth(); await saveEditor();
    let item = (await query('entitlements.list')).items.find(item => item.title === '验收体检权益'); assert.ok(item); assert.equal(item.totalUses - item.usedUses, 4); assert.equal(item.transferability, 'not_allowed');
    await cardAction(item.title, 'editEntitlement'); await waitRoute('entitlement-edit'); await fill('title', '验收体检权益（已更新）');
    await section('transfer'); await select('transferability', '明确可转让'); await fill('transferNote', '仅为验收输入，需按提供方规则核实。'); await saveEditor();
    await loadAfterReload(); await settled(); item = (await query('entitlement.get', { id: item.id })).entitlement;
    assert.equal(item.title, '验收体检权益（已更新）'); assert.equal(item.transferability, 'allowed'); assert.equal(item.totalUses - item.usedUses, 4);
    await capture('created-health-persisted');
  });
  await check('usage-input-validation', '扣次拒绝零、负数、小数与超额', async () => {
    await freshEntitlements(); const item = await sample(); await cardAction(item.title, 'recordUse');
    for (const quantity of ['0', '-1', '1.5', '5']) {
      await fill('usage-quantity', quantity); await action('submitUsage'); await text('.error', quantity === '5' ? '最多可记录 4 次' : '大于 0 的整数');
      assert.equal((await query('entitlement.get', { id: item.id })).entitlement.usedUses, 2);
    }
    await capture('usage-overdraw-blocked');
  });
  await check('usage-history-and-undo', '实际扣次、历史记录与仅撤销一次', async () => {
    await freshEntitlements(); const item = await sample(); await useOne(item, '2', '验收：本人及同行人');
    let detail = await query('entitlement.get', { id: item.id }); assert.equal(detail.entitlement.usedUses, 4); assert.equal(detail.usages.length, 1); assert.equal(detail.usages[0].quantity, 2);
    await cardAction(item.title, 'openHistory'); await text('.usage-row', '验收：本人及同行人'); await action('undoUsage'); await modal('确认撤销'); await settled();
    detail = await query('entitlement.get', { id: item.id }); assert.equal(detail.entitlement.usedUses, 2); assert.ok(detail.usages[0].reversedAt); assert.equal(detail.usages.length, 1);
    assert.equal(await handler('undoUsage').count(), 0); await text('.usage-row', '已撤销，次数已恢复'); await capture('usage-undo-history');
  });
  await check('usage-response-loss-idempotency', '真实提交响应丢失后重试不重复扣次', async () => {
    await freshEntitlements(); const item = await sample(); await cardAction(item.title, 'recordUse'); await fill('usage-quantity', '2'); await fill('usage-note', '验收：响应丢失');
    await page.evaluate(id => {
      const api = window.Prototype.api, originalCommand = api.command, originalSet = wx.setStorageSync;
      const baseline = new Set(Object.keys(wx.getStorageSync('card-benefits.native.demo.v1').seed.requests || {}));
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const state = window.__entitlementFault = { originalCommand, originalSet, release, calls: [], injected: null, reached: false };
      api.command = async function (...args) {
        state.calls.push({ action: args[0], payload: JSON.parse(JSON.stringify(args[1])) });
        if (args[0] === 'entitlement.use' && args[1].id === id && !state.reached) { state.reached = true; await gate; }
        return originalCommand.apply(api, args);
      };
      wx.setStorageSync = function (key, value) {
        const result = originalSet(key, value);
        if (key !== 'card-benefits.native.demo.v1' || state.injected) return result;
        const request = Object.values(value.seed.requests || {}).find(record => {
          if (baseline.has(record.id)) return false;
          const command = JSON.parse(record.fingerprint);
          return command.action === 'entitlement.use' && command.payload.id === id;
        });
        if (request) { state.injected = request; throw Object.assign(new Error('Acceptance fixture: persisted result response lost'), { code: 'NETWORK_ERROR' }); }
        return result;
      };
    }, item.id);
    await action('submitUsage');
    await until(() => page.evaluate(() => window.__entitlementFault.reached), 'The real command was not held');
    assert.ok(await handler('submitUsage').isDisabled()); assert.ok(await native('#usage-quantity').isDisabled());
    await page.evaluate(() => window.__entitlementFault.release());
    await until(async () => (await data()).pendingUse, 'Committed response loss did not retain the original intent'); await settled();
    const committed = await query('entitlement.get', { id: item.id }); assert.equal(committed.entitlement.usedUses, 4); assert.equal(committed.usages.length, 1);
    await text('.error-block', '不会另建一笔记录'); await capture('usage-response-lost');
    await page.evaluate(() => { wx.setStorageSync = window.__entitlementFault.originalSet; });
    await action('submitUsage'); await settled(); assert.equal((await data()).sheet, '');
    const retried = await query('entitlement.get', { id: item.id }); assert.equal(retried.entitlement.usedUses, 4); assert.equal(retried.usages.length, 1);
    const evidence = await page.evaluate(id => {
      const records = Object.values(wx.getStorageSync('card-benefits.native.demo.v1').seed.requests || {}).filter(record => { const parsed = JSON.parse(record.fingerprint); return parsed.action === 'entitlement.use' && parsed.payload.id === id; });
      return { injected: window.__entitlementFault.injected, calls: window.__entitlementFault.calls, records };
    }, item.id);
    assert.equal(evidence.records.length, 1); assert.equal(evidence.calls.filter(call => call.action === 'entitlement.use').length, 2);
    currentCase.measurements.transport = evidence; await capture('usage-response-retry-confirmed');
  });
  await check('usage-version-conflict', '并发扣次冲突保留输入并要求再次确认', async () => {
    await freshEntitlements(); const item = await sample(); await cardAction(item.title, 'recordUse'); await fill('usage-quantity', '2'); await fill('usage-note', '验收：保留本次输入');
    await fixture('entitlement.use', { id: item.id, quantity: 1, usedOn: (await data()).usedOn, note: 'Concurrent fixture', expectedVersion: item.version });
    await action('submitUsage'); await settled(); await text('.error-block', '填写内容仍然保留');
    assert.equal(await native('#usage-quantity').inputValue(), '2'); assert.equal(await native('#usage-note').inputValue(), '验收：保留本次输入');
    assert.equal((await query('entitlement.get', { id: item.id })).usages.length, 1); assert.equal((await data()).selectedRow.remaining, 3);
    await capture('usage-version-conflict'); await action('submitUsage'); await settled();
    const detail = await query('entitlement.get', { id: item.id }); assert.equal(detail.usages.length, 2); assert.equal(detail.entitlement.totalUses - detail.entitlement.usedUses, 1);
  });
  await check('archive-restore-history', '归档与恢复保留余额及使用历史', async () => {
    await freshEntitlements(); const item = await sample(); await useOne(item);
    await expandCardInfo(item.title);
    await card(item.title).locator('[data-handler~="toggleArchive"]').click(); await modal('归档权益'); await settled(); assert.equal(await card(item.title).count(), 0);
    await native('.tab[data-value="archived"]').click(); assert.equal(await card(item.title).count(), 1); await text('.benefit-card', '已归档');
    await card(item.title).locator('[data-handler~="toggleArchive"]').click(); await modal('恢复权益'); await settled();
    await native('.tab[data-value="valid"]').click(); assert.equal(await card(item.title).count(), 1);
    const detail = await query('entitlement.get', { id: item.id }); assert.equal(detail.entitlement.usedUses, 3); assert.equal(detail.usages.length, 1); assert.equal(detail.entitlement.archivedAt, null);
    await capture('archive-restored');
  });
  await check('airport-name-code-city-empty', '机场名称、三字码、城市与空结果', async () => {
    await open('lounges');
    for (const term of ['示例国际机场', 'zzz', '示例城市']) { await fill('airport-query', term); assert.equal(await native('.lounge-card').count(), 2); }
    await fill('airport-query', '找不到的机场XYZ'); assert.equal(await native('.lounge-card').count(), 0); await text('.empty', '这不代表该机场没有贵宾厅');
    await capture('airport-empty-copy'); await action('clearFilters'); assert.equal(await native('.lounge-card').count(), 2);
  });
  await check('airport-rules-and-supported-banks', '每厅支持银行名单、预约时长与本地客户限制', async () => {
    const original = await sample();
    const { id, ownerId, usedUses, version, createdAt, updatedAt, archivedAt, ...draft } = original;
    const lounges = original.lounges.map((lounge, index) => ({ ...lounge, supportedBanks: index === 0 ? ['验收甲银行', '验收乙银行'] : ['验收丙银行'] }));
    await fixture('entitlement.save', { id, expectedVersion: version, draft: { ...draft, lounges } });
    await open('lounges'); const item = await sample(); assert.equal(await native('.lounge-card').count(), 2);
    await text('.lounge-card', '需提前 4 小时预约'); await text('.lounge-card', '仅限当地银行客户'); await text('.lounge-card', '示例银行在示例城市开户');
    await text('.lounge-card', '无需预约（已登记）'); await text('.lounge-card', '仅限指定客户');
    await expectRegisteredBanks(item); await expectAirportInformationOnly(); await capture('airport-rules-supported-banks');
  });
  await check('airport-banks-missing-not-inferred', '未登记银行时明确提示且不从提供方或卡片推断', async () => {
    const list = await freshEntitlements(), item = await sample(), linkedCard = list.cards.find(card => card.bankId === 'cmb' && !card.archivedAt);
    assert.ok(linkedCard, 'The fixture requires the existing CMB card');
    const { id, ownerId, usedUses, version, createdAt, updatedAt, archivedAt, ...draft } = item;
    const { supportedBanks, ...legacyLounge } = item.lounges[0];
    const result = await fixture('entitlement.save', { draft: { ...draft, title: '验收银行未登记权益', provider: '不可推断提供方银行', cardId: linkedCard.id,
      lounges: [{ ...legacyLounge, id: 'acceptance-missing-banks', airportName: '验收未登记机场', airportCode: 'NOB', loungeName: '验收未登记银行贵宾厅' }] } });
    await open('lounges'); await fill('airport-query', 'NOB'); assert.equal(await native('.lounge-card').count(), 1);
    await text('.supported-banks', '尚未登记'); const content = await native('.supported-banks').innerText();
    assert.equal(await native('.supported-banks .bank-label').count(), 0, 'An unregistered lounge must not show a bank label');
    for (const forbidden of ['不可推断提供方银行', '招商银行', linkedCard.nickname].filter(Boolean)) assert.ok(!content.includes(forbidden), `An unregistered bank was inferred from personal data: ${forbidden}`);
    const saved = (await query('entitlement.get', { id: result.id })).entitlement;
    assert.deepEqual(saved.lounges[0].supportedBanks || [], []); await expectAirportInformationOnly(); await capture('airport-supported-banks-unregistered');
  });
  await check('airport-zone-terminal-scope', '贵宾厅航站楼、出发区域与权益范围筛选', async () => {
    await freshEntitlements(); const item = await sample(); await cardAction(item.title, 'openLounges'); await waitRoute('lounges'); assert.equal((await data()).entitlementId, item.id);
    await fill('terminal-query', 'T2'); assert.equal(await native('.lounge-card').count(), 1); await text('.lounge-card', '示例国际出发休息室');
    await fill('terminal-query', ''); await native('.zone-filter[data-value="domestic"]').click(); assert.equal(await native('.lounge-card').count(), 1); await text('.lounge-card', '示例银行贵宾厅');
    await action('clearFilters'); await action('clearScope'); assert.equal((await data()).entitlementId, ''); assert.equal(await native('.lounge-card').count(), 2);
    await capture('airport-scope-restored');
  });
  await check('entitlement-lounge-use-zero-keeps-airport-information', '我的权益选厅扣完共享次数后机场银行资料仍可查询', async () => {
    await freshEntitlements(); const item = await sample(); await selectUsageLounge(item, 'demo-lounge-local'); await text('.qualification', '4 小时预约');
    await fill('usage-quantity', '4'); await action('submitUsage'); await settled();
    await native('.tab[data-value="all"]').click(); assert.equal(await card(item.title).locator('.remaining-number').innerText(), '0');
    assert.ok(await card(item.title).locator('[data-handler~="recordUse"]').isDisabled());
    const detail = await query('entitlement.get', { id: item.id });
    assert.equal(detail.entitlement.totalUses - detail.entitlement.usedUses, 0); assert.equal(detail.usages.length, 1); assert.equal(detail.usages[0].quantity, 4); assert.equal(detail.usages[0].loungeName, '示例银行贵宾厅');
    await cardAction(item.title, 'openHistory'); await text('.usage-row', '示例银行贵宾厅'); await text('.sheet-balance', '剩余 0 次'); await capture('entitlement-lounge-shared-zero');
    await action('closeSheet'); await settled(); await open('lounges'); assert.equal(await native('.lounge-card').count(), 2);
    await expectRegisteredBanks(item); await expectAirportInformationOnly(); await capture('airport-banks-after-entitlement-depletion');
  });
  await check('lounge-editor-validation', '贵宾厅表单验证必填、三字码、预约与客户限制', async () => {
    await editSample(); await section('lounges'); await native('.add-lounge').click(); await action('commitLounge');
    let state = await data(); assert.ok(state.loungeErrors.airportName && state.loungeErrors.loungeName);
    await fill('airportName', '验收机场'); await fill('airportCode', '1!'); await fill('loungeName', '验收贵宾厅');
    await select('reservation', '需要预约', true); await fill('advanceHours', '-1'); await select('customerScope', '仅本地银行客户', true); await action('commitLounge');
    state = await data(); assert.ok(state.loungeErrors.airportCode && state.loungeErrors.advanceHours && state.loungeErrors.customerNote); assert.equal(state.draft.lounges.length, 2);
    await capture('lounge-editor-validation');
  });
  await check('lounge-add-cancel-preserves-input', '取消关闭贵宾厅弹层后保留输入并新增', async () => {
    const item = await editSample(); await section('lounges'); await native('.add-lounge').click();
    assert.equal((await handler('commitLounge').innerText()).trim(), '加入权益', 'The new lounge action must resolve its source label');
    const controlBorders = [];
    // The native picker has an invisible browser input overlay; inspect its visible source control.
    for (const selector of ['#airportName', '#lounge-field-reservation .select-input', '#reservationNote', '.sheet-actions .cancel-button']) {
      const control = native(selector); await control.scrollIntoViewIfNeeded();
      const measured = await control.evaluate(element => {
        const style = getComputedStyle(element), box = element.getBoundingClientRect();
        return { width: box.width, height: box.height, display: style.display, visibility: style.visibility, opacity: Number(style.opacity),
          borders: ['Top', 'Right', 'Bottom', 'Left'].map(side => ({ width: parseFloat(style[`border${side}Width`]), style: style[`border${side}Style`], color: style[`border${side}Color`] })) };
      });
      assert.ok(measured.width > 0 && measured.height > 0 && measured.display !== 'none' && measured.visibility !== 'hidden' && measured.opacity > 0, `The sheet control must be visible: ${selector}`);
      for (const border of measured.borders) {
        const alpha = border.color.startsWith('rgba(') ? Number(border.color.slice(5, -1).split(',').at(-1)) : 1;
        assert.ok(border.width > 0 && !['none', 'hidden'].includes(border.style) && border.color !== 'transparent' && alpha > 0,
          `The sheet control requires a visible border: ${selector} ${JSON.stringify(border)}`);
      }
      controlBorders.push({ selector, ...measured });
    }
    currentCase.measurements.controlBorders = controlBorders;
    await fill('airportName', '验收测试机场'); await fill('airportCode', 'abc'); await fill('city', '验收城市'); await fill('loungeName', '验收新增贵宾厅');
    await fill('supportedBanksInput', '验收甲银行\n验收乙银行');
    await select('reservation', '需要预约', true); await fill('advanceHours', '4'); await select('customerScope', '仅本地银行客户', true); await fill('customerNote', '仅验收银行在验收城市开户客户');
    await action('closeLounge'); await modal('继续填写'); assert.equal(await native('#loungeName').inputValue(), '验收新增贵宾厅'); assert.equal(await native('#airportCode').inputValue(), 'ABC'); assert.equal(await native('#supportedBanksInput').inputValue(), '验收甲银行\n验收乙银行');
    await action('commitLounge'); assert.equal((await data()).draft.lounges.length, 3); assert.equal((await query('entitlement.get', { id: item.id })).entitlement.lounges.length, 2);
    await saveEditor(); const saved = (await query('entitlement.get', { id: item.id })).entitlement.lounges.find(row => row.airportCode === 'ABC'); assert.ok(saved); assert.equal(saved.advanceHours, 4); assert.equal(saved.customerScope, 'local_bank'); assert.deepEqual(saved.supportedBanks, ['验收甲银行', '验收乙银行']);
    await open('lounges'); await fill('airport-query', 'abc'); assert.equal(await native('.lounge-card').count(), 1); await text('.supported-banks', '验收甲银行'); await text('.supported-banks', '验收乙银行'); await expectAirportInformationOnly(); await capture('lounge-added');
  });
  await check('lounge-edit-remove-draft', '贵宾厅修改和移除保存后生效', async () => {
    const item = await editSample(); await section('lounges'); await native('.lounge-row').first().click();
    assert.equal((await handler('commitLounge').innerText()).trim(), '确认修改', 'The existing lounge action must resolve its source label');
    await fill('loungeName', '验收修改贵宾厅'); await fill('supportedBanksInput', '验收更新银行\n验收合作银行'); await action('commitLounge');
    assert.equal((await query('entitlement.get', { id: item.id })).entitlement.lounges[0].loungeName, item.lounges[0].loungeName);
    await native('.lounge-row').nth(1).click(); await action('removeLounge'); await modal('移除'); assert.equal((await data()).draft.lounges.length, 1);
    await saveEditor(); const saved = (await query('entitlement.get', { id: item.id })).entitlement; assert.equal(saved.lounges.length, 1); assert.equal(saved.lounges[0].loungeName, '验收修改贵宾厅'); assert.deepEqual(saved.lounges[0].supportedBanks, ['验收更新银行', '验收合作银行']);
    await open('lounges'); await fill('airport-query', saved.lounges[0].airportCode); assert.equal(await native('.lounge-card').count(), 1); await text('.supported-banks', '验收更新银行'); await text('.supported-banks', '验收合作银行');
    await capture('lounge-edit-remove-saved');
  });
  await check('lounge-history-survives-kind-change', '贵宾厅移除并更改权益类型后保留原使用地点', async () => {
    await freshEntitlements(); const item = await sample(); await selectUsageLounge(item, 'demo-lounge-local');
    await fill('usage-note', '验收：保留实际使用地点'); await action('submitUsage'); await settled();
    const recorded = await query('entitlement.get', { id: item.id });
    assert.equal(recorded.usages.length, 1); assert.equal(recorded.usages[0].loungeName, '示例银行贵宾厅');
    await cardAction(item.title, 'editEntitlement'); await waitRoute('entitlement-edit'); await section('lounges');
    for (const remaining of [1, 0]) {
      await native('.lounge-row').first().click(); await action('removeLounge'); await modal('移除');
      await until(async () => !(await data()).loungeVisible && (await data()).draft.lounges.length === remaining, 'The removed lounge remained in the editor draft');
    }
    await section('basic'); await select('kind', '其他权益'); await saveEditor();
    const changed = await query('entitlement.get', { id: item.id });
    assert.equal(changed.entitlement.kind, 'other'); assert.equal(changed.entitlement.lounges.length, 0);
    assert.equal(changed.entitlement.usedUses, recorded.entitlement.usedUses); assert.equal(changed.usages.length, 1);
    assert.equal(changed.usages[0].id, recorded.usages[0].id); assert.equal(changed.usages[0].loungeName, '示例银行贵宾厅');
    await cardAction(item.title, 'openHistory'); await text('.usage-row', '示例银行贵宾厅'); await text('.usage-row', '验收：保留实际使用地点');
    assert.equal((await data()).selected.kind, 'other'); await capture('lounge-history-after-kind-change');
  });
  await check('editor-local-draft-recovery', '本机草稿刷新恢复后由用户保存', async () => {
    await beginHealth('验收草稿体检'); await loadAfterReload(); await modal('恢复草稿'); await settled();
    assert.equal((await data()).draft.title, '验收草稿体检'); assert.equal((await data()).draft.totalUses, '5'); assert.equal((await query('entitlements.list')).items.length, 3);
    await text('.notice', '恢复本机草稿'); await capture('editor-draft-recovered'); await action('save'); await settled();
    const list = await query('entitlements.list'); assert.equal(list.items.filter(item => item.title === '验收草稿体检').length, 1);
  });
  await check('editor-conflict-preserves-input', '权益编辑版本冲突刷新后保留填写并再次保存', async () => {
    const item = await editSample('health_check'); await fill('title', '验收并发后保留名称');
    const { id, ownerId, usedUses, version, createdAt, updatedAt, archivedAt, ...draft } = item;
    await fixture('entitlement.save', { id, expectedVersion: version, draft: { ...draft, provider: 'Concurrent fixture provider' } });
    await action('save'); await settled(); assert.ok((await data()).conflict); assert.equal(await native('#title').inputValue(), '验收并发后保留名称'); assert.ok(await handler('save').isDisabled());
    await action('reloadLatest'); await settled(); assert.equal(await native('#title').inputValue(), '验收并发后保留名称'); assert.equal((await query('entitlement.get', { id })).entitlement.title, item.title);
    await capture('editor-conflict-refreshed'); await saveEditor(); assert.equal((await query('entitlement.get', { id })).entitlement.title, '验收并发后保留名称');
  });
}

async function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.summary = { passed: report.cases.filter(item => item.status === 'passed').length, failed: report.cases.filter(item => item.status === 'failed').length,
    screenshots: report.screenshots.length, runtimeExceptions: report.exceptions.length, consoleErrors: report.consoleErrors.length, httpErrors: report.httpErrors.length };
  report.status = report.fatal || !report.cases.length || report.summary.failed || report.summary.runtimeExceptions || report.summary.consoleErrors || report.summary.httpErrors ? 'failed' : 'passed';
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>持有权益功能验收报告</title><style>body{max-width:1200px;margin:32px auto;padding:0 20px;font:15px/1.7 system-ui,sans-serif;background:#f4f6f8;color:#173041}h1{font-size:28px}table{width:100%;border-collapse:collapse;background:white}td,th{padding:10px;border:1px solid #d5dfe7;text-align:left}.passed{color:#176643}.failed{color:#a62c31}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px}figure{margin:0}img{width:100%;border:1px solid #c7d3df}pre,code{overflow-wrap:anywhere;white-space:pre-wrap}</style><h1>持有权益功能验收报告</h1><p>${escapeHtml(report.startedAt)} · ${report.summary.passed} 项通过 · ${report.summary.failed} 项未通过 · ${report.summary.runtimeExceptions} 个运行时异常</p><ul>${displayLimits.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul><h2>验收版本</h2><p>原型 SHA-256：<code>${escapeHtml(report.prototypeSha256)}</code></p><p>源码指纹：<code>${escapeHtml(report.sourceProvenance?.start)}</code> · 验收期间${report.sourceProvenance?.unchangedDuringRun ? '保持一致' : '未确认保持一致'}</p><p><a href="interactive-prototype.html">本次原型完整快照</a> · <a href="source-manifest-start.sha256">开始时源码清单</a> · <a href="source-manifest-end.sha256">结束时源码清单</a> · <a href="report.json">完整验收数据</a></p>${report.fatal ? `<pre class="failed">${escapeHtml(report.fatal)}</pre>` : ''}<h2>验收用例</h2><table><thead><tr><th>用例</th><th>结果</th><th>详情</th></tr></thead><tbody>${report.cases.map(item => `<tr><td>${escapeHtml(item.label)}</td><td class="${item.status}">${item.status === 'passed' ? '通过' : '未通过'}</td><td>${item.error ? escapeHtml(item.error) : ''}${item.screenshots.map((file, index) => ` <a href="${file}">截图 ${index + 1}</a>`).join('')}</td></tr>`).join('')}</tbody></table><h2>截图证据</h2><div class="gallery">${report.screenshots.map(item => `<figure><a href="${item.file}"><img src="${item.file}" loading="lazy" alt="验收截图"></a><figcaption>${escapeHtml(report.cases.find(test => test.screenshots.includes(item.file))?.label || '验收截图')}</figcaption></figure>`).join('')}</div></html>`);
  console.log(`REPORT ${path.join(output, 'index.html')}`); console.log(`RESULT ${JSON.stringify(report.summary)}`);
}

await mkdir(path.join(output, 'screenshots'), { recursive: true });
try {
  assert.equal(process.platform, 'linux', 'Run this acceptance only on the designated remote Linux test environment.');
  const { chromium } = require(process.env.PROTOTYPE_PLAYWRIGHT_MODULE || '/tmp/bank-benefits-native-assets/node_modules/playwright');
  initialSource = await sourceSnapshot(); initialPrototype = await readFile(path.join(prototypeRoot, 'index.html'));
  report.prototypeSha256 = hash(initialPrototype); report.sourceProvenance = { start: initialSource.sha256, fileCount: initialSource.fileCount, unchangedDuringRun: false };
  await writeFile(path.join(output, 'source-manifest-start.sha256'), initialSource.manifest); await writeFile(path.join(output, 'interactive-prototype.html'), initialPrototype);
  await writeFile(path.join(output, 'coverage.json'), await readFile(path.join(prototypeRoot, 'coverage.json')));
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const target = path.resolve(prototypeRoot, pathname.slice(1) || 'index.html'); assert.ok(target.startsWith(prototypeRoot + path.sep), 'Path escaped the frozen prototype directory');
      response.writeHead(200, { 'content-type': target.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8' }); response.end(await readFile(target));
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'], executablePath: process.env.PROTOTYPE_CHROMIUM_PATH || '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
  report.environment = { platform: process.platform, node: process.version, browser: await browser.version(), origin: baseUrl, sizes };
  await runCases();
} catch (error) { report.fatal = error.stack || error.message; console.error(report.fatal); }
finally {
  if (initialSource) {
    try {
      const finalSource = await sourceSnapshot(); await writeFile(path.join(output, 'source-manifest-end.sha256'), finalSource.manifest);
      report.sourceProvenance.end = finalSource.sha256; report.sourceProvenance.prototypeEnd = hash(await readFile(path.join(prototypeRoot, 'index.html')));
      report.sourceProvenance.unchangedDuringRun = finalSource.sha256 === initialSource.sha256 && report.sourceProvenance.prototypeEnd === report.prototypeSha256;
      assert.ok(report.sourceProvenance.unchangedDuringRun, 'Source or generated prototype changed during acceptance; rebuild and rerun on a frozen snapshot.');
    } catch (error) { report.fatal = [report.fatal, error.stack || error.message].filter(Boolean).join('\n'); }
  }
  await writeReport(); await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve());
}
if (report.status !== 'passed') process.exitCode = 1;
