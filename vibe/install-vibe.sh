#!/usr/bin/env bash
#
# Mistral Vibe CLI installer — mirrors the opencode conductor setup into ~/.vibe.
#
# Maps the opencode harness onto Vibe's primitives:
#   opencode.jsonc agents      -> ~/.vibe/agents/*.toml
#   prompts/agents/*.txt       -> ~/.vibe/prompts/*.md      (system_prompt_id)
#   instructions/*.md          -> ~/.vibe/AGENTS.md         (global instructions)
#   skills/*                   -> ~/.vibe/skills/*          (Agent Skills spec)
#   opencode command{}         -> ~/.vibe/skills/<cmd>/SKILL.md (user-invocable)
#
# Usage:
#   ./vibe/install-vibe.sh            # install (backs up existing files)
#   VIBE_HOME=/custom ./vibe/install-vibe.sh
#
set -euo pipefail

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]:-$0}" )/.." && pwd )"
VIBE_HOME="${VIBE_HOME:-$HOME/.vibe}"
SRC="$REPO_DIR/vibe"

say()  { printf '\033[1;36m[vibe]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[vibe]\033[0m %s\n' "$*"; }

backup() { [ -e "$1" ] && cp -a "$1" "$1.bak.$(date +%s)" && warn "backed up $1"; return 0; }

mkdir -p "$VIBE_HOME/agents" "$VIBE_HOME/prompts" "$VIBE_HOME/skills"

# --- config.toml --------------------------------------------------------------
# Non-destructive: Vibe generates a rich config.toml on first launch (providers,
# models, tool allowlists). Clobbering it loses the user's setup, so only write
# directly when none exists; otherwise drop an example to merge by hand.
if [ -f "$VIBE_HOME/config.toml" ]; then
  cp "$SRC/config.toml" "$VIBE_HOME/config.harness-example.toml"
  warn "existing config.toml kept. Merge these into it (providers/models/[tools.task]/mcp_servers):"
  warn "  $VIBE_HOME/config.harness-example.toml"
else
  cp "$SRC/config.toml" "$VIBE_HOME/config.toml"
  say "config.toml -> $VIBE_HOME/config.toml"
fi

# --- agents -------------------------------------------------------------------
cp "$SRC"/agents/*.toml "$VIBE_HOME/agents/"
say "agents -> $VIBE_HOME/agents/ ($(ls "$SRC"/agents/*.toml | wc -l | tr -d ' ') files)"

# --- prompts (.txt -> .md, name = system_prompt_id) ---------------------------
for f in "$REPO_DIR"/prompts/agents/*.txt; do
  base="$(basename "$f" .txt)"
  cp "$f" "$VIBE_HOME/prompts/$base.md"
done
say "prompts -> $VIBE_HOME/prompts/ ($(ls "$REPO_DIR"/prompts/agents/*.txt | wc -l | tr -d ' ') prompts)"

# --- AGENTS.md (global instructions, = opencode instructions[]) ---------------
backup "$VIBE_HOME/AGENTS.md"
{
  echo "# Vibe — global agent instructions"
  echo
  echo "Generated from the opencode \`instructions/\` set. Applies to every agent."
  echo
  for ins in subagent-routing question-handling codememory-first verification-gate caveman-ultra; do
    src="$REPO_DIR/instructions/$ins.md"
    [ -f "$src" ] || continue
    echo "---"
    echo
    cat "$src"
    echo
  done
} > "$VIBE_HOME/AGENTS.md"
say "AGENTS.md -> $VIBE_HOME/AGENTS.md"

# --- skills (Agent Skills spec; directly portable) ----------------------------
if [ -d "$REPO_DIR/skills" ]; then
  for d in "$REPO_DIR"/skills/*/; do
    [ -f "$d/SKILL.md" ] || continue
    name="$(basename "$d")"
    rm -rf "$VIBE_HOME/skills/$name"
    cp -a "$d" "$VIBE_HOME/skills/$name"
  done
  say "skills -> $VIBE_HOME/skills/"
fi

