<#
  ネオボワール → 予約カレンダー 写真の取り込み係（Windows 用）

  ネオボワールの写真が保存されるフォルダを見張り、新しい写真を予約カレンダーへ送ります。
  患者は「フォルダ名（またはファイル名）の氏名」で照合し、1人に決まらない写真は
  予約カレンダーの「設定 → 外部機器の連携 → 照合待ちの写真」に入ります。

  使い方（ネオボワールのパソコンで、このファイルを右クリック →「PowerShell で実行」でも動きます）
    1. 準備（最初の1回）   powershell -ExecutionPolicy Bypass -File neovoir-agent.ps1 -Setup
    2. 確かめる（送らない） powershell -ExecutionPolicy Bypass -File neovoir-agent.ps1 -Preview
    3. あとは5分ごとに自動で送ります（Windows の「タスク スケジューラ」に登録）
    止める                  powershell -ExecutionPolicy Bypass -File neovoir-agent.ps1 -Uninstall

  ・鍵はこのパソコンの、このWindowsユーザーだけが読める形で保存します（ほかの人・ほかのパソコンでは使えません）
  ・送るのは写真と、照合に使う氏名・撮影日時・ファイル名だけです。記録はこのパソコンの中にだけ残します
#>
param([switch]$Setup, [switch]$Preview, [switch]$Uninstall, [switch]$Once)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Dir = Join-Path $env:LOCALAPPDATA 'ReserveNeovoir'
$ConfigFile = Join-Path $Dir 'config.json'
$SentFile = Join-Path $Dir 'sent.txt'
$LogFile = Join-Path $Dir 'agent.log'
$TaskName = 'ReserveNeovoirAgent'
$MaxBytes = 10MB
$Exts = @('.jpg', '.jpeg', '.png')

function Write-Log([string]$msg) {
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  $line = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $msg
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
  # ログが大きくなりすぎないように（1MB を超えたら古い分を捨てる）
  if ((Get-Item $LogFile).Length -gt 1MB) { Get-Content $LogFile -Tail 2000 | Set-Content $LogFile -Encoding UTF8 }
}

function Load-Config {
  if (-not (Test-Path $ConfigFile)) { throw '準備がまだです。-Setup を付けて実行してください' }
  $c = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $secure = ConvertTo-SecureString $c.TokenProtected
  $c | Add-Member -NotePropertyName Token -NotePropertyValue ([Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)))
  return $c
}

# 写真から、照合に使う氏名を取り出す
function Get-PatientName($file, $c) {
  switch ($c.NameFrom) {
    'folder2' { $src = $file.Directory.Parent.Name }
    'file' { $src = [IO.Path]::GetFileNameWithoutExtension($file.Name) }
    default { $src = $file.Directory.Name }
  }
  if ($c.NamePattern) {
    $m = [regex]::Match($src, $c.NamePattern)
    if ($m.Success -and $m.Groups['name'].Success) { return $m.Groups['name'].Value.Trim() }
    return ''
  }
  # 既定：数字・記号（ID や日付）を外した残りを氏名とみなす
  return (($src -replace '[0-9０-９_\-\.\(\)（）\[\]【】#]', ' ') -replace '\s+', ' ').Trim()
}

function Get-Photos($c) {
  $since = [datetime]::Parse($c.Since)
  Get-ChildItem -Path $c.WatchFolder -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $Exts -contains $_.Extension.ToLower() -and $_.LastWriteTime -ge $since -and $_.LastWriteTime -lt (Get-Date).AddSeconds(-60) } |
    Sort-Object LastWriteTime
}

function Invoke-Api($c, [string]$path, [string]$method = 'GET', [string]$inFile = $null, [string]$contentType = $null) {
  $uri = $c.ServerUrl.TrimEnd('/') + '/api/v1/integration/photos' + $path
  $p = @{ Uri = $uri; Method = $method; Headers = @{ Authorization = 'Bearer ' + $c.Token }; UseBasicParsing = $true; TimeoutSec = 120 }
  if ($inFile) { $p.InFile = $inFile; $p.ContentType = $contentType }
  return (Invoke-WebRequest @p).Content | ConvertFrom-Json
}

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host '自動の取り込みを止めました（設定と送った記録は残しています）'
  exit 0
}

