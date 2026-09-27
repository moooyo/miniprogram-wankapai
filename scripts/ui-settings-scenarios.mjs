// Actual native controls and persistence; no synthetic page data or domain results.
export async function runUiSettingsScenarios(miniProgram, helpers) {
  const { check, expect, capture, measure, waitUntil, waitForPage } = helpers;
  async function element(scope, selector) {
    let target;
    await waitUntil(async () => !!(target = await scope.$(selector)), `Missing native control: ${selector}`);
    return target;
  }
  async function reveal(page, target) {
    const box = await measure(target);
    const viewport = await helpers.viewport();
    if (box.y < 0 || box.bottom > viewport.windowHeight) {
      await miniProgram.pageScrollTo(Math.max(0, Number(await page.scrollTop()) + box.y - 24));
    }
    return target;
  }
  async function openSettings() {
    await miniProgram.switchTab('/pages/mine/index');
    const mine = await waitForPage('/pages/mine/index');
    let entry;
    for (const candidate of await mine.$$('.menu-row')) {
      if ((await candidate.text()).includes('提醒设置')) { entry = candidate; break; }
    }
    expect(entry, 'Mine must expose the reminder settings destination.');
    await (await reveal(mine, entry)).tap();
    return waitForPage('/pages/preferences/index');
  }

  await check('Native preferences preserve visible saving, help and persisted switches', async () => {
    let page = await openSettings();
    const original = await page.data('newActivities');
    const toggle = await element(page, 'switch[data-field="newActivities"]');
    await (await reveal(page, toggle)).tap();
    await waitUntil(async () => (await page.data('dirty')) === true && (await page.data('newActivities')) === !original,
      'Native switch must change the unsaved preference.');
    const save = await element(page, '.preferences-dock .primary-button');
    const box = await measure(save), viewport = await helpers.viewport();
    expect(box.y >= 0 && box.bottom <= viewport.windowHeight + 3 && box.height >= 44,
      'Fixed preference Save must fit in the actual native viewport.', { box, viewport });
    expect((await (await element(page, '.save-status')).text()).includes('设置有修改'), 'Dirty preference must be explicit.');
    await save.tap();
    await waitUntil(async () => (await page.data('saved')) === true && (await page.data('dirty')) === false,
      'Preference save must complete.');
    await capture('native-preferences-saved');
    await miniProgram.navigateBack();
    await waitForPage('/pages/mine/index');
    page = await openSettings();
    expect((await page.data('newActivities')) === !original, 'Saved preference must survive reopening.');
    await (await reveal(page, await element(page, '.note-toggle'))).tap();
    await waitUntil(async () => !!(await page.$('#reminder-help')), 'Notification help must expand.');
    const help = await element(page, '#reminder-help');
    expect((await help.text()).includes('演示模式'), 'Help must explain the demo boundary.');
    await capture('native-preferences-help');
    await (await reveal(page, await element(page, '.note-toggle'))).tap();
    await (await reveal(page, await element(page, 'switch[data-field="newActivities"]'))).tap();
    await waitUntil(async () => (await page.data('newActivities')) === original && (await page.data('dirty')),
      'Original preference must be restored through the switch.');
    await (await element(page, '.preferences-dock .primary-button')).tap();
    await waitUntil(async () => (await page.data('saved')) && !(await page.data('dirty')), 'Original preference must save.');
  });

  await check('Native web-entry fallback explains unavailable pages and returns safely', async () => {
    await miniProgram.switchTab('/pages/activities/index');
    await waitForPage('/pages/activities/index');
    // Use a public bank overview URL accepted by the production validator.
    // Web-view is disabled in demo mode, so this never requests the website.
    await miniProgram.navigateTo('/pages/web-entry/index?url=' + encodeURIComponent('https://www.boc.cn/'));
    let page = await waitForPage('/pages/web-entry/index');
    expect(!(await page.data('url')) && (await page.data('sourceUrl')) === 'https://www.boc.cn/',
      'Disabled web-view must keep the validated source without opening a web page.');
    expect((await (await element(page, '.entry-copy')).text()).includes('复制地址'), 'Fallback must explain the next action.');
    expect(await page.$('.secondary'), 'Validated source must retain its copy action.');
    await capture('native-web-entry-fallback');
    await (await element(page, '.back-button')).tap();
    await waitForPage('/pages/activities/index');
    await miniProgram.navigateTo('/pages/web-entry/index?url=invalid');
    page = await waitForPage('/pages/web-entry/index');
    expect(!(await page.data('sourceUrl')) && !(await page.$('.secondary')), 'Invalid source must not be copyable.');
    expect((await (await element(page, '.entry-copy')).text()).includes('地址无效'), 'Invalid URL must have visible feedback.');
    await capture('native-web-entry-invalid');
    await (await element(page, '.back-button')).tap();
    await waitForPage('/pages/activities/index');
  });
}
