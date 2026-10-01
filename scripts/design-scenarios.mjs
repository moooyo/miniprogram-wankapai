import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRouteDiagnostics } from './ui-helpers.mjs';

const roots = {
  todo: '.todo-page', activities: '.activity-page', rewards: '.rewards-page', wallet: '.wallet-page', mine: '.mine-page',
  detail: '.detail-page', progress: '.entry-page', receipt: '.entry-page', history: '.history-page',
  'card-edit': '.card-form-page', 'submission-lead': '.lead-page', 'submission-edit': '.editor-page',
  submissions: '.submissions-page', review: '.review-page', preferences: '.preferences-page',
  'web-entry': '.web-entry-page', entitlements: '.entitlements-page', 'entitlement-edit': '.entitlement-editor', lounges: '.lounges-page',
};
const routeName = value => String(value || '').split('?')[0].replace(/^\//, '');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createDesignPageWaiter(miniProgram, { measure, onDiagnostic, timeoutMs = 18000 } = {}) {
  return async route => {
    const expected = routeName(route);
    const selector = roots[expected.split('/')[1]];
    if (!selector) throw new Error('Unknown acceptance route: ' + expected);
    const startedAt = Date.now(), samples = [];
    let previous, stableSince = 0;
    while (Date.now() - startedAt < timeoutMs) {
      const sample = { elapsedMs: Date.now() - startedAt };
      try {
        const { page, routes } = await readRouteDiagnostics(miniProgram);
        sample.routes = routes;
        sample.agree = page && routes.raw.id === routes.cached.id && [routes.raw.path, routes.cached.path, routes.logic.route]
          .every(value => routeName(value) === expected);
        if (sample.agree) {
          const data = await page.data();
          sample.idle = !['loading', 'busy', 'saving', 'reloading', 'refreshing', 'recognizing'].some(key => data[key] === true);
          sample.errors = { error: data.error, loadError: data.loadError, failed: data.failed, denied: data.denied };
          const nodes = await page.$$(selector);
          sample.rootCount = nodes.length;
          if (sample.idle && nodes.length === 1) sample.box = await measure(nodes[0]);
          const ready = sample.box?.width > 0 && sample.box?.height > 0;
          const stable = ready && previous?.ready && previous.id === page.id && ['x', 'y', 'width', 'height']
            .every(key => Math.abs(sample.box[key] - previous.box[key]) < 1);
          stableSince = stable ? stableSince : ready ? Date.now() : 0;
          sample.stableMs = stableSince ? Date.now() - stableSince : 0;
          previous = { ready, box: sample.box, id: page.id };
          samples.push(sample);
          if (ready && stable && sample.stableMs >= 500) {
            await onDiagnostic?.({ expected, selector, status: 'ready', durationMs: Date.now() - startedAt, samples });
            return page;
          }
        } else { previous = undefined; stableSince = 0; samples.push(sample); }
      } catch (error) { sample.error = error.message; samples.push(sample); previous = undefined; stableSince = 0; }
      await pause(150);
    }
    const diagnostic = { expected, selector, status: 'failed', durationMs: Date.now() - startedAt, samples };
    await onDiagnostic?.(diagnostic);
    const error = new Error('Native page did not settle: ' + expected);
    error.details = diagnostic;
    throw error;
  };
}

