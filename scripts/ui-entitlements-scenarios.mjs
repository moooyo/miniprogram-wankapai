const TOLERANCE = 3;
const STORAGE_KEY = 'card-benefits.native.demo.v1';
const routeName = value => String(value || '').replace(/^\//, '');

// Main paths use rendered controls and the persisted demo service. Picker changes
// use native component events. Only exact, operation-scoped modal callbacks are
// simulated because this simulator does not dismiss dialogs via Tool.native.
export async function runUiEntitlementScenarios(miniProgram, helpers) {
  const { check, expect, capture, measure, waitUntil, record } = helpers;
  const runSuffix = Date.now();
  const healthTitle = '原生验收体检权益 ' + runSuffix;
  const editedHealthTitle = healthTitle + '（已修改）';
  const loungeTitle = '原生验收贵宾厅 ' + runSuffix;
  const bankNames = ['验收甲银行', '验收乙银行', '验收丙银行', '验收丁银行'];
  const customerNote = '仅限验收甲银行在验收城市开户的客户；全部为虚构验收资料。';
  let healthId = '';
  let usageId = '';
  let sourceLoungeId = '';
  let addedLoungeId = '';

  async function element(scope, selector) {
    let target;
    await waitUntil(async () => !!(target = await scope.$(selector)), 'Missing rendered element: ' + selector);
    return target;
  }

  async function text(scope, selector, expected) {
    let target;
    await waitUntil(async () => {
      target = await scope.$(selector);
      return target && (await target.text()).includes(expected);
    }, 'Missing rendered text: ' + selector + ' / ' + expected);
    return target;
  }

  async function button(scope, selector, expected) {
    let match;
    await waitUntil(async () => {
      for (const target of await scope.$$(selector)) {
        if ((await target.text()).includes(expected)) { match = target; return true; }
      }
      return false;
    }, 'Missing rendered action: ' + selector + ' / ' + expected);
    return match;
  }

  async function loaded(route) {
    const page = await helpers.waitForPage(route);
    const data = await page.data();
    expect(!data.failed && !data.error && !data.loadError && !data.outdated,
      'Entitlement page did not load fresh data', { route, failed: data.failed, error: data.error || data.loadError, outdated: data.outdated });
    return page;
  }

  async function viewport() {
    const value = await helpers.viewport();
    return { width: Number(value.windowWidth ?? value.width), height: Number(value.windowHeight ?? value.height) };
  }

  async function sheetComponent(page) {
    const selectors = {
      'pages/entitlements/index': '#entitlement-sheet',
      'pages/entitlement-edit/index': '#lounge-editor-sheet',
    };
    const selector = selectors[routeName(page.path)];
    expect(selector, 'No entitlement sheet selector is registered for the current route', { route: page.path });
    return element(page, selector);
  }

  async function reveal(page, target, inSheet = false) {
    const screen = await viewport();
    let bounds = { x: 0, y: 0, right: screen.width, bottom: screen.height };
    let scroller;
    if (inSheet) {
      const component = await sheetComponent(page);
      await element(component, '.sheet-layer');
      scroller = await element(component, '.sheet-body');
      let previous;
      await waitUntil(async () => {
        const current = await measure(scroller);
        const stable = previous && ['x', 'y', 'width', 'height'].every(key => Math.abs(current[key] - previous[key]) < 1);
        previous = current;
        return stable && current.height > 0;
      }, 'Entitlement sheet did not settle before interaction');
      bounds = await measure(scroller);
    } else {
      const dock = await page.$('.editor-dock');
      if (dock && !(await target.attribute('class') || '').includes('primary')) {
        const dockBox = await measure(dock);
        if (dockBox.height > 0) bounds.bottom = Math.min(bounds.bottom, dockBox.y);
      }
    }
    const box = await measure(target);
    if (box.y < bounds.y + 4 || box.bottom > bounds.bottom - 4) {
      if (scroller) {
        const scroll = Number(await scroller.property('scrollTop')) || 0;
        await scroller.scrollTo(0, Math.max(0, scroll + box.y - bounds.y - 12));
      } else {
        const scroll = Number(await page.scrollTop()) || 0;
        await miniProgram.pageScrollTo(Math.max(0, scroll + box.y - 24));
      }
    }
    await waitUntil(async () => {
      const current = await measure(target);
      const available = scroller ? await measure(scroller) : bounds;
      return current.width > 0 && current.height > 0 && current.x >= -TOLERANCE
        && current.right <= screen.width + TOLERANCE && current.y >= available.y - TOLERANCE
        && current.bottom <= available.bottom + TOLERANCE;
    }, 'Entitlement control is clipped or outside the viewport');
    return target;
  }

  async function tap(page, target, inSheet = false) {
    await (await reveal(page, target, inSheet)).tap();
  }

  async function sheetElement(page, selector) {
    const component = await sheetComponent(page);
    await element(component, '.sheet-layer');
    let target;
    await waitUntil(async () => !!(target = await page.$(selector) || await component.$(selector)),
      'Missing slotted entitlement control: ' + selector);
    return target;
  }

  async function input(page, selector, value, inSheet = false, expected = value) {
    const target = inSheet ? await sheetElement(page, selector) : await element(page, selector);
    await (await reveal(page, target, inSheet)).input(value);
    await waitUntil(async () => (await target.value()) === expected, 'Input value did not render: ' + selector);
  }

  async function select(page, field, listName, value, inSheet = false) {
    const options = await page.data(listName);
    const index = options.findIndex(item => item.value === value);
    expect(index >= 0, 'Expected picker option is unavailable', { field, value, options });
    const selector = '#' + (inSheet ? 'lounge-' : '') + 'field-' + field + ' picker';
    const picker = inSheet ? await sheetElement(page, selector) : await element(page, selector);
    await (await reveal(page, picker, inSheet)).trigger('change', { value: String(index) });
    await waitUntil(async () => (await page.data((inSheet ? 'loungeDraft.' : 'draft.') + field)) === value,
      'Entitlement picker did not update: ' + field);
  }

  async function date(page, field, value) {
    const picker = await element(page, '#field-' + field + ' picker');
    await (await reveal(page, picker)).trigger('change', { value });
    await waitUntil(async () => (await page.data('draft.' + field)) === value, 'Entitlement date did not update: ' + field);
    await text(page, '#field-' + field + ' .select-input', value);
  }

  async function section(page, name) {
    if ((await page.data('openSection')) === name) return;
    await tap(page, await element(page, '#section-' + name + ' .section-heading'));
    await waitUntil(async () => (await page.data('openSection')) === name, 'Editor section did not open: ' + name);
  }

  async function tab(name) {
    await miniProgram.switchTab('/pages/' + name + '/index');
    const page = await loaded('/pages/' + name + '/index');
    await miniProgram.pageScrollTo(0);
    return page;
  }

  async function inventory(origin = 'wallet') {
    const page = await tab(origin);
    const selector = origin === 'wallet' ? '.benefits-primary' : '.tool-entry';
    await tap(page, await button(page, selector, '持有权益'));
    const list = await loaded('/pages/entitlements/index');
    expect(await list.data('demo'), 'Entitlement mutations require the isolated demo session');
    return list;
  }

  async function row(page, selector, dataName, predicate, expected = '') {
    let target, value;
    await waitUntil(async () => {
      const items = await page.data(dataName);
      const index = items.findIndex(predicate);
      const targets = await page.$$(selector);
      if (index < 0 || targets.length !== items.length || !targets[index]) return false;
      target = targets[index]; value = items[index];
      return !expected || (await target.text()).includes(expected);
    }, 'Expected rendered entitlement row is missing: ' + selector + ' / ' + expected);
    return { target, value };
  }

  async function benefit(page, id) {
    return row(page, '.benefit-card', 'rows', item => item.id === id);
  }

  async function expand(page, id) {
    const item = await benefit(page, id);
    if ((await page.data('expandedId')) !== id) {
      await tap(page, await element(item.target, '.info-toggle'));
      await waitUntil(async () => (await page.data('expandedId')) === id, 'Entitlement disclosure did not expand');
    }
    return benefit(page, id);
  }

  async function edit(page, id) {
    const item = await expand(page, id);
    await tap(page, await button(item.target, '.manage-actions button', '编辑资料与次数'));
    const editor = await loaded('/pages/entitlement-edit/index');
    expect((await editor.data('id')) === id && await editor.data('editing'), 'Editor opened the wrong entitlement');
    return editor;
  }

  async function save(page) {
    await tap(page, await text(page, '.editor-dock .primary', '保存权益'));
    return loaded('/pages/entitlements/index');
  }

  async function scope(page, value) {
    const choices = await page.data('scopes');
    const option = choices.find(item => item.value === value);
    expect(option, 'Inventory scope is unavailable', { value });
    await tap(page, await button(page, '.tabs .tab', option.label));
    await waitUntil(async () => (await page.data('scope')) === value, 'Inventory scope did not change');
  }

  async function settledList(page) {
    await waitUntil(async () => {
      const data = await page.data();
      return !data.busy && !data.confirming && !data.loading && !data.refreshing && !data.detailLoading;
    }, 'Entitlement mutation did not settle');
    expect(!(await page.data('outdated')) && !(await page.data('failed')), 'Entitlement data became stale after mutation');
  }

  async function sheet(page, id, mode) {
    const item = await benefit(page, id);
    await tap(page, await button(item.target, '.card-actions button', mode === 'use' ? '记录使用' : '使用记录'));
    await waitUntil(async () => (await page.data('sheet')) === mode && (await page.data('selectedId')) === id
      && await page.data('selectedFresh') && !(await page.data('detailLoading')),
    'Entitlement sheet did not load the selected record');
    await sheetElement(page, '.sheet-context');
  }

  async function closeHistory(page) {
    await tap(page, await sheetElement(page, '.sheet-close-button'), true);
    await waitUntil(async () => !(await page.data('sheet')), 'History sheet did not close');
  }

  async function withExpectedModal(page, expected, action) {
    const expectedOptions = { ...expected, showCancel: true };
    const reply = { confirm: true, cancel: false, errMsg: 'showModal:ok' };
    let installed = false;
    await miniProgram.evaluate((options, result) => {
      getApp().__uiEntitlementModal = { expected: options, reply: result, calls: [] };
    }, expectedOptions, reply);
    try {
      await miniProgram.mockWxMethod('showModal', options => {
        const trace = getApp().__uiEntitlementModal;
        const actual = {
          title: options.title || '', content: options.content || '',
          confirmText: options.confirmText || '确定', cancelText: options.cancelText || '取消',
          showCancel: options.showCancel !== false,
        };
        const matches = trace && Object.keys(trace.expected).every(key => actual[key] === trace.expected[key]);
        trace?.calls.push({ actual, matches: !!matches, returned: matches ? trace.reply : null });
        if (!matches) throw new Error('Unexpected modal during scoped entitlement confirmation; no default answer was supplied.');
        return trace.reply;
      });
      installed = true;
      await action();
      await waitUntil(async () => {
        const trace = await miniProgram.evaluate(() => getApp().__uiEntitlementModal);
        return trace?.calls.length > 0;
      }, 'The entitlement action did not request its expected confirmation');
      const trace = await miniProgram.evaluate(() => getApp().__uiEntitlementModal);
      expect(trace.calls.length === 1 && trace.calls[0].matches,
        'The entitlement action requested an unexpected or duplicate modal', { trace });
      await settledList(page);
    } finally {
      try {
        if (installed) await miniProgram.restoreWxMethod('showModal');
      } finally {
        const trace = await miniProgram.evaluate(() => {
          const value = getApp().__uiEntitlementModal;
          delete getApp().__uiEntitlementModal;
          return value;
        });
        record?.('platform-modal-' + expected.confirmText, {
          method: 'mockWxMethod(showModal)',
          scope: 'Only the exact confirmation requested by this UI action is simulated.',
          expected: expectedOptions, actual: trace?.calls || [], reply,
        });
      }
    }
  }

  async function persisted(id) {
    // Read-only storage evidence verifies that page transitions did not merely
    // update a view model. No fixture, quota, or domain result is injected here.
    return miniProgram.evaluate((key, entitlementId) => {
      const seed = wx.getStorageSync(key)?.seed || {};
      return { entitlement: seed.entitlements?.[entitlementId] || null,
        usages: Object.values(seed.entitlement_usages || {}).filter(item => item.entitlementId === entitlementId) };
    }, STORAGE_KEY, id);
  }

  async function informationOnly(page) {
    for (const selector of ['.result-actions', '.benefit-context', '.balance-number', '.remaining-number',
      '.transfer-row', '.transfer-line', '.grey-qualification', '.card-actions', '.manage-actions']) {
      expect(!(await page.$(selector)), 'Airport lookup exposed personal entitlement actions or balances', { selector });
    }
    for (const target of await page.$$('.lounge-card')) {
      expect((await target.$$('button')).length === 0, 'Airport results must not offer record, edit, or quota mutation actions');
      expect(!/记录使用|编辑资料与次数|归档权益|恢复权益|剩余\s*\d|次剩余/.test(await target.text()),
        'Airport result text leaked a personal entitlement action or balance');
    }
    const markup = await (await element(page, '.lounges-page')).outerWxml();
    expect(!/bindtap=["'](?:recordUse|editEntitlement|toggleArchive)["']/.test(markup),
      'Airport lookup binds a personal entitlement mutation');
  }

  await check('Held benefit entries, remaining quotas, transfer states, and disclosures render natively', async () => {
    let page = await inventory('wallet');
    const raw = await page.data('raw');
    const transferLabels = { allowed: '明确可转让', grey: '可转让（灰）', not_allowed: '不可转让' };
    const inspected = [];
    for (const [transferability, label] of Object.entries(transferLabels)) {
      const source = raw.items.find(item => item.transferability === transferability && !item.archivedAt
        && item.startsOn <= raw.today && item.endsOn >= raw.today && item.totalUses > item.usedUses);
      expect(source, 'The demo inventory is missing a current transfer-state fixture', { transferability });
      const item = await benefit(page, source.id);
      expect(item.value.remaining === source.totalUses - source.usedUses && item.value.usable,
        'Remaining quota disagrees with the loaded record', { source, row: item.value });
      await text(item.target, '.remaining-number', String(source.totalUses - source.usedUses));
      await text(item.target, '.benefit-identity .subtitle', `已用 ${source.usedUses} / 共 ${source.totalUses} 次`);
      await text(item.target, '.transfer-label', label);
      await text(item.target, '.period', `${source.startsOn} 至 ${source.endsOn}`);
      expect(!(await item.target.$('.benefit-details')), 'Entitlement details must start collapsed');
      const expanded = await expand(page, source.id);
      if (transferability === 'grey') {
        await text(expanded.target, '.transfer-caution', '需核实，非官方许可');
        await text(expanded.target, '.qualification', '不代表银行或服务商认可');
        await reveal(page, await element(expanded.target, '.qualification'));
        await capture('entitlement-grey-transfer-disclosure');
      } else expect(!(await expanded.target.$('.qualification')), 'Non-grey benefit shows the grey transfer qualification');
      await tap(page, await element(expanded.target, '.info-toggle'));
      inspected.push({ id: source.id, transferability, remaining: item.value.remaining });
    }
    await tap(page, await button(page, '.kind-filter', '体检'));
    await waitUntil(async () => (await page.data('kind')) === 'health_check', 'Health filter did not activate');
    expect((await page.data('rows')).every(item => item.kind === 'health_check'), 'Type filter includes another entitlement type');
    await input(page, '#entitlement-search', '不存在的验收权益 ' + runSuffix);
    await text(page, '.empty-title', '没有符合筛选条件的权益');
    expect((await page.$$('.benefit-card')).length === 0, 'Empty search retains benefit cards');
    await tap(page, await button(page, '.filter-summary .text-button', '清除筛选'));
    await waitUntil(async () => !(await page.data('filtered')) && (await page.data('rows')).length > 0, 'Inventory filters did not recover');
    await miniProgram.navigateBack();
    await loaded('/pages/wallet/index');
    page = await inventory('mine');
    expect((await page.data('rows')).length === raw.items.filter(item => !item.archivedAt && item.startsOn <= raw.today
      && item.endsOn >= raw.today && item.totalUses > item.usedUses).length, 'Mine and wallet entries disagree on current inventory');
    await miniProgram.pageScrollTo(0);
    await capture('entitlement-inventory');
    record?.('inventory', inspected);
  });

  await check('Normal entitlement add and edit controls persist quotas, dates, and notes', async () => {
    let page = await inventory();
    await tap(page, await button(page, '.page-heading button', '添加权益'));
    page = await loaded('/pages/entitlement-edit/index');
    expect(await page.data('ready'), 'New entitlement editor is not ready');
    const year = (await page.data('today')).slice(0, 4);
    await input(page, '#title', healthTitle);
    await select(page, 'kind', 'kinds', 'health_check');
    await input(page, '#provider', '虚构验收体检中心');
    await section(page, 'quota');
    await input(page, '#totalUses', '5');
    await input(page, '#initialUsed', '1');
    await date(page, 'startsOn', year + '-01-01');
    await date(page, 'endsOn', year + '-12-31');
    await text(page, '.quota-value', '4');
    await section(page, 'transfer');
    await select(page, 'transferability', 'transfers', 'not_allowed');
    await input(page, '#notes', '虚构验收资料：请提前核实机构、套餐与预约资格。');
    page = await save(page);
    let created = await row(page, '.benefit-card', 'rows', item => item.title === healthTitle, healthTitle);
    healthId = created.value.id;
    expect(created.value.remaining === 4 && created.value.totalUses === 5 && created.value.usedUses === 1,
      'New entitlement has the wrong initial balance', { row: created.value });
    page = await edit(page, healthId);
    await text(page, '#field-title .field-label', '权益名称');
    await input(page, '#title', editedHealthTitle);
    await section(page, 'quota');
    await input(page, '#totalUses', '6');
    await text(page, '.quota-calculation', '已记录使用 0 次');
    await text(page, '.quota-value', '5');
    await capture('entitlement-edit-quota');
    page = await save(page);
    page = await inventory();
    created = await benefit(page, healthId);
    await text(created.target, '.benefit-title', editedHealthTitle);
    expect(created.value.remaining === 5 && created.value.usedUses === 1 && created.value.totalUses === 6,
      'Edited quota did not survive reopening inventory', { row: created.value });
    const saved = await persisted(healthId);
    expect(saved.entitlement?.title === editedHealthTitle && saved.entitlement.totalUses === 6
      && saved.entitlement.initialUsed === 1 && saved.entitlement.usedUses === 1
      && saved.entitlement.startsOn === year + '-01-01' && saved.entitlement.endsOn === year + '-12-31',
    'Saved editor fields are missing from demo storage', { saved });
    expect(saved.usages.length === 0, 'Initial usage incorrectly created an individual history record');
    record?.('saved-entitlement', saved);
    await reveal(page, await element(created.target, '.benefit-overview'));
    await capture('entitlement-created-and-edited');
  });

  await check('Usage validation, persisted history, and callback-confirmed reversal preserve the entitlement balance', async () => {
    expect(healthId, 'The normal add-and-edit case did not produce a benefit');
    let page = await inventory();
    const before = (await benefit(page, healthId)).value;
    const storedBefore = await persisted(healthId);
    await sheet(page, healthId, 'use');
    await input(page, '#usage-quantity', String(before.remaining + 1), true);
    await tap(page, await sheetElement(page, '.sheet-actions .primary'), true);
    await waitUntil(async () => !!(await page.data('quantityError')), 'Over-quota usage did not show validation');
    await text(page, '.error', `最多可记录 ${before.remaining} 次`);
    expect(JSON.stringify(await persisted(healthId)) === JSON.stringify(storedBefore), 'Invalid usage changed persisted records');
    await input(page, '#usage-quantity', '2', true);
    const note = '原生验收：一次扣减两次，随后撤销并保留历史。';
    await input(page, '#usage-note', note, true);
    const usedOn = await page.data('usedOn');
    const preview = await sheetElement(page, '.deduction-preview');
    expect((await preview.text()).includes(String(before.remaining - 2)), 'Usage preview does not show the expected remaining quota');
    await reveal(page, preview, true);
    await capture('entitlement-use-preview');
    await tap(page, await sheetElement(page, '.sheet-actions .primary'), true);
    await waitUntil(async () => !(await page.data('sheet')) && !(await page.data('busy')) && !(await page.data('refreshing')),
      'Valid usage did not save and close its sheet');
    page = await inventory();
    const afterUse = (await benefit(page, healthId)).value;
    expect(afterUse.remaining === before.remaining - 2 && afterUse.usedUses === before.usedUses + 2,
      'Recorded usage deducted the wrong balance', { before, afterUse });
    await sheet(page, healthId, 'history');
    await text(page, '.history-baseline', '登记权益时已有 1 次使用');
    const usages = await page.data('usages');
    const usage = usages.find(item => item.note === note && item.usedOn === usedOn && !item.reversed);
    expect(usage && usage.quantity === 2, 'Saved usage history is missing the submitted quantity, date, or note', { usages });
    usageId = usage.id;
    const usageRow = await row(page, '.usage-row', 'usages', item => item.id === usageId, note);
    await text(usageRow.target, '.usage-bottom', '已计入使用次数');
    await withExpectedModal(page, {
      title: '撤销这笔使用记录？', content: `将恢复 ${usage.quantity} 次额度，并保留已撤销记录。`,
      confirmText: '确认撤销', cancelText: '保留记录',
    }, async () => tap(page, await button(usageRow.target, '.text-button', '撤销记录'), true));
    await waitUntil(async () => (await page.data('usages')).some(item => item.id === usageId && item.reversed),
      'Undo did not retain the original usage as reversed');
    const reversed = await row(page, '.usage-row', 'usages', item => item.id === usageId, note);
    await text(reversed.target, '.usage-bottom', '已撤销，次数已恢复');
    expect((await reversed.target.$$('button')).length === 0, 'Reversed usage still offers another reversal');
    expect((await page.data('selectedRow.remaining')) === before.remaining, 'Undo did not restore the exact original balance');
    await reveal(page, await element(reversed.target, '.usage-bottom'), true);
    await capture('entitlement-usage-reversed');
    await closeHistory(page);
    page = await inventory();
    const afterUndo = (await benefit(page, healthId)).value;
    const stored = await persisted(healthId);
    expect(afterUndo.remaining === before.remaining && afterUndo.usedUses === before.usedUses
      && stored.entitlement.usedUses === before.usedUses && stored.usages.length === 1
      && stored.usages[0].id === usageId && !!stored.usages[0].reversedAt,
    'Reversal failed to preserve balance and persisted history', { before, afterUndo, stored });
    record?.('usage-roundtrip', { before, afterUse, afterUndo, usedOn, usageId, stored });
  });

  await check('Archive and restore with scoped confirmation callbacks retain remaining quota and reversed history', async () => {
    expect(healthId && usageId, 'The usage roundtrip case did not create its persisted history');
    let page = await inventory();
    const before = await persisted(healthId);
    const item = await expand(page, healthId);
    await withExpectedModal(page, {
      title: '归档这项权益？', content: '归档后移入“已归档”，使用记录和剩余次数会保留，之后可以恢复。',
      confirmText: '归档权益', cancelText: '取消',
    }, async () => tap(page, await button(item.target, '.manage-actions button', '归档权益')));
    expect(!(await page.data('rows')).some(row => row.id === healthId), 'Archived entitlement remains in the current inventory');
    await scope(page, 'archived');
    const archived = await benefit(page, healthId);
    await text(archived.target, '.state-label', '已归档');
    expect(archived.value.remaining === before.entitlement.totalUses - before.entitlement.usedUses,
      'Archiving changed the remaining quota');
    await sheet(page, healthId, 'history');
    expect((await page.data('usages')).some(row => row.id === usageId && row.reversed), 'Archive lost the reversed usage');
    await closeHistory(page);
    await withExpectedModal(page, {
      title: '恢复这项权益？', content: '恢复后将按有效期与剩余次数显示，原使用记录会保留。',
      confirmText: '恢复权益', cancelText: '取消',
    }, async () => tap(page, await button((await benefit(page, healthId)).target, '.card-actions button', '恢复权益')));
    expect(!(await page.data('rows')).some(row => row.id === healthId), 'Restored entitlement remains in the archive scope');
    await scope(page, 'valid');
    const restored = await benefit(page, healthId);
    await text(restored.target, '.state-label', '当前可用');
    const after = await persisted(healthId);
    expect(!after.entitlement.archivedAt && after.entitlement.totalUses === before.entitlement.totalUses
      && after.entitlement.usedUses === before.entitlement.usedUses
      && JSON.stringify(after.usages) === JSON.stringify(before.usages),
    'Archive and restore altered the balance or history', { before, after });
    await reveal(page, await element(restored.target, '.benefit-overview'));
    await capture('entitlement-restored');
    record?.('archive-roundtrip', { entitlementId: healthId, before, after });
  });

  await check('Airport code and city lookup show registered banks and per-lounge access restrictions without mutation actions', async () => {
    let page = await inventory();
    const raw = await page.data('raw');
    const source = raw.items.find(item => item.kind === 'lounge' && !item.archivedAt
      && item.lounges.some(lounge => lounge.reservation === 'required' && lounge.advanceHours === 4 && lounge.customerScope === 'local_bank'));
    expect(source, 'Demo inventory is missing the four-hour local-bank lounge fixture');
    sourceLoungeId = source.id;
    const local = source.lounges.find(lounge => lounge.reservation === 'required' && lounge.advanceHours === 4 && lounge.customerScope === 'local_bank');
    const storedBefore = await persisted(source.id);
    await tap(page, await element((await benefit(page, source.id)).target, '.lounge-link'));
    page = await loaded('/pages/lounges/index');
    expect((await page.data('entitlementId')) === source.id, 'The entitlement lounge link lost its query scope');
    await text(page, '.scope-notice', source.title);
    await text(page, '.registry-note', '均为虚构示例，不可用于实际出行');
    await input(page, '#airport-query', local.airportCode.toLowerCase());
    let match = await row(page, '.lounge-card', 'matches', item => item.loungeId === local.id, local.loungeName);
    const byCode = (await page.data('matches')).map(item => item.key).sort();
    await text(match.target, '.access-rules', '需提前 4 小时预约');
    await text(match.target, '.access-rules', '仅限当地银行客户');
    await text(match.target, '.access-rules', local.customerNote);
    expect(JSON.stringify(await Promise.all((await match.target.$$('.bank-label')).map(target => target.text())))
      === JSON.stringify(local.supportedBanks), 'Lookup banks do not match this lounge registration');
    await reveal(page, await element(match.target, '.supported-banks'));
    await capture('lounge-banks-and-access-rules');
    await input(page, '#airport-query', local.city);
    const byCity = (await page.data('matches')).map(item => item.key).sort();
    expect(JSON.stringify(byCity) === JSON.stringify(byCode), 'Airport code and fixture city return different registrations', { byCode, byCity });
    await input(page, '#terminal-query', local.terminal.toLowerCase());
    await tap(page, await button(page, '.zone-filter', '国内区'));
    await waitUntil(async () => (await page.data('zone')) === 'domestic', 'Domestic lounge filter did not activate');
    const filtered = await page.data('matches');
    expect(filtered.length > 0 && filtered.every(item => item.terminal.toLowerCase().includes(local.terminal.toLowerCase())
      && ['国内区', '国内 / 国际区'].includes(item.zoneLabel)), 'Terminal and zone filters kept incompatible results', { filtered });
    await informationOnly(page);
    expect(JSON.stringify(await persisted(source.id)) === JSON.stringify(storedBefore), 'Read-only airport lookup changed entitlement records');
    record?.('airport-lookup', { entitlementId: source.id, localLoungeId: local.id, byCode, byCity, filtered });
  });

  await check('Lounge editor parses mixed bank separators and saves four-hour local-bank rules through normal controls', async () => {
    let page = await inventory();
    const candidates = await page.data('raw.items');
    const source = candidates.find(item => item.id === sourceLoungeId)
      || candidates.find(item => item.kind === 'lounge' && !item.archivedAt);
    expect(source, 'No lounge entitlement is available for the editor scenario');
    sourceLoungeId = source.id;
    const before = await persisted(source.id);
    page = await edit(page, source.id);
    await section(page, 'lounges');
    await tap(page, await button(page, '.add-lounge', '添加贵宾厅'));
    await waitUntil(async () => (await page.data('loungeVisible')) && !!(await page.data('loungeDraft')), 'Lounge editor sheet did not open');
    await input(page, '#airportName', '验收城市虚构机场', true);
    await input(page, '#airportCode', 'qaA', true, 'QAA');
    await input(page, '#city', '验收城市', true);
    await input(page, '#loungeName', loungeTitle, true);
    await input(page, '#terminal', 'T9', true);
    await select(page, 'zone', 'zones', 'domestic', true);
    await input(page, '#supportedBanksInput', ' 验收甲银行，验收乙银行、验收丙银行;验收丁银行；验收甲银行\n验收乙银行 ', true);
    await select(page, 'reservation', 'reservations', 'required', true);
    await input(page, '#advanceHours', '4', true);
    await input(page, '#reservationNote', '虚构验收：经平台取得预约确认后到场。', true);
    await select(page, 'customerScope', 'customerScopes', 'local_bank', true);
    await input(page, '#customerNote', customerNote, true);
    await tap(page, await sheetElement(page, '.sheet-actions .primary'), true);
    await waitUntil(async () => !(await page.data('loungeVisible')), 'Valid lounge rules did not join the draft');
    const draftLounge = (await page.data('draft.lounges')).find(item => item.loungeName === loungeTitle);
    expect(draftLounge && JSON.stringify(draftLounge.supportedBanks) === JSON.stringify(bankNames)
      && draftLounge.advanceHours === 4 && draftLounge.customerScope === 'local_bank'
      && draftLounge.customerNote === customerNote && draftLounge.airportCode === 'QAA',
    'Lounge draft did not normalize and retain the entered rules', { draftLounge });
    addedLoungeId = draftLounge.id;
    expect(JSON.stringify(await persisted(source.id)) === JSON.stringify(before), 'Joining the lounge draft saved the entitlement prematurely');
    const draftRow = await row(page, '.lounge-row', 'loungeRows', item => item.id === addedLoungeId, loungeTitle);
    await text(draftRow.target, '.rule-line', '支持银行');
    await reveal(page, await element(draftRow.target, '.lounge-head'));
    await capture('lounge-rules-joined-to-draft');
    page = await save(page);
    page = await inventory();
    page = await edit(page, source.id);
    await section(page, 'lounges');
    const savedRow = await row(page, '.lounge-row', 'loungeRows', item => item.id === addedLoungeId, loungeTitle);
    await tap(page, await element(savedRow.target, '.lounge-head'));
    await waitUntil(async () => (await page.data('loungeVisible')) && (await page.data('loungeDraft.id')) === addedLoungeId,
      'Saved lounge did not reopen in its normal editor');
    const banksInput = await sheetElement(page, '#supportedBanksInput');
    expect((await banksInput.value()) === bankNames.join('\n'), 'Saved lounge banks did not rehydrate as one bank per line');
    await input(page, '#loungeName', loungeTitle + '（已修改）', true);
    await tap(page, await sheetElement(page, '.sheet-actions .primary'), true);
    await waitUntil(async () => !(await page.data('loungeVisible')), 'Lounge edit did not return to its entitlement draft');
    await save(page);
    const after = await persisted(source.id);
    const saved = after.entitlement.lounges.find(item => item.id === addedLoungeId);
    expect(saved?.loungeName === loungeTitle + '（已修改）' && JSON.stringify(saved.supportedBanks) === JSON.stringify(bankNames)
      && saved.reservation === 'required' && saved.advanceHours === 4 && saved.customerScope === 'local_bank'
      && saved.customerNote === customerNote && after.entitlement.usedUses === before.entitlement.usedUses
      && after.entitlement.totalUses === before.entitlement.totalUses && JSON.stringify(after.usages) === JSON.stringify(before.usages),
    'Saving lounge rules changed their content or the entitlement ledger', { before, after });
    record?.('lounge-editor', { entitlementId: source.id, addedLoungeId, saved, unchangedUsedUses: before.entitlement.usedUses });
  });

  await check('Saved lounge lookup keeps banks isolated by registration and exposes no quota mutations', async () => {
    expect(sourceLoungeId && addedLoungeId, 'The lounge editor case did not save a lounge');
    const storedBefore = await persisted(sourceLoungeId);
    const mine = await tab('mine');
    await tap(mine, await button(mine, '.tool-entry', '贵宾厅速查'));
    const page = await loaded('/pages/lounges/index');
    expect(!(await page.data('entitlementId')), 'The mine lookup entry unexpectedly restricts its entitlement scope');
    await input(page, '#airport-query', 'qaa');
    const byCode = (await page.data('matches')).map(item => item.key);
    let match = await row(page, '.lounge-card', 'matches', item => item.loungeId === addedLoungeId, loungeTitle + '（已修改）');
    expect(JSON.stringify(await Promise.all((await match.target.$$('.bank-label')).map(target => target.text())))
      === JSON.stringify(bankNames), 'Saved lounge lookup does not render the exact normalized bank list');
    await text(match.target, '.access-rules', '需提前 4 小时预约');
    await text(match.target, '.access-rules', '仅限当地银行客户');
    await text(match.target, '.access-rules', customerNote);
    await informationOnly(page);
    await input(page, '#airport-query', '验收城市');
    const byCity = (await page.data('matches')).map(item => item.key);
    expect(JSON.stringify(byCity) === JSON.stringify(byCode), 'Saved fictional airport cannot be found consistently by code and city', { byCode, byCity });
    await input(page, '#airport-query', '不存在的验收机场 ' + runSuffix);
    await text(page, '.empty-title', '未找到已登记的贵宾厅');
    await text(page, '.empty', '这不代表该机场没有贵宾厅');
    expect((await page.$$('.lounge-card')).length === 0, 'Airport no-result state retains lounge cards');
    await tap(page, await button(page, '.clear-row .text-button', '清除筛选'));
    await waitUntil(async () => !(await page.data('filtered')), 'Airport lookup did not clear its filters');
    for (const item of await page.data('matches')) {
      match = await row(page, '.lounge-card', 'matches', value => value.key === item.key, item.title);
      expect(JSON.stringify(await Promise.all((await match.target.$$('.bank-label')).map(target => target.text())))
        === JSON.stringify(item.supportedBanks), 'Banks from another registration leaked into a lounge card', { key: item.key });
      if (item.loungeId !== addedLoungeId) {
        const registered = storedBefore.entitlement.lounges.find(value => value.id === item.loungeId);
        if (registered) expect(!item.supportedBanks.some(bank => bankNames.includes(bank)), 'Editor bank changes leaked into an unchanged lounge');
      }
    }
    await informationOnly(page);
    expect(JSON.stringify(await persisted(sourceLoungeId)) === JSON.stringify(storedBefore), 'Lookup changed the persisted entitlement ledger or rules');
    await input(page, '#airport-query', 'qaa');
    match = await row(page, '.lounge-card', 'matches', item => item.loungeId === addedLoungeId, loungeTitle + '（已修改）');
    await reveal(page, await element(match.target, '.supported-banks'));
    await capture('lounge-saved-banks-and-restrictions');
    record?.('saved-lounge-lookup', { sourceLoungeId, addedLoungeId, byCode, byCity, unchangedStorage: true,
      route: routeName((await miniProgram.currentPage()).path) });
  });
}
