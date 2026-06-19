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

    Use -Local for a project-scoped install: copies into .\.opencode and .\.claude
    in the current directory; does NOT persist env vars (prints them as a hint instead).
    Do NOT run -Local from inside the settings-opencode clone itself.

    Use -NoOpencode to skip OpenCode entirely (no repo copy, no deps, no env vars)
    and install only the Claude mirror. Cannot be combined with -NoClaude.

.EXAMPLE
    irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1 | iex

.EXAMPLE
    # Skip the Claude mirror, or uninstall:
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1))) -NoClaude
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1))) -Uninstall

.EXAMPLE
    # Project-scoped install (run from your project directory, not the clone):
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1))) -Local

.EXAMPLE
    # Install only the Claude mirror (skip OpenCode):
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1))) -NoOpencode
#>
[CmdletBinding()]
param(
    [switch]$NoClaude,
    [switch]$NoOpencode,
    [switch]$Local,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

# Capture invocation directory before any Push-Location happens.
$InvokeDir = (Get-Location).Path

# ------------------------------ constants ------------------------------------

$RepoUrl       = 'https://github.com/fmflurry/settings-opencode.git'
$Branch        = if ($env:SETTINGS_OPENCODE_BRANCH) { $env:SETTINGS_OPENCODE_BRANCH } else { 'master' }
$SrcDir        = if ($env:SETTINGS_OPENCODE_SRC) { $env:SETTINGS_OPENCODE_SRC } else { Join-Path $env:USERPROFILE '.local\share\settings-opencode' }

if ($Local) {
    $OpencodeDir = Join-Path $InvokeDir '.opencode'
    $ClaudeDir   = Join-Path $InvokeDir '.claude'
} else {
    $OpencodeDir = Join-Path $env:USERPROFILE '.config\opencode'
    $ClaudeDir   = Join-Path $env:USERPROFILE '.claude'
}

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
        '/XD', (Join-Path $src 'node_modules'), (Join-Path $src '.git'), (Join-Path $src '.serena'),
        '/XF', '*.log', '.DS_Store', '*.bak', 'install.sh', 'install-cursor.sh', 'bootstrap.sh', 'bootstrap.ps1',
        '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'
    )
    & robocopy.exe @roboArgs | Out-Null
    # robocopy exit codes 0-7 are success; >=8 is a real failure.
    if ($LASTEXITCODE -ge 8) { Die "robocopy failed copying $src -> $dst (exit $LASTEXITCODE)" }
    $global:LASTEXITCODE = 0
}

# Additive copy with seed-only protection for personal config files. Mirrors
# install.sh's copy_tree_with_seed: repo-managed content (skills/, agents/, rules/)
# is always updated; settings.json / settings.local.json / policy-limits.json /
# *.local.json are copied only when they do not already exist (first install seeds
# them; reinstalls never overwrite user edits).
function Copy-TreeWithSeed($src, $dst) {
    if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }

    # Pass 1: update all repo-managed content, excluding personal config files.
    $roboArgs = @(
        $src, $dst, '/E',
        '/XD', (Join-Path $src 'node_modules'), (Join-Path $src '.git'), (Join-Path $src '.serena'),
        '/XF', '*.log', '.DS_Store', '*.bak', 'install.sh', 'install-cursor.sh', 'bootstrap.sh', 'bootstrap.ps1',
               'settings.json', 'settings.local.json', 'policy-limits.json',
        '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'
    )
    & robocopy.exe @roboArgs | Out-Null
    if ($LASTEXITCODE -ge 8) { Die "robocopy failed copying $src -> $dst (exit $LASTEXITCODE)" }
    $global:LASTEXITCODE = 0

    # Pass 2: seed personal config files on first install only — skip if they
    # already exist in the destination (preserves user edits on reinstall).
    $seedFiles = @('settings.json', 'settings.local.json', 'policy-limits.json')
    foreach ($f in $seedFiles) {
        $srcFile = Join-Path $src $f
        $dstFile = Join-Path $dst $f
        if ((Test-Path $srcFile) -and -not (Test-Path $dstFile)) {
            Copy-Item -Path $srcFile -Destination $dstFile
            Ok "seeded $f (first install)"
        }
    }
    # Seed *.local.json files that don't exist at destination
    Get-ChildItem -Path $src -Filter '*.local.json' -ErrorAction SilentlyContinue | ForEach-Object {
        $dstFile = Join-Path $dst $_.Name
        if (-not (Test-Path $dstFile)) {
            Copy-Item -Path $_.FullName -Destination $dstFile
            Ok "seeded $($_.Name) (first install)"
        }
    }
}

# Sync the canonical skill union (root skills/ U .claude/skills/, root wins on
# conflict, excluding skill-creator/ runtime dir) into each installed
# target's skills/ directory. Mirrors install.sh's sync_skills function.
function Sync-Skills($srcDir, [string[]]$destDirs) {
    Step 'Syncing canonical skill union'
    $rootSkills   = Join-Path $srcDir 'skills'
    $claudeSkills = Join-Path $srcDir '.claude\skills'

    foreach ($dst in $destDirs) {
        if (-not $dst) { continue }
        Info "syncing -> $dst"
        if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }

        # Pass 1: secondary source (.claude/skills — lower priority)
        if (Test-Path $claudeSkills) {
            $roboArgs = @(
                $claudeSkills, $dst, '/E',
                '/XF', '.DS_Store',
                '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'
            )
            & robocopy.exe @roboArgs | Out-Null
            if ($LASTEXITCODE -ge 8) { Warn "robocopy warning copying .claude/skills -> $dst (exit $LASTEXITCODE)" }
            $global:LASTEXITCODE = 0
        }

        # Pass 2: primary source (root skills — wins on conflict)
        if (Test-Path $rootSkills) {
            $roboArgs = @(
                $rootSkills, $dst, '/E',
                '/XD', (Join-Path $rootSkills 'skill-creator'),
                '/XF', '.DS_Store',
                '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'
            )
            & robocopy.exe @roboArgs | Out-Null
            if ($LASTEXITCODE -ge 8) { Warn "robocopy warning copying skills -> $dst (exit $LASTEXITCODE)" }
            $global:LASTEXITCODE = 0
        }

        $count = (Get-ChildItem -Path $dst -Directory -ErrorAction SilentlyContinue | Measure-Object).Count
        Ok "$count skill dirs in $dst"
    }
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

