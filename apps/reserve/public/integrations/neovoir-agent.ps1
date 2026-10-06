<#
  ネオボワール → 予約カレンダー 写真の取り込み係（Windows 用）

  ネオボワールの写真が保存されるフォルダ（親機の \\NEOVOIR\NeoVoirI\Image など）を見張り、
  新しく撮った写真を予約カレンダーへ送ります。
  ネオボワールのファイル名「254_1_F_NL_氏名.jpg」（顧客番号_回_向き_光_氏名）から氏名と顧客番号を読み、
  予約カレンダーが患者に結びつけます（一度結びついた顧客番号は覚えるので、次からは同姓同名でも確実）。
  1人に決まらない写真は「設定 → 外部機器の連携 → 照合待ちの写真」に入ります。
  送るのは撮影したままの写真（1回の撮影で 向き3×光4＝12枚）だけで、加工・解析の画像（_M・_Res など）、
  控え（氏名BK）、作業用の ImageTemp は送りません。

  使い方（ネオボワールのパソコンで、このファイルを右クリック →「PowerShell で実行」でも動きます）
    1. 準備（最初の1回）   powershell -ExecutionPolicy Bypass -File neovoir-agent.ps1 -Setup
    2. 確かめる（送らない） powershell -ExecutionPolicy Bypass -File neovoir-agent.ps1 -Preview
    3. あとは5分ごとに自動で送ります（Windows の「タスク スケジューラ」に登録）
    過去の写真も送る        powershell -ExecutionPolicy Bypass -File neovoir-agent.ps1 -Backfill
    止める                  powershell -ExecutionPolicy Bypass -File neovoir-agent.ps1 -Uninstall

  どの光源（NL・PL・SL・UV）を送るか、縮小するかは、予約カレンダーの「設定 → 外部機器の連携」で選びます
  （取り込み係は起きるたびにそれを読みにいきます）。

  ・鍵はこのパソコンの、このWindowsユーザーだけが読める形で保存します（ほかの人・ほかのパソコンでは使えません）
  ・送るのは写真と、照合に使う氏名・撮影日時・ファイル名だけです。記録はこのパソコンの中にだけ残します
#>
param([switch]$Setup, [switch]$Preview, [switch]$Backfill, [switch]$Uninstall, [switch]$Once)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Dir = Join-Path $env:LOCALAPPDATA 'ReserveNeovoir'
$ConfigFile = Join-Path $Dir 'config.json'
$SentFile = Join-Path $Dir 'sent.txt'
$LogFile = Join-Path $Dir 'agent.log'
$TaskName = 'ReserveNeovoirAgent'
$MaxBytes = 10MB
$Exts = @('.jpg', '.jpeg', '.png')
$DefaultFolder = '\\NEOVOIR\NeoVoirI\Image'
# 見ないフォルダ（作業用・商品の画像）
$SkipDirs = '\\(ImageTemp|ProdImage)\\'

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

# ネオボワールのファイル名「顧客番号_回_向き_光_氏名[_解析の種類…]」を分ける。形が違えば $null
function Split-NeoVoirName($file) {
  $parts = [IO.Path]::GetFileNameWithoutExtension($file.Name) -split '_'
  if ($parts.Count -lt 5 -or $parts[0] -notmatch '^\d+$' -or $parts[1] -notmatch '^\d+$' -or $parts[2] -notmatch '^[FLR]$' -or $parts[3] -notmatch '^(NL|PL|SL|UV)$') { return $null }
  # 撮影したままの写真は「…_氏名.jpg」。後ろに _M などが付いたものは加工・解析の画像、氏名の直後の BK は控え
  $backup = $parts[4] -cmatch 'BK$'
  return @{ Ref = $parts[0]; Light = $parts[3]; Name = ($parts[4] -creplace 'BK$', '').Trim(); Original = ($parts.Count -eq 5 -and -not $backup) }
}

# 写真から、照合に使う氏名と顧客番号を取り出す
function Get-PatientInfo($file, $c) {
  if ($c.NameFrom -eq 'neovoir') {
    $nv = Split-NeoVoirName $file
    if ($nv) { return @{ Name = $nv.Name; Ref = $nv.Ref } }
    return @{ Name = ''; Ref = '' }
  }
  return @{ Name = (Get-PatientName $file $c); Ref = '' }
}

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

