# 共享记忆 · 一键部署到 Cloudflare（Windows PowerShell）
# 用法：在项目文件夹里右键"在终端中打开"，运行：
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# 可以重复运行：已经建好的东西会自动跳过。

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location (Join-Path $PSScriptRoot "..")
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Base = "https://memory-new.catmin.io"

function Step($t) { Write-Host "`n== $t ==" -ForegroundColor Yellow }
# 参数一律用 @('a','b') 数组传入：PowerShell 5 会把直接写的 --json 之类当成自己的参数而改写掉。
# 同时局部改成 Continue：PowerShell 5 在 Stop 模式下会把 wrangler 的 stderr 警告当成错误。
function Wr([string[]]$A) {
  Write-Host ("> wrangler " + ($A -join " ")) -ForegroundColor DarkGray
  $ErrorActionPreference = "Continue"; & npx --yes wrangler $A
  if ($LASTEXITCODE -ne 0) { throw ("wrangler " + ($A -join " ") + " 失败") }
}
function WrRaw([string[]]$A) {
  Write-Host ("> wrangler " + ($A -join " ")) -ForegroundColor DarkGray
  $ErrorActionPreference = "Continue"; $o = & npx --yes wrangler $A 2>&1 | Out-String
  return @{ Out = $o; Code = $LASTEXITCODE }
}
function WrOut([string[]]$A) { $r = WrRaw $A; if ($r.Code -ne 0) { Write-Host $r.Out; throw ("wrangler " + ($A -join " ") + " 失败") }; return $r.Out }
function JsonArray($text) { $m = [regex]::Match($text, '(?s)\[\s*(\{.*\}\s*)?\]'); if (-not $m.Success) { return @() }; return ($m.Value | ConvertFrom-Json) }
function RandomToken($n) {
  $b = New-Object byte[] $n; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return ([BitConverter]::ToString($b) -replace "-", "").ToLower()
}

Step "1/8 安装依赖"
$ErrorActionPreference = "Continue"; npm install; $code = $LASTEXITCODE; $ErrorActionPreference = "Stop"
if ($code -ne 0) { throw "npm install 失败" }

Step "2/8 登录 Cloudflare（会打开浏览器，点 Allow）"
$who = (WrRaw @("whoami")).Out
if ($who -notmatch "You are logged in") { Wr @("login") } else { Write-Host "已登录" }

$cfg = [IO.File]::ReadAllText("wrangler.jsonc", $Utf8)

Step "3/8 数据库 D1（catmin-study）"
if ($cfg -match "REPLACE_WITH_D1_ID") {
  $find = { JsonArray (WrOut @("d1", "list", "--json")) | Where-Object { $_.name -eq "catmin-study" } | Select-Object -First 1 }
  $db = & $find
  if (-not $db) { $o = WrOut @("d1", "create", "catmin-study"); Write-Host $o; $db = & $find }
  $d1id = $db.uuid
  if (-not $d1id) { throw "没拿到 D1 的 ID" }
  $cfg = $cfg.Replace("REPLACE_WITH_D1_ID", $d1id)
  [IO.File]::WriteAllText("wrangler.jsonc", $cfg, $Utf8)
  Write-Host "D1: $d1id"
} else { Write-Host "已配置，跳过" }

Step "4/8 KV（存放授权令牌）"
if ($cfg -match "REPLACE_WITH_KV_ID") {
  $find = { JsonArray (WrOut @("kv", "namespace", "list")) | Where-Object { $_.title -match "OAUTH_KV" } | Select-Object -First 1 }
  $kv = & $find
  if (-not $kv) { $o = WrOut @("kv", "namespace", "create", "OAUTH_KV"); Write-Host $o; $kv = & $find }
  $kvid = $kv.id
  if (-not $kvid) { throw "没拿到 KV 的 ID" }
  $cfg = $cfg.Replace("REPLACE_WITH_KV_ID", $kvid)
  [IO.File]::WriteAllText("wrangler.jsonc", $cfg, $Utf8)
  Write-Host "KV: $kvid"
} else { Write-Host "已配置，跳过" }

Step "5/8 向量索引 Vectorize（1024 维，bge-m3 多语言）"
$vo = WrRaw @("vectorize", "create", "catmin-memory-bge-m3", "--dimensions=1024", "--metric=cosine")
if ($vo.Code -ne 0 -and $vo.Out -notmatch "already exists|duplicate") { Write-Host $vo.Out; throw "Vectorize 创建失败" }
Write-Host "OK"

Step "6/8 建表"
Wr @("d1", "migrations", "apply", "catmin-study", "--remote")

Step "7/8 部署 Worker 到 $Base"
Wr @("deploy")

# 机密：口令你自己定；管理口令自动生成并存在 .admin-token（不会上传）
if (-not (Test-Path ".admin-token")) {
  $pw1 = Read-Host "设置授权口令（连接 Claude/ChatGPT 时输入，至少 8 位）" -AsSecureString
  $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw1))
  if ($pw.Length -lt 8) { throw "口令太短" }
  $admin = RandomToken 24
  $tmp = Join-Path $env:TEMP ("catmin-secrets-" + [guid]::NewGuid() + ".json")
  [IO.File]::WriteAllText($tmp, (@{ OWNER_PASSWORD = $pw; ADMIN_TOKEN = $admin } | ConvertTo-Json), $Utf8)
  try { Wr @("secret", "bulk", $tmp) } finally { Remove-Item $tmp -Force }
  [IO.File]::WriteAllText(".admin-token", $admin, $Utf8)
  Write-Host "已设置口令；管理口令保存在 .admin-token"
}
$admin = [IO.File]::ReadAllText(".admin-token", $Utf8).Trim()
$H = @{ Authorization = "Bearer $admin" }

Step "8/8 导入现有记忆并生成向量"
# 新域名第一次用可能要等一会儿 DNS 和证书
for ($i = 1; $i -le 30; $i++) {
  try { Invoke-WebRequest "$Base/" -UseBasicParsing -TimeoutSec 10 | Out-Null; break }
  catch { Write-Host "等待域名生效…($i/30)"; Start-Sleep 10 }
}
$body = [IO.File]::ReadAllBytes((Resolve-Path "migration\export_default.json"))
$r = Invoke-RestMethod -Method Post -Uri "$Base/admin/import" -Headers $H -ContentType "application/json; charset=utf-8" -Body $body
Write-Host ("导入：新增 {0}，跳过 {1}" -f $r.added, $r.skipped)
do {
  $r = Invoke-RestMethod -Method Post -Uri "$Base/admin/reindex" -Headers $H
  Write-Host ("向量：本次 {0}，剩余 {1}" -f $r.embedded, $r.remaining)
} while ($r.remaining -gt 0 -and $r.embedded -gt 0)

Write-Host "`n完成。测试地址：$Base/mcp" -ForegroundColor Green
Write-Host "下一步：回到 Claude 对话，告诉 Claude「部署好了」。"
