const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const net = require('node:net');

// Keep the official CLI intact and choose an available callback port for this process.
(async () => {
  const cliFile = process.env.WECHAT_OFFICIAL_CLI_SOURCE;
  if (!cliFile) throw new Error('The official WeChat CLI source path is required.');
  const source = fs.readFileSync(cliFile, 'utf8');
  if (!source.includes('let D=3799;')) throw new Error('The official CLI callback declaration changed; review the adapter before use.');
  const server = net.createServer();
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  const callbackPort = server.address().port;
  await new Promise(resolve => server.close(resolve));
  if (!process.env.cwd) process.env.cwd = process.cwd();
  process.argv = [process.execPath,'--ms-enable-electron-run-as-node',cliFile,'--electron',...process.argv.slice(2)];
  const entry = new Module(cliFile,module);
  entry.filename = cliFile;
  entry.paths = Module._nodeModulePaths(path.dirname(cliFile));
  entry._compile(source.replace('let D=3799;',`let D=${callbackPort};`),cliFile);
})().catch(error => { console.error(error.message); process.exitCode=1; });
