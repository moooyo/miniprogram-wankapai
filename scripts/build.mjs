import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  }else await cp(file,target);
}
const singletonPlugin={name:'shared-mini-program-services',setup(builder){
  builder.onResolve({filter:/(?:services\/(?:api|privacy)|runtime-config)$/},args=>{
    if(args.kind==='entry-point')return null;
    return {path:args.path,external:true};
  });
}};
await build({entryPoints:entries,outdir:output,outbase:client,bundle:true,platform:'neutral',format:'cjs',target:'es2018',sourcemap:false,plugins:[singletonPlugin],logLevel:'info'});
for(const name of ['api','reminders']){
  const source=path.join(root,'cloudfunctions',name),destination=path.join(root,'dist','cloudfunctions',name);
  await mkdir(destination,{recursive:true});
  await build({entryPoints:[path.join(source,'index.ts')],outfile:path.join(destination,'index.js'),bundle:true,platform:'node',format:'cjs',target:'node18',external:['wx-server-sdk'],logLevel:'info'});
  await writeFile(path.join(destination,'package.json'),JSON.stringify({name:`bank-benefits-${name}`,version:'0.1.0',private:true,main:'index.js',dependencies:{'wx-server-sdk':'4.0.2'}},null,2)+'\n');
  await cp(path.join(source,'config.json'),path.join(destination,'config.json'));
}
