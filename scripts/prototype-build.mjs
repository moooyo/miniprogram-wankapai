import { build } from 'esbuild';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = path.join(root, 'miniprogram');
const output = path.join(root, 'dist', 'prototype');
const config = JSON.parse(await readFile(path.join(client, 'app.json'), 'utf8'));

// A small XML tokenizer preserves quoted WXML expressions containing angle brackets.
function parseWxml(source) {
  const tree = { tag: 'root', attrs: {}, children: [] };
  const stack = [tree];
  const tokens = source.match(/<!--[\s\S]*?-->|<\/?[\w:-]+(?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>|[^<]+/g) || [];
  for (const token of tokens) {
    if (token.startsWith('<!--')) continue;
    if (token.startsWith('</')) { stack.pop(); continue; }
    if (token.startsWith('<')) {
      const tag = /^<([\w:-]+)/.exec(token)[1];
      const attrs = {};
      const body = token.slice(tag.length + 1).replace(/\/?\s*>$/, '');
      for (const match of body.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)) attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? true;
      const node = { tag, attrs, children: [] };
      stack.at(-1).children.push(node);
      if (!token.endsWith('/>')) stack.push(node);
    } else if (token.trim()) stack.at(-1).children.push({ text: token });
  }
  return tree.children;
}

function listActions(nodes, found = [], ancestry = []) {
  for (const node of nodes) {
    if (!node.tag) continue;
    const conditions = [...ancestry];
    if (node.tag === 'app-sheet') conditions.push({ title: node.attrs.title, expression: node.attrs.show });
    if (node.attrs['wx:if'] || node.attrs['wx:elif']) conditions.push({ expression: node.attrs['wx:if'] || node.attrs['wx:elif'] });
    if (node.attrs['wx:else']) conditions.push({ expression: 'Previous conditions do not match' });
    for (const [binding, handler] of Object.entries(node.attrs)) {
      if (/^(bind|catch)/.test(binding)) found.push({ binding, handler, tag: node.tag, label: node.attrs['aria-label'] || node.children.filter(child => child.text).map(child => child.text.trim()).join(' '), conditions });
    }
    listActions(node.children, found, conditions);
  }
  return found;
}

