$installationDirectory = if ($env:WECHAT_DEVTOOLS_INSTALL_DIR) { $env:WECHAT_DEVTOOLS_INSTALL_DIR } else { 'C:\Program Files (x86)\Tencent\微信web开发者工具' }
$electronExecutable = Get-ChildItem -LiteralPath $installationDirectory -Filter '*.exe' | Where-Object { $_.Length -gt 50000000 } | Sort-Object Length -Descending | Select-Object -First 1
if (-not $electronExecutable) { throw 'The installed WeChat Electron executable was not found.' }
$previousElectronMode = $env:ELECTRON_RUN_AS_NODE
$previousCliSource = $env:WECHAT_OFFICIAL_CLI_SOURCE
try {
  $env:ELECTRON_RUN_AS_NODE = '1'
  $env:WECHAT_OFFICIAL_CLI_SOURCE = Join-Path $installationDirectory 'resources\app.asar.unpacked\js\common\cli\index.js'
  & $electronExecutable.FullName (Join-Path $PSScriptRoot 'wechat-cli-adapter.cjs') @args | ForEach-Object { $_ }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  $env:ELECTRON_RUN_AS_NODE = $previousElectronMode
  $env:WECHAT_OFFICIAL_CLI_SOURCE = $previousCliSource
}
