#!/usr/bin/env bash
#
# install-cursor.sh — port OpenCode + ClaudeCode setup into ~/.cursor (physical copy)
#
# Copies skills, subagents, commands, rules, hooks (translated), and MCP servers
# (merged) from the repo and ~/.claude into ~/.cursor/. No symlinks; everything is
# a real on-disk copy so Cursor can run standalone.
#
# Flags:
#   --yes, -y        Non-interactive
#   --uninstall      Remove installed files (asks before deleting)
#   --no-backup      Skip pre-overwrite backup
#   --help, -h
#
set -euo pipefail

# ------------------------------ constants ------------------------------------

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]:-$0}" )" && pwd )"
CLAUDE_DIR="$HOME/.claude"
CURSOR_DIR="$HOME/.cursor"
BACKUP_ROOT="$CURSOR_DIR/_pre_install_backups"

ASSUME_YES=0
DO_UNINSTALL=0
NO_BACKUP=0

# ------------------------------ presentation ---------------------------------

if [ -t 1 ]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'
    RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'
    RESET=$'\033[0m'
else
    BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step() { printf "\n${BOLD}${BLUE}==>${RESET} ${BOLD}%s${RESET}\n" "$*"; }
info() { printf "    %s\n" "$*"; }
ok()   { printf "    ${GREEN}OK${RESET}   %s\n" "$*"; }
warn() { printf "    ${YELLOW}WARN${RESET} %s\n" "$*"; }
err()  { printf "    ${RED}ERR${RESET}  %s\n" "$*" >&2; }

ask() {
    local prompt="$1" default="${2:-Y}" hint reply
    if [ "$ASSUME_YES" = "1" ]; then
        [ "$default" = "Y" ] && return 0 || return 1
    fi
    if [ "$default" = "Y" ]; then hint="[Y/n]"; else hint="[y/N]"; fi
    while :; do
        printf "    ${BOLD}?${RESET} %s %s " "$prompt" "$hint"
        read -r reply || reply=""
        reply="${reply:-$default}"
        case "$reply" in
            Y|y|Yes|yes) return 0 ;;
            N|n|No|no)   return 1 ;;
            *) printf "    please answer y or n\n" ;;
        esac
    done
}

print_help() {
    cat <<EOF
${BOLD}install-cursor.sh${RESET} — port OpenCode + ClaudeCode setup into ~/.cursor

Usage: ./install-cursor.sh [flags]

Flags:
  --yes, -y        Non-interactive (accept all defaults)
  --uninstall      Remove installed files (confirms before deleting)
  --no-backup      Skip pre-overwrite backup
  --help, -h       Show this help

Source assets (read):
  $REPO_DIR/{skills,commands,opencode.jsonc,CLAUDE.md,.claude/rules}
  $CLAUDE_DIR/{skills,agents,commands,rules,settings.json,CLAUDE.md}

Target (written, no symlinks):
  $CURSOR_DIR/{skills,agents,commands,rules,hooks.json,mcp.json}
EOF
}

# ------------------------------ prereqs --------------------------------------

USE_RSYNC=1

check_prereqs() {
    step "Checking prerequisites"
    local missing=0
    if ! command -v node >/dev/null 2>&1; then
        err "node not found"; missing=1
    else
        ok "node $(node --version)"
    fi
    if command -v rsync >/dev/null 2>&1; then
        local rv
        rv="$(rsync --version 2>&1 | head -1)"
        ok "rsync: $rv"
        if printf "%s" "$rv" | grep -qi openrsync; then
            USE_RSYNC=0
            warn "openrsync detected (macOS default) — using cp -R fallback (no delta sync, but works around openrsync nested-dir bug)"
        fi
    else
        USE_RSYNC=0
        warn "rsync not found — using cp -R fallback"
    fi
    [ "$missing" = "0" ] || { err "install required tools first"; exit 1; }
    if [ ! -d "$CLAUDE_DIR" ]; then
        err "$CLAUDE_DIR does not exist — run install.sh first to set up Claude mirror"
        exit 1
    fi
}