function mapNativeSelector(selector) {
  const nativeTags = new Set(['view', 'text', 'image', 'picker', 'scroll-view', 'checkbox-group', 'switch', 'checkbox', 'web-view']);
  let result = '', quote = '', bracketDepth = 0;
  for (let index = 0; index < selector.length;) {
    const character = selector[index];
    if (quote) { result += character; if (character === quote && selector[index - 1] !== '\\') quote = ''; index++; continue; }
    if (character === '"' || character === "'") { quote = character; result += character; index++; continue; }
    if (selector.slice(index, index + 2) === '/*') {
      const end = selector.indexOf('*/', index + 2); const until = end < 0 ? selector.length : end + 2;
      result += selector.slice(index, until); index = until; continue;
    }
    if (character === '[') bracketDepth++;
    if (character === ']') bracketDepth--;
    const mayStartType = index === 0 || /[\s>+~,(]/.test(selector[index - 1]);
    if (!bracketDepth && mayStartType && /[a-z]/i.test(character)) {
      const word = /^[a-z][\w-]*/i.exec(selector.slice(index))[0];
      result += word === 'page' ? ':host' : nativeTags.has(word) ? `[data-wx-tag="${word}"]` : word;
      index += word.length; continue;
    }
    result += character; index++;
  }
  return result;
}
function convertCss(css) {
  const units = css.replace(/(-?\d*\.?\d+)(rpx|vw|vh)\b/g, (_, value, unit) => `calc(${Number(value)} * var(--prototype-${unit}, ${unit === 'rpx' ? '.5px' : unit === 'vw' ? '3.9px' : '7px'}))`);
  // Only rule preludes are selectors. Declaration values and attribute strings stay intact.
  return units.replace(/(?:^|(?<=[{}]))([^{}]+)(?=\{)/g, selector => selector.trimStart().startsWith('@') ? selector : mapNativeSelector(selector));
}
const pages = {};
const componentPaths = {
  ...config.usingComponents,
  'demo-notice': '/components/demo-notice/index',
  'privacy-gate': '/components/privacy-gate/index',
};
for (const route of config.pages) {
  const markup = await readFile(path.join(client, `${route}.wxml`), 'utf8');
  const nodes = parseWxml(markup);
  const pageConfig = JSON.parse(await readFile(path.join(client, `${route}.json`), 'utf8'));
  for (const [name, componentPath] of Object.entries(pageConfig.usingComponents || {})) {
    componentPaths[name] = componentPath.startsWith('/') ? componentPath : '/' + path.relative(client, path.resolve(path.dirname(path.join(client, route)), componentPath)).split(path.sep).join('/');
  }
  pages[route] = { nodes, actions: listActions(nodes), css: convertCss(await readFile(path.join(client, `${route}.wxss`), 'utf8')), title: pageConfig.navigationBarTitleText || config.window.navigationBarTitleText };
}
const components = {};
for (const [name, componentPath] of Object.entries(componentPaths)) {
  const nodes = parseWxml(await readFile(path.join(client, `${componentPath.replace(/^\//, '')}.wxml`), 'utf8'));
  components[name] = { nodes, actions: listActions(nodes) };
}
const expressions = {};
function compileExpressions(nodes) {
  for (const node of nodes) {
    for (const value of [node.text, ...Object.values(node.attrs || {})]) {
      if (typeof value !== 'string') continue;
      for (const [, expression] of value.matchAll(/{{([\s\S]*?)}}/g)) {
        if (expressions[expression]) continue;
        const file = ts.createSourceFile('expression.ts', `(${expression})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const transformed = ts.transform(file.statements[0].expression, [context => {
          const visit = node => {
            const updated = ts.visitEachChild(node, visit, context);
            if (ts.isPropertyAccessExpression(updated)) return ts.factory.createPropertyAccessChain(updated.expression, ts.factory.createToken(ts.SyntaxKind.QuestionDotToken), updated.name);
            if (ts.isElementAccessExpression(updated)) return ts.factory.createElementAccessChain(updated.expression, ts.factory.createToken(ts.SyntaxKind.QuestionDotToken), updated.argumentExpression);
            return updated;
          };
          return node => ts.visitNode(node, visit);
        }]);
        expressions[expression] = ts.createPrinter().printNode(ts.EmitHint.Expression, transformed.transformed[0], file);
        transformed.dispose();
      }
    }
    compileExpressions(node.children || []);
  }
}
Object.values(pages).forEach(page => compileExpressions(page.nodes));
Object.values(components).forEach(component => compileExpressions(component.nodes));
const assets = {};
async function collectAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectAssets(absolute);
    else assets['/' + path.relative(client, absolute).replaceAll('\\', '/')] = `data:image/png;base64,${(await readFile(absolute)).toString('base64')}`;
  }
}
await collectAssets(path.join(client, 'assets'));
const manifest = {
  config, pages, components, expressions, assets,
  appCss: convertCss(await readFile(path.join(client, 'app.wxss'), 'utf8')),
  sheetCss: convertCss(await readFile(path.join(client, 'components/app-sheet/index.wxss'), 'utf8')),
  demoCss: convertCss(await readFile(path.join(client, 'components/demo-notice/index.wxss'), 'utf8')),
};
const entry = [
  "import './prototype/runtime.js';",
  ...config.pages.map(route => `import './miniprogram/${route}.ts';`),
  "import { api, setDemoRole, ensureSession, ApiError } from './miniprogram/services/api';",
  "import { demoService, resetDemoCache, demoActor } from './miniprogram/services/demo';",
  "window.Prototype.start({api, setDemoRole, ensureSession, ApiError, demoService, resetDemoCache, demoActor});",
].join('\n');
const result = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'prototype-entry.js' },
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2020', logLevel: 'info',
  plugins: [{ name: 'prototype-native-adapter', setup(builder) {
    builder.onLoad({ filter: /miniprogram[\\/]pages[\\/].*\.ts$/ }, async args => {
      const route = path.relative(client, args.path).replaceAll('\\', '/').replace(/\.ts$/, '');
      return { contents: (await readFile(args.path, 'utf8')).replace(/\bPage\s*\(/, `window.Prototype.register(${JSON.stringify(route)}, `), loader: 'ts' };
    });
    builder.onLoad({ filter: /runtime-config\.js$/ }, () => ({ contents: "export default {mode:'demo',cloudEnvId:'',apiFunctionName:'api',templateIds:{new_activity:'',deadline:'',reward:'',repayment:''},webViewEnabled:false,allowedWebViewHosts:[]};", loader: 'js' }));
  } }],
});
const shell = await readFile(path.join(root, 'prototype/index.html'), 'utf8');
const css = await readFile(path.join(root, 'prototype/workbench.css'), 'utf8');
const script = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = shell.replace('/* PROTOTYPE_STYLES */', css).replace('/* PROTOTYPE_MANIFEST */', `window.PROTOTYPE_MANIFEST=${JSON.stringify(manifest).replaceAll('<', '\\u003c')};`).replace('/* PROTOTYPE_BUNDLE */', script);
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'index.html'), html);
await writeFile(path.join(output, 'coverage.json'), JSON.stringify({ pages: Object.fromEntries(Object.entries(pages).map(([route, page]) => [route, { title: page.title, actions: page.actions }])), components: Object.fromEntries(Object.entries(components).map(([name, component]) => [name, { actions: component.actions }])) }, null, 2) + '\n');
console.log(`Interactive prototype: ${path.join(output, 'index.html')} (${config.pages.length} source pages)`);
