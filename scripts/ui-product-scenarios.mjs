const TOLERANCE = 3;
const normalizeRoute = route => String(route || '').replace(/^\//, '');

// These scenarios exercise rendered pages and their normal event handlers.
// Native picker selections are event-level; no domain response or page data is replaced.
// The known prior blank lead draft uses a narrowly matched platform-dialog mock
// because simulator native cancellation did not resolve its recovery promise.
export async function runUiProductScenarios(miniProgram, helpers) {
  const { check, expect, capture, measure, waitUntil } = helpers;

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
    }, 'Missing rendered button: ' + selector + ' / ' + expected);
    return match;
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
    await miniProgram.switchTab('/pages/' + name + '/index');
    const page = await loaded('/pages/' + name + '/index');
    await miniProgram.pageScrollTo(0);
    await waitUntil(async () => Math.abs(Number(await page.scrollTop())) < 1, 'Tab did not return to its top edge');
    return page;
  }

  async function viewport() {
    const info = await helpers.viewport();
    return { width: Number(info.windowWidth ?? info.width), height: Number(info.windowHeight ?? info.height) };
  }

  async function reveal(page, target) {
    const box = await measure(target);
    const bounds = await viewport();
    if (box.y < 0 || box.bottom > bounds.height) {
      const scroll = Number(await page.scrollTop()) || 0;
      await miniProgram.pageScrollTo(Math.max(0, scroll + box.y - 24));
    }
    await waitUntil(async () => {
      const current = await measure(target), screen = await viewport();
      return current.width > 0 && current.height > 0 && current.x >= -TOLERANCE
        && current.right <= screen.width + TOLERANCE && current.y >= -TOLERANCE
        && current.bottom <= screen.height + TOLERANCE;
    }, 'Interactive control did not become visible');
    return target;
  }

  async function tap(page, target) {
    await reveal(page, target);
    await target.tap();
  }

  async function input(page, selector, value) {
    const target = await reveal(page, await element(page, selector));
    await target.input(value);
    await waitUntil(async () => {
      const rendered = await page.$(selector);
      return rendered && (await rendered.value()) === value;
    }, 'Input value did not render: ' + selector);
  }

  async function ordinaryDemo() {
    const mine = await tab('mine');
    const session = await mine.data('session');
    expect(session?.demo === true && session.isModerator === false,
      'Product scenarios require an isolated ordinary demo session', { session });
    await text(mine, '.role-picker', '普通用户');
    return mine;
  }

  async function priorLeadDraft(ownerId) {
    return miniProgram.evaluate(userId => {
      const key = ['card-benefits.form-draft.v1', 'submission-lead', userId, 'new'].map(encodeURIComponent).join(':');
      const saved = wx.getStorageSync(key);
      if (!saved) return { exists: false };
      const lead = saved.value?.lead;
      const fixture = saved.version === 1 && saved.ownerId === userId && saved.entityId === 'new'
        && saved.baseVersion === null && saved.value?.pendingCreation === undefined && lead
        && ['title', 'bankId', 'sourceUrl', 'sourceNote'].every(field => lead[field] === '')
        && Array.isArray(lead.imageIds) && lead.imageIds.length === 0;
      return { exists: true, fixture: !!fixture, revision: saved.revision || '', updatedAt: saved.updatedAt || '' };
    }, ownerId);
  }

  async function freshLead(listPage, ownerId) {
    const prior = await priorLeadDraft(ownerId);
    expect(!prior.exists || prior.fixture,
      'A non-fixture lead draft is present; the product scenario must not discard it', { prior });
    let page;
    let contextCreated = false;
    let modalMockInstalled = false;
    let observed;
    try {
      if (prior.exists) {
        await miniProgram.evaluate((userId, fixture) => {
          const app = getApp();
          if (app.__uiProductLeadRecovery) throw new Error('A prior lead-recovery observer is still active');
          app.__uiProductLeadRecovery = { ownerId: userId, prior: fixture, calls: [] };
        }, ownerId, prior);
        contextCreated = true;
        modalMockInstalled = true;
        await miniProgram.mockWxMethod('showModal', options => {
          const context = getApp().__uiProductLeadRecovery;
          const pages = getCurrentPages();
          const current = pages[pages.length - 1];
          const data = current?.data || {};
          const key = ['card-benefits.form-draft.v1', 'submission-lead', context.ownerId, 'new'].map(encodeURIComponent).join(':');
          const saved = wx.getStorageSync(key);
          const lead = saved?.value?.lead;
          const call = { title: options.title, content: options.content, confirmText: options.confirmText,
            cancelText: options.cancelText, route: current?.route || '', ownerId: data.ownerId || '',
            entityId: data.submissionId || 'new', decision: 'unmatched' };
          const matches = context.calls.length === 0 && call.route === 'pages/submission-lead/index'
            && data.ready === true && data.loading === true && data.ownerId === context.ownerId
            && !data.submissionId && !data.pendingCreationUnconfirmed && !data.dirty
            && saved?.version === 1 && saved.ownerId === context.ownerId && saved.entityId === 'new'
            && saved.baseVersion === null && saved.value?.pendingCreation === undefined
            && (saved.revision || '') === context.prior.revision && (saved.updatedAt || '') === context.prior.updatedAt
            && lead && ['title', 'bankId', 'sourceUrl', 'sourceNote'].every(field => lead[field] === '')
            && Array.isArray(lead.imageIds) && lead.imageIds.length === 0
            && options.title === '发现未保存的草稿' && options.confirmText === '恢复草稿' && options.cancelText === '放弃草稿'
            && options.content === '是否恢复上次未保存的填写内容？恢复后仍需由你确认保存。';
          context.calls.push(call);
          if (!matches) throw new Error('Unexpected modal during the scoped lead-draft decision; no decision was returned');
          call.decision = 'cancel';
          return { confirm: false, cancel: true, errMsg: 'showModal:ok' };
        });
      }
      await tap(listPage, await text(listPage, '.new-button', '分享活动'));
      page = await loaded('/pages/submission-lead/index');
    } finally {
      try {
        if (contextCreated) {
          observed = await miniProgram.evaluate(() => getApp().__uiProductLeadRecovery);
          await helpers.record?.('prior-lead-draft-decision', { prior, calls: observed?.calls || [],
            method: 'SDK mockWxMethod(showModal), exact route, owner, fixture revision and dialog match',
            limitation: 'Simulator native cancelModal did not resolve this recovery promise in the previous run.' });
        }
      } finally {
        try {
          if (modalMockInstalled) await miniProgram.restoreWxMethod('showModal');
        } finally {
          if (contextCreated) await miniProgram.evaluate(() => { delete getApp().__uiProductLeadRecovery; });
        }
      }
    }
    if (prior.exists) expect(observed?.calls?.length === 1 && observed.calls[0].decision === 'cancel',
      'The scoped fixture recovery did not receive exactly one explicit cancellation', { observed });
    else await helpers.record?.('prior-lead-draft-decision', { prior, decision: 'No prior draft', method: 'No modal action' });
    const data = await page.data();
    expect(!data.dirty && !data.pendingCreationUnconfirmed && !data.submissionId
      && ['title', 'bankId', 'sourceUrl', 'sourceNote'].every(field => data.lead[field] === '')
      && data.lead.imageIds.length === 0, 'Fresh lead form retained an earlier scenario draft');
    expect(!(await priorLeadDraft(ownerId)).exists, 'The discarded fixture draft is still offered for recovery');
    return page;
  }

  async function demoRole(mine, moderator) {
    expect((await mine.data('session'))?.demo === true, 'The role picker is only valid for demo fixtures');
    const picker = await reveal(mine, await element(mine, '.demo-heading picker'));
    await picker.trigger('change', { value: moderator ? '1' : '0' });
    await waitUntil(async () => {
      const data = await mine.data();
      return !data.changingRole && data.session?.isModerator === moderator;
    }, 'Demo role did not change');
    await text(mine, '.role-picker', moderator ? '运营审核' : '普通用户');
  }

  async function row(page, selector, dataName, predicate, expectedText) {
    let target, value;
    await waitUntil(async () => {
      const items = await page.data(dataName);
      const index = items.findIndex(predicate);
      const targets = await page.$$(selector);
      if (index < 0 || targets.length !== items.length || !targets[index]) return false;
      target = targets[index];
      value = items[index];
      return (await target.text()).includes(expectedText);
    }, 'Expected row did not render: ' + selector + ' / ' + expectedText);
    return { target, value };
  }

  async function catalog() {
    const page = await tab('activities');
    const sheet = await page.$('#bank-picker');
    if (sheet && await sheet.$('.sheet-layer')) {
      await (await element(sheet, '.sheet-close')).tap();
      await waitUntil(async () => !(await sheet.$('.sheet-layer')), 'Bank sheet did not close');
    }
    await tap(page, await button(page, '.bank-choice', '全部'));
    await waitUntil(async () => !(await page.data('loading')) && (await page.data('bankId')) === '',
      'All-bank catalog filter did not settle');
    if (await page.data('mineOnly')) {
      await tap(page, await element(page, '#mine-switch'));
      await waitUntil(async () => !(await page.data('loading')) && !(await page.data('mineOnly')),
        'Catalog retained the owned-card filter');
    }
    const cursors = new Set();
    while (await page.data('cursor')) {
      const cursor = await page.data('cursor');
      expect(!cursors.has(cursor), 'Catalog pagination repeated a cursor');
      cursors.add(cursor);
      await tap(page, await element(page, '.more-button'));
      await waitUntil(async () => !(await page.data('loadingMore')) && (await page.data('cursor')) !== cursor,
        'Catalog pagination did not advance');
    }
    await waitUntil(async () => (await page.$$('.activity-tile')).length === (await page.data('items')).length,
      'Catalog cards did not finish rendering');
    return page;
  }

  async function expectPrivateLead(title) {
    const page = await catalog();
    const items = await page.data('items');
    expect(!items.some(item => item.title === title), 'An unreviewed lead entered the public catalog', { title });
    for (const target of await page.$$('.tile-title')) {
      expect(!(await target.text()).includes(title), 'An unreviewed lead has a public activity card', { title });
    }
    return items.map(item => item.id);
  }

  async function rewards(month) {
    const page = await tab('rewards');
    await tap(page, await button(page, '.tabs .tab', '已记录'));
    await waitUntil(async () => (await page.data('tab')) === 'received', 'Recorded rewards tab did not activate');
    await button(page, '.tabs .tab', '待确认');
    let pickers = [];
    await waitUntil(async () => (pickers = await page.$$('.reward-filters picker')).length === 2,
      'Recorded reward filters did not render');
    const currencyIndex = (await page.data('currencies')).findIndex(item => item.value === 'CNY');
    expect(currencyIndex >= 0, 'CNY currency option is missing');
    await pickers[1].trigger('change', { value: String(currencyIndex) });
    await waitUntil(async () => !(await page.data('loading')) && (await page.data('currencyIndex')) === currencyIndex,
      'CNY reward filter did not settle');
    pickers = await page.$$('.reward-filters picker');
    await pickers[0].trigger('change', { value: month });
    await waitUntil(async () => !(await page.data('loading')) && (await page.data('month')) === month,
      'Reward month filter did not settle');
    await text(page, '.currency-picker', 'CNY');
    return page;
  }

  async function summary(page) {
    const amounts = {};
    await text(page, '.income-summary', '返现到账');
    await text(page, '.income-summary', '已享优惠');
    for (const [name, selector, field] of [
      ['cashback', '.income-cashback', 'cashbackTotal'],
      ['discount', '.income-discount', 'discountTotal'],
      ['total', '.income-total', 'total'],
    ]) {
      let content;
      await waitUntil(async () => {
        const target = await page.$(selector);
        content = target ? await target.text() : '';
        return /\d/.test(content) && content.trim() === (await page.data(field));
      }, 'Reward subtotal did not render: ' + selector);
      const amount = Number(content.replace(/[^\d.]/g, ''));
      expect(Number.isFinite(amount), 'Rendered reward subtotal is invalid', { selector, content });
      amounts[name] = Math.round(amount * 100);
    }
    expect(amounts.total === amounts.cashback + amounts.discount,
      'Combined reward total does not equal its benefit subtotals', { amounts });
    return amounts;
  }

  await check('Instant discount uses benefit wording and contributes only to its ledger subtotal', async () => {
    const mine = await ordinaryDemo();
    const month = (await mine.data('session')).today.slice(0, 7);
    const before = await summary(await rewards(month));
    let page = await catalog();
    const instant = await row(page, '.activity-tile', 'items', item => item.id === 'instant', '周末餐饮');
    expect(!instant.value.joined, 'Instant discount must start outside the demo todo list');
    await tap(page, await element(instant.target, '.offer-heading'));
    page = await loaded('/pages/detail/index');
    expect((await page.data('view.activity.rewardKind')) === 'discount', 'Instant fixture is not a discount');
    expect(!(await page.data('detail.participation')), 'Instant discount already has a demo participation');
    expect((await page.data('view.primaryAction')) === 'join', 'Unjoined discount does not offer joining as its next action');
    await tap(page, await text(page, '.detail-primary', '加入待办'));
    await waitUntil(async () => !(await page.data('busy')) && !!(await page.data('detail.participation')),
      'Instant discount did not join the todo list');
    const participationId = await page.data('detail.participation.id');
    await text(page, '.progress-heading', '我的参与');
    expect((await page.data('view.primaryAction')) === 'receipt'
      && (await page.$$('.detail-bottom-bar button')).length === 2,
    'Joined discount does not present one receipt action and More');
    await tap(page, await text(page, '.detail-primary', '记录已享优惠'));
    page = await loaded('/pages/receipt/index');
    expect(await page.data('allowed'), 'Discount receipt form is not available');
    await text(page, '#amount-field .entry-label', '实际优惠');
    await text(page, '#receipt-date-field .entry-label', '享受优惠日期');
    expect(!(await (await element(page, '.entry-page')).text()).includes('实际到账'),
      'Discount receipt form still describes a bank cash receipt');
    await input(page, '#amount', '27.50');
    const receivedOn = await page.data('receivedOn');
    expect(receivedOn.slice(0, 7) === month, 'Discount receipt date differs from the selected ledger month');
    await capture('discount-receipt-form');
    await tap(page, await text(page, '.entry-primary', '记录已享优惠'));
    page = await loaded('/pages/detail/index');
    await waitUntil(async () => (await page.data('detail.participation.stage')) === 'received',
      'Saved discount did not refresh the detail record');
    expect((await page.data('detail.participation.receivedMinor')) === 2750,
      'Discount has the wrong recorded amount');
    await text(page, '.progress-current', '已享优惠');
    await text(page, '.summary-reward', '实际优惠');
    await text(page, '.detail-primary', '修改优惠');
    page = await rewards(month);
    const recorded = await row(page, '.ledger-row', 'received', item => item.participationId === participationId, '周末餐饮');
    await text(recorded.target, '.ledger-kind', '已享优惠');
    const amount = await text(recorded.target, '.ledger-amount', '27.50');
    expect(!(await amount.text()).includes('+'), 'Discount is displayed as an incoming cash payment');
    const after = await summary(page);
    expect(after.cashback === before.cashback && after.discount === before.discount + 2750 && after.total === before.total + 2750,
      'Discount changed the wrong benefit subtotal', { before, after });
    await helpers.record?.('discount-ledger', { participationId, receivedOn, before, after });
    await miniProgram.pageScrollTo(0);
    await capture('discount-ledger-summary');
    await reveal(page, recorded.target);
    await capture('discount-ledger-row');
  });

  await check('A lightweight lead remains private until complete moderator review', async () => {
    const title = '界面验收活动线索 ' + Date.now();
    const sourceNote = '银行 App → 信用卡 → 优惠活动。仅用于隔离演示验收，等待运营核实。';
    let mine = await ordinaryDemo();
    const ownerId = (await mine.data('session')).userId;
    await tap(mine, await button(mine, '.menu-row', '我的投稿'));
    let page = await loaded('/pages/submissions/index');
    page = await freshLead(page, ownerId);
    expect(await page.data('ready'), 'Lead form did not initialize');
    const bankIndex = (await page.data('bankOptions')).findIndex(bank => bank.id === 'cmb');
    expect(bankIndex > 0, 'Lead form is missing the fixture bank');
    const bankPicker = await reveal(page, await element(page, '#field-bankId picker'));
    await bankPicker.trigger('change', { value: String(bankIndex) });
    await waitUntil(async () => (await page.data('lead.bankId')) === 'cmb', 'Lead bank selection did not update');
    await text(page, '#field-bankId .picker-field', '招商');
    await input(page, '#title', title);
    await input(page, '#sourceNote', sourceNote);
    expect(!(await page.$('#targetText')) && !(await page.$('#rewardText')) && !(await page.$('#field-startsOn')),
      'Lightweight lead unexpectedly requires complete activity rules');
    await capture('lightweight-lead-filled');
    await tap(page, await text(page, '.lead-dock .primary-button', '提交线索'));
    page = await loaded('/pages/submissions/index');
    let submitted = await row(page, '.submission-row', 'items', item => item.titleText === title, title);
    expect(submitted.value.status === 'pending' && submitted.value.isLead && submitted.value.draft === null,
      'Lightweight submission did not remain an unreviewed lead', { submission: submitted.value });
    const submissionId = submitted.value.id, version = submitted.value.version;
    await text(submitted.target, '.status', '待审核');
    await reveal(page, submitted.target);
    await capture('lightweight-lead-in-my-submissions');
    await tap(page, submitted.target);
    page = await loaded('/pages/submission-lead/index');
    await text(page, '.status-notice', '等待运营核实');
    await waitUntil(async () => (await (await element(page, '#title')).value()) === title
      && (await (await element(page, '#sourceNote')).value()) === sourceNote,
    'Saved lead input is not visible to its ordinary owner');
    const catalogBeforeReview = await expectPrivateLead(title);

    try {
      mine = await tab('mine');
      await demoRole(mine, true);
      await tap(mine, await button(mine, '.menu-row', '活动审核'));
      page = await loaded('/pages/review/index');
      const pending = await row(page, '.review-row', 'items', item => item.id === submissionId, title);
      await tap(page, pending.target);
      page = await loaded('/pages/submission-edit/index');
      const data = await page.data();
      expect(data.reviewMode && data.leadReview && !data.denied && !data.readOnly,
        'Moderator did not receive the complete lead review editor');
      expect(data.draft.startsOn === '' && data.draft.endsOn === '' && data.targetText === '' && data.rewardText === '',
        'Lead review silently invented missing dates, targets, or rewards');
      await text(page, '.return-notice', '待核实的活动线索');
      await tap(page, await text(page, '.editor-dock .primary-button', '审核通过并发布'));
      await waitUntil(async () => {
        const errors = await page.data('errors');
        return errors.startsOn && errors.endsOn && errors.targetText && errors.rewardText && errors.sourceVerified;
      }, 'Incomplete lead review did not report missing rule and verification fields');
      await text(page, '.error-banner', '请检查');
      await text(page, '#field-issuerIds .field-error', '发卡机构');
      await tap(page, await element(page, '#section-rules .section-heading'));
      await text(page, '#field-startsOn .field-error', '开始日期');
      await text(page, '#field-targetText .field-error', '累计门槛');
      await text(page, '#field-rewardText .field-error', '奖励金额');
      expect(normalizeRoute((await miniProgram.currentPage()).path) === 'pages/submission-edit/index'
        && (await page.data('submission.status')) === 'pending' && !(await page.data('saving')),
      'Incomplete lead review unexpectedly left the editor or changed status');
      await capture('lead-review-requires-complete-rules');
      await miniProgram.navigateBack();
      page = await loaded('/pages/review/index');
      const unchanged = await row(page, '.review-row', 'items', item => item.id === submissionId, title);
      expect(unchanged.value.status === 'pending' && unchanged.value.draft === null
        && unchanged.value.version === version && !unchanged.value.activityId,
      'Invalid review changed the persisted lead', { submission: unchanged.value });
    } finally {
      await demoRole(await tab('mine'), false);
    }

    mine = await ordinaryDemo();
    await tap(mine, await button(mine, '.menu-row', '我的投稿'));
    page = await loaded('/pages/submissions/index');
    submitted = await row(page, '.submission-row', 'items', item => item.id === submissionId, title);
    await text(submitted.target, '.status', '待审核');
    expect(submitted.value.version === version && submitted.value.draft === null,
      'Ordinary owner no longer sees the original pending lead');
    const catalogAfterReview = await expectPrivateLead(title);
    expect(JSON.stringify(catalogBeforeReview.slice().sort()) === JSON.stringify(catalogAfterReview.slice().sort()),
      'Incomplete lead review changed public catalog membership', { catalogBeforeReview, catalogAfterReview });
    await helpers.record?.('private-lead-review', { submissionId, version, catalogBeforeReview, catalogAfterReview, restoredRole: 'ordinary' });
    await ordinaryDemo();
  });
}