# --- command skills (opencode command{} -> user-invocable Vibe slash skills) --
# Format: "<slash-name>:<delegate-agent-or-empty>:<commands/file.md>"
COMMAND_SKILLS=(
  "git:git-specialist:git.md"
  "push-changes:git-specialist:push-changes.md"
  "plan:planner:plan.md"
  "tdd:tdd-guide:tdd.md"
  "code-review:code-reviewer:code-review.md"
  "cop-review:merge-cop:cop-review.md"
  "security:security-reviewer:security.md"
  "build-fix:build-error-resolver:build-fix.md"
  "e2e:e2e-runner:e2e.md"
  "refactor-clean:refactor-cleaner:refactor-clean.md"
  "orchestrate:planner:orchestrate.md"
  "update-docs:doc-updater:update-docs.md"
  "update-codemaps:doc-updater:update-codemaps.md"
  "test-coverage:tdd-guide:test-coverage.md"
  "learn::learn.md"
  "checkpoint::checkpoint.md"
  "verify::verify.md"
  "eval::eval.md"
  "skill-create::skill-create.md"
)

# Vibe skills follow the Agent Skills spec: the SKILL.md body is injected
# verbatim as a user message to the active agent (the conductor). So unlike
# opencode commands, there is NO `$ARGUMENTS` substitution and the opencode
# frontmatter (`agent:`/`subtask:`) is meaningless here. We therefore:
#   - lift the real `description` out of the source frontmatter (shown in the
#     slash-command picker AND used by the model to judge relevance),
#   - strip that source frontmatter from the injected body,
#   - neutralise the literal `$ARGUMENTS` token (Vibe never expands it),
#   - emit a spec-valid `allowed-tools` YAML list,
#   - and, for delegating commands, instruct the conductor to build the task
#     brief from the FULL workflow it now has in context — not a placeholder.
strip_frontmatter() {
  awk '
    NR==1 && $0=="---" { infm=1; next }
    infm && $0=="---"  { infm=0; next }
    !infm              { print }
  ' "$1" | sed 's/\$ARGUMENTS/(any extra instructions you included with this command)/g'
}
extract_description() {
  awk '
    NR==1 && $0=="---" { infm=1; next }
    infm && $0=="---"  { exit }
    infm && /^description:/ { sub(/^description:[[:space:]]*/,""); print; exit }
  ' "$1"
}

gen=0
for entry in "${COMMAND_SKILLS[@]}"; do
  name="${entry%%:*}"; rest="${entry#*:}"
  agent="${rest%%:*}"; file="${rest#*:}"
  body_src="$REPO_DIR/commands/$file"
  [ -f "$body_src" ] || { warn "skip /$name — missing commands/$file"; continue; }

  desc="$(extract_description "$body_src")"
  [ -n "$desc" ] || desc="$name command (ported from the opencode harness)"

  dir="$VIBE_HOME/skills/cmd-$name"
  mkdir -p "$dir"
  {
    echo "---"
    echo "name: $name"
    echo "description: $desc"
    echo "user-invocable: true"
    echo "allowed-tools: [task, read_file, grep, glob, bash]"
    echo "---"
    echo
    if [ -n "$agent" ]; then
      echo "Route this request to the \`$agent\` subagent via the \`task\` tool."
      echo "Build the task brief from the COMPLETE workflow below — pass the real"
      echo "requirements, never a summary or a placeholder. Do the work only through"
      echo "the subagent, then relay its result. If you added extra instructions"
      echo "alongside the command, fold them into the brief."
      echo
    fi
    strip_frontmatter "$body_src"
  } > "$dir/SKILL.md"
  gen=$((gen+1))
done
say "command skills -> $VIBE_HOME/skills/cmd-* ($gen generated)"

echo
say "Done. ~/.vibe is provisioned."
echo
warn "Before first run:"
echo "  1. export MISTRAL_API_KEY=...   (or run: vibe --setup)"
echo "  2. code-memory MCP needs 'uvx' (uv) on PATH."
echo "  3. Verify the code-memory tool prefix with /mcp inside vibe; if tools are"
echo "     named 'code_memory_*' instead of 'code-memory_*', update enabled_tools"
echo "     in ~/.vibe/agents/*.toml accordingly."
echo "  4. Plugins (instinct learning, worktree, caveman TUI, auto-compact) are"
echo "     opencode-only and were NOT ported — Vibe has no equivalent plugin runtime."
