#Requires -Version 5.1
<#
.SYNOPSIS
    settings-opencode bootstrap — one-line installer for native Windows (PowerShell).

.DESCRIPTION
    Clones (or fast-forwards) the repo into a local source dir, then merges the
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
    [switch]$Opencode,
    [switch]$Claude,
    [switch]$Local,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

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

# Allowlist / opt-out resolver — mirrors install.sh logic.
# Defaults: opencode ON, claude ON.
$doOpencode = $true
$doClaude   = $true

if ($Opencode -or $Claude) {
    # Allowlist mode: only listed targets are candidates, others default OFF.
    $doOpencode = $Opencode.IsPresent
    $doClaude   = $Claude.IsPresent
}

# Opt-outs win over allowlist (applied last).
if ($NoOpencode) { $doOpencode = $false }
if ($NoClaude)   { $doClaude   = $false }

# Empty-set guard.
if (-not $doOpencode -and -not $doClaude) {
    Die 'nothing to install (both targets disabled)'
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

# Additive copy that mirrors install.sh's copy_tree: excludes node_modules/.git,
# assets, vibe, removed OCX files, and transient files. Does NOT purge the destination so runtime state
# (auth.json, sessions, memory\, projects\) survives re-runs.
function Copy-Tree($src, $dst) {
    if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }
    $roboArgs = @(
        $src, $dst, '/E',
        '/XD', (Join-Path $src 'node_modules'), (Join-Path $src '.git'), (Join-Path $src '.serena'), (Join-Path $src 'assets'), (Join-Path $src 'vibe'), (Join-Path $src '.vibe'),
        '/XF', '*.log', '.DS_Store', '*.bak', 'install.sh', 'install-cursor.sh', 'bootstrap.sh', 'bootstrap.ps1', 'ocx.jsonc',
        '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'
    )
    & robocopy.exe @roboArgs | Out-Null
    # robocopy exit codes 0-7 are success; >=8 is a real failure.
    if ($LASTEXITCODE -ge 8) { Die "robocopy failed copying $src -> $dst (exit $LASTEXITCODE)" }
    $global:LASTEXITCODE = 0
}

function Ensure-OpencodeRuntimeDirs($opencodeDir) {
    New-Item -ItemType Directory -Path (Join-Path $opencodeDir 'data\opencode') -Force | Out-Null
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

function Sync-LearningRuntime($srcDir, $opencodeDir, $claudeDir, [bool]$opencodeReady, [bool]$claudeReady) {
    if (-not $opencodeReady -and -not $claudeReady) { return }
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Die 'proposal-learning runtime synchronization requires node' }
    $args = @('--experimental-strip-types', (Join-Path $srcDir 'plugins\learning\installer-cli.ts'), '--source-root', $srcDir, '--opencode-root', $opencodeDir, '--claude-root', $claudeDir)
    if ($opencodeReady) { $args += '--opencode' }
    if ($claudeReady) { $args += '--claude' }
    & $node.Source @args
    if ($LASTEXITCODE -ne 0) { Die 'proposal-learning runtime synchronization failed' }
    Ok 'synchronized proposal-learning runtime'
}

