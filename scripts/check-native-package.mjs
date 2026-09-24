import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const filename = path.join(directory, item.name);
    return item.isDirectory() ? files(filename) : [filename];
  });
}

export function checkNativePackage(directory = path.join(root, 'dist', 'miniprogram')) {
  const packageRoot = realpathSync(directory);
  const relative = filename => path.relative(packageRoot, filename).split(path.sep).join('/');
  const insidePackage = filename => {
    const result = path.relative(packageRoot, filename);
    assert.ok(result && !result.startsWith(`..${path.sep}`) && result !== '..' && !path.isAbsolute(result), `Module escapes the native package: ${filename}`);
    return filename;
  };
  const resolveModule = (request, importer) => {
    assert.match(request, /^\.\.?\//, `Unsupported external dependency in ${relative(importer)}: ${request}`);
    const base = insidePackage(path.resolve(path.dirname(importer), request));
    for (const candidate of [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]) {
      try {
        if (statSync(candidate).isFile()) return insidePackage(realpathSync(candidate));
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      }
    }
    throw new Error(`Unresolved native dependency: ${relative(importer)} -> ${request}`);
  };
  const allFiles = files(packageRoot);
  const entries = allFiles.filter(filename => filename.endsWith('.js')).sort();
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'app.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.pages) && manifest.pages.length, 'The native package must declare pages.');
  assert.equal(new Set(manifest.pages).size, manifest.pages.length, 'Native page routes must be unique.');
  const pages = manifest.pages.map(route => insidePackage(path.resolve(packageRoot, `${route}.js`)));
  for (const page of pages) {
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      assert.ok(allFiles.includes(page.replace(/\.js$/, `.${extension}`)), `Missing page artifact: ${relative(page).replace(/\.js$/, `.${extension}`)}`);
    }
  }
  const components = entries.filter(filename => relative(filename).startsWith('components/'));
  const services = entries.filter(filename => relative(filename).startsWith('services/'));
  const app = path.join(packageRoot, 'app.js');
  const config = path.join(packageRoot, 'runtime-config.js');
  for (const filename of [app, config, path.join(packageRoot, 'services', 'api.js'), path.join(packageRoot, 'services', 'privacy.js')]) {
    assert.ok(entries.includes(filename), `Missing native entry: ${relative(filename)}`);
  }
  for (const filename of allFiles.filter(filename => filename.endsWith('.json'))) {
    const configuration = JSON.parse(readFileSync(filename, 'utf8'));
    for (const component of Object.values(configuration.usingComponents || {})) {
      assert.equal(typeof component, 'string', `Invalid component path in ${relative(filename)}`);
      const target = component.startsWith('/') ? path.resolve(packageRoot, `.${component}.js`) : path.resolve(path.dirname(filename), `${component}.js`);
      assert.ok(components.includes(insidePackage(target)), `Missing component in ${relative(filename)}: ${component}`);
    }
  }

  const sources = new Map(entries.map(filename => [filename, readFileSync(filename, 'utf8')]));
  const dependencies = [];
  for (const [filename, source] of sources) {
    // esbuild emits literal CommonJS imports; check dormant imports without invoking application handlers.
    for (const match of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
      dependencies.push({ importer: filename, target: resolveModule(match[1], filename) });
    }
  }

  function createLoader() {
    const cache = new Map();
    const registrations = [];
    let currentModule;
    const register = kind => definition => {
      assert.ok(definition && typeof definition === 'object', `Invalid ${kind} registration in ${relative(currentModule)}`);
      registrations.push({ kind, filename: currentModule });
    };
    const blocked = name => () => { throw new Error(`${name} must not run during native package registration.`); };
    const context = vm.createContext({
      App: register('App'), Page: register('Page'), Component: register('Component'),
      wx: new Proxy({}, { get: (_target, name) => { throw new Error(`wx.${String(name)} must not run during native package registration.`); } }),
      getApp: blocked('getApp'), getCurrentPages: blocked('getCurrentPages'),
      setTimeout: blocked('setTimeout'), setInterval: blocked('setInterval'),
    });
    function load(filename) {
      if (cache.has(filename)) return cache.get(filename).exports;
      const module = { exports: {} };
      cache.set(filename, module);
      if (filename.endsWith('.json')) {
        module.exports = JSON.parse(readFileSync(filename, 'utf8'));
        return module.exports;
      }
      assert.ok(sources.has(filename), `Unexpected native module: ${relative(filename)}`);
      const execute = vm.compileFunction(sources.get(filename), ['require', 'module', 'exports', '__filename', '__dirname'], { parsingContext: context, filename });
      const previousModule = currentModule;
      currentModule = filename;
      try {
        execute(request => load(resolveModule(request, filename)), module, module.exports, filename, path.dirname(filename));
      } finally {
        currentModule = previousModule;
      }
      return module.exports;
    }
    return { load, cache, registrations };
  }

  for (const entry of entries) {
    const loader = createLoader();
    loader.load(entry);
    const expectedKind = entry === app ? 'App' : pages.includes(entry) ? 'Page' : components.includes(entry) ? 'Component' : undefined;
    const registered = loader.registrations.filter(item => item.filename === entry);
    assert.equal(registered.length, expectedKind ? 1 : 0, `Unexpected registration count for ${relative(entry)}`);
    if (expectedKind) assert.equal(registered[0].kind, expectedKind, `Incorrect registration type for ${relative(entry)}`);
    assert.equal(loader.registrations.length, registered.length, `A dependency registered an additional page, component, or app for ${relative(entry)}`);
  }

  for (const entry of [config, ...services]) {
    assert.ok(dependencies.some(dependency => dependency.target === entry), `Shared entry is not imported externally: ${relative(entry)}`);
  }
  const sharedLoader = createLoader();
  for (const entry of entries) sharedLoader.load(entry);
  assert.equal(sharedLoader.registrations.length, pages.length + components.length + 1, 'Combined native entry registration count is incorrect.');
  return {
    pages: pages.length, components: components.length, services: services.length,
    apps: 1, configurationFiles: 1, modules: entries.length, staticDependencies: dependencies.length,
    scope: 'Node CommonJS package integrity and registration only; no lifecycle, WeChat APIs, WXML rendering, device, or cloud acceptance.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(checkNativePackage(process.argv[2]), null, 2));
}
