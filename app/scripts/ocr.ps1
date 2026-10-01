param([Parameter(Mandatory = $true)][string]$Path)
# Windows 自带 OCR（WinRT OcrEngine），离线，支持系统里已安装的语言（中/英）。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File ocr.ps1 -Path <图片路径>
#
# ⚠️ 必须先把输出编码钉成 UTF-8：
#   powershell.exe（5.1）把 stdout 重定向到管道时用的是**控制台代码页**，
#   中文系统上是 GBK/936。而 Node 那边是按 UTF-8 解码的 ——
#   于是识别出来的中文全变成 "��" 这种乱码（实测中文屏幕上整段都是乱码，
#   "读屏幕"对中文界面等于失效）。设置 OutputEncoding 后写出的就是 UTF-8 字节，
#   两边才对得上。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]

    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

    function Await($op, $type) {
        $m = $asTaskGeneric.MakeGenericMethod($type)
        $task = $m.Invoke($null, @($op))
        $task.Wait(-1) | Out-Null
        $task.Result
    }

    $file    = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
    $stream  = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap  = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $engine) { throw 'OCR engine unavailable (no language pack installed)' }

    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    Write-Output $result.Text
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
