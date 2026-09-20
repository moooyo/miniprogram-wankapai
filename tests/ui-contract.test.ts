import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { ActivityItem, ApiRequest, Dashboard, MutationResult, PageResult, RewardsView, Wallet } from '../shared/contracts';

const project = process.cwd();
const root = path.join(project, 'miniprogram');
const read = (file: string) => readFileSync(file, 'utf8');
const json = (file: string) => JSON.parse(read(file));

function files(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file, extension) : file.endsWith(extension) ? [file] : [];
  });
}

function controllerMethods(file: string): Set<string> {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const methods = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['Page', 'Component'].includes(node.expression.text)) {
      const object = node.arguments[0];
      if (object && ts.isObjectLiteralExpression(object)) {
        const collect = (properties: ts.NodeArray<ts.ObjectLiteralElementLike>) => {
          for (const property of properties) {
            if (ts.isMethodDeclaration(property) && property.name) methods.add(property.name.getText(source).replace(/^['"]|['"]$/g, ''));
            if (ts.isPropertyAssignment(property)) {
              if (ts.isFunctionExpression(property.initializer) || ts.isArrowFunction(property.initializer)) methods.add(property.name.getText(source).replace(/^['"]|['"]$/g, ''));
              if (property.name.getText(source) === 'methods' && ts.isObjectLiteralExpression(property.initializer)) collect(property.initializer.properties);
            }
          }
        };
        collect(object.properties);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return methods;
}

test('registered pages, tab icons, and custom components resolve to complete source units', () => {
  const app = json(path.join(root, 'app.json'));
  assert.ok(Array.isArray(app.pages) && app.pages.length > 0, 'The app must register pages.');
  const routes = new Set<string>(app.pages);
  assert.equal(routes.size, app.pages.length, 'Routes must be unique.');
  for (const route of routes) {
    for (const extension of ['.ts', '.wxml', '.wxss', '.json']) assert.ok(existsSync(path.join(root, route + extension)), `Missing ${route}${extension}`);
  }
  for (const tab of app.tabBar?.list || []) {
    assert.ok(routes.has(tab.pagePath), `Unknown tab route: ${tab.pagePath}`);
    for (const icon of [tab.iconPath, tab.selectedIconPath]) assert.ok(existsSync(path.join(root, icon)), `Missing tab icon: ${icon}`);
  }
  for (const configFile of files(root, '.json')) {
    const config = json(configFile);
    for (const [name, target] of Object.entries<string>(config.usingComponents || {})) {
      assert.ok(!target.startsWith('plugin://'), `External component ${name} requires a credentialed integration check.`);
      const base = target.startsWith('/') ? path.join(root, target) : path.resolve(path.dirname(configFile), target);
      for (const extension of ['.ts', '.wxml', '.wxss', '.json']) assert.ok(existsSync(base + extension), `Missing component ${name}: ${base}${extension}`);
      assert.equal(json(base + '.json').component, true, `Component ${name} must declare component: true.`);
    }
  }
});

test('every WXML event binding names a method in its own controller', () => {
  const app = json(path.join(root, 'app.json'));
  const nativeTags = new Set(['scroll-view', 'swiper-item', 'movable-area', 'movable-view', 'cover-view', 'cover-image', 'icon', 'rich-text', 'progress', 'checkbox-group', 'editor', 'form', 'label', 'picker-view', 'picker-view-column', 'radio-group', 'textarea', 'functional-page-navigator', 'navigation-bar', 'page-meta', 'match-media', 'page-container', 'share-element', 'root-portal', 'web-view', 'live-player', 'live-pusher', 'official-account', 'open-data', 'ad-custom', 'channel-live', 'channel-video', 'voip-room']);
  for (const templateFile of files(root, '.wxml')) {
    const controller = templateFile.replace(/\.wxml$/, '.ts');
    assert.ok(existsSync(controller), `Missing controller for ${templateFile}`);
    const methods = controllerMethods(controller);
    const template = read(templateFile).replace(/<!--[\s\S]*?-->/g, '');
    const config = json(templateFile.replace(/\.wxml$/, '.json'));
    const registered = new Set(Object.keys({ ...app.usingComponents, ...config.usingComponents }));
    for (const match of template.matchAll(/<([a-z][a-z0-9]*-[a-z0-9-]+)\b/g)) {
      assert.ok(nativeTags.has(match[1]) || registered.has(match[1]), `Unregistered component ${match[1]} in ${path.relative(root, templateFile)}`);
    }
    const binding = /\b(?:(?:capture-)?(?:bind|catch)|mut-bind):?[a-zA-Z][\w-]*\s*=\s*["']([^"']+)["']/g;
    for (const match of template.matchAll(binding)) {
      assert.ok(!match[1].includes('{{'), `Dynamic event binding needs an explicit contract: ${templateFile}: ${match[1]}`);
      assert.ok(methods.has(match[1]), `Unknown event handler ${match[1]} in ${path.relative(root, templateFile)}`);
    }
  }
});

test('literal native navigation targets registered routes', () => {
  const app = json(path.join(root, 'app.json'));
  const routes = new Set<string>(app.pages);
  for (const controller of files(root, '.ts')) {
    for (const match of read(controller).matchAll(/\/pages\/[a-z0-9-]+\/index/g)) {
      assert.ok(routes.has(match[0].slice(1)), `Unregistered destination ${match[0]} in ${path.relative(root, controller)}`);
    }
  }
});

test('WXML bindings do not use unsupported JavaScript-only expressions', () => {
  const issues: string[] = [];
  for (const file of files(root, '.wxml')) {
    for (const match of read(file).matchAll(/\bwx:(?:if|elif|for)\s*=\s*"([^"]*)"/g)) {
      if (!/^{{[\s\S]+}}$/.test(match[1].trim())) issues.push(`Control directives must bind data, not a truthy literal in ${path.relative(root, file)}: ${match[0]}`);
    }
    for (const match of read(file).matchAll(/{{([\s\S]*?)}}/g)) {
      if (/\?\.|\?\?|=>|\bnew\s/.test(match[1])) issues.push(`Unsupported WXML expression in ${path.relative(root, file)}: ${match[1]}`);
      if (/\.[a-zA-Z_$][\w$]*\s*\(/.test(match[1])) issues.push(`WXML cannot call controller methods in ${path.relative(root, file)}: ${match[1]}`);
    }
  }
  assert.deepEqual(issues, []);
});

test('demo bootstrap, held-card filtering, and receipt persistence work without cloud credentials', async () => {
  const runtime = globalThis as unknown as { wx?: unknown };
  const previous = runtime.wx;
  const storage = new Map<string, unknown>();
  runtime.wx = {
    getStorageSync(key: string) { return storage.has(key) ? structuredClone(storage.get(key)) : undefined; },
    setStorageSync(key: string, value: unknown) { storage.set(key, structuredClone(value)); },
  };
  const { demoActor, demoService, persistDemo, resetDemoCache } = await import('../miniprogram/services/demo');
  try {
    resetDemoCache();
    const service = await demoService();
    const query = <T>(action: string, payload: unknown = {}) => service.execute(demoActor, { action, payload } as ApiRequest) as Promise<T>;
    const wallet = await query<Wallet>('wallet.get');
    assert.equal(wallet.cards.length, 3);
    assert.ok(wallet.cards.every(card => card.ownerId === demoActor.userId));
    const all = await query<PageResult<ActivityItem>>('catalog.list');
    const mine = await query<PageResult<ActivityItem>>('catalog.list', { mineOnly: true });
    assert.ok(mine.items.length > 0 && mine.items.length < all.items.length);
    const dashboard = await query<Dashboard>('dashboard.get');
    assert.ok(dashboard.pendingRewards.some(record => record.endsOn < dashboard.today.slice(0, 7) + '-01'));
    const result = await service.execute(demoActor, { action: 'reward.confirm', payload: { activityId: 'instant', amountMinor: 3000, receivedOn: dashboard.today }, requestId: 'demo-persistence-check' }) as MutationResult;
    await persistDemo();
    resetDemoCache();
    const restored = await demoService();
    const rewards = await restored.execute(demoActor, { action: 'rewards.get', payload: { month: dashboard.today.slice(0, 7), currency: 'CNY' } }) as RewardsView;
    assert.equal(rewards.totalMinor, 3000);
    assert.ok(rewards.received.some(reward => reward.participationId === result.id));
  } finally {
    resetDemoCache();
    runtime.wx = previous;
  }
});