if ($Setup) {
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  Write-Host '=== ネオボワール → 予約カレンダー 取り込み係の準備 ==='
  $url = Read-Host '予約カレンダーのアドレス（例 https://ishidahihuka.jp/reserve）'
  $token = Read-Host '接続用の鍵（設定 → 外部機器の連携 で発行したもの）' -AsSecureString
  $folder = Read-Host 'ネオボワールの写真が保存されるフォルダ（例 C:\NeoVoir\Data）'
  if (-not (Test-Path $folder)) { throw "フォルダが見つかりません：$folder" }
  Write-Host '氏名をどこから読みますか？  1) 写真の入っているフォルダ名（既定）  2) その1つ上のフォルダ名  3) ファイル名'
  $choice = Read-Host '番号'
  $nameFrom = @{ '2' = 'folder2'; '3' = 'file' }[$choice]; if (-not $nameFrom) { $nameFrom = 'folder' }
  $days = Read-Host '何日前に撮った写真から送りますか？（0 = これから撮る分だけ。既定 0）'
  if (-not ($days -match '^\d+$')) { $days = 0 }
  $cfg = [ordered]@{
    ServerUrl = $url.Trim(); WatchFolder = $folder; NameFrom = $nameFrom; NamePattern = ''
    Since = (Get-Date).Date.AddDays(-[int]$days).ToString('s'); TokenProtected = (ConvertFrom-SecureString $token)
  }
  $cfg | ConvertTo-Json | Set-Content $ConfigFile -Encoding UTF8
  $c = Load-Config
  $pong = Invoke-Api $c '/ping'
  Write-Host "接続できました：$($pong.name)"
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Once')
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Description '予約カレンダーへネオボワールの写真を送る' -Force | Out-Null
  Write-Host '5分ごとに自動で送るよう登録しました。まず -Preview で、読み取る氏名が正しいか確かめてください'
  exit 0
}

$c = Load-Config

if ($Preview) {
  $photos = @(Get-Photos $c)
  Write-Host "見つかった写真：$($photos.Count)枚（このパソコンに表示するだけで、送りません）"
  $photos | Select-Object -Last 20 | ForEach-Object {
    $n = Get-PatientName $_ $c
    Write-Host ('  氏名「' + $n + '」  ' + $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') + '  ' + $_.FullName)
  }
  $other = @(Get-ChildItem -Path $c.WatchFolder -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $Exts -notcontains $_.Extension.ToLower() } | Group-Object Extension | Sort-Object Count -Descending | Select-Object -First 5)
  if ($other.Count) { Write-Host ('写真以外のファイル（送りません）：' + (($other | ForEach-Object { "$($_.Name) $($_.Count)件" }) -join '、')) }
  exit 0
}

# ---- 送る（タスク スケジューラから5分ごと） ----
$sent = New-Object 'System.Collections.Generic.HashSet[string]'
if (Test-Path $SentFile) { Get-Content $SentFile -Encoding UTF8 | ForEach-Object { [void]$sent.Add($_) } }
$ok = 0; $inbox = 0; $dup = 0; $skip = 0; $err = 0
foreach ($f in Get-Photos $c) {
  $key = $f.FullName + '|' + $f.Length + '|' + $f.LastWriteTime.Ticks
  if ($sent.Contains($key)) { continue }
  if ($f.Length -gt $MaxBytes) { $skip++; Add-Content $SentFile $key -Encoding UTF8; continue }
  $name = Get-PatientName $f $c
  $q = '?name=' + [uri]::EscapeDataString($name) + '&file=' + [uri]::EscapeDataString($f.Name) + '&takenAt=' + [uri]::EscapeDataString($f.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:sszzz'))
  $type = if ($f.Extension.ToLower() -eq '.png') { 'image/png' } else { 'image/jpeg' }
  try {
    $r = Invoke-Api $c $q 'POST' $f.FullName $type
    switch ($r.status) { 'saved' { $ok++ } 'inbox' { $inbox++ } default { $dup++ } }
    Add-Content $SentFile $key -Encoding UTF8
  } catch {
    $err++
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 401) { Write-Log '鍵が使えません（設定で止められたか、違う鍵です）。-Setup をやり直してください'; break }
    if ($code -eq 400) { Add-Content $SentFile $key -Encoding UTF8 }
  }
}
if ($ok + $inbox + $dup + $skip + $err -gt 0) { Write-Log "送信 患者に入った $ok / 照合待ち $inbox / 送信済み $dup / 大きすぎ $skip / 失敗 $err" }