function Get-Photos($c, $opt) {
  $since = [datetime]::Parse($c.Since)
  Get-ChildItem -Path $c.WatchFolder -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $Exts -contains $_.Extension.ToLower() -and $_.LastWriteTime -ge $since -and $_.LastWriteTime -lt (Get-Date).AddSeconds(-60) -and $_.FullName -notmatch $SkipDirs } |
    Where-Object {
      # ネオボワールの形のときは、撮影したままの写真だけ（解析の画像は IncludeAnalysis が Yes のときだけ）
      if ($c.NameFrom -ne 'neovoir') { return $true }
      $nv = Split-NeoVoirName $_
      return ($nv -and ($nv.Original -or $c.IncludeAnalysis -eq 'Yes') -and ($opt.lights -contains $nv.Light))
    } |
    Sort-Object LastWriteTime
}

function Invoke-Api($c, [string]$path, [string]$method = 'GET', [string]$inFile = $null, [string]$contentType = $null) {
  $uri = $c.ServerUrl.TrimEnd('/') + '/api/v1/integration/photos' + $path
  $p = @{ Uri = $uri; Method = $method; Headers = @{ Authorization = 'Bearer ' + $c.Token }; UseBasicParsing = $true; TimeoutSec = 120 }
  if ($inFile) { $p.InFile = $inFile; $p.ContentType = $contentType }
  return (Invoke-WebRequest @p).Content | ConvertFrom-Json
}

# 送る前に縮小する（長い辺を maxSide に。0 なら原寸のまま）。縮小したときは一時ファイルを返す
Add-Type -AssemblyName System.Drawing
function Get-SendFile($path, [int]$maxSide) {
  if ($maxSide -le 0) { return $path }
  $img = [Drawing.Image]::FromFile($path)
  try {
    $w = $img.Width; $h = $img.Height
    $scale = [Math]::Min(1.0, $maxSide / [double][Math]::Max($w, $h))
    if ($scale -ge 1.0) { return $path }
    $nw = [int][Math]::Round($w * $scale); $nh = [int][Math]::Round($h * $scale)
    $bmp = New-Object Drawing.Bitmap $nw, $nh
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, $nw, $nh); $g.Dispose()
    $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $ep = New-Object Drawing.Imaging.EncoderParameters 1
    $ep.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), ([long]85)
    $tmp = Join-Path $env:TEMP ('nv_' + [guid]::NewGuid().ToString('N') + '.jpg')
    $bmp.Save($tmp, $codec, $ep); $bmp.Dispose()
    return $tmp
  } finally { $img.Dispose() }
}