# Copy entire tree src/ -> dst/ filtering common junk. Idempotent overlay.
copy_tree() {
    local src="$1" dst="$2"
    [ -d "$src" ] || return 1
    mkdir -p "$dst"
    if [ "$USE_RSYNC" = "1" ]; then
        rsync -a \
            --exclude='node_modules' --exclude='.git' --exclude='.DS_Store' --exclude='vibe' \
            "$src/" "$dst/"
    else
        # tar-pipe merges nested non-empty dirs cleanly; BSD `cp -R` and `ditto` both choke on overlapping subtrees.
        # `-h` dereferences symlinks so extraction writes real files into the target dir
        # instead of trying to plant a symlink atop an existing dir.
        ( cd "$src" && tar -h -cf - \
            --exclude='node_modules' --exclude='.git' --exclude='.DS_Store' --exclude='vibe' \
            . ) | ( cd "$dst" && tar xf - )
    fi
}

# Copy only *.md files from src/ -> dst/, preserving structure (flat or nested).
copy_md_tree() {
    local src="$1" dst="$2"
    [ -d "$src" ] || return 1
    mkdir -p "$dst"
    ( cd "$src" && find . -type f -name '*.md' -print0 ) | \
        while IFS= read -r -d '' f; do
            local target="$dst/$f"
            mkdir -p "$(dirname "$target")"
            cp -p "$src/$f" "$target"
        done
}

# ------------------------------ backup ---------------------------------------

backup_existing() {
    [ "$NO_BACKUP" = "1" ] && { info "backup skipped (--no-backup)"; return 0; }
    local target="$1"
    [ -e "$target" ] || return 0
    mkdir -p "$BACKUP_ROOT"
    local stamp dest
    stamp="$(date +%Y%m%d-%H%M%S)"
    dest="$BACKUP_ROOT/$(basename "$target").bak.$stamp"
    info "backing up $target -> $dest"
    if [ -d "$target" ]; then
        # Move is atomic + dodges openrsync bugs. Install step recreates the dir.
        mv "$target" "$dest"
    else
        cp -p "$target" "$dest"
    fi
    ok "backup at $dest"
}

# ------------------------------ skills ---------------------------------------

install_skills() {
    step "Skills -> $CURSOR_DIR/skills"
    local dst="$CURSOR_DIR/skills"
    backup_existing "$dst"
    mkdir -p "$dst"

    # Delegate to scripts/sync-skills.sh — the canonical union-merge implementation
    # shared by install.sh, install-cursor.sh, and bootstrap.ps1.
    # It builds root/skills ∪ .claude/skills (root wins on conflict, excluding
    # skill-creator/ runtime dir) and overlays them into $dst.
    local sync_script="$REPO_DIR/scripts/sync-skills.sh"
    if [ -x "$sync_script" ]; then
        "$sync_script" "$dst"
    else
        # Fallback: inline union-merge (kept for safety if sync-skills.sh is missing)
        # Source 1: ~/.claude/skills
        if [ -d "$CLAUDE_DIR/skills" ]; then
            copy_tree "$CLAUDE_DIR/skills" "$dst"
            ok "copied ~/.claude/skills -> $dst"
        fi
        # Source 2: repo/skills (overlays; root wins on conflict)
        if [ -d "$REPO_DIR/skills" ]; then
            copy_tree "$REPO_DIR/skills" "$dst"
            ok "copied repo/skills -> $dst (overlay)"
        fi
        # Source 3: repo/.claude/skills (Claude-native overlay)
        if [ -d "$REPO_DIR/.claude/skills" ]; then
            copy_tree "$REPO_DIR/.claude/skills" "$dst"
            ok "copied repo/.claude/skills -> $dst (overlay)"
        fi
    fi

    local count
    count="$(find "$dst" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
    info "$count skill directories in $dst"
}

# ------------------------------ agents (subagents) ---------------------------

install_agents() {
    step "Subagents -> $CURSOR_DIR/agents"
    local dst="$CURSOR_DIR/agents"
    backup_existing "$dst"
    mkdir -p "$dst"

    if [ -d "$CLAUDE_DIR/agents" ]; then
        copy_md_tree "$CLAUDE_DIR/agents" "$dst"
        ok "copied ~/.claude/agents -> $dst"
    else
        warn "$CLAUDE_DIR/agents not found, skipping"
    fi

    if [ -d "$REPO_DIR/agents" ]; then
        copy_md_tree "$REPO_DIR/agents" "$dst"
        ok "copied repo/agents -> $dst (overlay)"
    fi

    if [ -d "$REPO_DIR/.claude/agents" ]; then
        copy_md_tree "$REPO_DIR/.claude/agents" "$dst"
        ok "copied repo/.claude/agents -> $dst (overlay)"
    fi

    install_opencode_agents "$dst"

    local count
    count="$(find "$dst" -mindepth 1 -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
    info "$count agent files in $dst"
}

