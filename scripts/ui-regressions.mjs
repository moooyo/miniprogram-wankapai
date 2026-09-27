const TEXT = {
  actual: '实际到账', estimate: '原预计', allCurrencies: '全部币种',
  history: '全部参与记录', anotherCard: '用另一张卡参加',
  addCard: '添加符合条件的卡片', skip: '本期不参加', resume: '恢复本期参与',
  demoReminder: '演示提醒', draftTitle: '发现未保存的草稿',
  draftNickname: 'UI draft recovery card', submissionTitle: 'UI draft recovery submission',
};
const TOLERANCE = 3;

// These cases use normal pages and event handlers. Only platform dialogs and
// subscription requests are mocked; no page data or domain response is replaced.
export async function runUiRegressions(miniProgram, helpers) {
  const { check, expect, capture, measure, waitUntil } = helpers;
  const platformMocks = [];
  let originalAnnualId = '';
  let secondAnnualId = '';
  let secondCardId = '';

  async function element(scope, selector) {
    let target;
    await waitUntil(async () => !!(target = await scope.$(selector)), 'Missing rendered element: ' + selector);
    return target;
  }
  async function loaded(route) {
    const page = await helpers.waitForPage(route);
    const data = await page.data();
    expect(!data.failed && !data.error && !data.loadError, 'Page could not load', {
      route, failed: data.failed, error: data.error, loadError: data.loadError,
    });
    return page;
  }
  async function tab(name) {
    await closeSheets();
    await miniProgram.switchTab('/pages/' + name + '/index');
    const page = await loaded('/pages/' + name + '/index');
    await miniProgram.pageScrollTo(0);
    await waitUntil(async () => Math.abs(Number(await page.scrollTop())) < 1, 'Tab did not return to its top edge');
    return page;
  }
  async function navigate(route) {
    await miniProgram.navigateTo(route);
    return loaded(route.split('?')[0]);
  }
  async function demo() {
    const mine = await tab('mine');
    expect((await mine.data('session'))?.demo === true, 'UI regression mutations require isolated demo mode');
    return mine;
  }
  async function screen() {
    const info = typeof helpers.viewport === 'function'
      ? await helpers.viewport()
      : await miniProgram.evaluate(() => wx.getWindowInfo());
    return { width: Number(info.windowWidth ?? info.width), height: Number(info.windowHeight ?? info.height) };
  }
  async function onScreen(page, target, label) {
    const box = await measure(target);
    const viewport = await screen();
    expect(box.width > 0 && box.height > 0 && box.x >= -TOLERANCE && box.right <= viewport.width + TOLERANCE
      && box.y >= -TOLERANCE && box.bottom <= viewport.height + TOLERANCE,
    label + ' is outside the viewport', { box, viewport });
    return box;
  }
  async function tap(page, target) {
    const box = await measure(target);
    const scroll = Number(await page.scrollTop()) || 0;
    const viewport = await screen();
    if (box.y < 0 || box.bottom > viewport.height) {
      await miniProgram.pageScrollTo(Math.max(0, scroll + box.y - 24));
      await waitUntil(async () => {
        const current = await measure(target);
        const bounds = await screen();
        return current.y >= -TOLERANCE && current.bottom <= bounds.height + TOLERANCE;
      }, 'Interactive control did not scroll into view');
    }
    await onScreen(page, target, 'Interactive control');
    await target.tap();
  }
  async function button(scope, selector, expected) {
    let match;
    await waitUntil(async () => {
      for (const target of await scope.$$(selector)) {
        if ((await target.text()).includes(expected)) { match = target; return true; }
      }
      return false;
    }, 'Missing rendered button: ' + selector + ' / ' + expected);
    return match;
  }
  async function text(scope, selector, expected) {
    let target;
    await waitUntil(async () => {
      target = await scope.$(selector);
      return target && (await target.text()).includes(expected);
    }, 'Expected rendered text is missing: ' + selector + ' / ' + expected);
    return target;
  }
  async function renderedValue(page, selector, expected) {
    await waitUntil(async () => {
      const target = await page.$(selector);
      return target && (await target.value()) === expected;
    }, 'Expected input value is not rendered: ' + selector);
  }
  async function closeSheets() {
    const page = await miniProgram.currentPage();
    if (!page) return;
    for (const selector of ['#bank-picker', '#todo-actions', '#detail-manage', '#detail-card-picker', '#detail-rules', '#detail-guide', '#detail-expected']) {
      const component = await page.$(selector);
      if (!component || !(await component.$('.sheet-layer'))) continue;
      const close = await component.$('.sheet-close');
      if (close) await close.tap();
      await waitUntil(async () => !(await component.$('.sheet-layer')), 'Residual sheet did not close: ' + selector);
    }
  }
  async function slots(page, component, selector) {
    const owned = await page.$$(selector);
    return owned.length ? owned : component.$$(selector);
  }
  async function sheetButton(page, id, selector, expected) {
    const component = await element(page, id);
    await element(component, '.sheet-layer');
    const panel = await element(component, '.sheet');
    let previous;
    await waitUntil(async () => {
      const box = await measure(panel);
      const stable = previous && ['x', 'y', 'width', 'height'].every(key => Math.abs(box[key] - previous[key]) < 1);
      previous = box;
      return stable && box.height > 0;
    }, 'Sheet geometry did not settle: ' + id);
    let targets = [];
    let match;
    await waitUntil(async () => {
      targets = await slots(page, component, selector);
      for (const target of targets) {
        if (!expected || (await target.text()).includes(expected)) { match = target; return true; }
      }
      return false;
    }, 'Sheet action did not render: ' + id + ' / ' + (expected || selector));
    if (match) {
      const target = match;
      const scroller = await element(component, '.sheet-body');
      const box = await measure(target);
      const scrollBox = await measure(scroller);
      if (box.y < scrollBox.y || box.bottom > scrollBox.bottom) {
        await scroller.scrollTo(0, Math.max(0, (Number(await scroller.property('scrollTop')) || 0) + box.y - scrollBox.y));
      }
      await waitUntil(async () => {
        const current = await measure(target);
        const bounds = await measure(scroller);
        return current.y >= bounds.y - TOLERANCE && current.bottom <= bounds.bottom + TOLERANCE;
      }, 'Sheet action is clipped by its scroll container');
      await onScreen(page, target, 'Sheet action');
      return target;
    }
    expect(false, 'Sheet action was not rendered', { id, selector, expected });
  }
  async function currentTask(page, id) {
    const tasks = await page.data('tasks');
    const index = tasks.findIndex(item => item.id === id);
    expect(index >= 0, 'Participation is missing from todo rows', { id, tasks });
    let rows = [];
    await waitUntil(async () => {
      rows = await page.$$('.task-row');
      return rows.length === tasks.length;
    }, 'Todo rows did not finish rendering');
    expect(!!rows[index], 'Participation has no rendered todo row', { index });
    return { row: rows[index], task: tasks[index] };
  }
  async function allTasks() {
    const page = await tab('todo');
    await (await button(page, '.tabs .tab', '当前记录')).tap();
    await waitUntil(async () => (await page.data('filter')) === 'all', 'Todo all-record filter did not activate');
    return page;
  }
  async function openAnnual() {
    await demo();
    return navigate('/pages/detail/index?id=annual' + (originalAnnualId ? '&participationId=' + encodeURIComponent(originalAnnualId) : ''));
  }
  async function editableAnnual() {
    const page = await openAnnual();
    const stage = await page.data('detail.participation.stage');
    if (stage === 'skipped') {
      await tap(page, await button(page, '.detail-bottom-bar .primary', '恢复参加'));
      await waitUntil(async () => !(await page.data('busy')) && (await page.data('detail.participation.stage')) !== 'skipped',
        'Could not restore annual participation for the independent draft scenario');
      await helpers.record?.('draft-fixture-recovery', { previousStage: stage, action: 'Resume through the detail UI' });
    }
    expect(!['skipped', 'completed', 'received'].includes(await page.data('detail.participation.stage')),
      'Draft scenario requires an editable annual participation');
    return page;
  }
  async function openAnotherCard(page) {
    await tap(page, await element(page, '.detail-more'));
    await (await sheetButton(page, '#detail-manage', '.sheet-option', TEXT.anotherCard)).tap();
    await waitUntil(async () => (await page.data('showCards')) === true, 'Card picker did not open');
  }
  async function platformCalls() {
    return miniProgram.evaluate(() => getApp().__uiRegressionPlatformCalls);
  }
  async function mock(method, result) {
    await miniProgram.mockWxMethod(method, result);
    platformMocks.push(method);
  }

  await demo();
  await miniProgram.evaluate(() => {
    getApp().__uiRegressionPlatformCalls = { modals: [], subscriptions: [] };
  });
  try {
    await mock('showModal', options => {
      getApp().__uiRegressionPlatformCalls.modals.push({ title: options.title, content: options.content,
        confirmText: options.confirmText, cancelText: options.cancelText });
      return { confirm: true, cancel: false, errMsg: 'showModal:ok' };
    });
    await mock('requestSubscribeMessage', options => {
      getApp().__uiRegressionPlatformCalls.subscriptions.push({ tmplIds: options.tmplIds });
      return { errMsg: 'requestSubscribeMessage:ok', ...Object.fromEntries((options.tmplIds || []).map(id => [id, 'reject'])) };
    });
    // Bypass the simulator's native leave prompt while verifying persisted form
    // contents and the application's explicit recovery confirmation separately.
    await mock('enableAlertBeforeUnload', { errMsg: 'enableAlertBeforeUnload:ok' });
    await mock('disableAlertBeforeUnload', { errMsg: 'disableAlertBeforeUnload:ok' });

    await check('Received todo shows the actual amount and original estimate', async () => {
      const page = await tab('todo');
      await (await button(page, '.tabs .tab', '本期已完成')).tap();
      await waitUntil(async () => (await page.data('filter')) === 'completed', 'Completed filter did not activate');
      const tasks = await page.data('tasks');
      const match = tasks.find(item => item.activityId === 'monthly' && item.rewardLabel === TEXT.actual);
      expect(!!match, 'The earlier receipt scenario must leave a received monthly participation');
      const { row } = await currentTask(page, match.id);
      const reward = await text(row, '.reward', TEXT.actual);
      expect((await reward.text()).includes('18.75'), 'Todo lost the actual receipt amount');
      const estimate = await text(row, '.original-estimate', TEXT.estimate);
      expect(/20(?:\.00)?/.test(await estimate.text()), 'Todo lost the original reward estimate');
      await helpers.record?.('actual-vs-estimate', { actual: await reward.text(), estimate: await estimate.text() });
      await capture('todo-actual-and-estimate');
    });

    await check('Pending totals explain all currencies and currency subtotals agree', async () => {
      const todo = await tab('todo');
      const total = await todo.data('pendingCount');
      expect(total >= 2, 'Fixture must include pending rewards in at least two currencies');
      await text(todo, '.follow-up-scope', TEXT.allCurrencies);
      await tap(todo, await button(todo, '.follow-up', '待确认'));
      const rewards = await loaded('/pages/rewards/index');
      expect((await rewards.data('tab')) === 'pending', 'Todo entry did not open pending rewards');
      await text(rewards, '.all-periods', TEXT.allCurrencies);
      const counts = await rewards.data('pendingCurrencies');
      expect(counts.filter(item => item.count > 0).length >= 2, 'Fixture does not exercise multiple currencies');
      expect(counts.reduce((sum, item) => sum + item.count, 0) === total && (await rewards.data('pendingCount')) === total,
        'Todo total differs from currency subtotals', { total, counts });
      for (const currency of counts) {
        await tap(rewards, (await rewards.$$('.currency-tab'))[currency.index]);
        await waitUntil(async () => !(await rewards.data('loading')) && (await rewards.data('currencyIndex')) === currency.index,
          'Currency filter did not settle');
        expect((await rewards.data('pending')).length === currency.count, 'Currency count differs from its displayed rows', { currency });
        await text(rewards, '.section-heading', currency.name + ' ' + currency.count);
      }
      await helpers.record?.('pending-counts', { total, counts });
      await capture('pending-currency-scopes');
    });

    await check('Mine and todo open complete participation history across periods', async () => {
      for (const origin of ['mine', 'todo']) {
        const page = await tab(origin);
        await tap(page, await button(page, origin === 'mine' ? '.menu-row' : '.history-entry', TEXT.history));
        const history = await loaded('/pages/history/index');
        expect(!(await history.data('activityId')), 'Global history unexpectedly contains an activity filter', { origin });
        const items = await history.data('items');
        expect(new Set(items.map(item => item.activityId)).size > 1, 'Global history must contain different activities');
        expect(items.some(item => item.id === 'demo-prior-pending'), 'Previous-period participation is inaccessible');
        expect(new Set(items.filter(item => item.activityId === 'monthly').map(item => item.period)).size >= 2,
          'Monthly history lost its earlier period');
        await text(history, '.history-scope', '全部活动 · 全部周期');
        await tap(history, await element(history, '.history-help'));
        await waitUntil(async () => (await history.data('showRecordHelp')) === true, 'History explanation did not expand');
        await text(history, '.history-description', '全部活动、全部周期');
        await capture('global-history-from-' + origin);
      }
    });

    await check('Duplicate card names require a readable nickname before creation', async () => {
      let page = await openAnnual();
      const initial = await page.data('detail.participation');
      originalAnnualId = initial.id;
      expect(initial.cardId === 'demo-card-boc', 'Annual fixture is not linked to its original card');
      await openAnotherCard(page);
      await (await sheetButton(page, '#detail-card-picker', '.sheet-wide', TEXT.addCard)).tap();
      page = await loaded('/pages/card-edit/index');
      const data = await page.data();
      expect(data.banks[data.bankIndex].id === 'boc', 'Activity bank context was lost by the card form');
      expect(data.issuerOptions.every(issuer => issuer.bankId === 'boc'), 'Issuer choices do not belong to the activity bank');
      await text(page, '#field-bankId', '中国银行');
      const issuerIndex = data.issuerOptions.findIndex(issuer => issuer.id === 'boc-mo');
      const networkIndex = data.networks.findIndex(network => network.value === 'mastercard');
      expect(issuerIndex >= 0 && networkIndex >= 0, 'Annual card requirements are unavailable');
      await (await element(page, '#field-issuerId picker')).trigger('change', { value: String(issuerIndex) });
      await waitUntil(async () => (await page.data('issuerIndex')) === issuerIndex, 'Issuer selection did not update');
      await (await element(page, '#field-network picker')).trigger('change', { value: String(networkIndex) });
      await waitUntil(async () => (await page.data('networkIndex')) === networkIndex, 'Card network selection did not update');
      const originalCard = data.raw.cards.find(card => card.id === 'demo-card-boc');
      await (await element(page, '#field-nickname input')).input(originalCard.nickname);
      await waitUntil(async () => (await page.data('nickname')) === originalCard.nickname && await page.data('draftSaved'),
        'New card input was not received or persisted');
      await capture('card-bank-context');
      await tap(page, await element(page, '.save-button'));
      await waitUntil(async () => !!(await page.data('errors.nickname')) && !(await page.data('saving')),
        'Duplicate card nickname was not rejected');
      expect((await miniProgram.currentPage()).path === page.path, 'Duplicate nickname unexpectedly saved and navigated away');
      await text(page, '#field-nickname .field-error', '与另一张卡难以区分');
      expect((await page.data('nickname')) === originalCard.nickname, 'Nickname validation discarded the entered name');
      await capture('duplicate-card-name-feedback');
      const readableNickname = '澳门旅行卡';
      await (await element(page, '#field-nickname input')).input(readableNickname);
      await waitUntil(async () => (await page.data('nickname')) === readableNickname && !(await page.data('errors.nickname')),
        'A readable unique nickname did not clear the error');
      await tap(page, await element(page, '.save-button'));
      page = await loaded('/pages/detail/index');
      await openAnotherCard(page);
      const cards = await page.data('cards');
      const created = cards.find(card => card.id !== originalCard.id && card.matches && card.name === readableNickname);
      expect(!!created, 'The second matching card was not saved');
      secondCardId = created.id;
      expect(cards.find(card => card.id === originalCard.id).name === originalCard.nickname,
        'A unique existing nickname gained an opaque identifier');
      await (await sheetButton(page, '#detail-card-picker', '.card-option', created.name)).tap();
      await waitUntil(async () => (await page.data('selectedCardId')) === secondCardId, 'The second card selection did not update');
      await (await sheetButton(page, '#detail-card-picker', '.sheet-confirm')).tap();
      await waitUntil(async () => !(await page.data('busy')) && (await page.data('detail.participation.cardId')) === secondCardId,
        'Second card did not receive its own participation');
      secondAnnualId = await page.data('detail.participation.id');
      expect(secondAnnualId !== originalAnnualId, 'Two cards share the same participation');
      page = await allTasks();
      const first = await currentTask(page, originalAnnualId);
      const second = await currentTask(page, secondAnnualId);
      const firstLabel = await (await element(first.row, '.task-card')).text();
      const secondLabel = await (await element(second.row, '.task-card')).text();
      expect(firstLabel === originalCard.nickname && secondLabel === readableNickname,
        'Todo rows do not preserve the readable card names', { firstLabel, secondLabel });
      expect(![firstLabel, secondLabel].some(label => label.includes('标识') || /\b[A-Z0-9]{7}\b/.test(label)),
        'Card labels expose opaque system identifiers', { firstLabel, secondLabel });
      await helpers.record?.('card-identities', { firstLabel, secondLabel, originalAnnualId, secondAnnualId });
      await capture('readable-card-participations');
    });

    await check('Skipped todo hides receipt actions and recovery restores an executable flow', async () => {
      await demo();
      let page = await allTasks();
      if (!originalAnnualId) originalAnnualId = (await page.data('tasks')).find(item => item.activityId === 'annual')?.id || '';
      expect(!!originalAnnualId, 'Annual participation is missing');
      let task = await currentTask(page, originalAnnualId);
      await tap(page, await element(task.row, '.more-button'));
      await (await sheetButton(page, '#todo-actions', '.sheet-actions button', TEXT.skip)).tap();
      await waitUntil(async () => !(await page.data('busyId')) && (await page.data('tasks')).some(item => item.id === originalAnnualId && item.skipped),
        'Skipping did not update the actual participation');
      task = await currentTask(page, originalAnnualId);
      await text(task.row, '.task-primary', '恢复参与');
      expect((await task.row.$$('.task-primary')).length === 1 && (await task.row.$$('.task-actions button')).length === 2,
        'Skipped row does not present recovery as its single primary action');
      await tap(page, await element(task.row, '.task-open'));
      page = await loaded('/pages/detail/index');
      expect((await page.data('detail.participation.id')) === originalAnnualId
        && (await page.data('view.primaryAction')) === 'resume', 'Skipped detail points to the wrong recovery action');
      await text(page, '.detail-primary', '恢复参加');
      expect((await page.$$('.detail-bottom-bar button')).length === 2, 'Skipped detail has competing primary actions');
      await tap(page, await element(page, '.detail-more'));
      await sheetButton(page, '#detail-manage', '.sheet-option', '参与与操作记录');
      const skippedSheet = await element(page, '#detail-manage');
      const skippedActions = await Promise.all((await slots(page, skippedSheet, '.option-title')).map(action => action.text()));
      expect(skippedActions.every(label => !['确认到账', '直接标记完成', '本期不参加'].includes(label.trim())),
        'Skipped detail exposes an unavailable result action', { skippedActions });
      await capture('skipped-detail-actions');
      page = await allTasks();
      task = await currentTask(page, originalAnnualId);
      await tap(page, await element(task.row, '.more-button'));
      await waitUntil(async () => (await page.data('actionStage')) === 'skipped' && await page.data('showActions'),
        'Skipped participation actions did not open');
      await sheetButton(page, '#todo-actions', '.sheet-actions button', TEXT.resume);
      const component = await element(page, '#todo-actions');
      let labels = [];
      await waitUntil(async () => {
        const actions = await slots(page, component, '.sheet-actions button');
        labels = await Promise.all(actions.map(action => action.text()));
        return labels.some(label => label.includes(TEXT.resume)) && labels.every(label => !label.includes(TEXT.skip));
      }, 'Skipped participation menu still renders its previous state');
      expect(labels.every(label => !label.includes('到账')), 'Skipped record still exposes a receipt dead end', { labels });
      await capture('skipped-task-actions');
      await (await sheetButton(page, '#todo-actions', '.sheet-actions button', TEXT.resume)).tap();
      await waitUntil(async () => !(await page.data('busyId')) && (await page.data('tasks')).some(item => item.id === originalAnnualId && !item.skipped),
        'Resume did not restore the participation');
      task = await currentTask(page, originalAnnualId);
      await text(task.row, '.task-primary', '标记完成');
      await tap(page, await element(task.row, '.more-button'));
      await (await sheetButton(page, '#todo-actions', '.task-more-receipt')).tap();
      const receipt = await loaded('/pages/receipt/index');
      expect(await receipt.data('allowed'), 'Restored task cannot record a receipt');
      expect((await receipt.data('participation'))?.id === originalAnnualId, 'Restored action points to the wrong participation');
      await text(receipt, '.entry-card', '关联卡片');
      await capture('resumed-receipt-form');
      await tab('mine');
    });

    await check('Wallet keeps billing settings folded and demo reminders do not imply authorization', async () => {
      await demo();
      const page = await tab('wallet');
      const groups = await page.data('groups');
      const index = groups.findIndex(group => group.primaryBill && !group.primaryBill.paid && !group.archived);
      expect(index >= 0, 'Fixture has no unpaid bill');
      expect(groups.every(group => !group.expanded), 'Billing settings are expanded before the user requests them');
      let group = (await page.$$('.account-group'))[index];
      expect(!(await group.$('.account-extra')), 'Low-frequency billing settings occupy the default view');
      await tap(page, await element(group, '.account-settings'));
      await element(group, '.account-extra');
      await text(group, '.account-edit', '编辑卡片与账单规则');
      await tap(page, await element(group, '.account-settings'));
      await waitUntil(async () => !(await group.$('.account-extra')), 'Billing settings did not collapse');
      const before = await platformCalls();
      group = (await page.$$('.account-group'))[index];
      await tap(page, await element(group, '.reminder-button'));
      await waitUntil(async () => !(await page.data('reminderBusyId')) && (await platformCalls()).modals.length > before.modals.length,
        'Demo reminder did not explain its scope');
      const after = await platformCalls();
      const modal = after.modals[after.modals.length - 1];
      expect(modal.title === TEXT.demoReminder && modal.content.includes('不发送微信消息'), 'Demo reminder explanation is misleading', { modal });
      expect(after.subscriptions.length === 0, 'Demo attempted a platform subscription request', { subscriptions: after.subscriptions });
      expect(!(await page.data('reminderNotice')).includes('已申请'), 'Demo incorrectly claims that a reminder was authorized');
      await helpers.record?.('reminder-platform-boundary', { modal, subscriptionRequests: after.subscriptions.length, realAuthorizationTested: false });
      await capture('wallet-folded-settings');
    });

    await check('Activity titles share the reading edge and joined activity entry is secondary', async () => {
      const activities = await tab('activities');
      await (await activities.$$('.bank-choice'))[0].tap();
      await waitUntil(async () => !(await activities.data('loading')) && (await activities.data('bankId')) === '', 'All-bank feed did not load');
      const tiles = await activities.$$('.activity-tile');
      expect(tiles.length >= 3, 'Activity feed is missing its fixture cards');
      const geometry = [];
      for (let index = 0; index < Math.min(3, tiles.length); index += 1) {
        let tile;
        let title;
        let alignment;
        await waitUntil(async () => {
          tile = (await activities.$$('.activity-tile'))[index];
          title = tile && await tile.$('.tile-title');
          if (!title) return false;
          alignment = { textAlign: await title.style('text-align'), direction: await title.style('direction') };
          await helpers.record?.('activity-title-style-' + index, alignment);
          return alignment.textAlign === 'left';
        }, 'Activity title text is not left aligned');
        const titleBox = await measure(title);
        const bankBox = await measure(await element(tile, '.offer-bank'));
        const descriptionBox = await measure(await element(tile, '.tile-description'));
        expect(alignment.textAlign === 'left', 'Activity title text is not left aligned', { alignment });
        expect(Math.abs(titleBox.x - bankBox.x) <= TOLERANCE && Math.abs(titleBox.x - descriptionBox.x) <= TOLERANCE,
          'Activity title does not share the bank and rules reading edge', { titleBox, bankBox, descriptionBox });
        geometry.push({ titleBox, bankBox, descriptionBox, alignment });
      }
      await capture('activity-reading-edges');
      const page = await navigate('/pages/detail/index?id=monthly');
      expect(!!(await page.data('detail.participation')), 'Fixture monthly detail is not joined');
      const entry = await element(page, '.entry-open.is-secondary');
      const primary = await element(page, '.detail-bottom-bar .primary');
      let entryColor;
      let primaryColor;
      await waitUntil(async () => {
        entryColor = await entry.style('background-color');
        primaryColor = await primary.style('background-color');
        return !!entryColor && !!primaryColor && entryColor !== primaryColor;
      }, 'Detail action colors did not reflect their visual hierarchy');
      expect(entryColor !== primaryColor, 'Entry and next-step action have the same visual emphasis', { entryColor, primaryColor });
      expect((await measure(entry)).height >= 44 && (await measure(primary)).height >= 44,
        'Detail actions lost their minimum touch height');
      await helpers.record?.('activity-hierarchy', { geometry, entryColor, primaryColor });
      await capture('joined-detail-hierarchy');
    });

    await check('Unsaved card input restores from its own local draft without creating a card', async () => {
      let page = await tab('wallet');
      const count = await page.data('cardCount');
      await tap(page, await button(page, '.page-heading .text-button', '添加卡片'));
      page = await loaded('/pages/card-edit/index');
      await (await element(page, '#field-nickname input')).input(TEXT.draftNickname);
      await waitUntil(async () => (await page.data('nickname')) === TEXT.draftNickname && await page.data('draftSaved'),
        'Card input was not persisted as a draft');
      const calls = (await platformCalls()).modals.length;
      await tab('wallet');
      page = await navigate('/pages/card-edit/index');
      await waitUntil(async () => (await page.data('nickname')) === TEXT.draftNickname && await page.data('dirty'), 'Card draft did not recover');
      await renderedValue(page, '#field-nickname input', TEXT.draftNickname);
      expect((await platformCalls()).modals.slice(calls).some(modal => modal.title === TEXT.draftTitle), 'Card draft recovery skipped confirmation');
      await capture('card-draft-recovered');
      page = await tab('wallet');
      expect((await page.data('cardCount')) === count, 'Recovering an unsaved card silently created a card');
    });

    await check('Unsaved progress restores after navigation without changing the participation', async () => {
      let page = await editableAnnual();
      const record = await page.data('detail.participation');
      const progress = record.progress === 0 ? '0.5' : '0';
      await tap(page, await element(page, '.progress-heading .text-button'));
      page = await loaded('/pages/progress/index');
      await (await element(page, '#progress')).input(progress);
      await waitUntil(async () => (await page.data('progressInput')) === progress && await page.data('dirty'),
        'Progress input was not received or marked unsaved');
      const calls = (await platformCalls()).modals.length;
      await tab('mine');
      page = await navigate('/pages/progress/index?activityId=annual&id=' + encodeURIComponent(record.id));
      await waitUntil(async () => (await page.data('progressInput')) === progress, 'Progress draft lost the user input');
      expect((await page.data('participation.progress')) === record.progress, 'Draft recovery changed the stored progress');
      await renderedValue(page, '#progress', progress);
      expect(await page.data('reapplyRequired'), 'Recovered progress lacks an explicit save decision');
      expect((await platformCalls()).modals.slice(calls).some(modal => modal.title === TEXT.draftTitle), 'Progress draft recovery skipped confirmation');
      await text(page, '.entry-primary', '重新应用并保存');
      await capture('progress-draft-recovered');
      await tab('mine');
    });

    await check('Unsaved receipt restores amount and date without recording income', async () => {
      let page = await editableAnnual();
      const record = await page.data('detail.participation');
      await tap(page, await element(page, '.detail-more'));
      await (await sheetButton(page, '#detail-manage', '.sheet-option', '确认到账')).tap();
      page = await loaded('/pages/receipt/index');
      const date = await page.data('receivedOn');
      const period = await page.data('periodText');
      expect(!!period && (await page.data('receiptTarget.periodKey')) === record.periodKey,
        'Receipt form does not identify the original participation period');
      await (await element(page, '#amount')).input('42.25');
      await waitUntil(async () => (await page.data('amountInput')) === '42.25' && await page.data('dirty'),
        'Receipt input was not received or marked unsaved');
      const calls = (await platformCalls()).modals.length;
      await tab('mine');
      page = await navigate('/pages/receipt/index?activityId=annual&id=' + encodeURIComponent(record.id));
      await waitUntil(async () => (await page.data('amountInput')) === '42.25' && (await page.data('receivedOn')) === date,
        'Receipt draft lost its amount or receipt date');
      await renderedValue(page, '#amount', '42.25');
      expect((await page.data('participation.stage')) === record.stage && !(await page.data('participation.receivedOn')),
        'Draft recovery silently recorded income');
      const recovery = (await platformCalls()).modals.slice(calls).find(modal => modal.title === '恢复活动记录草稿？');
      expect(!!recovery, 'Receipt draft recovery skipped its period-aware confirmation');
      expect(recovery.confirmText === '恢复草稿' && recovery.cancelText === '放弃草稿'
        && recovery.content.includes('草稿归属：' + period) && recovery.content.includes('当前显示：' + period)
        && recovery.content.includes('恢复只取回金额和日期') && recovery.content.includes('需要另行确认目标再保存'),
      'Receipt recovery confirmation omits its period or explicit save boundary', { recovery, period });
      expect((await page.data('receiptTarget.periodKey')) === record.periodKey
        && (await page.data('receiptTarget.participationId')) === record.id,
      'Recovered receipt draft changed its original participation target');
      await helpers.record?.('receipt-draft-confirmation', { recovery, participationId: record.id, periodKey: record.periodKey });
      await text(page, '.entry-primary', '重新应用并保存');
      await capture('receipt-draft-recovered');
      await tab('mine');
    });

    await check('Submission draft preserves input and section without submitting for review', async () => {
      let page = await demo();
      await tap(page, await button(page, '.menu-row', '分享活动'));
      page = await loaded('/pages/submission-lead/index');
      await tap(page, await button(page, 'button', '填写完整规则'));
      page = await loaded('/pages/submission-edit/index');
      await (await element(page, '#title')).input(TEXT.submissionTitle);
      await waitUntil(async () => (await page.data('draft.title')) === TEXT.submissionTitle, 'Submission title input did not update');
      await tap(page, await element(page, '#section-rules .section-heading'));
      await waitUntil(async () => (await page.data('openSection')) === 'rules', 'Submission rules section did not open');
      await (await element(page, '#rewardText')).input('19.50');
      await waitUntil(async () => (await page.data('rewardText')) === '19.50', 'Submission reward input did not update');
      await tap(page, await element(page, '.editor-dock .secondary-button'));
      await waitUntil(async () => (await page.data('localDraftStatus')).includes('本机草稿已保存'), 'Submission local save did not report persistence');
      const calls = (await platformCalls()).modals.length;
      await tab('mine');
      page = await navigate('/pages/submission-edit/index');
      await waitUntil(async () => (await page.data('draft.title')) === TEXT.submissionTitle && (await page.data('rewardText')) === '19.50'
        && (await page.data('openSection')) === 'rules', 'Submission draft lost values or section');
      expect(!(await page.data('submissionId')) && !(await page.data('submission')), 'Local draft was silently submitted');
      await renderedValue(page, '#rewardText', '19.50');
      expect((await platformCalls()).modals.slice(calls).some(modal => modal.title === TEXT.draftTitle), 'Submission draft recovery skipped confirmation');
      await text(page, '.draft-status', '尚未提交');
      await capture('submission-draft-recovered');
      await tab('mine');
    });
  } finally {
    await closeSheets();
    for (const method of platformMocks.reverse()) await miniProgram.restoreWxMethod(method);
    await miniProgram.evaluate(() => { delete getApp().__uiRegressionPlatformCalls; });
  }
}
