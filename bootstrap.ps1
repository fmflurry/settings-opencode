#Requires -Version 5.1
<#
.SYNOPSIS
    settings-opencode bootstrap — one-line installer for native Windows (PowerShell).

.DESCRIPTION
    Clones (or fast-forwards) the repo into a local source dir, then copies the
    config into %USERPROFILE%\.config\opencode and %USERPROFILE%\.claude, installs
    JS dependencies, and writes the OPENCODE_MODEL_* / OPENCODE_REASONING_* defaults
    as persistent User environment variables.

    Re-running the exact same one-liner pulls the latest and re-applies it — that
    is the update path.

.EXAMPLE
    irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1 | iex

.EXAMPLE
    # Skip the Claude mirror, or uninstall:
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1))) -NoClaude
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1))) -Uninstall
#>
[CmdletBinding()]
param(
    [switch]$NoClaude,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

# ------------------------------ constants ------------------------------------

$RepoUrl       = 'https://github.com/fmflurry/settings-opencode.git'
$Branch        = if ($env:SETTINGS_OPENCODE_BRANCH) { $env:SETTINGS_OPENCODE_BRANCH } else { 'master' }
$SrcDir        = if ($env:SETTINGS_OPENCODE_SRC) { $env:SETTINGS_OPENCODE_SRC } else { Join-Path $env:USERPROFILE '.local\share\settings-opencode' }
$OpencodeDir   = Join-Path $env:USERPROFILE '.config\opencode'
$ClaudeDir     = Join-Path $env:USERPROFILE '.claude'

$EnvVars = [ordered]@{
    OPENCODE_MODEL_CONDUCTOR        = 'myMistral/mistral-medium-2604'
    OPENCODE_MODEL_SUBAGENT_PLANNER = 'myMistral/mistral-large-latest'
    OPENCODE_MODEL_SUBAGENT_WORKER  = 'myMistral/mistral-medium-latest'
    OPENCODE_MODEL_SUBAGENT_MINI    = 'myMistral/mistral-small-latest'
    OPENCODE_REASONING_CONDUCTOR    = 'high'
    OPENCODE_REASONING_PRIMARY      = 'high'
    OPENCODE_REASONING_SECONDARY    = 'medium'
    OPENCODE_REASONING_TERTIARY     = 'low'
}

# ------------------------------ presentation ---------------------------------

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }
function Ok($m)   { Write-Host "    OK   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    WARN $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

# ------------------------------ helpers --------------------------------------

function Require-Cmd($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { Die "$name is required. $hint" }
}

# Additive copy that mirrors install.sh's copy_tree: excludes node_modules/.git
# and transient files, and does NOT purge the destination so runtime state
# (auth.json, sessions, memory\, projects\) survives re-runs.
function Copy-Tree($src, $dst) {
    if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }
    $roboArgs = @(
        $src, $dst, '/E',
        '/XD', (Join-Path $src 'node_modules'), (Join-Path $src '.git'),
        '/XF', '*.log', '.DS_Store',
        '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'
    )
    & robocopy.exe @roboArgs | Out-Null
    # robocopy exit codes 0-7 are success; >=8 is a real failure.
    if ($LASTEXITCODE -ge 8) { Die "robocopy failed copying $src -> $dst (exit $LASTEXITCODE)" }
    $global:LASTEXITCODE = 0
}

function Backup-IfExists($path) {
    if (Test-Path $path) {
        $stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backup = "$path.bak.$stamp"
        Info "backing up existing $path -> $backup"
        Move-Item -Path $path -Destination $backup
        Ok "backed up to $backup"
    }
}

# ------------------------------ uninstall ------------------------------------

if ($Uninstall) {
    Step 'Uninstall'
    foreach ($name in $EnvVars.Keys) {
        [Environment]::SetEnvironmentVariable($name, $null, 'User')
    }
    Ok 'removed OPENCODE_* User environment variables'
    Info "Copied config left in place (delete manually if you want it gone):"
    Info "  $OpencodeDir"
    Info "  $ClaudeDir"
    Info "Source clone left at: $SrcDir"
    exit 0
}