# 予約カレンダーの設定（取り込む光源・縮小）を読む
function Get-Options($c) {
  $pong = Invoke-Api $c '/ping'
  $o = $pong.options
  if (-not $o) { $o = [pscustomobject]@{ lights = @('NL', 'SL'); maxSide = 2000 } }
  return $o
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
  $folder = Read-Host "ネオボワールの写真が保存されるフォルダ（そのまま Enter で $DefaultFolder）"
  if (-not $folder) { $folder = $DefaultFolder }
  if (-not (Test-Path $folder)) {
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')
    if ($admin) { throw "フォルダが見つかりません：$folder（「管理者として実行」した PowerShell では親機の共有フォルダが見えないことがあります。PowerShell を普通に開き直して、もう一度 -Setup を実行してください）" }
    throw "フォルダが見つかりません：$folder（親機の電源・スリープを確かめ、エクスプローラーのアドレス欄にこの場所を入れて開けるか確かめてください）"
  }
  Write-Host '氏名をどこから読みますか？  1) ネオボワールのファイル名（顧客番号_回_向き_光_氏名。既定）  2) 写真の入っているフォルダ名  3) その1つ上のフォルダ名  4) ファイル名'
  $choice = Read-Host '番号'
  $nameFrom = @{ '2' = 'folder'; '3' = 'folder2'; '4' = 'file' }[$choice]; if (-not $nameFrom) { $nameFrom = 'neovoir' }
  $days = Read-Host '何日前に撮った写真から送りますか？（0 = これから撮る分だけ。既定 0）'
  if (-not ($days -match '^\d+$')) { $days = 0 }
  $cfg = [ordered]@{
    ServerUrl = $url.Trim(); WatchFolder = $folder; NameFrom = $nameFrom; NamePattern = ''; IncludeAnalysis = 'No'
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

if ($Backfill) {
  Write-Host '過去に撮った写真も、予約カレンダーの設定（光源・縮小）のとおりに送ります。'
  Write-Host 'Airリザーブからの患者の移行が終わってから行うと、患者さんに結びつきやすくなります。'
  $d = Read-Host '何日前に撮った写真から送りますか？（そのまま Enter で全部）'
  $since = if ($d -match '^\d+$') { (Get-Date).Date.AddDays(-[int]$d) } else { [datetime]'2000-01-01' }
  $raw = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $raw.Since = $since.ToString('s')
  $raw | ConvertTo-Json | Set-Content $ConfigFile -Encoding UTF8
  $c = Load-Config
  $opt = Get-Options $c
  $n = @(Get-Photos $c $opt).Count
  Write-Host ("{0} 以降の写真（送っていない分）を、5分ごとの自動送信で順に送ります。対象：最大 {1}枚（送り済みは飛ばします）" -f $since.ToString('yyyy-MM-dd'), $n)
  exit 0
}

if ($Preview) {
  $opt = Get-Options $c
  Write-Host ("予約カレンダーの設定：光源 {0}・{1}" -f ($opt.lights -join '・'), $(if ([int]$opt.maxSide -gt 0) { "長い辺 $($opt.maxSide)px に縮小" } else { '原寸' }))
  $photos = @(Get-Photos $c $opt)
  Write-Host "送る対象の写真：$($photos.Count)枚（このパソコンに表示するだけで、送りません。患者さんの名前が出るので、この画面をチャット等に貼らないでください）"
  $photos | Select-Object -Last 20 | ForEach-Object {
    $i = Get-PatientInfo $_ $c
    Write-Host ('  氏名「' + $i.Name + '」 顧客番号「' + $i.Ref + '」  ' + $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') + '  ' + $_.Name)
  }
  $other = @(Get-ChildItem -Path $c.WatchFolder -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $Exts -notcontains $_.Extension.ToLower() } | Group-Object Extension | Sort-Object Count -Descending | Select-Object -First 5)
  if ($other.Count) { Write-Host ('写真以外のファイル（送りません）：' + (($other | ForEach-Object { "$($_.Name) $($_.Count)件" }) -join '、')) }
  exit 0
}

# ---- 送る（タスク スケジューラから5分ごと） ----
$sent = New-Object 'System.Collections.Generic.HashSet[string]'
if (Test-Path $SentFile) { Get-Content $SentFile -Encoding UTF8 | ForEach-Object { [void]$sent.Add($_) } }
$ok = 0; $inbox = 0; $dup = 0; $skip = 0; $err = 0
try { $opt = Get-Options $c } catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 401) { Write-Log '鍵が使えません（設定で止められたか、違う鍵です）。-Setup をやり直してください' } else { Write-Log ('予約カレンダーにつながりません：' + $_.Exception.Message) }
  exit 1
}
foreach ($f in Get-Photos $c $opt) {
  $key = $f.FullName + '|' + $f.Length + '|' + $f.LastWriteTime.Ticks
  if ($sent.Contains($key)) { continue }
  if ($f.Length -gt $MaxBytes -and [int]$opt.maxSide -le 0) { $skip++; Add-Content $SentFile $key -Encoding UTF8; continue }
  $info = Get-PatientInfo $f $c
  $q = '?name=' + [uri]::EscapeDataString($info.Name) + '&ref=' + [uri]::EscapeDataString($info.Ref) + '&file=' + [uri]::EscapeDataString($f.Name) + '&takenAt=' + [uri]::EscapeDataString($f.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:sszzz'))
  $type = if ($f.Extension.ToLower() -eq '.png') { 'image/png' } else { 'image/jpeg' }
  $send = $null
  try {
    $send = Get-SendFile $f.FullName ([int]$opt.maxSide)
    if ($send -ne $f.FullName) { $type = 'image/jpeg' }
    $r = Invoke-Api $c $q 'POST' $send $type
    switch ($r.status) { 'saved' { $ok++ } 'inbox' { $inbox++ } default { $dup++ } }
    Add-Content $SentFile $key -Encoding UTF8
  } catch {
    $err++
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 401) { Write-Log '鍵が使えません（設定で止められたか、違う鍵です）。-Setup をやり直してください'; break }
    if ($code -eq 400) { Add-Content $SentFile $key -Encoding UTF8 }
  } finally {
    if ($send -and $send -ne $f.FullName) { Remove-Item $send -ErrorAction SilentlyContinue }
  }
}
if ($ok + $inbox + $dup + $skip + $err -gt 0) { Write-Log "送信 患者に入った $ok / 照合待ち $inbox / 送信済み $dup / 大きすぎ $skip / 失敗 $err" }
