const ROOTS = {
  'pages/todo/index': '.todo-page',
  'pages/activities/index': '.activity-page',
  'pages/rewards/index': '.rewards-page',
  'pages/wallet/index': '.wallet-page',
  'pages/mine/index': '.mine-page',
  'pages/detail/index': '.detail-page',
  'pages/progress/index': '.entry-page',
  'pages/receipt/index': '.entry-page',
  'pages/history/index': '.history-page',
  'pages/card-edit/index': '.card-form-page',
  'pages/submission-lead/index': '.lead-page',
  'pages/submission-edit/index': '.editor-page',
  'pages/submissions/index': '.submissions-page',
  'pages/review/index': '.review-page',
  'pages/preferences/index': '.preferences-page',
  'pages/web-entry/index': '.web-entry-page',
  'pages/entitlements/index': '.entitlements-page',
  'pages/entitlement-edit/index': '.entitlement-editor',
  'pages/lounges/index': '.lounges-page',
};
const CONTENT = {
  'pages/todo/index': ['.task-list', '.empty'],
  'pages/activities/index': ['.activity-tile', '.empty-title'],
  'pages/wallet/index': ['.privacy-note'],
  'pages/mine/index': ['.menu-row'],
  'pages/detail/index': ['.activity-summary'],
  'pages/progress/index': ['#progress-field'],
  'pages/receipt/index': ['#amount-field'],
  'pages/history/index': ['.history-record', '.empty-title'],
  'pages/card-edit/index': ['#field-bankId'],
  'pages/submission-lead/index': ['.lead-intro'],
  'pages/submission-edit/index': ['.editor-intro'],
  'pages/submissions/index': ['.submission-row', '.empty-title'],
  'pages/review/index': ['.review-list', '.empty-title'],
  'pages/preferences/index': ['.settings-group'],
  'pages/web-entry/index': ['.entry-state'],
  'pages/entitlements/index': ['.benefit-card', '.empty'],
  'pages/entitlement-edit/index': ['#section-basic'],
  'pages/lounges/index': ['.lounge-card', '.empty'],
};