# ------------------------------ prereqs --------------------------------------

Step 'Checking prerequisites'
Require-Cmd 'git' 'Install from https://git-scm.com/download/win  (or: winget install --id Git.Git)'

$pkgManager = $null
if (Get-Command bun -ErrorAction SilentlyContinue) {
    $pkgManager = 'bun'; Ok "bun $(bun --version)"
} elseif (Get-Command npm -ErrorAction SilentlyContinue) {
    $pkgManager = 'npm'; Ok "npm $(npm --version) (bun not found, will use npm)"
} else {
    Die 'neither bun nor npm found. Install Node.js 20+ (winget install --id OpenJS.NodeJS.LTS) or Bun (https://bun.sh), then re-run.'
}
Ok "git $((git --version) -replace 'git version ','')"

# ------------------------------ fetch ----------------------------------------

Step "Fetching settings-opencode into $SrcDir"
if (Test-Path (Join-Path $SrcDir '.git')) {
    git -C $SrcDir fetch --depth 1 origin $Branch
    git -C $SrcDir checkout -q $Branch 2>$null
    if ($LASTEXITCODE -ne 0) { git -C $SrcDir checkout -qB $Branch "origin/$Branch" }
    git -C $SrcDir reset --hard "origin/$Branch"
} elseif (Test-Path $SrcDir) {
    Die "$SrcDir exists but is not a git checkout. Remove it or set `$env:SETTINGS_OPENCODE_SRC."
} else {
    $parent = Split-Path -Parent $SrcDir
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    git clone --depth 1 --branch $Branch $RepoUrl $SrcDir
}
if ($LASTEXITCODE -ne 0) { Die 'git fetch/clone failed' }
Ok "source ready at $SrcDir"

# ------------------------------ opencode config ------------------------------

Step "Installing OpenCode config into $OpencodeDir"
if ((Test-Path $OpencodeDir) -and -not (Test-Path (Join-Path $OpencodeDir '.git'))) {
    Backup-IfExists $OpencodeDir
}
Copy-Tree $SrcDir $OpencodeDir
Ok "copied config (node_modules and .git excluded)"

Step "Installing JS dependencies ($pkgManager)"
Push-Location $OpencodeDir
try {
    if ($pkgManager -eq 'bun') {
        bun install
    } else {
        npm ci
        if ($LASTEXITCODE -ne 0) { npm install }
    }
    if ($LASTEXITCODE -ne 0) { Die 'dependency install failed' }
} finally {
    Pop-Location
}
Ok 'deps installed'

# ------------------------------ claude mirror --------------------------------

if ($NoClaude) {
    Step 'Claude Code mirror — skipped (-NoClaude)'
} else {
    $sourceClaude = Join-Path $SrcDir '.claude'
    if (Test-Path $sourceClaude) {
        Step "Installing Claude Code mirror into $ClaudeDir"
        Copy-Tree $sourceClaude $ClaudeDir
        Ok "copied .claude mirror (existing runtime state preserved)"
    } else {
        Warn '.claude not found in repo, skipping mirror'
    }
}

# ------------------------------ env vars -------------------------------------

Step 'Configuring User environment variables'
foreach ($name in $EnvVars.Keys) {
    [Environment]::SetEnvironmentVariable($name, $EnvVars[$name], 'User')
    # Make them available in the current session too.
    Set-Item -Path "Env:$name" -Value $EnvVars[$name]
}
Ok 'wrote OPENCODE_MODEL_* and OPENCODE_REASONING_* (User scope)'
Info 'These are defaults for the myMistral provider — edit them for your own provider:'
Info '  setx OPENCODE_MODEL_CONDUCTOR "yourprovider/your-model"'

# ------------------------------ next steps -----------------------------------

Step 'Done'
Info "OpenCode config: $OpencodeDir"
if (-not $NoClaude) { Info "Claude mirror:   $ClaudeDir" }
Info 'Open a NEW terminal so the environment variables take effect, then run: opencode'
Info ''
Info 'Update later — re-run the same one-liner:'
Info '  irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1 | iex'
Info 'Uninstall:'
Info '  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1))) -Uninstall'
