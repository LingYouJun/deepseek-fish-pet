# build-winserve.ps1 -- rebuild app/vendor/winserve/winserve.exe from WinServe.cs
# The bundled exe is committed (same as input.exe); rebuild only when WinServe.cs changes.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'csc.exe not found (.NET Framework 4 required)' }
$src = Join-Path $root 'vendor\winserve\WinServe.cs'
$out = Join-Path $root 'vendor\winserve\winserve.exe'
& $csc /nologo /out:$out $src
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
Write-Host ('built ' + $out + '  ' + [math]::Round((Get-Item $out).Length / 1KB, 1) + ' KB')
# quick smoke: list once
$line = '{"ok":true}'
try {
  $p = Start-Process -FilePath $out -RedirectStandardInput ([System.IO.Path]::GetTempFileName()) -RedirectStandardOutput ([System.IO.Path]::GetTempFileName()) -NoNewWindow -PassThru
  $p | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue
} catch {}
Write-Host 'done'
