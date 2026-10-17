@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "$BatPath='%~f0'; iex ((Get-Content -LiteralPath $BatPath -Encoding UTF8 | Select-Object -Skip 3) -join [Environment]::NewLine)"
exit /b %errorlevel%
# DeepSeek Harness 便携版 — Windows x64
# 挂载 U 盘上的只读程序镜像，DSH_HOME 指向 U 盘的 home\，运行官方的 dsh web。
# 备用方案：电脑不允许挂载 ISO 时，用系统自带的 tar 把镜像解压到 U 盘上的 dsh-win-x64\（只做一次）。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Root = Split-Path -Parent $BatPath
$Iso = Join-Path $Root 'dsh-win-x64.iso'
$Folder = Join-Path $Root 'dsh-win-x64'

function Fail($message) {
  Write-Host "`n启动失败：$message" -ForegroundColor Red
  Read-Host '按回车关闭'
  exit 1
}

if (-not [Environment]::Is64BitOperatingSystem) { Fail '只支持 64 位 Windows。' }
if (-not (Test-Path -LiteralPath $Iso)) { Fail "找不到 $Iso" }

$App = $null
$MountedHere = $false
try {
  $image = Get-DiskImage -ImagePath $Iso
  if (-not $image.Attached) {
    $image = Mount-DiskImage -ImagePath $Iso -StorageType ISO -Access ReadOnly -PassThru
    $MountedHere = $true
  }
  $letter = ($image | Get-Volume).DriveLetter
  if ($letter) { $App = "${letter}:\" }
} catch {
  Write-Host "无法挂载镜像（$($_.Exception.Message)），改用备用方案。" -ForegroundColor Yellow
}

if (-not $App) {
  $stamp = Join-Path $Folder '.complete'
  $isoInfo = Get-Item -LiteralPath $Iso
  $expected = "$($isoInfo.Length) $($isoInfo.LastWriteTimeUtc.Ticks)"
  if (-not ((Test-Path -LiteralPath $stamp) -and ((Get-Content -LiteralPath $stamp -Raw).Trim() -eq $expected))) {
    Write-Host '第一次在不能挂载镜像的电脑上运行，正在把程序解压到 U 盘（只做一次，需要几分钟）…'
    $tmp = "$Folder.partial"
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
    if (Test-Path -LiteralPath $Folder) { Remove-Item -LiteralPath $Folder -Recurse -Force }
    New-Item -ItemType Directory -Path $tmp | Out-Null
    & "$env:SystemRoot\System32\tar.exe" -xf $Iso -C $tmp
    if ($LASTEXITCODE -ne 0) { Fail '解压镜像失败。' }
    Set-Content -LiteralPath (Join-Path $tmp '.complete') -Value $expected
    Rename-Item -LiteralPath $tmp -NewName (Split-Path -Leaf $Folder)
  }
  $App = $Folder
}

$env:DSH_HOME = Join-Path $Root 'home'
$env:DSH_PRIMARY_RUNTIME = Join-Path $App 'runtime\primary-runtime'
# 这台电脑的标识：用户名-MachineGuid 前 8 位，工作区登记表按它分开存
$guid = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography').MachineGuid
$env:DSH_MACHINE = "$env:USERNAME-$($guid.Substring(0, 8))"
New-Item -ItemType Directory -Force -Path $env:DSH_HOME | Out-Null

$node = Join-Path $env:DSH_PRIMARY_RUNTIME 'dependencies\node\bin\node.exe'
# exfat-link.mjs：exFAT 不支持硬链接，链接失败时改为不覆盖的复制
$shim = ([Uri](Join-Path $App 'exfat-link.mjs')).AbsoluteUri
$cli = Join-Path $App 'dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'
Set-Location -LiteralPath $env:USERPROFILE
Write-Host '正在启动 DeepSeek Harness，在这台电脑上第一次运行可能要等一分钟左右，好了浏览器会自动打开……' -ForegroundColor Yellow
try {
  # dsh 输出原样显示，碰到网址时额外用醒目的框再打印一遍
  & $node --expose-internals --import $shim $cli web --patch (Join-Path $App 'python.patch.yml') --patch (Join-Path $App 'per-machine.patch.yml') | ForEach-Object {
    Write-Host $_
    if ($_ -match 'http://\S+') {
      $line = '=' * 56
      Write-Host "`n$line" -ForegroundColor Green
      Write-Host ' DeepSeek Harness 已启动。浏览器关了的话，用这个地址重新打开：'
      Write-Host "`n   $($Matches[0])`n" -ForegroundColor Cyan
      Write-Host ' （复制到浏览器地址栏打开）  用完关掉这个窗口即可退出。'
      Write-Host "$line`n" -ForegroundColor Green
    }
  }
} finally {
  if ($MountedHere) { Dismount-DiskImage -ImagePath $Iso | Out-Null }
}
