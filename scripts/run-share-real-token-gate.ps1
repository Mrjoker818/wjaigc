param([switch]$FullRegression)

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$temporaryBase = (Resolve-Path -LiteralPath 'J:\无界本地版\projects\_tmp_e2e').Path
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$runId = 'sharegate_' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$root = Join-Path $temporaryBase "share-gate-$runId"
$pgData = Join-Path $root 'pgdata'
$pgLog = Join-Path $root 'postgres.log'
$appOut = Join-Path $root 'app.out.log'
$appErr = Join-Path $root 'app.err.log'
$migrationLog = Join-Path $root 'migrate.log'
$coreSchemaLog = Join-Path $root 'core-schema.log'
$seedLog = Join-Path $root 'seed.log'
$buildLog = Join-Path $root 'build.log'
$testLog = Join-Path $root 'test.log'
$regressionLog = Join-Path $root 'regression.log'
$fixtureEnvironmentPath = Join-Path $root 'fixture-environment.json'
$appPort = 55474
$pgPort = 55475
$databaseName = "wujie_share_gate_$runId"
$databaseURL = "postgresql://postgres@127.0.0.1:$pgPort/$databaseName`?sslmode=disable"
$appProcess = $null
$testExit = 99
$pgStarted = $false
$environmentNames = @(
  'DATABASE_URL', 'PGDATABASE_URL', 'POSTGRES_TEST_DATABASE_URL', 'TEST_POSTGRES_URL',
  'E2E_SHARE_REAL_TOKEN_DATABASE_URL', 'E2E_SHARE_REAL_TOKEN_LOCAL_GATE',
  'E2E_STAGE2_DATABASE_URL', 'E2E_STAGE2_RUN_ID', 'E2E_STAGE2_DATABASE_GUARD',
  'E2E_STAGE2_ALLOW_SEED', 'E2E_STAGE2_ENV_OUTPUT', 'E2E_BASE_URL',
  'COZE_PROJECT_DOMAIN_DEFAULT', 'WUJIE_DATA_DIR', 'E2E_STAGE2_UPLOAD_FIXTURE',
  'E2E_TEST_USERNAME', 'E2E_TEST_PASSWORD', 'E2E_STAGE2_LIFECYCLE_PROJECT_IDS',
  'E2E_STAGE2_LIFECYCLE_PLACEMENT_IDS', 'E2E_STAGE2_LIFECYCLE_ASSET_IDS',
  'WUJIE_AUTH_SECRET', 'WUJIE_ADMIN_PASSWORD', 'INTERNAL_API_SECRET',
  'WUJIE_CANVAS_SHARE_ENABLED', 'WUJIE_ASSET_GRAPH_MODE', 'PLAYWRIGHT_WORKERS',
  'LOCAL_AI_ENABLED', 'RUN_POSTGRES_INTEGRATION'
)
$originalEnvironment = @{}
foreach ($name in $environmentNames) {
  $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Protect-ShareGateDiagnostic([string]$line) {
  $redacted = $line -replace '(/shared/canvas/)[A-Za-z0-9_-]{43,128}', '$1[REDACTED]'
  $redacted = $redacted -replace '(/api/public/canvas-shares/)[A-Za-z0-9_-]{43,128}', '$1[REDACTED]'
  $redacted = $redacted -replace '(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43,128}(?![A-Za-z0-9_-])', '[REDACTED_LONG_VALUE]'
  $redacted = $redacted -replace 'LocalShareGate[^\s]*', '[REDACTED_SECRET]'
  return ($redacted -replace 'local-share-gate-[A-Za-z0-9_-]+', '[REDACTED_SECRET]')
}

if (Test-Path -LiteralPath $root) { throw 'Unique temporary directory already exists' }
foreach ($port in @($appPort, $pgPort)) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "Required isolated port $port is already listening"
  }
}
New-Item -ItemType Directory -Path $root | Out-Null