export async function runDesignScenarios(miniProgram, helpers) {
  const { check, expect, capture, measure, record, waitUntil, waitForPage, viewport } = helpers;
  let fixture = {}, participationId = '', leadId = '';
  const geometry = [];

  async function element(scope, selector) {
    let target;
    await waitUntil(async () => !!(target = await scope.$(selector)), 'Missing rendered control: ' + selector);
    return target;
  }
  async function byText(scope, selector, expected) {
    let target;
    await waitUntil(async () => {
      for (const candidate of await scope.$$(selector)) if ((await candidate.text()).includes(expected)) { target = candidate; return true; }
      return false;
    }, 'Missing rendered text: ' + selector + ' / ' + expected);
    return target;
  }
  async function loaded(route, allowError = false) {
    const page = await waitForPage(route);
    const data = await page.data();
    expect(allowError || (!data.failed && !data.error && !data.loadError && !data.denied), 'Page reported a loading failure', {
      route, error: data.error, loadError: data.loadError, failed: data.failed, denied: data.denied,
    });
    return page;
  }
  async function tab(name) {
    await miniProgram.switchTab('/pages/' + name + '/index');
    const page = await loaded('/pages/' + name + '/index');
    await miniProgram.pageScrollTo(0);
    return page;
  }
  async function go(name, query = '', allowError = false) {
    const route = '/pages/' + name + '/index' + (query ? '?' + query : '');
    await miniProgram.reLaunch(route);
    return loaded(route, allowError);
  }
  async function reveal(page, target, sheet) {
    const screen = await viewport();
    let box = await measure(target);
    if (sheet) {
      const scroller = await element(sheet, '.sheet-body');
      const bounds = await measure(scroller);
      if (box.y < bounds.y + 8 || box.bottom > bounds.bottom - 8) {
        await scroller.scrollTo(0, Math.max(0, Number(await scroller.property('scrollTop')) + box.y - bounds.y - 12));
      }
    } else if (box.y < 0 || box.bottom > screen.windowHeight) {
      await miniProgram.pageScrollTo(Math.max(0, Number(await page.scrollTop()) + box.y - 100));
    }
    let previous;
    await waitUntil(async () => {
      box = await measure(target);
      const currentScreen = await viewport();
      const area = sheet ? await measure(await element(sheet, '.sheet-body')) : { y: 0, bottom: currentScreen.windowHeight };
      const bounds = { y: Math.max(0, area.y), bottom: Math.min(currentScreen.windowHeight, area.bottom) };
      const stable = previous && ['x', 'y', 'width', 'height'].every(key => Math.abs(box[key] - previous.box[key]) < 1)
        && Math.abs(bounds.y - previous.bounds.y) < 1 && Math.abs(bounds.bottom - previous.bounds.bottom) < 1;
      previous = { box, bounds };
      return stable && box.width > 0 && box.height > 0 && box.x >= -2 && box.right <= currentScreen.windowWidth + 2
        && box.y >= bounds.y - 2 && box.bottom <= bounds.bottom + 2;
    }, 'Control remains clipped: ' + (await target.attribute('class')));
    return target;
  }
  async function tap(page, target, sheet) { await (await reveal(page, target, sheet)).tap(); }
  async function input(page, selector, value, sheet) {
    const target = sheet ? await sheetElement(page, sheet, selector) : await element(page, selector);
    await (await reveal(page, target, sheet)).input(value);
  }
  async function sheetElement(page, component, selector) { return await page.$(selector) || element(component, selector); }
  async function sheetButton(page, component, selector, expected) {
    let match;
    await waitUntil(async () => {
      const owned = await page.$$(selector);
      const candidates = owned.length ? owned : await component.$$(selector);
      for (const candidate of candidates) if ((await candidate.text()).includes(expected)) { match = candidate; return true; }
      return false;
    }, 'Missing sheet action: ' + expected);
    return match;
  }
  async function closeSheet(page, id, state) {
    const sheet = await element(page, id);
    const navigation = await sheet.$('#sheet-navigation');
    await (await element(navigation || sheet, navigation ? '.back' : '.sheet-close')).tap();
    await waitUntil(async () => !(await page.data(state)), 'Sheet did not close: ' + id);
  }
  async function expandBillControls(page, sheet) {
    await waitUntil(async () => (await page.data('cardSheet')) === true && !(await page.data('loading'))
      && !(await page.data('refreshing')) && !(await page.data('busyId')), 'The reopened billing sheet is not idle');
    if (!(await page.data('showBillControls'))) await tap(page, await sheetElement(page, sheet, '.bill-management-toggle'), sheet);
    await waitUntil(async () => (await page.data('showBillControls')) === true, 'The native billing management toggle did not expand');
    await sheetElement(page, sheet, '#bill-amount');
  }
  async function compare(scope, selector, property, expected, tolerance = 1.5) {
    const target = await element(scope, selector);
    const box = await measure(target);
    const actual = property in box ? box[property] : await target.style(property);
    const valid = typeof expected === 'number' ? Math.abs(Number.parseFloat(actual) - expected) <= tolerance
      : String(actual).replace(/\s/g, '').toLowerCase() === expected.replace(/\s/g, '').toLowerCase();
    const result = { route: routeName((await miniProgram.currentPage()).path), selector, property, expected, actual, tolerance, valid };
    geometry.push(result); record(selector + ':' + property, result);
    expect(valid, 'Rendered design metric differs from the handoff', result);
    return box;
  }
  async function designCard(scope, selector, radius = 18) {
    await compare(scope, selector, 'background-color', 'rgb(255,255,255)');
    await compare(scope, selector, 'border-top-left-radius', radius);
    await compare(scope, selector, 'border-top-color', 'rgb(227,233,242)');
  }
  async function viewer(page) {
    const name = routeName(page.path).split('/')[1];
    return element(page, name === 'submission-lead' ? '#lead-viewer' : name === 'submission-edit' ? '#editor-viewer' : '#activity-viewer');
  }

  await check('Four native tabs match the redesigned information architecture', async () => {
    const config = JSON.parse(await readFile(path.join(projectRoot, 'dist/miniprogram/app.json'), 'utf8'));
    assert.deepEqual(config.tabBar.list.map(item => item.text), ['进度', '活动', '卡与权益', '我的']);
    for (const name of ['todo', 'activities', 'wallet', 'mine']) {
      const page = await tab(name);
      const root = await element(page, roots[name]);
      expect(/[\u3400-\u9fff]/.test(await root.text()), 'The tab does not render Chinese product content', { name });
      const bounds = await measure(root), screen = await viewport();
      expect(bounds.x >= -1 && bounds.right <= screen.windowWidth + 1, 'The page exceeds the actual native viewport', { name, bounds, screen });
      await capture('tab-' + name);
    }
    const mine = await miniProgram.currentPage();
    expect((await mine.data('session'))?.demo === true, 'Native acceptance must use an explicit demo session');
  });

  await check('Explicit design fixtures remain isolated from production', async () => {
    fixture = await miniProgram.evaluate(async () => {
      const app = getApp();
      if (typeof app.installDesignDemoFixtures !== 'function') throw new Error('The demo-only design fixture installer is unavailable');
      return app.installDesignDemoFixtures();
    });
    expect(Array.isArray(fixture.activityIds) && fixture.activityIds.length >= 4, 'The installer did not return the required cycle fixtures', { fixture });
    record('fixture', fixture);
  });

  await check('Activity bank filters, dynamic match count and 60 by 80 thumbnails', async () => {
    const page = await tab('activities');
    const data = await page.data();
    const count = await (await element(page, '.filter-count')).text();
    expect(count.includes(`共 ${data.items.length} 个`) && count.includes(`${data.cardCount} 张卡`), 'The match count is not derived from the displayed catalog', { count, cardCount: data.cardCount, items: data.items.length });
    await designCard(page, '.activity-tile');
    await compare(page, '.activity-tile', 'padding-left', 14);
    await compare(page, '.tile-title', 'font-size', 16);
    await reveal(page, await element(page, '.tile-shot'));
    await compare(page, '.tile-shot', 'width', 60);
    await compare(page, '.tile-shot', 'height', 80);
    await compare(page, '.tile-shot', 'border-top-left-radius', 9);
    await compare(page, '.cycle-chip', 'height', 22);
    const banks = await page.$$('.bank-choice');
    expect(banks.length > 1, 'The bank rail has no bank option');
    await banks[1].tap();
    await waitUntil(async () => !(await page.data('loading')) && !!(await page.data('bankId')), 'Bank filter did not settle');
    const filtered = await page.data();
    expect(filtered.items.every(item => item.activity.bankId === filtered.bankId), 'Bank filter includes another bank', { bankId: filtered.bankId });
    await capture('activity-bank-filter');
    await banks[0].tap();
    await waitUntil(async () => !(await page.data('loading')) && (await page.data('bankId')) === '', 'All banks did not reset');
    await (await element(page, '.mine-control')).tap();
    await waitUntil(async () => !(await page.data('loading')) && (await page.data('mineOnly')) === false, 'The match toggle did not disable');
    expect((await (await element(page, '.filter-count')).text()).includes('全部活动'), 'All activity count is missing');
    await capture('activity-all');
  });

  await check('Custom screenshot viewer opens without card navigation and paginates', async () => {
    const page = await tab('activities'), before = page.path;
    const itemsOnPage = await page.data('items'), tiles = await page.$$('.activity-tile');
    const multipleShotIndex = itemsOnPage.findIndex(item => item.shotCount >= 2);
    expect(multipleShotIndex >= 0 && tiles[multipleShotIndex], 'The catalog has no multi-image screenshot fixture');
    await tap(page, await element(tiles[multipleShotIndex], '.tile-shot'));
    await waitUntil(async () => await page.data('viewerOpen'), 'Thumbnail did not open the custom viewer');
    expect((await miniProgram.currentPage()).path === before, 'Thumbnail tap bubbled into detail navigation');
    const component = await viewer(page), items = await component.data('items');
    expect(items.length >= 2, 'The screenshot pagination fixture is missing');
    const screen = await viewport();
    await compare(component, '.viewer', 'width', screen.windowWidth);
    await compare(component, '.viewer', 'background-color', 'rgb(11,18,32)');
    const shot = await compare(component, '.shot', 'width', Math.min(300, screen.windowWidth - 88));
    expect(Math.abs(shot.height / shot.width - 4 / 3) < 0.025, 'Viewer screenshot does not preserve the 3:4 ratio', { shot });
    await compare(component, '.close', 'width', 44);
    await compare(component, '.arrow', 'width', 36);
    await capture('viewer-first');
    await (await element(component, '.next')).tap();
    await waitUntil(async () => (await component.data('activeIndex')) === 1, 'Next screenshot did not render');
    expect((await (await element(component, '.position')).text()).includes('2 / '), 'Viewer page indicator is stale');
    await capture('viewer-second');
    await (await element(component, '.previous')).tap();
    await waitUntil(async () => (await component.data('activeIndex')) === 0, 'Previous screenshot did not render');
    await (await element(component, '.close')).tap();
    await waitUntil(async () => !(await page.data('viewerOpen')), 'Viewer did not close');
  });

  await check('Unjoined detail shows eligibility and activity rules before joining', async () => {
    const page = await go('detail', 'id=design-month-day21');
    const view = await page.data('view');
    expect(view && !view.joined && view.canJoin, 'The prejoin fixture is not eligible', { view });
    await element(page, '.eligibility-section');
    expect((await (await element(page, '.detail-primary')).text()).includes('参加活动'), 'Prejoin detail has no participation action');
    await capture('detail-before-join');
  });

  await check('Prejoin sheet requires an explicit card choice and joins through the domain service', async () => {
    const page = await tab('activities');
    const tiles = await page.$$('.activity-tile'), items = await page.data('items');
    const index = items.findIndex(item => item.id === 'design-month-day21');
    expect(index >= 0, 'The prejoin fixture is absent from the native catalog');
    await tap(page, await element(tiles[index], '.tile-action'));
    await waitUntil(async () => await page.data('showJoin'), 'Participation sheet did not open');
    const sheet = await element(page, '#activity-join');
    await element(sheet, '.sheet-layer');
    const choices = await sheetElement(page, sheet, '.join-card');
    expect((await page.data('selectedCardId')) === '', 'The sheet preselected a card without user input');
    await tap(page, choices, sheet);
    await waitUntil(async () => !!(await page.data('selectedCardId')), 'Card selection did not update');
    await capture('prejoin-card-selected');
    await tap(page, await sheetElement(page, sheet, '.join-confirm'), sheet);
    await waitUntil(async () => !(await page.data('showJoin')) && !(await page.data('joinBusy')), 'Participation did not finish');
    const joined = (await page.data('items')).find(item => item.id === 'design-month-day21');
    expect(joined?.joined && joined.participationId, 'Participation did not create a persisted domain record', { joined });
  });

  for (const [id, type] of [['instant', 'once'], ['design-weekly', 'week'], ['design-month-day21', 'month'], ['design-custom-quarterly', 'custom']]) {
    await check('Detail renders the ' + type + ' cycle from its saved rules', async () => {
      const page = await go('detail', 'id=' + id), view = await page.data('view');
      expect(view?.cycle && (view.activity.cycle?.t || (view.activity.frequency === 'once' ? 'once' : '')) === type,
        'Detail does not use the intended cycle', { id, cycle: view?.activity.cycle, frequency: view?.activity.frequency });
      const panel = await element(page, '.cycle-panel');
      await reveal(page, panel);
      if (type === 'week') {
        expect((await page.$$('.week-day')).length === 7, 'Weekly cycle does not render seven day cells');
        expect((await page.$$('.cycle-timeline')).length === 0, 'Weekly cycle rendered the wrong timeline');
      } else {
        await element(page, '.timeline-current');
        expect((await page.$$('.timeline-next')).length === (type === 'once' ? 0 : 1), 'One-time and repeating cycle timeline states are mixed');
        if (view.cycle.showToday) expect(view.cycle.todayPercent >= 12 && view.cycle.todayPercent <= 88,
          'The today label exceeds the design clamp', { todayPercent: view.cycle.todayPercent });
      }
      if (type === 'month') expect((await panel.text()).includes('非自然月'), 'Day-21 monthly cycle omits its non-calendar-month explanation');
      await capture('detail-cycle-' + type);
    });
  }

  await check('Quit confirmation retains progress, excludes pending work and supports rejoin', async () => {
    let page = await go('detail', 'id=monthly');
    const original = await page.data('detail.participation');
    expect(original && original.progress > 0, 'The retained-progress fixture is missing');
    participationId = original.id;
    await tap(page, await element(page, '.quit-button'));
    await waitUntil(async () => await page.data('showQuit'), 'Quit confirmation did not open');
    const sheet = await element(page, '#detail-quit');
    const effects = await sheetElement(page, sheet, '.quit-effects');
    expect((await effects.text()).includes('记录将保留'), 'Quit sheet omits the retained-record consequence');
    await capture('quit-confirmation');
    await tap(page, await sheetElement(page, sheet, '.quit-actions .danger'), sheet);
    await waitUntil(async () => !(await page.data('busy')) && (await page.data('view.withdrawn')) === true, 'Activity did not withdraw');
    const withdrawn = await page.data('detail.participation');
    expect(withdrawn.progress === original.progress && withdrawn.id === original.id && !!withdrawn.withdrawnAt,
      'Withdrawal lost the existing progress or record identity', { original, withdrawn });
    await capture('detail-withdrawn');
    const dashboard = await tab('todo');
    const tasks = await dashboard.data('tasks');
    expect(!tasks.some(item => item.id === original.id), 'Withdrawn participation remains in the progress dashboard');
    const rewards = await go('rewards');
    expect(!(await rewards.data('pending')).some(item => item.id === original.id), 'Withdrawn participation remains in pending rewards');
    const history = await go('history', 'activityId=monthly');
    expect((await (await element(history, roots.history)).text()).includes('已退出'), 'Participation history omits withdrawal status');
    await capture('history-withdrawn');
    page = await go('detail', 'id=monthly');
    expect((await (await element(page, '.detail-primary')).text()).includes('重新参加'), 'Withdrawn detail does not offer rejoin');
    await (await element(page, '.detail-primary')).tap();
    await waitUntil(async () => !(await page.data('busy')) && (await page.data('view.joined')) === true, 'Rejoin did not finish');
    const resumed = await page.data('detail.participation');
    expect(resumed.id === original.id && resumed.progress === original.progress && !resumed.withdrawnAt,
      'Rejoin did not restore the existing record and progress', { original, resumed });
    await capture('detail-rejoined');
  });

  await check('Progress, receipt and card forms preserve their real business entry points', async () => {
    let page = await go('detail', 'id=monthly');
    participationId = (await page.data('detail.participation')).id;
    await tap(page, await byText(page, '.detail-links button', '更多操作'));
    await waitUntil(async () => (await page.data('showManage')) === true, 'The cumulative-progress management sheet did not open');
    const manage = await element(page, '#detail-manage');
    await tap(page, await sheetButton(page, manage, '.sheet-option', '更新累计进度'), manage);
    page = await loaded('/pages/progress/index');
    await element(page, '#progress');
    expect(Number(await page.data('target')) > 0 && (await page.data('editable')) === true, 'Progress form lost the participation contract');
    await capture('progress-form');
    page = await go('receipt', 'id=' + encodeURIComponent(participationId));
    await element(page, '#amount');
    const minDate = await page.data('minDate'), maxDate = await page.data('maxDate');
    expect(/^\d{4}-\d{2}-\d{2}$/.test(minDate) && minDate <= maxDate, 'Receipt form lost its actual-date range', { minDate, maxDate });
    await capture('receipt-form');
    page = await go('card-edit', 'id=demo-card-cmb');
    await element(page, '#field-bankId');
    expect((await page.data('id')) === 'demo-card-cmb', 'Card editor lost the selected identity');
    await compare(page, '.kind-button.selected', 'background-color', 'rgb(255,255,255)');
    await compare(page, '#field-network .form-chip.selected', 'background-color', 'rgb(230,238,252)');
    if (await page.data('reminderEnabled')) await compare(page, '#field-remindDays .form-chip.selected', 'background-color', 'rgb(230,238,252)');
    await capture('card-editor');
  });

  await check('Withdrawing a completed period removes pending rewards and rejoin restores them', async () => {
    const dashboard = await tab('todo'), beforeCount = await dashboard.data('pendingCount');
    let page = await go('detail', 'id=quarterly');
    const original = await page.data('detail.participation');
    expect(original?.stage === 'completed' && original.expectedOn, 'The completed reward fixture is missing');
    await tap(page, await element(page, '.quit-button'));
    await waitUntil(async () => await page.data('showQuit'), 'Completed activity quit sheet did not open');
    const sheet = await element(page, '#detail-quit');
    expect((await (await sheetElement(page, sheet, '.quit-effects')).text()).includes('不再提醒到账'), 'Completed quit sheet omits the reward-reminder consequence');
    await tap(page, await sheetElement(page, sheet, '.quit-actions .danger'), sheet);
    await waitUntil(async () => !(await page.data('busy')) && (await page.data('view.withdrawn')) === true, 'Completed period did not withdraw');
    const after = await tab('todo'), afterCount = await after.data('pendingCount');
    expect(afterCount === beforeCount - 1, 'Completed withdrawal did not remove exactly its own pending reward', { beforeCount, afterCount, participationId: original.id });
    page = await go('rewards');
    const currencies = await page.data('currencies'), currencyIndex = currencies.findIndex(item => item.value === 'HKD');
    expect(currencyIndex >= 0, 'HKD rewards filter is unavailable');
    const picker = (await page.$$('.summary-head picker'))[1];
    await picker.trigger('change', { value: String(currencyIndex) });
    await waitUntil(async () => !(await page.data('loading')) && (await page.data('currencyIndex')) === currencyIndex, 'Reward currency filter did not settle');
    expect(!(await page.data('pending')).some(item => item.id === original.id), 'The withdrawn completed reward remains in the HKD pending list');
    await capture('rewards-after-completed-withdrawal');
    page = await go('detail', 'id=quarterly');
    await (await element(page, '.detail-primary')).tap();
    await waitUntil(async () => !(await page.data('busy')) && (await page.data('view.joined')) === true, 'Completed period did not rejoin');
    const resumed = await page.data('detail.participation');
    expect(resumed.id === original.id && resumed.stage === original.stage && resumed.progress === original.progress,
      'Completed rejoin lost its saved period result', { original, resumed });
    const restored = await tab('todo');
    expect((await restored.data('pendingCount')) === beforeCount, 'Rejoin did not restore the existing pending reward');
  });

  await check('Persisted consumption rows add, complete and revoke within their original participation', async () => {
    expect(!!fixture.consumptionActivityId, 'The consumption fixture is unavailable');
    let page = await go('detail', 'id=' + encodeURIComponent(fixture.consumptionActivityId));
    const original = await page.data('detail.participation');
    expect(original && original.cardId === 'demo-card-cmb' && original.progress === 0 && original.snapshot.target === 2,
      'Consumption acceptance requires its isolated card participation', { original });
    expect((await page.data('detail.consumptions')).length === 0, 'The isolated consumption fixture already has ledger rows');
    const today = await page.data('serverToday');
    async function add(amount, merchant, progress) {
      await tap(page, await element(page, '.detail-primary'));
      await waitUntil(async () => (await page.data('showConsumption')) === true, 'The consumption form did not open');
      const sheet = await element(page, '#detail-consumption');
      await input(page, '.consumption-amount-input', amount, sheet);
      await input(page, '.consumption-merchant-input', merchant, sheet);
      const picker = await sheetElement(page, sheet, '.consumption-input-row picker');
      const latestAllowedDate = original.endsOn < today ? original.endsOn : today;
      expect((await picker.attribute('start')) === original.startsOn && (await picker.attribute('end')) === latestAllowedDate,
        'Consumption date selection lost the original period or actual-date limit');
      if (original.startsOn !== today) {
        await (await reveal(page, picker, sheet)).trigger('change', { value: original.startsOn });
        await waitUntil(async () => (await page.data('consumptionOn')) === original.startsOn, 'The consumption date change did not alter its previous value');
      }
      await (await reveal(page, picker, sheet)).trigger('change', { value: today });
      await waitUntil(async () => (await page.data('consumptionOn')) === today, 'The consumption date did not update');
      await capture('consumption-form-' + progress);
      await tap(page, await sheetElement(page, sheet, '.consumption-save'), sheet);
      await waitUntil(async () => !(await page.data('busy')) && !(await page.data('refreshing'))
        && !(await page.data('showConsumption')) && (await page.data('detail.participation.progress')) === progress,
      'The consumption command did not persist the expected progress');
      const record = (await page.data('detail.consumptions')).find(item => item.merchant === merchant);
      expect(record && record.amountMinor === Math.round(Number(amount) * 100) && record.consumedOn === today
        && record.participationId === original.id && record.progressDelta === 1 && !record.reversedAt,
      'The saved ledger row does not retain the amount, date, delta or original participation', { record });
      return record.id;
    }
    const firstId = await add('100.25', '原生验收消费一', 1);
    page = await go('detail', 'id=' + encodeURIComponent(fixture.consumptionActivityId));
    expect((await page.data('detail.participation.id')) === original.id && (await page.data('detail.participation.progress')) === 1
      && (await page.data('detail.consumptions')).some(item => item.id === firstId), 'Consumption exists only in the prior page state');
    await tap(page, await element(page, '.consumption-row'));
    await waitUntil(async () => (await page.data('showConsumptionRecord')) === true, 'The persisted ledger row did not open');
    await capture('consumption-persisted-record');
    await closeSheet(page, '#detail-consumption-record', 'showConsumptionRecord');
    const secondId = await add('150.00', '原生验收消费二', 2);
    expect((await page.data('detail.participation.stage')) === 'completed', 'The second counted consumption did not reach the target');
    await waitUntil(async () => (await page.data('showCelebration')) === true, 'Automatic completion did not show its native confirmation');
    await pause(2200);
    await capture('consumption-completed');
    await (await element(page, '.celebration-mask button')).tap();
    await waitUntil(async () => !(await page.data('showCelebration')), 'Completion confirmation did not close');
    for (const [id, remaining] of [[secondId, 1], [firstId, 0]]) {
      const rows = await page.data('view.consumptions'), index = rows.findIndex(item => item.id === id);
      await tap(page, (await page.$$('.consumption-row'))[index]);
      await waitUntil(async () => (await page.data('selectedConsumptionId')) === id && (await page.data('showConsumptionRecord')) === true,
        'The intended consumption did not open for reversal');
      const sheet = await element(page, '#detail-consumption-record');
      await tap(page, await sheetElement(page, sheet, '.danger.consumption-save'), sheet);
      await waitUntil(async () => !(await page.data('busy')) && !(await page.data('showConsumptionRecord'))
        && (await page.data('detail.participation.progress')) === remaining, 'Consumption reversal did not restore its exact progress');
      expect((await page.data('detail.consumptions')).find(item => item.id === id)?.reversedAt,
        'Reversal deleted the ledger history instead of retaining its reversed state');
    }
    const restored = await page.data('detail.participation');
    expect(restored.id === original.id && restored.cardId === original.cardId && restored.periodKey === original.periodKey
      && restored.startsOn === original.startsOn && restored.endsOn === original.endsOn && restored.progress === 0 && restored.stage === original.stage,
    'Reversed consumption changed the identity, card, snapshot period or original stage', { original, restored });
    await reveal(page, await element(page, '.consumption-row'));
    await pause(2200);
    await capture('consumption-reversed-ledger');
  });

  await check('Wallet card stack, holdings and lounge quick lookup render native data', async () => {
    let page = await tab('wallet');
    await compare(page, '.segment-button.selected', 'background-color', 'rgb(255,255,255)');
    const cards = await page.data('stackCards'), rendered = await page.$$('.stack-card');
    expect(cards.length > 0 && cards.length === rendered.length, 'The card stack does not reflect the real wallet');
    for (let index = 1; index < Math.min(rendered.length, 3); index++) {
      const prior = await measure(rendered[index - 1]), current = await measure(rendered[index]);
      expect(current.y < prior.bottom && current.y > prior.y, 'The wallet cards do not form the designed overlapping stack', { prior, current });
    }
    await tap(page, rendered[0]);
    await waitUntil(async () => !!(await page.data('cardSheet')), 'Stack card did not open its detail sheet');
    await capture('wallet-card-sheet');
    await closeSheet(page, '#card-detail-sheet', 'cardSheet');
    await (await byText(page, '.segment-button', '权益速查')).tap();
    await waitUntil(async () => (await page.data('segment')) === 'perks', 'Wallet holdings segment did not select');
    await capture('wallet-holdings');
    page = await go('entitlements');
    await compare(page, '.tab.selected', 'background-color', 'rgb(255,255,255)');
    await compare(page, '.kind-filter.selected', 'background-color', 'rgb(230,238,252)');
    await compare(page, '.airport-entry', 'background-color', 'rgb(31,97,216)');
    await element(page, '.benefit-card');
    await capture('held-entitlements');
    page = await go('lounges');
    await element(page, '.program-row');
    await capture('lounge-landing');
    await tap(page, await element(page, '.airport-row'));
    await waitUntil(async () => (await page.data('showAirports')) === false, 'Airport selection did not show registered lounges');
    await element(page, '.lounge-card');
    await compare(page, '.zone-filter.selected', 'background-color', 'rgb(230,238,252)');
    await capture('lounge-lookup');
    await tap(page, await element(page, '.clear-filters'));
    await waitUntil(async () => (await page.data('showAirports')) === true && (await page.data('recentAirports')).length > 0,
      'Lounge lookup did not retain its actual recent query for the current owner');
    await capture('lounge-recent-channels');
    page = await go('entitlement-edit', 'kind=lounge');
    await element(page, '#section-basic');
    await capture('entitlement-editor');
  });

  await check('Six benefit categories use actual holdings and information benefits have no usage action', async () => {
    let page = await tab('wallet');
    await (await byText(page, '.segment-button', '权益速查')).tap();
    await waitUntil(async () => (await page.data('segment')) === 'perks', 'The six-category benefit view did not open');
    const categories = await page.data('perkKinds');
    const expectedKinds = ['lounge', 'delay_insurance', 'airport_transfer', 'health_check', 'car_wash', 'points'];
    assert.deepEqual(categories.map(item => item.value), expectedKinds, 'The quick lookup does not use the six handoff categories');
    for (const kind of expectedKinds) {
      const index = categories.findIndex(item => item.value === kind), buttons = await page.$$('.perk-kind');
      await tap(page, buttons[index]);
      await waitUntil(async () => (await page.data('perkKind')) === kind, 'The benefit category did not select: ' + kind);
      const rows = await page.data('perkRows');
      expect(rows.length > 0 && rows.every(item => item.kind === kind), 'Benefit category shows another type or lost its fixture', { kind, rows });
      expect(rows.some(item => item.id === fixture.entitlementIds?.[kind]), 'The category did not display its owned domain fixture', { kind });
      await compare(page, '.perk-kind.selected', 'background-color', 'rgb(31,97,216)');
      if (kind === 'points') {
        const item = (await page.data('perks.items')).find(item => item.id === fixture.entitlementIds.points);
        expect(!!item, 'The points category lost its owned balance record');
        const row = rows.find(row => row.id === item.id);
        expect(row.counted === false && row.balanceUnit === '分' && Number(row.balanceText.replace(/,/g, '')) === item.pointsBalance,
          'Points are represented as remaining visits or lose their registered balance', { row, pointsBalance: item.pointsBalance });
        const renderedRows = await page.$$('.perk-row'), rowIndex = rows.findIndex(row => row.id === item.id);
        const renderedBalance = await (await element(renderedRows[rowIndex], '.perk-balance-number')).text();
        expect(renderedBalance.replace(/\s/g, '') === item.pointsBalance.toLocaleString('en-US') + '分',
          'The native points balance text differs from the owned record', { renderedBalance, pointsBalance: item.pointsBalance });
      }
      await capture('benefit-category-' + kind);
    }
    for (const kind of ['delay_insurance', 'points']) {
      const id = fixture.entitlementIds[kind];
      page = await go('entitlements', 'id=' + encodeURIComponent(id));
      expect((await page.data('expandedId')) === id, 'The information benefit did not expand its owned record');
      const rows = await page.data('rows'), cards = await page.$$('.benefit-card');
      const index = rows.findIndex(item => item.id === id);
      expect(index >= 0 && cards[index], 'The information benefit has no rendered card');
      expect((await cards[index].$$('.card-actions')).length === 0 && (await cards[index].$$('.benefit-meter')).length === 0,
        'An information benefit exposes a visit deduction or usage meter', { kind, id });
      await reveal(page, await element(cards[index], kind === 'points' ? '.balance-panel' : '.information-description'));
      await capture('information-benefit-' + kind);
    }
  });

  await check('The independent bill amount persists without changing bill identity or due dates', async () => {
    expect(!!fixture.billingAmountFixture?.billId, 'The independent billing fixture is unavailable');
    let page = await tab('wallet');
    await (await byText(page, '.segment-button', '我的卡')).tap();
    await waitUntil(async () => (await page.data('segment')) === 'cards', 'The billing card segment did not select');
    const cards = await page.data('stackCards'), index = cards.findIndex(item => item.id === fixture.billingAmountFixture.cardId);
    expect(index >= 0, 'The independent billing card is missing');
    expect(cards[index].dueAmount === '¥1,280.50', 'The stack does not format the registered bill amount from integer cents', { dueAmount: cards[index].dueAmount });
    const rendered = await page.$$('.stack-card');
    await tap(page, rendered[index]);
    await waitUntil(async () => (await page.data('selectedCard.id')) === fixture.billingAmountFixture.cardId, 'The billing card did not select');
    const sheet = await element(page, '#card-detail-sheet'), original = await page.data('selectedGroup.primaryBill');
    expect(original.id === fixture.billingAmountFixture.billId && original.amountMinor === 128050 && original.currency === 'CNY',
      'The displayed bill does not reflect its owned amount fixture', { original });
    await capture('bill-registered-amount');
    await expandBillControls(page, sheet);
    await input(page, '#bill-amount', '1500.25', sheet);
    await tap(page, await sheetElement(page, sheet, '.save-amount'), sheet);
    await waitUntil(async () => !(await page.data('busyId')) && !(await page.data('refreshing'))
      && (await page.data('selectedGroup.primaryBill.amountMinor')) === 150025, 'The bill amount did not persist through its actual command');
    const changed = await page.data('selectedGroup.primaryBill');
    expect(changed.id === original.id && changed.period === original.period && changed.dueOn === original.dueOn && changed.paid === original.paid,
      'An amount correction changed the bill identity, period, date or repayment state', { original, changed });
    await capture('bill-corrected-amount');
    await closeSheet(page, '#card-detail-sheet', 'cardSheet');
    await tab('mine');
    page = await tab('wallet');
    const refreshed = (await page.data('raw.bills')).find(bill => bill.id === original.id);
    expect(refreshed?.amountMinor === 150025, 'The corrected amount was only local page state', { refreshed });
    const refreshedIndex = (await page.data('stackCards')).findIndex(item => item.id === fixture.billingAmountFixture.cardId);
    await tap(page, (await page.$$('.stack-card'))[refreshedIndex]);
    const restoredSheet = await element(page, '#card-detail-sheet');
    await expandBillControls(page, restoredSheet);
    await input(page, '#bill-amount', '1280.50', restoredSheet);
    await tap(page, await sheetElement(page, restoredSheet, '.save-amount'), restoredSheet);
    await waitUntil(async () => !(await page.data('busyId')) && (await page.data('selectedGroup.primaryBill.amountMinor')) === 128050,
      'The isolated billing fixture could not restore its original amount');
    await closeSheet(page, '#card-detail-sheet', 'cardSheet');
  });

  await check('OCR merges demo fixtures, preserves manual title and restores the first snapshot', async () => {
    expect(!!fixture.ocrSubmissionId, 'The installer did not create an owned pending OCR lead through the domain service');
    const page = await go('submission-lead', 'id=' + encodeURIComponent(fixture.ocrSubmissionId));
    await compare(page, '.lead-dock .secondary-button', 'width', 112);
    record('ocr-fixture', { method: 'Owned pending lead created through the real demo domain service',
      assetId: fixture.ocrAssetId, submissionId: fixture.ocrSubmissionId, limitation: 'The operating-system image picker and upload are not exercised.' });
    leadId = await page.data('submissionId');
    await input(page, '#title', '手动填写的验收活动');
    const before = await page.data('lead');
    await tap(page, await element(page, '.recognize-button'));
    await waitUntil(async () => !(await page.data('recognizing')) && (await page.data('recognitionCount')) > 0, 'Demo OCR did not fill the form');
    expect((await page.data('recognitionDemo')) === true, 'OCR fixture is not explicitly labelled demo');
    expect((await page.data('lead.title')) === before.title && !!(await page.data('suggestedTitle')), 'OCR overwrote a manually edited title');
    expect((await page.data('rulesExpanded')) === true, 'OCR did not reveal recognized rules');
    const recognized = await page.data('recognizedFields');
    expect(recognized.reward && recognized.cycle && recognized.time && recognized.conditions, 'OCR omitted recognized rule groups', { recognized });
    await capture('ocr-recognized-manual-title');
    await tap(page, await element(page, '.screenshot-card'));
    await waitUntil(async () => await page.data('viewerShow'), 'Recognized screenshot did not open');
    const component = await viewer(page);
    expect((await component.$$('.region')).length > 0, 'OCR regions are not drawn over the actual image');
    await capture('ocr-image-regions');
    await (await element(component, '.close')).tap();
    await tap(page, await element(page, '.undo-recognition'));
    await waitUntil(async () => (await page.data('recognitionCount')) === 0, 'OCR undo did not clear recognition state');
    const undone = await page.data('lead');
    assert.deepEqual(undone, before, 'OCR undo did not restore the first pre-recognition snapshot and preserve screenshots');
    await capture('ocr-undone');
  });

  await check('Reward filters, date lower bounds and custom interval controls follow the handoff', async () => {
    const page = await miniProgram.currentPage();
    expect(routeName(page.path) === 'pages/submission-lead/index', 'Rule controls require the existing native lead form');
    if (!(await page.data('rulesExpanded'))) await tap(page, await element(page, '.rules-heading'));
    await tap(page, await byText(page, '.pills .pill', '返现'));
    await input(page, '.reward-input input', '00012a.3456.7');
    await waitUntil(async () => (await page.data('rewardText')) === '12.34', 'Money input did not filter leading zeros, invalid text and extra decimals');
    await tap(page, await byText(page, '.pills .pill', '积分'));
    expect((await page.data('rewardText')) === '12', 'Switching to points did not remove the fractional part');
    await input(page, '.reward-input input', '000234.99a');
    await waitUntil(async () => (await page.data('rewardText')) === '234', 'Points input did not preserve an integer');
    expect((await (await element(page, '.reward-input input')).attribute('type')) === 'number', 'Points input does not use the native number keyboard');
    await tap(page, await byText(page, '.cycle-option', '自定义'));
    const dates = await page.$$('.date-pair picker');
    await (await reveal(page, dates[0])).trigger('change', { value: '2026-10-10' });
    await waitUntil(async () => (await page.data('rules.startsOn')) === '2026-10-10', 'Start date did not update');
    expect((await dates[1].attribute('start')) === '2026-10-10', 'End-date picker permits a date earlier than start');
    await dates[1].trigger('change', { value: '2026-10-09' });
    expect((await page.data('rules.endsOn')) !== '2026-10-09', 'The date handler accepted an end date earlier than the start');
    await dates[1].trigger('change', { value: '2026-12-31' });
    await waitUntil(async () => (await page.data('rules.endsOn')) === '2026-12-31', 'End date did not update');
    await tap(page, await byText(page, '.interval-row .pill', '天'));
    for (let index = 0; index < 2; index++) await tap(page, await byText(page, '.stepper button', '+'));
    expect((await page.data('cycleN')) === 3 && (await page.data('cycleUnit')) === 'day', 'Custom interval controls did not update');
    expect((await page.data('rules.cycle.anchor')) === '2026-10-10', 'Custom interval anchor does not follow the activity start');
    await capture('submission-custom-date-reward');
    record('date-picker', { method: 'Native picker change event', limitation: 'The OS date-wheel gesture is not exercised', start: await dates[1].attribute('start') });
  });

  await check('Public submission preserves pending moderation in the demo domain', async () => {
    const page = await miniProgram.currentPage();
    expect(routeName(page.path) === 'pages/submission-lead/index', 'Submission requires the existing native lead form');
    if (!(await page.data('lead.bankId'))) {
      const options = await page.$$('.bank-option');
      expect(options.length > 0, 'The lead form has no bank choice');
      await tap(page, options[0]);
    }
    if (!(await page.data('lead.title'))) await input(page, '#title', '原生验收活动线索');
    if (!(await page.data('lead.sourceNote'))) await input(page, '#sourceNote', '原生模拟器验收样例，非真实银行活动。');
    await tap(page, await element(page, '.lead-dock .primary-button'));
    await waitUntil(async () => !(await page.data('saving')) && (await page.data('submitted')) === true, 'The moderated demo lead did not submit');
    leadId = await page.data('submissionId');
    expect(!!leadId && (await page.data('submission.status')) === 'pending', 'The public lead bypassed pending moderation', { leadId, submission: await page.data('submission') });
    await capture('submission-pending-moderation');
  });

  await check('Review requires an explicit demo moderator and real source/rule checks', async () => {
    let page = await tab('mine');
    await (await byText(page, '.role-option', '运营审核')).tap();
    await waitUntil(async () => (await page.data('session.isModerator')) === true, 'Explicit demo moderator did not select');
    const reviewerOwnerId = await page.data('session.userId');
    await capture('mine-demo-moderator');
    await tap(page, await byText(page, '.menu-row', '活动审核'));
    page = await loaded('/pages/review/index');
    await capture('review-queue');
    expect(!!leadId, 'Review requires the pending lead submitted in the native form');
    const reviewPage = page;
    const row = await element(reviewPage, '#review-' + leadId);
    const inlineForm = async () => (await reviewPage.data('items')).find(item => item.id === leadId)?.form;
    expect(!!(await inlineForm()), 'The pending submission has no actual inline rule form');
    await tap(reviewPage, await byText(row, '.reward-pills .pill', '返现'));
    await input(reviewPage, '#reward-' + leadId, '00018x.456');
    await waitUntil(async () => (await inlineForm())?.rewardText === '18.45'
      && (await inlineForm())?.draft.rewardMinor === 1845, 'Inline review did not filter and store a numeric reward');
    await tap(reviewPage, await byText(row, '.cycle-option', '按月'));
    await waitUntil(async () => (await inlineForm())?.draft.cycle?.t === 'month', 'Inline monthly cycle did not select');
    for (let index = 0; index < 2; index++) {
      const steppers = await row.$$('.stepper-button');
      expect(steppers.length === 2, 'Inline monthly cycle has no decrease/increase controls');
      await tap(reviewPage, steppers[1]);
    }
    const prepared = await inlineForm();
    expect(prepared.draft.cycle.day === 3 && prepared.draft.rewardKind === 'cashback' && prepared.sourceVerified === false,
      'Inline rule edits lost their cycle, reward type or explicit-source requirement', { prepared });
    const inlinePublish = await element(row, '.publish-button');
    const inlineDisabled = await inlinePublish.property('disabled');
    expect(inlineDisabled === true || inlineDisabled === 'true', 'An unverified incomplete inline draft exposes publication');
    await capture('review-inline-rules');
    await compare(row, '.screenshot-button', 'width', 48);
    await compare(row, '.screenshot-button', 'height', 64);
    await tap(reviewPage, await element(row, '.screenshot-button'));
    const reviewViewer = await element(reviewPage, '#review-screenshot-viewer');
    await element(reviewViewer, '.viewer');
    const viewerActions = await reviewViewer.$$('.actions button');
    expect(viewerActions.length === 1 && (await viewerActions[0].text()).includes('复制截图链接'),
      'The review viewer exposes another context action');
    await capture('review-screenshot-viewer');
    await (await element(reviewViewer, '.close')).tap();
    await waitUntil(async () => !(await reviewViewer.$('.viewer')), 'The review screenshot did not close');
    let recovery;
    await miniProgram.evaluate(expected => { getApp().__designReviewRecovery = { ...expected, calls: [] }; },
      { id: leadId, ownerId: reviewerOwnerId, version: prepared.baseVersion, rewardText: '18.45', cycle: { t: 'month', day: 3 } });
    await miniProgram.mockWxMethod('showModal', options => {
      const context = getApp().__designReviewRecovery;
      const pages = getCurrentPages(), current = pages[pages.length - 1], data = current?.data || {};
      const key = ['card-benefits.form-draft.v1', 'submission-review', context.ownerId, context.id].map(encodeURIComponent).join(':');
      const saved = wx.getStorageSync(key);
      const call = { title: options.title, content: options.content, route: current?.route || '', decision: 'unmatched' };
      context.calls.push(call);
      const matches = context.calls.length === 1 && call.route === 'pages/submission-edit/index'
        && data.loading === true && data.ready === true && data.reviewMode === true && data.readOnly === false
        && data.ownerId === context.ownerId && data.submissionId === context.id && data.sourceVerified === false
        && saved?.version === 1 && saved.ownerId === context.ownerId && saved.entityId === context.id
        && saved.baseVersion === context.version && saved.value?.pendingCreation === undefined
        && saved.value.rewardText === context.rewardText && saved.value.draft.rewardKind === 'cashback'
        && saved.value.draft.rewardMinor === 1845 && JSON.stringify(saved.value.draft.cycle) === JSON.stringify(context.cycle)
        && options.title === '发现未保存的草稿' && options.confirmText === '恢复草稿' && options.cancelText === '放弃草稿'
        && options.content === '是否恢复上次未保存的填写内容？恢复后仍需由你确认保存。';
      if (!matches) throw new Error('Unexpected platform modal during the operation-scoped inline review handoff');
      call.decision = 'confirm';
      return { confirm: true, cancel: false, errMsg: 'showModal:ok' };
    });
    try {
      await tap(reviewPage, await element(row, '.full-rules-link'));
      page = await loaded('/pages/submission-edit/index');
    } finally {
      try { recovery = await miniProgram.evaluate(() => getApp().__designReviewRecovery); }
      finally {
        try { await miniProgram.restoreWxMethod('showModal'); }
        finally { await miniProgram.evaluate(() => { delete getApp().__designReviewRecovery; }); }
      }
      record('inline-draft-recovery', { method: 'Operation-scoped SDK showModal callback',
        limitation: 'The platform recovery dialog gesture is simulated; application draft loading and rule transfer remain real.', calls: recovery?.calls || [] });
    }
    expect(recovery?.calls?.length === 1 && recovery.calls[0].decision === 'confirm', 'The inline handoff did not receive one explicit matching recovery decision');
    expect((await page.data('draft.rewardMinor')) === 1845 && (await page.data('draft.rewardKind')) === 'cashback'
      && (await page.data('draft.cycle.t')) === 'month' && (await page.data('draft.cycle.day')) === 3,
    'Opening complete review rules lost the actual inline draft');
    expect((await page.data('reviewMode')) === true && !(await page.data('readOnly')), 'The moderator cannot refine a pending lead');
    await element(page, '#section-basic');
    await capture('submission-rule-editor');
    const publish = await element(page, '.editor-dock .primary-button');
    expect(/审核|提交|发布/.test(await publish.text()), 'Rule editor lost its review workflow');
    const sourceHeader = await element(page, '#section-source .rules-heading');
    await tap(page, sourceHeader);
    if (leadId) {
      await element(page, '#field-sourceVerified');
      expect((await page.data('sourceVerified')) === false, 'Review preselected source verification without an explicit decision');
      const disabledProperty = await publish.property('disabled');
      const disabled = disabledProperty === true || disabledProperty === 'true';
      expect((await page.data('publishReady')) === true && !disabled,
        'The prepared positive reward and cycle do not reach the review validation gate', { disabled, publishReady: await page.data('publishReady') });
      if (!disabled) {
        await tap(page, publish);
        await waitUntil(async () => !(await page.data('saving')), 'Incomplete review did not resolve');
        const errors = await page.data('errors');
        expect(!!errors?.sourceVerified && (await page.data('submission.status')) === 'pending'
          && (await miniProgram.currentPage()).path === page.path,
          'Review published without explicit source verification and complete rules', { errors });
      }
      record('publication-gate', { sourceVerified: await page.data('sourceVerified'), disabled, errors: await page.data('errors') });
    }
    await capture('review-source-checks');
    page = await tab('mine');
    await (await byText(page, '.role-option', '普通用户')).tap();
    await waitUntil(async () => (await page.data('session.isModerator')) === false, 'Demo role did not restore');
  });

  await check('Complete inline review requires source confirmation and publishes only isolated demo content', async () => {
    expect(!!fixture.inlineReviewSubmissionId, 'The complete inline-review fixture is unavailable');
    let page = await tab('mine');
    expect((await page.data('session.demo')) === true, 'Publication acceptance requires an explicit isolated demo session');
    await (await byText(page, '.role-option', '运营审核')).tap();
    await waitUntil(async () => (await page.data('session.isModerator')) === true, 'The demo moderator did not activate');
    await tap(page, await byText(page, '.menu-row', '活动审核'));
    page = await loaded('/pages/review/index');
    const id = fixture.inlineReviewSubmissionId;
    const row = await element(page, '#review-' + id);
    const form = (await page.data('items')).find(item => item.id === id)?.form;
    expect(form?.complete === true && form.publishReady === true && form.sourceVerified === false,
      'The complete fixture does not isolate the explicit source-verification gate', { form });
    const button = await element(row, '.publish-button'), before = await button.property('disabled');
    expect(before === true || before === 'true', 'Unverified complete rules expose publication');
    await capture('inline-publication-before-source-confirmation');
    await tap(page, await element(row, '#source-verified-' + id));
    await waitUntil(async () => (await page.data('items')).find(item => item.id === id)?.form.sourceVerified === true,
      'The native source-verification switch did not apply an explicit decision');
    const after = await button.property('disabled');
    expect(after === false || after === 'false', 'Verified complete rules remain unable to publish');
    await capture('inline-publication-source-confirmed');
    await tap(page, button);
    await waitUntil(async () => !(await page.data('loading')) && !(await page.data('anyBusy'))
      && !(await page.data('items')).some(item => item.id === id), 'The actual demo publication did not remove its pending queue item');
    await (await byText(page, '.tabs .tab', '已发布')).tap();
    await waitUntil(async () => !(await page.data('loading')) && (await page.data('status')) === 'published'
      && (await page.data('items')).some(item => item.id === id), 'The published queue does not contain the moderated result');
    const published = (await page.data('items')).find(item => item.id === id);
    expect(published.status === 'published' && published.activityId, 'Publication did not create a real isolated catalog activity', { published });
    record('demo-publication', { submissionId: id, activityId: published.activityId, environment: 'Isolated demo service; no production/cloud write' });
    await capture('inline-publication-confirmed');
    page = await go('detail', 'id=' + encodeURIComponent(published.activityId));
    expect((await page.data('detail.activity.status')) === 'published' && (await page.data('detail.activity.id')) === published.activityId,
      'The moderated demo catalog entry does not load through the normal activity service');
    await capture('published-demo-activity');
    page = await tab('mine');
    await (await byText(page, '.role-option', '普通用户')).tap();
    await waitUntil(async () => (await page.data('session.isModerator')) === false, 'The demo publication did not restore the ordinary role');
  });

  await check('All remaining native pages render and geometric evidence is recorded', async () => {
    for (const name of ['submissions', 'preferences', 'history', 'entitlement-edit']) {
      await go(name);
      await capture(name);
    }
    const page = await go('web-entry', 'url=' + encodeURIComponent('https://example.com/design-acceptance'), true);
    expect((await page.data('url')) === '' && (await page.data('error')), 'Unconfigured website does not render its explicit safe fallback');
    await capture('web-entry-unconfigured-domain');
    record('rendered-design-metrics', geometry);
    record('reference', { source: 'D:/Code/design_handoff_activity_features/README.md', width: 402, height: 874,
      actualViewport: await viewport(), comparison: 'Rendered native element dimensions and computed styles; screenshot visual comparison remains a separate human review.' });
    await tab('activities');
    await capture('accepted-activity-overview');
  });
}
