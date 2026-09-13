param(
  [string]$WakeWords = '你好大肥鱼|大肥鱼|你好大飞鱼',
  [string]$Language = 'zh-CN',
  [double]$Sensitivity = 0.55,
  [string]$InitialMode = 'wake'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech

function Write-Json($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 6
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

try {
  $culture = New-Object System.Globalization.CultureInfo($Language)
  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  $found = $null
  foreach ($r in $installed) {
    if ($r.Culture.Name -eq $Language) { $found = $r; break }
  }
  if (-not $found) {
    $names = @($installed | ForEach-Object { $_.Culture.Name + ':' + $_.Description }) -join '; '
    Write-Json @{ type = 'error'; message = "Windows 未安装 $Language 语音识别包。已安装: $names" }
    exit 2
  }

  $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
  $rec.SetInputToDefaultAudioDevice()

  $choices = New-Object System.Speech.Recognition.Choices
  foreach ($w in $WakeWords.Split('|')) {
    $w = $w.Trim()
    if ($w) { [void]$choices.Add($w) }
  }
  $builder = New-Object System.Speech.Recognition.GrammarBuilder
  $builder.Culture = $culture
  $builder.Append($choices)
  $wakeGrammar = New-Object System.Speech.Recognition.Grammar($builder)
  $commandGrammar = New-Object System.Speech.Recognition.DictationGrammar

  $script:state = if ($InitialMode -eq 'command') { 'command' } else { 'wake' }
  $script:commandTimer = New-Object System.Timers.Timer
  $script:commandTimer.Interval = 8000
  $script:commandTimer.AutoReset = $false

  function Reset-ToWake {
    try {
      $script:state = 'wake'
      $script:commandTimer.Stop()
      $rec.UnloadAllGrammars()
      $rec.LoadGrammar($wakeGrammar)
      Write-Json @{ type = 'status'; state = 'wake' }
    } catch { }
  }

  $script:commandTimer.add_Elapsed({ Reset-ToWake })

  $rec.add_SpeechRecognized({
    param($sender, $e)
    try {
      $text = [string]$e.Result.Text
      if (-not $text) { return }
      $text = $text.Trim()
      if ($script:state -eq 'wake') {
        if ($e.Result.Confidence -ge $Sensitivity) {
          Write-Json @{ type = 'wake'; text = $text; confidence = $e.Result.Confidence }
          $script:state = 'command'
          $sender.UnloadAllGrammars()
          $sender.LoadGrammar($commandGrammar)
          $script:commandTimer.Stop()
          $script:commandTimer.Start()
          Write-Json @{ type = 'status'; state = 'command' }
        }
      } else {
        $script:commandTimer.Stop()
        Write-Json @{ type = 'command'; text = $text; confidence = $e.Result.Confidence }
        Reset-ToWake
      }
    } catch {
      Write-Json @{ type = 'error'; message = $_.Exception.Message }
    }
  })

  $rec.add_RecognizeCompleted({
    param($sender, $e)
    if ($e.Error) { Write-Json @{ type = 'error'; message = $e.Error.Message } }
  })

  if ($script:state -eq 'command') { $rec.LoadGrammar($commandGrammar); $script:commandTimer.Start() }
  else { $rec.LoadGrammar($wakeGrammar) }
  $rec.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  Write-Json @{ type = 'status'; state = $script:state; language = $Language; wakeWords = $WakeWords }

  while ($true) { Start-Sleep -Milliseconds 250 }
} catch {
  Write-Json @{ type = 'error'; message = $_.Exception.Message }
  exit 1
}
