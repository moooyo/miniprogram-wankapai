import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('sheet titles keep their full text while yielding width to the design 44px close target', () => {
  const markup = readFileSync('miniprogram/components/app-sheet/index.wxml', 'utf8');
  const styles = readFileSync('miniprogram/components/app-sheet/index.wxss', 'utf8');
  const titleRule = /\.sheet-title\s*\{([^}]+)\}/.exec(styles)?.[1] || '';
  const closeRule = /\.sheet-head\s+\.sheet-close\s*\{([^}]+)\}/.exec(styles)?.[1] || '';
  assert.match(markup, /<text\s+class="sheet-title">\{\{title\}\}<\/text>/);
  for (const [, selector] of styles.matchAll(/(?:^|})\s*([^{}]+)\{/g)) assert.doesNotMatch(selector, /(^|[\s>+~,])(?:text|view|button)\b/);
  assert.match(markup, /role="dialog"[^>]*aria-label="\{\{title\}\}"/);
  assert.match(titleRule, /flex\s*:\s*1\s*;/);
  assert.match(titleRule, /min-width\s*:\s*0\s*;/);
  assert.match(titleRule, /overflow-wrap\s*:\s*anywhere\s*;/);
  assert.match(titleRule, /white-space\s*:\s*normal\s*;/);
  assert.doesNotMatch(titleRule, /ellipsis|line-clamp|overflow\s*:\s*hidden/);
  assert.match(closeRule, /width\s*:\s*44px\s*;/);
  assert.match(closeRule, /height\s*:\s*44px\s*;/);
  assert.match(closeRule, /flex\s*:\s*none\s*;/);
});

test('a wrapped sheet header is measured before allocating its remaining scroll viewport', () => {
  let definition: any;
  let headerHeight = 64;
  const source = readFileSync('miniprogram/components/app-sheet/index.ts', 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(javascript, {
    exports: {},
    require: () => ({ default: { tabBar: { list: [] } } }),
    Component: (value: unknown) => { definition = value; },
    getCurrentPages: () => [{ route: 'pages/detail/index' }],
    wx: { nextTick: (callback: () => void) => callback(), getWindowInfo: () => ({ windowHeight: 700, screenHeight: 734, safeArea: { bottom: 700 } }) },
  });
  const instance = {
    ...definition.methods,
    data: { show: true, bodyHeight: 200, title: 'Short title' },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
    createSelectorQuery() {
      const query = {
        selectViewport() { return query; }, select() { return query; }, boundingClientRect() { return query; },
        exec(callback: (results: { height: number }[]) => void) { callback([{ height: 700 }, { height: 1600 }, { height: headerHeight }]); },
      };
      return query;
    },
  };
  definition.observers.show.call(instance, true);
  assert.equal(instance.data.bodyHeight, 518);
  headerHeight = 160;
  instance.data.title = 'W'.repeat(60);
  definition.observers['contentState.**, title, fullScreen'].call(instance);
  assert.equal(instance.data.title.length, 60);
  assert.equal(instance.data.bodyHeight, 422);
  assert.ok(instance.data.bodyHeight > 0 && instance.data.bodyHeight < 1600);
  assert.equal(instance.data.bodyHeight + headerHeight + 34, 700 * .88);
});