const routeName = value => String(value || '').split('?')[0].replace(/^\//, '');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const errorInfo = error => ({ message: error.message, stack: error.stack });

// App.getCurrentPage is the same read-only protocol used by SDK 0.12.1.
// Reading it separately exposes cached Page metadata without changing SDK caches.
export async function readRouteDiagnostics(miniProgram) {
  const raw = await miniProgram.connection.send('App.getCurrentPage', {});
  const page = await miniProgram.currentPage();
  const logic = await miniProgram.evaluate(() => {
    const pages = getCurrentPages();
    const current = pages[pages.length - 1];
    return { route: current?.route || '', options: current?.options || {}, stackDepth: pages.length };
  });
  return {
    page,
    routes: {
      raw: { id: raw.pageId, path: raw.path, query: raw.query || {} },
      cached: { id: page?.id, path: page?.path, query: page?.query || {} },
      logic,
    },
  };
}

export function createPageWaiter(miniProgram, { measure, onDiagnostic, timeoutMs = 15000, stableForMs = 800 } = {}) {
  return async function waitForPage(route) {
    const expected = routeName(route);
    const selector = ROOTS[expected];
    if (!selector) throw new Error('No acceptance root selector is registered for ' + expected);
    const startedAt = Date.now();
    const samples = [];
    let previous;
    let stableSince = 0;
    let stableSamples = 0;
    let page;
    let lastError;
    let phase = 'routes';
    while (Date.now() - startedAt < timeoutMs) {
      const sample = { elapsedMs: Date.now() - startedAt };
      try {
        phase = 'routes';
        const current = await readRouteDiagnostics(miniProgram);
        page = current.page;
        sample.routes = current.routes;
        const { raw, cached, logic } = current.routes;
        const sameRoute = raw.id === cached.id && [raw.path, cached.path, logic.route].every(path => routeName(path) === expected);
        sample.routesAgree = sameRoute;
        if (sameRoute && page) {
          phase = 'page-data';
          const data = await page.data();
          sample.state = {
            loading: data.loading, busy: data.busy, saving: data.saving, reloading: data.reloading,
            failed: data.failed, error: data.error || data.loadError || '',
          };
          sample.idle = ![data.loading, data.busy, data.saving, data.reloading].some(value => value === true);
          phase = 'root-selector';
          const roots = await page.$$(selector);
          sample.rootCount = roots.length;
          if (sample.idle && roots.length === 1) {
            phase = 'page-content';
            sample.contentReady = !!(data.failed || data.error || data.loadError || data.denied);
            const contentSelectors = expected === 'pages/rewards/index'
              ? [data.tab === 'pending' ? '.pending-note' : '.income-summary'] : CONTENT[expected] || [];
            for (const contentSelector of contentSelectors) {
              if (await roots[0].$(contentSelector)) {
                sample.contentReady = true;
                sample.contentSelector = contentSelector;
                break;
              }
            }
            if (!contentSelectors.length) sample.contentReady = true;
            phase = 'root-geometry';
            sample.box = await measure(roots[0]);
          }
        }
        const box = sample.box;
        const ready = sample.routesAgree && sample.idle && sample.contentReady && sample.rootCount === 1 && box?.width > 0 && box?.height > 0;
        const unchanged = ready && previous?.ready && previous.id === sample.routes.raw.id
          && ['x', 'y', 'width', 'height'].every(key => Math.abs(box[key] - previous.box[key]) < 1);
        if (ready) {
          if (!unchanged) { stableSince = Date.now(); stableSamples = 1; }
          else stableSamples += 1;
        } else { stableSince = 0; stableSamples = 0; }
        previous = { ready, id: sample.routes.raw.id, box };
        sample.stableMs = stableSince ? Date.now() - stableSince : 0;
        samples.push(sample);
        if (ready && stableSamples >= 3 && sample.stableMs >= stableForMs) {
          await onDiagnostic?.({ expected, selector, status: 'ready', durationMs: Date.now() - startedAt, stableForMs, samples });
          return page;
        }
      } catch (error) {
        lastError = error;
        stableSince = 0;
        stableSamples = 0;
        previous = undefined;
        sample.phase = phase;
        sample.error = errorInfo(error);
        samples.push(sample);
      }
      await pause(150);
    }
    const diagnostic = { expected, selector, status: 'failed', durationMs: Date.now() - startedAt, stableForMs, samples };
    await onDiagnostic?.(diagnostic);
    const error = new Error('Page did not reach a stable rendered state: ' + expected + (lastError ? ': ' + lastError.message : ''));
    error.details = diagnostic;
    if (lastError) error.cause = lastError;
    throw error;
  };
}

export async function readRenderedViewport(miniProgram) {
  // A selector callback can be lost while its renderer is being replaced.
  // Bound that callback itself instead of leaving an unresolved protocol call.
  const serialized = await miniProgram.evaluate(() => new Promise(resolve => {
    const pages = getCurrentPages();
    const routeBefore = pages[pages.length - 1]?.route || '';
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(JSON.stringify(value));
    };
    const timer = setTimeout(() => finish({ timedOut: true, routeBefore }), 1500);
    wx.createSelectorQuery().selectViewport().boundingClientRect(value => {
      const current = getCurrentPages();
      finish({ windowWidth: value?.width, windowHeight: value?.height, routeBefore,
        routeAfter: current[current.length - 1]?.route || '' });
    }).exec();
  }));
  const viewport = JSON.parse(serialized);
  if (viewport.timedOut || !(viewport.windowWidth > 0 && viewport.windowHeight > 0) || viewport.routeBefore !== viewport.routeAfter) {
    const error = new Error('Rendered viewport was unavailable or changed routes during measurement');
    error.details = { automationStep: 'selectViewport.boundingClientRect', viewport };
    throw error;
  }
  return viewport;
}
