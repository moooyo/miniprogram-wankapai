const TEXT = {
  todo: '\u6211\u7684\u5f85\u529e',
  activities: '\u6d3b\u52a8',
  rewards: '\u6536\u76ca',
  wallet: '\u5361\u5305',
  mine: '\u6211\u7684',
  bankSearch: '\u62db\u5546',
  bankSheet: '\u5168\u90e8\u94f6\u884c',
  submit: '\u5206\u4eab\u6d3b\u52a8',
  titleRequired: '活动名称',
  completed: '\u5df2\u5b8c\u6210',
  received: '\u6536\u76ca\u5df2\u5230\u8d26',
  moderator: '\u8fd0\u8425\u5ba1\u6838',
  user: '\u666e\u901a\u7528\u6237',
  review: '\u6d3b\u52a8\u5ba1\u6838',
  permission: '\u5ba1\u6838\u6743\u9650',
};

const TOLERANCE = 3;
const hasChinese = value => /[\u3400-\u9fff]/.test(value);

export async function runUiScenarios(miniProgram, helpers) {
  const { check, expect, capture, measure, waitUntil } = helpers;

  async function viewport() {
    const info = typeof helpers.viewport === 'function'
      ? await helpers.viewport()
      : helpers.viewport || await miniProgram.callWxMethod('getWindowInfo');
    return {
      width: Number(info.windowWidth ?? info.width),
      height: Number(info.windowHeight ?? info.height),
    };
  }

  async function element(scope, selector) {
    let found;
    await waitUntil(async () => {
      found = await scope.$(selector);
      return !!found;
    }, 'Element was not rendered: ' + selector);
    return found;
  }

  async function renderedText(scope, selector, expected) {
    let found;
    let text = '';
    await waitUntil(async () => {
      found = await scope.$(selector);
      if (!found) return false;
      text = await found.text();
      return text.includes(expected);
    }, 'Expected rendered text in ' + selector);
    expect(hasChinese(text), 'Expected Chinese interface text', { selector, text });
    const box = await measure(found);
    expect(box.width > 0 && box.height > 0, 'Text has no rendered area', { selector, box });
    return found;
  }

  async function loadedPage(route) {
    const page = await helpers.waitForPage(route);
    const data = await page.data();
    expect(data.failed !== true, 'Page reported a loading failure', { route });
    expect(!data.error && !data.loadError, 'Page reported an error', {
      route, error: data.error, loadError: data.loadError,
    });
    return page;
  }

  async function tab(name) {
    const route = '/pages/' + name + '/index';
    await miniProgram.switchTab(route);
    const page = await loadedPage(route);
    await miniProgram.pageScrollTo(0);
    return page;
  }

  async function requireDemo() {
    const mine = await tab('mine');
    const session = await mine.data('session');
    expect(session?.demo === true, 'Mutating UI scenarios require an isolated demo fixture', { session });
    return mine;
  }

  async function buttonByText(scope, selector, expected) {
    let found;
    await waitUntil(async () => {
      for (const candidate of await scope.$$(selector)) {
        if ((await candidate.text()).includes(expected)) { found = candidate; return true; }
      }
      return false;
    }, 'Button with expected text was not rendered: ' + selector + ' / ' + expected);
    return found;
  }

  async function todoRow(page, id) {
    let row;
    await waitUntil(async () => {
      const tasks = await page.data('tasks');
      const index = tasks.findIndex(item => item.id === id);
      const rows = await page.$$('.task-row');
      if (index < 0 || rows.length !== tasks.length) return false;
      row = rows[index];
      return !!row;
    }, 'Participation did not render in todo: ' + id);
    return row;
  }

  async function visibleBox(page, target) {
    return measure(target);
  }

  async function expectOnScreen(page, target, label) {
    const box = await visibleBox(page, target);
    const screen = await viewport();
    expect(box.width > 0 && box.height > 0, label + ' has no rendered area', { box });
    expect(
      box.x >= -TOLERANCE && box.y >= -TOLERANCE
      && box.right <= screen.width + TOLERANCE && box.bottom <= screen.height + TOLERANCE,
      label + ' is outside the viewport',
      { box, screen },
    );
    return box;
  }

  async function stableMeasure(target) {
    let previous;
    let current;
    await waitUntil(async () => {
      current = await measure(target);
      const stable = previous && ['x', 'y', 'width', 'height'].every(
        key => Math.abs(current[key] - previous[key]) < 1,
      );
      previous = current;
      return current.width > 0 && current.height > 0 && stable;
    }, 'Rendered geometry did not settle');
    return current;
  }

  async function scrollToAndTap(page, selector) {
    await miniProgram.callWxMethod('pageScrollTo', { selector, duration: 0 });
    const target = await element(page, selector);
    await waitUntil(async () => {
      const box = await measure(target), screen = await viewport();
      return box.y >= -TOLERANCE && box.bottom <= screen.height + TOLERANCE;
    }, 'Scrolled control did not become visible: ' + selector);
    await expectOnScreen(page, target, selector);
    await target.tap();
  }

  async function tapVisible(page, target) {
    const box = await visibleBox(page, target);
    const screen = await viewport();
    if (box.y < 0 || box.bottom > screen.height) {
      const scrollTop = Number(await page.scrollTop()) || 0;
      await miniProgram.pageScrollTo(Math.max(0, scrollTop + box.y - 24));
      await waitUntil(async () => {
        const current = await visibleBox(page, target);
        return current.y >= -TOLERANCE && current.bottom <= screen.height + TOLERANCE;
      }, 'Target did not scroll into the viewport');
    }
    await expectOnScreen(page, target, 'Interactive target');
    await target.tap();
  }

  async function slotElements(page, component, selector) {
    const owned = await page.$$(selector);
    return owned.length ? owned : component.$$(selector);
  }

  async function slotElement(page, component, selector) {
    let matches = [];
    await waitUntil(async () => {
      matches = await slotElements(page, component, selector);
      return matches.length > 0;
    }, 'Slot element was not rendered: ' + selector);
    return matches[0];
  }

  async function closeActivitySheet(page) {
    const component = await page.$('#bank-picker');
    if (!component) return;
    const close = await component.$('.sheet-close');
    if (close) {
      await close.tap();
      await waitUntil(async () => !(await component.$('.sheet-layer')), 'Bank sheet did not close');
    }
  }

  async function detailActions(page, expected, name) {
    const primary = await renderedText(page, '.detail-primary', expected.label);
    expect((await page.data('view.primaryAction')) === expected.action,
      'Detail does not identify the expected next action', { expected, view: await page.data('view') });
    const actions = await element(page, '.detail-bottom-bar');
    const buttons = await actions.$$('button');
    expect(buttons.length === 2 && (await actions.$$('.detail-primary')).length === 1
      && (await actions.$$('.detail-more')).length === 1,
    'Detail must render one primary action and one More control', { count: buttons.length });
    const more = await renderedText(page, '.detail-more', '更多');
    const primaryBox = await expectOnScreen(page, primary, 'Detail primary action');
    const moreBox = await expectOnScreen(page, more, 'Detail More control');
    expect(primaryBox.width >= 44 && primaryBox.height >= 44 && moreBox.width >= 44 && moreBox.height >= 44
      && moreBox.right <= primaryBox.x + TOLERANCE && Math.abs(moreBox.y - primaryBox.y) <= TOLERANCE,
    'Detail action targets overlap or lose their touch area', { primaryBox, moreBox });
    await capture(name + '-primary');
    await more.tap();
    const component = await element(page, '#detail-manage');
    await element(component, '.sheet-layer');
    await stableMeasure(await element(component, '.sheet'));
    let labels = [];
    await waitUntil(async () => {
      labels = await Promise.all((await slotElements(page, component, '.option-title')).map(target => target.text()));
      labels = labels.map(label => label.trim());
      return expected.present.every(label => labels.includes(label))
        && expected.absent.every(label => !labels.includes(label));
    }, 'Detail More actions do not match the current participation stage');
    expect(!labels.includes(expected.label), 'Detail repeats its primary action in More', { expected, labels });
    await helpers.record?.(name, { primaryAction: expected.action, primaryLabel: expected.label, primaryBox, moreBox, moreActions: labels });
    await capture(name + '-more');
    await (await element(component, '.sheet-close')).tap();
    await waitUntil(async () => !(await page.data('showManage')) && !(await component.$('.sheet-layer')),
      'Detail More sheet did not close');
  }

  const tabCases = [
    { name: 'todo', selector: '.heading', text: TEXT.todo },
    { name: 'activities', selector: '.feed-heading .section-title', text: TEXT.activities },
    { name: 'rewards', selector: '.heading', text: TEXT.rewards },
    { name: 'wallet', selector: '.heading', text: TEXT.wallet },
    { name: 'mine', selector: '.page-title', text: TEXT.mine },
  ];

  for (const entry of tabCases) {
    await check('Tab renders Chinese content: ' + entry.name, async () => {
      const page = await tab(entry.name);
      await renderedText(page, entry.selector, entry.text);
      if (entry.name === 'mine') {
        const session = await page.data('session');
        expect(session?.demo === true, 'Expected the isolated demo session');
      }
      await capture('tab-' + entry.name);
    });
  }

  await check('Todo groups reflect urgency and each row has one clear primary action', async () => {
    const page = await tab('todo');
    const data = await page.data();
    const index = data.tasks.findIndex(task => task.activityId === 'monthly' && !task.closed && !task.skipped);
    expect(index >= 0, 'Fixture is missing an unfinished monthly task');
    const rows = await page.$$('.task-row');
    const row = rows[index];
    expect(!!row, 'Monthly task has no rendered row', { index, rows: rows.length });
    const body = await measure(await element(row, '.task-body'));
    const opener = await measure(await element(row, '.task-open'));
    const bank = await measure(await element(row, '.bank-line'));
    const title = await measure(await element(row, '.task-title'));
    expect(Math.abs(opener.width - body.width) <= TOLERANCE, 'Task opener does not fill its content column', { body, opener });
    expect(title.y >= bank.bottom - TOLERANCE, 'Task title overlaps the bank line', { bank, title });
    const actions = await element(row, '.task-actions');
    const container = await measure(actions);
    const buttons = await actions.$$('button');
    expect(buttons.length === 2, 'Expected one primary action and one more control', { count: buttons.length });
    expect((await actions.$$('.task-primary')).length === 1 && (await actions.$$('.more-button')).length === 1,
      'Todo row does not expose exactly one primary action');
    await renderedText(actions, '.task-primary', '更新进度');
    const boxes = await Promise.all(buttons.map(target => measure(target)));
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      expect(box.width >= 44 && box.height >= 44, 'Task action has an invalid touch target', { index: i, box });
      expect(box.x >= container.x - TOLERANCE && box.right <= container.right + TOLERANCE,
        'Task action overflows its container', { container, box });
      expect(Math.abs(box.y - boxes[0].y) <= TOLERANCE, 'Task actions unexpectedly wrap into separate rows', { boxes });
      if (i) expect(box.x >= boxes[i - 1].right - TOLERANCE, 'Task actions overlap', { boxes });
    }
    const today = data.raw.today;
    const day = Date.parse(today + 'T00:00:00Z');
    const groups = [];
    let previousRank = -1;
    const counts = new Map();
    for (const task of data.tasks) {
      const daysRemaining = (Date.parse(task.deadline + 'T00:00:00Z') - day) / 86400000;
      const expectedGroup = daysRemaining < 0 ? 'overdue' : daysRemaining <= 7 ? 'soon' : 'later';
      const rank = ['overdue', 'soon', 'later'].indexOf(expectedGroup);
      expect(task.groupKey === expectedGroup && rank >= previousRank, 'Todo groups do not prioritize actual deadlines', {
        today, task, expectedGroup, previousRank,
      });
      previousRank = rank;
      counts.set(expectedGroup, (counts.get(expectedGroup) || 0) + 1);
    }
    await waitUntil(async () => (await page.$$('.task-group-heading')).length === counts.size,
      'Todo section headings did not render');
    const headings = await page.$$('.task-group-heading');
    const groupLabels = { overdue: '已逾期', soon: '未来7天内截止', later: '其他活动' };
    let groupIndex = 0;
    for (const [key, count] of counts) {
      const rendered = await headings[groupIndex++].text();
      expect(rendered.includes(groupLabels[key]) && rendered.includes(String(count)), 'Urgency heading lost its label or count', {
        key, count, rendered,
      });
      groups.push({ key, count, rendered });
    }
    await helpers.record?.('todo-geometry', { body, opener, bank, title, actions: boxes, groups });
    await capture('todo-geometry');
  });

  await check('Activity controls preserve fixed and full-width button geometry', async () => {
    const page = await tab('activities');
    await closeActivitySheet(page);
    const choices = await page.$$('.bank-choice');
    expect(choices.length >= 3, 'Bank rail is missing choices');
    await choices[0].tap();
    await waitUntil(async () => !(await page.data('loading')), 'Activity filter did not settle');
    for (const choice of choices.slice(0, 3)) {
      const box = await measure(choice);
      expect(Math.abs(box.width - 56) <= TOLERANCE, 'Bank rail button lost its explicit width', { box });
    }
    const heading = await measure(await element(page, '.feed-heading'));
    const headingTitle = await measure(await element(page, '.feed-heading .section-title'));
    const actions = await measure(await element(page, '.feed-actions'));
    expect(headingTitle.right <= actions.x + TOLERANCE, 'Activity heading overlaps its action buttons', { headingTitle, actions });
    expect(actions.right <= heading.right + TOLERANCE, 'Activity heading actions overflow', { heading, actions });
    const tile = await element(page, '.activity-tile');
    const tileBox = await measure(tile);
    const offer = await measure(await element(tile, '.offer-heading'));
    const edges = await Promise.all(['padding-left', 'padding-right', 'border-left-width', 'border-right-width'].map(name => tile.style(name)));
    const contentWidth = tileBox.width - edges.reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
    expect(Math.abs(offer.width - contentWidth) <= TOLERANCE, 'Activity heading does not fill the card content area', { offer, contentWidth, tileBox });
    await helpers.record?.('activity-geometry', { heading, headingTitle, actions, offer, contentWidth });
    await capture('activities-geometry');
  });

  await check('Bank sheet renders on screen and supports search and selection', async () => {
    const page = await tab('activities');
    await closeActivitySheet(page);
    await (await element(page, '.all-banks')).tap();
    const component = await element(page, '#bank-picker');
    const layer = await element(component, '.sheet-layer');
    const mask = await element(component, '.sheet-mask');
    const panel = await element(component, '.sheet');
    await stableMeasure(panel);
    const screen = await viewport();
    for (const [name, target] of [['layer', layer], ['mask', mask]]) {
      const box = await expectOnScreen(page, target, 'Bank sheet ' + name);
      expect(Math.abs(box.x) <= TOLERANCE && Math.abs(box.y) <= TOLERANCE
        && Math.abs(box.width - screen.width) <= TOLERANCE
        && Math.abs(box.height - screen.height) <= TOLERANCE,
      'Bank sheet ' + name + ' does not cover the viewport', { box, screen });
    }
    const panelBox = await expectOnScreen(page, panel, 'Bank sheet panel');
    expect(Math.abs(panelBox.bottom - screen.height) <= TOLERANCE, 'Bank sheet is not anchored to the viewport bottom', { panelBox, screen });
    await renderedText(component, '.sheet-head', TEXT.bankSheet);
    const closeBox = await measure(await element(component, '.sheet-close'));
    expect(Math.abs(closeBox.width - 48) <= TOLERANCE && Math.abs(closeBox.height - 48) <= TOLERANCE,
      'Sheet close button lost its explicit touch target', { closeBox });
    const search = await slotElement(page, component, '.bank-search');
    await expectOnScreen(page, search, 'Bank search input');
    const initialChoices = await slotElements(page, component, '.bank-grid-choice');
    expect(initialChoices.length >= 3, 'Bank sheet is missing its initial grid');
    const firstRow = await Promise.all(initialChoices.slice(0, 3).map(target => measure(target)));
    expect(firstRow.every(box => Math.abs(box.y - firstRow[0].y) <= TOLERANCE),
      'Bank grid does not render three columns', { firstRow });
    expect(firstRow[0].right <= firstRow[1].x + TOLERANCE && firstRow[1].right <= firstRow[2].x + TOLERANCE,
      'Bank grid columns overlap', { firstRow });
    await helpers.record?.('bank-sheet-geometry', { panelBox, screen, closeBox, firstRow });
    await capture('bank-sheet-open');
    await search.input(TEXT.bankSearch);
    await waitUntil(async () => {
      const choices = await slotElements(page, component, '.bank-grid-choice');
      return choices.length === 1 && (await choices[0].text()).includes(TEXT.bankSearch);
    }, 'Bank search did not render its matching result');
    const results = await slotElements(page, component, '.bank-grid-choice');
    await expectOnScreen(page, results[0], 'Bank search result');
    await capture('bank-sheet-search');
    await results[0].tap();
    await waitUntil(async () => !(await component.$('.sheet-layer')), 'Selecting a bank did not dismiss the sheet');
    await waitUntil(async () => !(await page.data('loading')), 'Selected-bank activities did not load');
    await renderedText(page, '.feed-heading .section-title', TEXT.bankSearch);
    const items = await page.data('items');
    expect(items.length > 0, 'Selected bank has no fixture activities');
    await capture('bank-filter-selected');
  });

  await check('Detail presents the next stage action and keeps secondary actions in More', async () => {
    await requireDemo();
    const fixtures = [
      { id: 'monthly', action: 'progress', label: '更新进度',
        present: ['直接标记完成', '确认到账', '本期不参加', '参与与操作记录'],
        absent: ['撤销完成', '撤销到账', '用另一张卡参加'] },
      { id: 'annual', action: 'complete', label: '标记完成',
        present: ['确认到账', '用另一张卡参加', '本期不参加', '参与与操作记录'],
        absent: ['直接标记完成', '撤销完成', '撤销到账'] },
      { id: 'quarterly', action: 'receipt', label: '确认到账',
        present: ['预计到账日', '撤销完成', '参与与操作记录'],
        absent: ['直接标记完成', '本期不参加', '撤销到账'] },
      { id: 'instant', action: 'join', label: '加入待办',
        present: ['直接标记完成', '记录已享优惠', '参与与操作记录'],
        absent: ['预计到账日', '本期不参加', '撤销完成', '撤销优惠记录'] },
    ];
    for (const fixture of fixtures) {
      await tab('activities');
      await miniProgram.navigateTo('/pages/detail/index?id=' + fixture.id);
      const page = await loadedPage('/pages/detail/index');
      await detailActions(page, fixture, 'detail-' + fixture.id);
    }
  });

  await check('Monthly primary action advances from progress to completion to receipt and history', async () => {
    await requireDemo();
    let page = await tab('activities');
    await closeActivitySheet(page);
    const items = await page.data('items');
    const index = items.findIndex(item => item.id === 'monthly');
    expect(index >= 0, 'Fixture is missing the monthly activity');
    const headings = await page.$$('.offer-heading');
    expect(!!headings[index], 'Monthly activity has no rendered entry');
    await tapVisible(page, headings[index]);
    page = await loadedPage('/pages/detail/index');
    let record = await page.data('detail.participation');
    expect(record && record.progress === 2 && !['completed', 'received', 'skipped'].includes(record.stage),
      'Fixture monthly participation must retain its initial progress of two', { progress: record?.progress, stage: record?.stage });
    const participationId = record.id;
    page = await tab('todo');
    await (await buttonByText(page, '.tabs .tab', '未完成')).tap();
    await waitUntil(async () => (await page.data('filter')) === 'unfinished', 'Unfinished filter did not activate');
    let row = await todoRow(page, participationId);
    await tapVisible(page, await renderedText(row, '.task-primary', '更新进度'));
    page = await loadedPage('/pages/progress/index');
    expect(await page.data('editable'), 'Progress form is not editable');
    await (await element(page, '#progress')).input('3');
    await waitUntil(async () => (await page.data('progressInput')) === '3', 'Progress input was not received');
    await scrollToAndTap(page, '.entry-primary');
    page = await loadedPage('/pages/todo/index');
    await waitUntil(async () => (await page.data('raw.tasks')).some(item => item.id === participationId && item.progress === 3),
      'Saved progress was not refreshed in todo');
    row = await todoRow(page, participationId);
    await renderedText(row, '.task-primary', '标记完成');
    await capture('monthly-progress-saved');
    await tapVisible(page, await element(row, '.task-primary'));
    await waitUntil(async () => (await page.data('raw.tasks')).some(item => item.id === participationId && item.stage === 'completed') && !(await page.data('busyId')),
      'Completion did not update the participation');
    await (await buttonByText(page, '.tabs .tab', '本期已完成')).tap();
    await waitUntil(async () => (await page.data('filter')) === 'completed', 'Completed filter did not activate');
    row = await todoRow(page, participationId);
    await tapVisible(page, await renderedText(row, '.task-primary', '确认到账'));
    page = await loadedPage('/pages/receipt/index');
    expect(await page.data('allowed'), 'Receipt form is not available');
    await (await element(page, '#amount')).input('18.75');
    await waitUntil(async () => (await page.data('amountInput')) === '18.75', 'Receipt input was not received');
    await scrollToAndTap(page, '.entry-primary');
    page = await loadedPage('/pages/todo/index');
    await waitUntil(async () => (await page.data('raw.tasks')).some(item => item.id === participationId && item.stage === 'received'),
      'Receipt was not refreshed in todo');
    row = await todoRow(page, participationId);
    await tapVisible(page, await renderedText(row, '.task-primary', '查看记录'));
    page = await loadedPage('/pages/detail/index');
    await renderedText(page, '.progress-current', '已到账');
    record = await page.data('detail.participation');
    expect(record.receivedMinor === 1875, 'Receipt has the wrong amount', { receivedMinor: record.receivedMinor });
    await detailActions(page, { action: 'receipt', label: '修改到账',
      present: ['撤销到账', '参与与操作记录'], absent: ['直接标记完成', '确认到账', '本期不参加', '撤销完成'] },
    'detail-received');
    page = await tab('rewards');
    const receivedTab = await buttonByText(page, '.tabs .tab', '已记录');
    await receivedTab.tap();
    await waitUntil(async () => (await page.data('received')).some(item => item.participationId === participationId),
      'Receipt is missing from the rewards page');
    const received = await page.data('received');
    const rowIndex = received.findIndex(item => item.participationId === participationId);
    const rows = await page.$$('.ledger-row');
    expect(!!rows[rowIndex], 'Receipt has no rendered ledger row');
    const amount = await element(rows[rowIndex], '.ledger-amount');
    expect((await amount.text()).includes('18.75'), 'Rendered ledger amount is incorrect');
    expect((await measure(rows[rowIndex])).height > 0, 'Receipt ledger row is not rendered');
    await capture('monthly-receipt-ledger');
  });

  await check('Lightweight submission shows focused feedback for an empty lead', async () => {
    const mine = await requireDemo();
    await (await buttonByText(mine, '.menu-row', TEXT.submit)).tap();
    const page = await loadedPage('/pages/submission-lead/index');
    expect(await page.data('ready'), 'Lead form did not initialize');
    await (await element(page, '.lead-dock .primary-button')).tap();
    await waitUntil(async () => !!(await page.data('errors.title')), 'Empty submission did not produce a title error');
    const feedback = await renderedText(page, '#field-title .field-error', TEXT.titleRequired);
    await waitUntil(async () => {
      const box = await measure(feedback), bounds = await viewport();
      return box.y >= -TOLERANCE && box.bottom <= bounds.height + TOLERANCE;
    }, 'Lead title feedback did not scroll into view');
    await expectOnScreen(page, feedback, 'Required-title feedback');
    expect((await miniProgram.currentPage()).path === page.path, 'Invalid submission unexpectedly navigated away');
    await capture('submission-required-title');
    await tab('mine');
  });

  await check('Demo review access follows the role picker change event (event-level)', async () => {
    let mine = await requireDemo();
    expect((await mine.data('session')).isModerator === false, 'Fixture must start with the ordinary demo role');
    await miniProgram.navigateTo('/pages/review/index');
    let review = await loadedPage('/pages/review/index');
    expect(await review.data('denied'), 'Ordinary demo role unexpectedly has review access');
    await renderedText(review, '.empty-title', TEXT.permission);
    mine = await tab('mine');
    const picker = await element(mine, '.demo-heading picker');
    // This validates the picker change event, not the native picker popup.
    await picker.trigger('change', { value: '1' });
    try {
      await waitUntil(async () => {
        const data = await mine.data();
        return !data.changingRole && data.session?.isModerator === true;
      }, 'Demo moderator role did not activate');
      await renderedText(mine, '.role-picker', TEXT.moderator);
      await (await buttonByText(mine, '.menu-row', TEXT.review)).tap();
      review = await loadedPage('/pages/review/index');
      expect((await review.data('denied')) === false, 'Moderator review page is denied');
      await renderedText(review, '.page-title', TEXT.review);
      const tabs = await review.$$('.tabs .tab');
      expect(tabs.length === 3, 'Review status tabs are not rendered');
      await capture('demo-moderator-review');
    } finally {
      mine = await tab('mine');
      await (await element(mine, '.demo-heading picker')).trigger('change', { value: '0' });
      await waitUntil(async () => {
        const data = await mine.data();
        return !data.changingRole && data.session?.isModerator === false;
      }, 'Ordinary demo role was not restored');
      await renderedText(mine, '.role-picker', TEXT.user);
    }
  });
}
