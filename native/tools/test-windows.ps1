$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsRoot) { throw 'Visual Studio C++ build tools are required.' }
Import-Module (Join-Path $vsRoot 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64'
$swiftRoot = Join-Path $env:LOCALAPPDATA 'Programs\Swift'
$toolchain = Get-ChildItem (Join-Path $swiftRoot 'Toolchains') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$platform = Get-ChildItem (Join-Path $swiftRoot 'Platforms') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$runtime = Get-ChildItem (Join-Path $swiftRoot 'Runtimes') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$env:Path = "$($toolchain.FullName)\usr\bin;$($runtime.FullName)\usr\bin;$env:Path"
$env:SDKROOT = Join-Path $platform.FullName 'Windows.platform\Developer\SDKs\Windows.sdk'
Set-Location $projectRoot
swift --version
swift test 2>&1 | Tee-Object -FilePath (Join-Path $projectRoot 'docs\windows-test-results.txt')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