# Parse opencode.jsonc `agent` block, resolve each prompt body, and emit
# Cursor-compatible markdown files. Primary agents also get an alwaysApply rule
# emitted later by install_rules() via the side-channel file we drop here.
install_opencode_agents() {
    local dst="$1"
    [ -f "$REPO_DIR/opencode.jsonc" ] || { info "no opencode.jsonc, skipping OpenCode agents"; return 0; }

    REPO_DIR="$REPO_DIR" DST="$dst" PRIMARY_OUT="$CURSOR_DIR/_primary_agents" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { REPO_DIR, DST, PRIMARY_OUT } = process.env;

function parseJsonc(text) {
    const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:"])\/\/[^\n]*/g, '$1')
        .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(stripped);
}

const cfg = parseJsonc(fs.readFileSync(path.join(REPO_DIR, 'opencode.jsonc'), 'utf8'));
if (!cfg.agent) { console.log('no agent block in opencode.jsonc'); process.exit(0); }

fs.mkdirSync(PRIMARY_OUT, { recursive: true });

// Resolve OpenCode prompt placeholder like
//   {.config/opencode/prompts/agents/conductor.txt}
// to a real file under the repo (where ~/.config/opencode -> repo via install.sh).
function resolvePrompt(placeholder) {
    if (!placeholder) return null;
    const m = placeholder.match(/\{(.+?)\}/);
    const rel = m ? m[1] : placeholder;
    const candidates = [
        path.join(REPO_DIR, rel.replace(/^\.config\/opencode\//, '')),
        path.join(REPO_DIR, rel),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

function yamlEscape(s) {
    if (s == null) return '""';
    if (/^[\w./-]+$/.test(s)) return s;
    return JSON.stringify(s);
}

let writtenAgents = 0, writtenPrimary = 0;

for (const [name, def] of Object.entries(cfg.agent)) {
    const promptPath = resolvePrompt(def.prompt);
    const body = promptPath ? fs.readFileSync(promptPath, 'utf8') : `(no prompt body found for ${name})\n`;

    const isPrimary = def.mode === 'primary';
    const tools = def.tools || {};
    const editsDenied = tools.write === false && tools.edit === false;

    const frontmatter = [
        '---',
        `name: ${yamlEscape(name)}`,
        `description: ${yamlEscape(def.description || '')}`,
        `model: inherit`,
        `readonly: ${editsDenied ? 'true' : 'false'}`,
        `is_background: false`,
        '---',
        '',
    ].join('\n');

    fs.writeFileSync(path.join(DST, `${name}.md`), frontmatter + body);
    writtenAgents++;

    if (isPrimary) {
        // Cursor has no file-based "custom primary mode" yet. Drop the prompt as
        // an alwaysApply rule so the primary system prompt is always loaded.
        const rule = [
            '---',
            `description: ${yamlEscape(`OpenCode primary agent: ${name}`)}`,
            'globs: ""',
            'alwaysApply: true',
            '---',
            '',
            `# Primary Agent: ${name}`,
            '',
            def.description || '',
            '',
            body,
        ].join('\n');
        fs.writeFileSync(path.join(PRIMARY_OUT, `primary__${name}.mdc`), rule);
        writtenPrimary++;
    }
}

console.log(`opencode agents emitted: ${writtenAgents} (${writtenPrimary} primary)`);
NODE
    ok "OpenCode agents -> $dst"
}

# ------------------------------ commands -------------------------------------

install_commands() {
    step "Commands -> $CURSOR_DIR/commands"
    local dst="$CURSOR_DIR/commands"
    backup_existing "$dst"
    mkdir -p "$dst"

    if [ -d "$CLAUDE_DIR/commands" ]; then
        copy_md_tree "$CLAUDE_DIR/commands" "$dst"
        ok "copied ~/.claude/commands -> $dst"
    fi

    if [ -d "$REPO_DIR/commands" ]; then
        copy_md_tree "$REPO_DIR/commands" "$dst"
        ok "copied repo/commands -> $dst (overlay)"
    fi

    if [ -d "$REPO_DIR/.claude/commands" ]; then
        copy_md_tree "$REPO_DIR/.claude/commands" "$dst"
        ok "copied repo/.claude/commands -> $dst (overlay)"
    fi

    local count
    count="$(find "$dst" -mindepth 1 -name '*.md' | wc -l | tr -d ' ')"
    info "$count command files in $dst"
}

# ------------------------------ rules ----------------------------------------
# Wraps plain .md rule files with Cursor MDC frontmatter.

install_rules() {
    step "Rules -> $CURSOR_DIR/rules"
    local dst="$CURSOR_DIR/rules"
    backup_existing "$dst"
    mkdir -p "$dst"

    REPO_DIR="$REPO_DIR" CLAUDE_DIR="$CLAUDE_DIR" DST="$dst" PRIMARY_STAGE="$CURSOR_DIR/_primary_agents" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { REPO_DIR, CLAUDE_DIR, DST, PRIMARY_STAGE } = process.env;

const sources = [
    // [label, root, alwaysApplyDefault]
    ['claude-global', path.join(CLAUDE_DIR, 'rules'), false],
    ['repo-claude',   path.join(REPO_DIR, '.claude', 'rules'), false],
];
// Top-level CLAUDE.md files - always apply
const topLevel = [
    path.join(CLAUDE_DIR, 'CLAUDE.md'),
    path.join(REPO_DIR, 'CLAUDE.md'),
    path.join(REPO_DIR, '.claude', 'CLAUDE.md'),
];

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
    return out;
}

function slug(s) {
    return s.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function hasFrontmatter(body) {
    return /^---\s*\n[\s\S]*?\n---\s*\n/.test(body);
}

function wrap(body, opts) {
    if (hasFrontmatter(body)) {
        // Already MDC-shaped — pass through but ensure fields exist.
        return body;
    }
    const fm = [
        '---',
        `description: ${JSON.stringify(opts.description || '')}`,
        `globs: ${JSON.stringify(opts.globs || '')}`,
        `alwaysApply: ${opts.alwaysApply ? 'true' : 'false'}`,
        '---',
        '',
    ].join('\n');
    return fm + body;
}

let written = 0;
const seen = new Set();

function emit(targetName, body, opts) {
    let name = targetName;
    let i = 1;
    while (seen.has(name)) name = `${targetName.replace(/\.mdc$/, '')}-${++i}.mdc`;
    seen.add(name);
    fs.writeFileSync(path.join(DST, name), wrap(body, opts));
    written++;
}

for (const [label, root, defAlways] of sources) {
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root)) {
        const rel = path.relative(root, file).replace(/\.md$/, '');
        const name = `${slug(label)}__${slug(rel)}.mdc`;
        const body = fs.readFileSync(file, 'utf8');
        emit(name, body, {
            description: `${label}: ${rel}`,
            globs: '',
            alwaysApply: defAlways,
        });
    }
}

for (const file of topLevel) {
    if (!fs.existsSync(file)) continue;
    // Symlinks: resolve so we read the actual content
    const real = fs.realpathSync(file);
    const body = fs.readFileSync(real, 'utf8');
    const tag = slug(path.relative(path.dirname(real).startsWith(REPO_DIR) ? REPO_DIR : CLAUDE_DIR, real)) || 'claude-md';
    emit(`always__${tag}.mdc`, body, {
        description: 'Always-on baseline from CLAUDE.md',
        globs: '',
        alwaysApply: true,
    });
}

// Primary-agent staging (populated by install_opencode_agents)
if (PRIMARY_STAGE && fs.existsSync(PRIMARY_STAGE)) {
    for (const f of fs.readdirSync(PRIMARY_STAGE)) {
        if (!f.endsWith('.mdc')) continue;
        const src = path.join(PRIMARY_STAGE, f);
        emit(f, fs.readFileSync(src, 'utf8'), { alwaysApply: true });
    }
    // Clean staging
    fs.rmSync(PRIMARY_STAGE, { recursive: true, force: true });
}

console.log(`wrote ${written} rule files`);
NODE
    local count
    count="$(find "$dst" -name '*.mdc' | wc -l | tr -d ' ')"
    ok "$count .mdc files in $dst"
}

# ------------------------------ hooks ----------------------------------------
# Translate ~/.claude/settings.json hooks block -> ~/.cursor/hooks.json
# Claude format: { "PreToolUse": [ { "matcher": "X", "hooks": [ {"type":"command","command":"..."} ] } ] }
# Cursor format: { "version": 1, "hooks": { "preToolUse": [ {"command":"...", "matcher":"X"} ] } }

install_hooks() {
    step "Hooks -> $CURSOR_DIR/hooks.json"
    local dst="$CURSOR_DIR/hooks.json"
    backup_existing "$dst"

    CLAUDE_DIR="$CLAUDE_DIR" REPO_DIR="$REPO_DIR" DST="$dst" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR, REPO_DIR, DST } = process.env;

const eventMap = {
    PreToolUse:        'preToolUse',
    PostToolUse:       'postToolUse',
    UserPromptSubmit:  'beforeSubmitPrompt',
    SessionStart:      'sessionStart',
    SessionEnd:        'sessionEnd',
    Stop:              'stop',
    SubagentStop:      'subagentStop',
    PreCompact:        'preCompact',
    // Notification, etc. have no Cursor equivalent — dropped.
};

function readJson(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch { return null; }
}

const sources = [
    path.join(CLAUDE_DIR, 'settings.json'),
    path.join(REPO_DIR, '.claude', 'settings.json'),
];

const out = { version: 1, hooks: {} };
let dropped = 0;
let translated = 0;

for (const src of sources) {
    const j = readJson(src);
    if (!j || !j.hooks) continue;
    for (const [claudeEvent, entries] of Object.entries(j.hooks)) {
        const cursorEvent = eventMap[claudeEvent];
        if (!cursorEvent) { dropped += entries.length; continue; }
        out.hooks[cursorEvent] = out.hooks[cursorEvent] || [];
        for (const entry of entries) {
            const matcher = entry.matcher;
            for (const h of (entry.hooks || [])) {
                if (h.type !== 'command' || !h.command) continue;
                const cursorHook = { command: h.command };
                if (matcher && matcher !== '*') cursorHook.matcher = matcher;
                if (typeof h.timeout === 'number') cursorHook.timeout = h.timeout;
                out.hooks[cursorEvent].push(cursorHook);
                translated++;
            }
        }
    }
}

fs.writeFileSync(DST, JSON.stringify(out, null, 2) + '\n');
console.log(`translated ${translated} hooks, dropped ${dropped} (no Cursor equivalent)`);
NODE
    ok "wrote $dst"
}

# ------------------------------ MCP servers ----------------------------------
# Merge into ~/.cursor/mcp.json from three sources:
#   1. existing ~/.cursor/mcp.json (preserve)
#   2. opencode.jsonc "mcp" block (translate)
#   3. ~/.claude/.mcp.json or ~/.claude/settings.json "mcpServers" (passthrough)

install_mcp() {
    step "MCP servers -> $CURSOR_DIR/mcp.json"
    local dst="$CURSOR_DIR/mcp.json"
    backup_existing "$dst"

    REPO_DIR="$REPO_DIR" CLAUDE_DIR="$CLAUDE_DIR" CURSOR_DIR="$CURSOR_DIR" DST="$dst" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { REPO_DIR, CLAUDE_DIR, CURSOR_DIR, DST } = process.env;

// Strip JSONC comments + trailing commas (minimal — handles opencode.jsonc style)
function parseJsonc(text) {
    const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:"])\/\/[^\n]*/g, '$1')
        .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(stripped);
}

function readJson(p) {
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { console.error(`warn: failed to parse ${p}: ${e.message}`); return null; }
}

function readJsonc(p) {
    if (!fs.existsSync(p)) return null;
    try { return parseJsonc(fs.readFileSync(p, 'utf8')); }
    catch (e) { console.error(`warn: failed to parse ${p}: ${e.message}`); return null; }
}

// Translate opencode-style mcp entry -> Cursor-style server entry.
function fromOpencode(name, cfg) {
    if (cfg.enabled === false) return null;
    if (cfg.type === 'remote' && cfg.url) {
        const out = { url: cfg.url };
        if (cfg.headers && Object.keys(cfg.headers).length) out.headers = cfg.headers;
        return out;
    }
    if (cfg.type === 'local' && Array.isArray(cfg.command) && cfg.command.length) {
        const out = { command: cfg.command[0], args: cfg.command.slice(1) };
        if (cfg.environment) out.env = cfg.environment;
        return out;
    }
    return null;
}

const merged = {};
let kept = 0, skipped = 0;

// 1. Existing ~/.cursor/mcp.json — preserve as baseline
const existing = readJson(path.join(CURSOR_DIR, 'mcp.json'));
if (existing && existing.mcpServers) {
    for (const [n, s] of Object.entries(existing.mcpServers)) { merged[n] = s; kept++; }
}

// 2. opencode.jsonc mcp block
const opencode = readJsonc(path.join(REPO_DIR, 'opencode.jsonc'));
if (opencode && opencode.mcp) {
    for (const [n, cfg] of Object.entries(opencode.mcp)) {
        const translated = fromOpencode(n, cfg);
        if (translated) { merged[n] = translated; kept++; }
        else skipped++;
    }
}

// 3. ~/.claude/.mcp.json (Claude Code standard) or settings.json mcpServers
const claudeMcp = readJson(path.join(CLAUDE_DIR, '.mcp.json'));
if (claudeMcp && claudeMcp.mcpServers) {
    for (const [n, s] of Object.entries(claudeMcp.mcpServers)) { merged[n] = s; kept++; }
}
const claudeSettings = readJson(path.join(CLAUDE_DIR, 'settings.json'));
if (claudeSettings && claudeSettings.mcpServers) {
    for (const [n, s] of Object.entries(claudeSettings.mcpServers)) { merged[n] = s; kept++; }
}

fs.writeFileSync(DST, JSON.stringify({ mcpServers: merged }, null, 2) + '\n');
console.log(`mcp servers written: ${Object.keys(merged).length} (sources combined; ${skipped} disabled entries skipped)`);
NODE
    ok "wrote $dst"
}

# ------------------------------ uninstall ------------------------------------

run_uninstall() {
    step "Uninstall"
    info "this will remove (after confirm):"
    info "  $CURSOR_DIR/{skills,agents,commands,rules,hooks.json,mcp.json}"
    info "backups under $BACKUP_ROOT are kept."
    if ! ask "proceed?" N; then info "aborted"; exit 0; fi

    for target in skills agents commands rules hooks.json mcp.json; do
        local p="$CURSOR_DIR/$target"
        if [ -e "$p" ]; then
            if ask "delete $p ?" Y; then
                rm -rf "$p"
                ok "removed $p"
            else
                info "kept $p"
            fi
        fi
    done

    step "Done."
}

# ------------------------------ main -----------------------------------------

while [ $# -gt 0 ]; do
    case "$1" in
        --yes|-y)     ASSUME_YES=1 ;;
        --uninstall)  DO_UNINSTALL=1 ;;
        --no-backup)  NO_BACKUP=1 ;;
        -h|--help)    print_help; exit 0 ;;
        *) err "unknown flag: $1"; print_help; exit 1 ;;
    esac
    shift
done

if [ "$DO_UNINSTALL" = "1" ]; then
    run_uninstall
    exit 0
fi

step "install-cursor.sh — port OpenCode + ClaudeCode -> ~/.cursor"
info "repo:    $REPO_DIR"
info "claude:  $CLAUDE_DIR"
info "target:  $CURSOR_DIR"
info "mode:    $([ "$ASSUME_YES" = "1" ] && echo "non-interactive" || echo "interactive")"

if [ -e "$CURSOR_DIR" ] && [ ! -d "$CURSOR_DIR" ]; then
    err "$CURSOR_DIR exists and is not a directory"; exit 1
fi
mkdir -p "$CURSOR_DIR"

check_prereqs

install_skills
install_agents
install_commands
install_rules
install_hooks
install_mcp

step "Next steps"
cat <<EOF
    1. Restart Cursor (or reload window) to pick up new files
    2. Verify in Cursor:
         Settings -> Rules, Skills, Subagents
         Settings -> Tools & MCPs
         Settings -> Hooks
    3. Re-run this script anytime to refresh from the repo + ~/.claude
    4. Uninstall:   $REPO_DIR/install-cursor.sh --uninstall

    Backups (if any) saved under: $BACKUP_ROOT
EOF
