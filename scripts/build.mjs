import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNativePackage } from './check-native-package.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const client=path.join(root,'miniprogram');
const output=path.join(root,'dist','miniprogram');
async function files(directory){
  const result=[];
  for(const item of await readdir(directory,{withFileTypes:true})){
    const name=path.join(directory,item.name);
    result.push(...(item.isDirectory()?await files(name):[name]));
  }
  return result;
}
await mkdir(output,{recursive:true});
const entries=[];
for(const file of await files(client)){
  const relative=path.relative(client,file),target=path.join(output,relative);
  if(file.endsWith('.ts')){
    if(relative==='app.ts'||relative.startsWith(`pages${path.sep}`)||relative.startsWith(`components${path.sep}`)||['services/api.ts','services/privacy.ts'].includes(relative.split(path.sep).join('/')))entries.push(file);
    continue;
  }
  await mkdir(path.dirname(target),{recursive:true});
  if(file.endsWith('.wxml')&&relative.startsWith(`pages${path.sep}`)&&!relative.startsWith(`pages${path.sep}web-entry`)){
    const markup=await readFile(file,'utf8');
    await writeFile(target,`<demo-notice />\n${markup}\n<privacy-gate />\n`);
  }else if(file.endsWith('.json')&&relative.startsWith(`pages${path.sep}`)&&!relative.startsWith(`pages${path.sep}web-entry`)){
    const configuration=JSON.parse(await readFile(file,'utf8'));
    configuration.usingComponents={...configuration.usingComponents,'demo-notice':'/components/demo-notice/index','privacy-gate':'/components/privacy-gate/index'};
    await writeFile(target,JSON.stringify(configuration,null,2)+'\n');
  }else await cp(file,target);
}
const sharedModules = new Map([
  ['services/api.ts', 'services/api.js'],
  ['services/privacy.ts', 'services/privacy.js'],
  ['runtime-config.js', 'runtime-config.js'],
].map(([source, target]) => [path.join(client, source), path.join(output, target)]));
const demoSource = path.join(client, 'services', 'demo.ts');
const apiSource = path.join(client, 'services', 'api.ts');
const configSource = path.join(client, 'runtime-config.js');

function singletonPlugin(outfile) {
  const resolving = {};
  return {
    name: 'shared-mini-program-services',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, async args => {
        if (args.kind === 'entry-point' || args.pluginData === resolving) return null;
        const resolved = await builder.resolve(args.path, {
          importer: args.importer, namespace: args.namespace, resolveDir: args.resolveDir,
          kind: args.kind, pluginData: resolving, with: args.with,
        });
        if (resolved.errors.length) return { errors: resolved.errors, warnings: resolved.warnings };
        const target = sharedModules.get(resolved.path);
        if (!target) return null;
        const relative = path.relative(path.dirname(outfile), target).split(path.sep).join('/');
        // A transitive import is relative to its final bundle, not its source helper.
        return { path: relative.startsWith('.') ? relative : `./${relative}`, external: true };
      });
    },
  };
}

await Promise.all(entries.map(async entry => {
  const outfile = path.join(output, path.relative(client, entry).replace(/\.ts$/, '.js'));
  const result = await build({
    absWorkingDir: root, entryPoints: [entry], outfile, bundle: true, platform: 'neutral', format: 'cjs',
    target: 'es2018', sourcemap: false, metafile: true, plugins: [singletonPlugin(outfile)], logLevel: 'warning',
  });
  const inputs = new Set(Object.keys(result.metafile.inputs).map(filename => path.resolve(root, filename)));
  assert.ok(!inputs.has(configSource), 'Runtime configuration must remain an external package file.');
  for (const source of sharedModules.keys()) {
    assert.ok(!inputs.has(source) || source === entry, `Shared module was bundled into ${path.relative(client, entry)}: ${path.relative(client, source)}`);
  }
  assert.ok(!inputs.has(demoSource) || entry === apiSource, 'The demo runtime must only be bundled into the shared API entry.');
}));
const nativeReport = checkNativePackage(output);
console.log(`Native package integrity passed: ${nativeReport.pages} pages, ${nativeReport.components} components, ${nativeReport.services} services, ${nativeReport.apps} app, and ${nativeReport.configurationFiles} configuration file.`);
for(const name of ['api','reminders']){
  const source=path.join(root,'cloudfunctions',name),destination=path.join(root,'dist','cloudfunctions',name);
  await mkdir(destination,{recursive:true});
  await build({entryPoints:[path.join(source,'index.ts')],outfile:path.join(destination,'index.js'),bundle:true,platform:'node',format:'cjs',target:'node18',external:['wx-server-sdk'],logLevel:'info'});
  await writeFile(path.join(destination,'package.json'),JSON.stringify({name:`bank-benefits-${name}`,version:'0.1.0',private:true,main:'index.js',dependencies:{'wx-server-sdk':'4.0.2'}},null,2)+'\n');
  await cp(path.join(source,'config.json'),path.join(destination,'config.json'));
}