try {
  & (Join-Path $pgBin 'initdb.exe') -D $pgData -A trust -U postgres --no-locale --encoding=UTF8 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "initdb failed with exit $LASTEXITCODE" }
  $pgStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $pgStartInfo.FileName = Join-Path $pgBin 'pg_ctl.exe'
  $pgStartInfo.UseShellExecute = $false
  $pgStartInfo.CreateNoWindow = $true
  foreach ($argument in @('start', '-D', $pgData, '-l', $pgLog, '-o', "-p $pgPort -h 127.0.0.1")) {
    [void]$pgStartInfo.ArgumentList.Add($argument)
  }
  $pgStartProcess = [System.Diagnostics.Process]::Start($pgStartInfo)
  $pgStartProcess.WaitForExit()
  $pgStartExit = $pgStartProcess.ExitCode
  $pgStartProcess.Dispose()
  if ($pgStartExit -ne 0) { throw "pg_ctl start failed with exit $pgStartExit" }
  $pgStarted = $true
  & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p $pgPort -U postgres $databaseName
  if ($LASTEXITCODE -ne 0) { throw "createdb failed with exit $LASTEXITCODE" }

  $env:DATABASE_URL = $databaseURL
  $env:PGDATABASE_URL = $databaseURL
  $env:POSTGRES_TEST_DATABASE_URL = $databaseURL
  $env:TEST_POSTGRES_URL = $databaseURL
  $env:E2E_SHARE_REAL_TOKEN_DATABASE_URL = $databaseURL
  $env:E2E_SHARE_REAL_TOKEN_LOCAL_GATE = '1'
  $env:E2E_STAGE2_DATABASE_URL = $databaseURL
  $env:E2E_STAGE2_RUN_ID = $runId
  $env:E2E_STAGE2_DATABASE_GUARD = "guard-$runId"
  $env:E2E_STAGE2_ALLOW_SEED = '1'
  $env:E2E_STAGE2_ENV_OUTPUT = $fixtureEnvironmentPath
  $env:E2E_BASE_URL = "http://127.0.0.1:$appPort"
  $env:COZE_PROJECT_DOMAIN_DEFAULT = $env:E2E_BASE_URL
  $env:WUJIE_DATA_DIR = Join-Path $root 'data'
  $env:E2E_STAGE2_UPLOAD_FIXTURE = Join-Path $root 'upload.png'
  $env:E2E_TEST_USERNAME = 'share_gate_owner'
  $env:E2E_TEST_PASSWORD = 'LocalShareGate!' + [guid]::NewGuid().ToString('N')
  $env:WUJIE_AUTH_SECRET = 'local-share-gate-' + [guid]::NewGuid().ToString('N')
  $env:WUJIE_ADMIN_PASSWORD = 'LocalShareGateAdmin!' + [guid]::NewGuid().ToString('N')
  $env:INTERNAL_API_SECRET = 'local-share-gate-internal-' + [guid]::NewGuid().ToString('N')
  $env:WUJIE_CANVAS_SHARE_ENABLED = 'true'
  $env:WUJIE_ASSET_GRAPH_MODE = 'shadow'
  $env:PLAYWRIGHT_WORKERS = '1'
  $env:LOCAL_AI_ENABLED = 'false'

  Push-Location $repo
  try {
    & pnpm migrate *> $migrationLog
    if ($LASTEXITCODE -ne 0) { throw "Local migration failed with exit $LASTEXITCODE" }
    & pnpm exec tsx -e "import { ensureCoreTables } from './src/lib/db-storage'; ensureCoreTables().then(() => process.exit(0), error => { console.error(error); process.exit(1); });" *> $coreSchemaLog
    if ($LASTEXITCODE -ne 0) {
      Get-Content -LiteralPath $coreSchemaLog | Select-Object -Last 20 | ForEach-Object { Write-Output $_ }
      throw "Runtime core schema setup failed with exit $LASTEXITCODE"
    }
    $guardSql = "CREATE TABLE wujie_stage2_e2e_guard(guard_token text PRIMARY KEY); INSERT INTO wujie_stage2_e2e_guard VALUES ('$($env:E2E_STAGE2_DATABASE_GUARD)');"
    & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $pgPort -U postgres -d $databaseName -v ON_ERROR_STOP=1 -c $guardSql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Fixture guard failed with exit $LASTEXITCODE" }
    & node scripts/stage-2-e2e-fixtures.mjs *> $seedLog
    if ($LASTEXITCODE -ne 0) {
      Get-Content -LiteralPath $seedLog | Select-Object -Last 20 | ForEach-Object { Write-Output $_ }
      throw "Fixture seed failed with exit $LASTEXITCODE"
    }

    $fixtureEnvironment = Get-Content -LiteralPath $fixtureEnvironmentPath -Raw | ConvertFrom-Json
    $env:E2E_TEST_USERNAME = [string]$fixtureEnvironment.E2E_TEST_USERNAME
    $env:E2E_STAGE2_LIFECYCLE_PROJECT_IDS = [string]$fixtureEnvironment.E2E_STAGE2_LIFECYCLE_PROJECT_IDS
    $env:E2E_STAGE2_LIFECYCLE_PLACEMENT_IDS = [string]$fixtureEnvironment.E2E_STAGE2_LIFECYCLE_PLACEMENT_IDS
    $env:E2E_STAGE2_LIFECYCLE_ASSET_IDS = [string]$fixtureEnvironment.E2E_STAGE2_LIFECYCLE_ASSET_IDS

    & pnpm build *> $buildLog
    if ($LASTEXITCODE -ne 0) {
      Get-Content -LiteralPath $buildLog -Tail 30 | ForEach-Object { Write-Output (Protect-ShareGateDiagnostic ([string]$_)) }
      throw "Production build failed with exit $LASTEXITCODE"
    }

    $pnpmCommand = (Get-Command pnpm.cmd).Source
    $appProcess = Start-Process -FilePath $pnpmCommand -ArgumentList @('exec', 'next', 'start', '-p', [string]$appPort, '-H', '127.0.0.1') -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $appOut -RedirectStandardError $appErr -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 90; $attempt += 1) {
      try {
        if ((Invoke-WebRequest -UseBasicParsing -Uri "$($env:E2E_BASE_URL)/" -TimeoutSec 2).StatusCode -eq 200) {
          $ready = $true
          break
        }
      } catch {}
      Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Isolated app did not become ready' }

    & pnpm exec playwright test tests/e2e/read-only-canvas-share-real-token.spec.ts --project=chromium --reporter=line --output (Join-Path $root 'playwright-output') *> $testLog
    $testExit = $LASTEXITCODE
    Write-Output "SHARE_GATE_TEST_EXIT=$testExit"
    if ($testExit -ne 0) {
      $lines = Get-Content -LiteralPath $testLog | Select-Object -Last 90
    } else {
      $lines = Get-Content -LiteralPath $testLog | Select-String -Pattern 'passed|failed|skipped' | Select-Object -Last 15 | ForEach-Object { $_.Line }
    }
    $diagnostics = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $lines) {
      $redacted = Protect-ShareGateDiagnostic ([string]$line)
      Write-Output $redacted
      [void]$diagnostics.Add($redacted)
    }
    if ($testExit -ne 0) {
      foreach ($logPath in @($appErr, $appOut)) {
        $heading = "SHARE_GATE_APP_DIAGNOSTIC=$(Split-Path -Leaf $logPath)"
        Write-Output $heading
        [void]$diagnostics.Add($heading)
        Get-Content -LiteralPath $logPath -Tail 120 | Select-String -Pattern 'Error|ENOENT|EACCES| 500 |unavailable|failed|Failed|Cannot' | ForEach-Object {
          $redacted = Protect-ShareGateDiagnostic ([string]$_.Line)
          Write-Output $redacted
          [void]$diagnostics.Add($redacted)
        }
      }
      $reportDirectory = Join-Path $temporaryBase 'share-gate-failure-reports'
      New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
      $reportPath = Join-Path $reportDirectory "$runId.txt"
      Set-Content -LiteralPath $reportPath -Value $diagnostics -Encoding utf8
      Write-Output "SHARE_GATE_REDACTED_FAILURE_REPORT=$reportPath"
    }
    if ($FullRegression -and $testExit -eq 0) {
      [Environment]::SetEnvironmentVariable('E2E_TEST_USERNAME', $null, 'Process')
      [Environment]::SetEnvironmentVariable('E2E_TEST_PASSWORD', $null, 'Process')
      $env:RUN_POSTGRES_INTEGRATION = '1'
      Write-Output 'SHARE_GATE_FULL_REGRESSION_STARTED=true'
      & pnpm exec vitest run --reporter=dot *> $regressionLog
      $testExit = $LASTEXITCODE
      Write-Output "SHARE_GATE_FULL_REGRESSION_EXIT=$testExit"
      $regressionLines = Get-Content -LiteralPath $regressionLog | Select-Object -Last 35
      $regressionLines | ForEach-Object { Write-Output $_ }
    }
  } finally {
    Pop-Location
  }
} finally {
  try {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $appPort -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $appOwner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($appOwner -and $appOwner.CommandLine.Contains($repo) -and $appOwner.CommandLine.Contains('next')) {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
  if ($appProcess -and -not $appProcess.HasExited) {
    Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if ($pgStarted -and (Test-Path -LiteralPath $pgData)) {
    & (Join-Path $pgBin 'pg_ctl.exe') stop -D $pgData -m fast | Out-Null
  }
  $appStopped = -not [bool](Get-NetTCPConnection -State Listen -LocalPort $appPort -ErrorAction SilentlyContinue)
  $pgStopped = -not [bool](Get-NetTCPConnection -State Listen -LocalPort $pgPort -ErrorAction SilentlyContinue)
  Write-Output "SHARE_GATE_APP_STOPPED=$appStopped"
  Write-Output "SHARE_GATE_POSTGRES_STOPPED=$pgStopped"
  $resolvedBase = [System.IO.Path]::GetFullPath($temporaryBase).TrimEnd('\') + '\'
  $resolvedRoot = [System.IO.Path]::GetFullPath($root)
  if ($appStopped -and $pgStopped -and $resolvedRoot.StartsWith($resolvedBase, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedRoot).StartsWith('share-gate-sharegate_')) {
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
    Write-Output 'SHARE_GATE_TEMP_REMOVED=true'
  } else {
    Write-Output 'SHARE_GATE_TEMP_REMOVED=false'
  }
  } finally {
    foreach ($name in $environmentNames) {
      [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
    }
  }
}

exit $testExit