function Install-LearningMaintenance($runtimeRoot) {
    if (-not $runtimeRoot -or -not [IO.Path]::IsPathRooted($runtimeRoot) -or $runtimeRoot.IndexOfAny([char[]]@("`r", "`n", "`t")) -ge 0) {
        Die 'proposal-learning maintenance rejected an unsafe runtime path'
    }
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node -or -not [IO.Path]::IsPathRooted($node.Source)) { Die 'proposal-learning maintenance requires an absolute node executable' }
    $stateCli = Join-Path $runtimeRoot 'state-cli.ts'
    if (-not (Test-Path -LiteralPath $stateCli -PathType Leaf)) { Die 'proposal-learning state CLI is unavailable' }
    $stateHome = if ($env:XDG_STATE_HOME) { $env:XDG_STATE_HOME } else { Join-Path $env:USERPROFILE '.local\state' }
    if (-not [IO.Path]::IsPathRooted($stateHome) -or $stateHome.IndexOfAny([char[]]@("`r", "`n", "`t")) -ge 0) { Die 'proposal-learning maintenance rejected an unsafe XDG state path' }
    $escapePowerShellLiteral = { param($value) return $value.Replace("'", "''") }
    $wrapper = Join-Path $runtimeRoot 'proposal-learning-purge.ps1'
    @(
        "`$ErrorActionPreference = 'Stop'",
        "`$env:XDG_STATE_HOME = '$(& $escapePowerShellLiteral $stateHome)'",
        "& '$(& $escapePowerShellLiteral $node.Source)' --experimental-strip-types '$(& $escapePowerShellLiteral $stateCli)' purge",
        'exit $LASTEXITCODE'
    ) | Set-Content -LiteralPath $wrapper -Encoding utf8
    $taskName = 'settings-opencode-proposal-learning-purge'
    $action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$wrapper`""
    $trigger = New-ScheduledTaskTrigger -Daily -At 03:00
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'state-cli.ts purge' -Force | Out-Null
    Ok 'registered daily proposal-learning maintenance'
}

function Test-ReparsePoint($path) {
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    $item = Get-Item -LiteralPath $path -Force
    return (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Test-SamePath($left, $right) {
    try {
        $trimChars = [char[]]@('\', '/')
        $leftPath = (Resolve-Path -LiteralPath $left).ProviderPath.TrimEnd($trimChars)
        $rightPath = (Resolve-Path -LiteralPath $right).ProviderPath.TrimEnd($trimChars)
        return [string]::Equals($leftPath, $rightPath, [StringComparison]::OrdinalIgnoreCase)
    } catch {
        return $false
    }
}

function Get-ReparseTarget($path) {
    $item = Get-Item -LiteralPath $path -Force
    if (-not ($item.PSObject.Properties.Name -contains 'Target')) { return $null }

    $target = $item.Target
    if ($target -is [array]) { $target = $target | Select-Object -First 1 }
    if (-not $target) { return $null }
    if ([IO.Path]::IsPathRooted($target)) { return $target }

    return [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $path) $target))
}

function Test-ReparsePointsTo($path, $expectedTarget) {
    $target = Get-ReparseTarget $path
    if (-not $target) { return $false }
    return (Test-SamePath $target $expectedTarget)
}

# (empty-set guard is handled in the resolver block above)

# ------------------------------ uninstall ------------------------------------

if ($Uninstall) {
    Step 'Uninstall'
    if (-not $Local -and $doOpencode) {
        foreach ($name in $EnvVars.Keys) {
            [Environment]::SetEnvironmentVariable($name, $null, 'User')
        }
        Ok 'removed OPENCODE_* User environment variables'
    } elseif ($Local) {
        Info 'env vars not removed — -Local mode never persisted them'
    } else {
        Info 'env vars not removed — OpenCode was skipped'
    }
    Info "Copied config left in place (delete manually if you want it gone):"
    if ($doOpencode) { Info "  $OpencodeDir" }
    if ($doClaude)   { Info "  $ClaudeDir" }
    Info "Source clone left at: $SrcDir"
    exit 0
}

# ------------------------------ prereqs --------------------------------------

Step 'Checking prerequisites'
Require-Cmd 'git' 'Install from https://git-scm.com/download/win  (or: winget install --id Git.Git)'

$pkgManager = $null
if ($doOpencode -or $doClaude) {
    if (Get-Command bun -ErrorAction SilentlyContinue) {
        $pkgManager = 'bun'; Ok "bun $(bun --version)"
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
        $pkgManager = 'npm'; Ok "npm $(npm --version) (bun not found, will use npm)"
    } else {
        Die 'neither bun nor npm found. Install Node.js 22.6+ (winget install --id OpenJS.NodeJS.LTS) or Bun (https://bun.sh), then re-run.'
    }
}
Require-Cmd 'node' 'Install Node.js 22.6+ (winget install --id OpenJS.NodeJS.LTS), then re-run.'
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

$opencodeTargetReady = $false
if (-not $doOpencode) {
    Step 'OpenCode config — skipped'
} else {
    Step "Installing OpenCode config into $OpencodeDir"
    $skipOpencodeCopy = $false
    if (Test-Path -LiteralPath $OpencodeDir) {
        if (Test-ReparsePoint $OpencodeDir) {
            if (Test-ReparsePointsTo $OpencodeDir $SrcDir) {
                Ok "$OpencodeDir already points at $SrcDir"
                $skipOpencodeCopy = $true
                $opencodeTargetReady = $true
            } else {
                Warn "$OpencodeDir is a symlink/reparse point; leaving it untouched and skipping OpenCode copy"
                $skipOpencodeCopy = $true
            }
        } elseif (Test-Path -LiteralPath $OpencodeDir -PathType Container) {
            Info "$OpencodeDir exists; merging repo files into it"
        } else {
            Warn "$OpencodeDir exists and is not a directory; leaving it untouched and skipping OpenCode copy"
            $skipOpencodeCopy = $true
        }
    }

    if (-not $skipOpencodeCopy) {
        Copy-Tree $SrcDir $OpencodeDir
        Ensure-OpencodeRuntimeDirs $OpencodeDir
        Ok "copied config (node_modules, .git, assets, vibe, OCX files excluded)"
        $opencodeTargetReady = $true
    }

    if ($opencodeTargetReady) {
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
    } else {
        Warn 'OpenCode target was not modified; skipping dependencies, env vars, and OpenCode skill sync'
    }
}

# ------------------------------ claude mirror --------------------------------

$claudeTargetReady = $false
if (-not $doClaude) {
    Step 'Claude Code mirror — skipped'
} else {
    $sourceClaude = Join-Path $SrcDir '.claude'
    if (Test-Path $sourceClaude) {
        Step "Installing Claude Code mirror into $ClaudeDir"
        $skipClaudeCopy = $false
        if (Test-Path -LiteralPath $ClaudeDir) {
            if (Test-ReparsePoint $ClaudeDir) {
                if (Test-ReparsePointsTo $ClaudeDir $sourceClaude) {
                    Ok "$ClaudeDir already points at $sourceClaude"
                    $skipClaudeCopy = $true
                } else {
                    Warn "$ClaudeDir is a symlink/reparse point; leaving it untouched and skipping Claude copy"
                    $skipClaudeCopy = $true
                }
            } elseif (Test-Path -LiteralPath $ClaudeDir -PathType Container) {
                Info "$ClaudeDir exists; merging Claude mirror into it"
            } else {
                Warn "$ClaudeDir exists and is not a directory; leaving it untouched and skipping Claude copy"
                $skipClaudeCopy = $true
            }
        }

        if (-not $skipClaudeCopy) {
            Copy-TreeWithSeed $sourceClaude $ClaudeDir
            Ok "copied .claude mirror (personal config files seeded, not overwritten on reinstall)"
            $claudeTargetReady = $true
        }
    } else {
        Warn '.claude not found in repo, skipping mirror'
    }
}

# ------------------------------ env vars -------------------------------------

if (-not $doOpencode) {
    Step 'Environment variables — skipped'
} elseif (-not $opencodeTargetReady) {
    Step 'Environment variables — skipped (OpenCode target was not modified)'
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
if ($doOpencode -and $opencodeTargetReady) { $skillDests += (Join-Path $OpencodeDir 'skills') }
if ($doClaude -and $claudeTargetReady)     { $skillDests += (Join-Path $ClaudeDir   'skills') }
if ($skillDests.Count -gt 0) {
    Sync-Skills $SrcDir $skillDests
}

Sync-LearningRuntime $SrcDir $OpencodeDir $ClaudeDir $opencodeTargetReady $claudeTargetReady
if ($opencodeTargetReady) {
    Install-LearningMaintenance (Join-Path $OpencodeDir 'plugins\learning')
} elseif ($claudeTargetReady) {
    Install-LearningMaintenance (Join-Path $ClaudeDir 'hooks\learning')
}

# ------------------------------ next steps -----------------------------------

Step 'Done'
if ($doOpencode -and $opencodeTargetReady) { Info "OpenCode config: $OpencodeDir" }
if ($doClaude -and $claudeTargetReady)     { Info "Claude mirror:   $ClaudeDir" }
if ($Local) {
    Info 'Project-scoped install — applies only when working in:'
    Info "  $InvokeDir"
    Info 'No new terminal needed — no persistent env vars were written.'
    Info "Re-run anytime: bootstrap.ps1 -Local"
    $localTargets = @()
    if ($doOpencode -and $opencodeTargetReady) { $localTargets += $OpencodeDir }
    if ($doClaude -and $claudeTargetReady)     { $localTargets += $ClaudeDir }
    if ($localTargets.Count -gt 0) {
        Info ("Uninstall local copies: remove manually — " + ($localTargets -join ', '))
    } else {
        Info 'No local copies were changed.'
    }
} else {
    if ($doOpencode -and $opencodeTargetReady) {
        Info 'Open a NEW terminal so the environment variables take effect, then run: opencode'
    }
    Info ''
    Info 'Update later — re-run the same one-liner:'
    Info '  irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1 | iex'
    Info 'Uninstall:'
    Info '  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/fmflurry/settings-opencode/master/bootstrap.ps1))) -Uninstall'
}