# ------------------------------ guards --------------------------------------

if ($NoClaude -and $NoOpencode) {
    Die 'nothing to install (both -NoClaude and -NoOpencode given)'
}

# ------------------------------ uninstall ------------------------------------

if ($Uninstall) {
    Step 'Uninstall'
    if (-not $Local -and -not $NoOpencode) {
        foreach ($name in $EnvVars.Keys) {
            [Environment]::SetEnvironmentVariable($name, $null, 'User')
        }
        Ok 'removed OPENCODE_* User environment variables'
    } elseif ($Local) {
        Info 'env vars not removed — -Local mode never persisted them'
    } else {
        Info 'env vars not removed — OpenCode was skipped (-NoOpencode)'
    }
    Info "Copied config left in place (delete manually if you want it gone):"
    if (-not $NoOpencode) { Info "  $OpencodeDir" }
    if (-not $NoClaude)   { Info "  $ClaudeDir" }
    Info "Source clone left at: $SrcDir"
    exit 0
}

# ------------------------------ prereqs --------------------------------------

Step 'Checking prerequisites'
Require-Cmd 'git' 'Install from https://git-scm.com/download/win  (or: winget install --id Git.Git)'

$pkgManager = $null
if (-not $NoOpencode) {
    if (Get-Command bun -ErrorAction SilentlyContinue) {
        $pkgManager = 'bun'; Ok "bun $(bun --version)"
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
        $pkgManager = 'npm'; Ok "npm $(npm --version) (bun not found, will use npm)"
    } else {
        Die 'neither bun nor npm found. Install Node.js 20+ (winget install --id OpenJS.NodeJS.LTS) or Bun (https://bun.sh), then re-run.'
    }
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

# ------------------------------ local guard ----------------------------------

if ($Local -and ($InvokeDir -eq $SrcDir)) {
    Die 'run -Local from your project directory, not the settings-opencode clone'
}

# ------------------------------ opencode config ------------------------------

if ($NoOpencode) {
    Step 'OpenCode config — skipped (-NoOpencode)'
} else {
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
}

# ------------------------------ claude mirror --------------------------------

if ($NoClaude) {
    Step 'Claude Code mirror — skipped (-NoClaude)'
} else {
    $sourceClaude = Join-Path $SrcDir '.claude'
    if (Test-Path $sourceClaude) {
        Step "Installing Claude Code mirror into $ClaudeDir"
        Copy-TreeWithSeed $sourceClaude $ClaudeDir
        Ok "copied .claude mirror (personal config files seeded, not overwritten on reinstall)"
    } else {
        Warn '.claude not found in repo, skipping mirror'
    }
}

# ------------------------------ env vars -------------------------------------

if ($NoOpencode) {
    Step 'Environment variables — skipped (-NoOpencode)'
} elseif ($Local) {
    Step 'Environment variables — not persisted (-Local mode)'
    Info 'Add the following to a per-project .envrc (direnv) or source it manually:'
    Info ''
    foreach ($name in $EnvVars.Keys) {
        Info "  `$env:$name = '$($EnvVars[$name])'"
    }
    Info ''
} else {
    Step 'Configuring User environment variables'
    foreach ($name in $EnvVars.Keys) {
        [Environment]::SetEnvironmentVariable($name, $EnvVars[$name], 'User')
        # Make them available in the current session too.
        Set-Item -Path "Env:$name" -Value $EnvVars[$name]
    }
    Ok 'wrote OPENCODE_MODEL_* and OPENCODE_REASONING_* (User scope)'
    Info 'These are defaults for the myMistral provider — edit them for your own provider:'
    Info '  setx OPENCODE_MODEL_CONDUCTOR "yourprovider/your-model"'
}

# ------------------------------ skill sync -----------------------------------

$skillDests = @()
if (-not $NoOpencode) { $skillDests += (Join-Path $OpencodeDir 'skills') }
if (-not $NoClaude)   { $skillDests += (Join-Path $ClaudeDir   'skills') }
if ($skillDests.Count -gt 0) {
    Sync-Skills $SrcDir $skillDests
}

# ------------------------------ next steps -----------------------------------

Step 'Done'
if (-not $NoOpencode) { Info "OpenCode config: $OpencodeDir" }
if (-not $NoClaude)   { Info "Claude mirror:   $ClaudeDir" }
if ($Local) {
    Info 'Project-scoped install — applies only when working in:'
    Info "  $InvokeDir"
    Info 'No new terminal needed — no persistent env vars were written.'
    Info "Re-run anytime: bootstrap.ps1 -Local"
    Info "Uninstall local copy: remove $OpencodeDir and $ClaudeDir manually"
} else {
    Info 'Open a NEW terminal so the environment variables take effect, then run: opencode'
    Info ''
    Info 'Update later — re-run the same one-liner:'
    Info '  irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1 | iex'
    Info 'Uninstall:'
    Info '  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1))) -Uninstall'
}
