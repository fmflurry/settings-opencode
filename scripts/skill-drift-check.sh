#!/usr/bin/env bash
#
# skill-drift-check.sh — READ-ONLY drift detector for duplicated skill copies.
#
# WHY
#   OpenCode resolves duplicated skill names NON-DETERMINISTICALLY across copy
#   roots (repo .claude/skills, repo .opencode/skills, ~/.config/opencode/skills,
#   ~/.claude/skills): last-writer-wins, with no config able to pin a winner.
#   A skill present in more than one root with divergent content therefore means
#   different sessions silently load different doctrine. This script makes that
#   drift visible and gate-able.
#
# WHAT
#   Walks every configured skills root, hashes every file under each skill
#   directory (shasum -a 256), and compares the copies of the same skill name
#   across roots.  Prints a per-skill drift table plus a unified diff for each
#   diverging copy, then exits non-zero when any duplicated skill differs
#   (different content, missing file, or extra file).
#
#   A skill that exists in only ONE root is not drift — it is reported only in
#   the summary count.
#
# USAGE
#   skill-drift-check.sh [-q|--quiet] [REPO_DIR]
#
#   REPO_DIR   Optional project root.  When given (positional or via the
#              REPO_DIR env var) its .claude/skills and .opencode/skills trees
#              are added as additional roots.
#   -q         Quiet: print the table + summary, skip the per-drift diffs.
#   -h         Show this help.
#
# ROOTS (in order; only existing dirs participate)
#   0  $SETTINGS_DIR/skills            canonical root, wins on conflict
#   1  $SETTINGS_DIR/.claude/skills    secondary
#   2  $OPENCODE_HOME/skills           live OpenCode install
#   3  $CLAUDE_HOME/skills             live Claude Code install
#   4  $REPO_DIR/.claude/skills        project tree (when REPO_DIR is given)
#   5  $REPO_DIR/.opencode/skills      project tree (when REPO_DIR is given)
#
# ENV OVERRIDES
#   SETTINGS_DIR  default: parent of this script's directory
#   OPENCODE_HOME default: $HOME/.config/opencode
#   CLAUDE_HOME   default: $HOME/.claude
#   REPO_DIR      default: empty (project roots not included)
#   SKILL_DRIFT_INCLUDE_RUNTIME=1  also hash runtime dirs (skill-creator/),
#                                  otherwise they are skipped like sync-skills.sh
#
# EXIT
#   0  no drift among duplicated skills
#   1  drift detected
#   2  usage / configuration error
#
# READ-ONLY
#   This script never writes, copies, moves, or deletes anything under the
#   scanned roots.  It only uses a transient mktemp -d workspace, removed on exit.
#
set -o pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]:-$0}" )" && pwd )"
SETTINGS_DIR="${SETTINGS_DIR:-$( cd "$SCRIPT_DIR/.." && pwd )}"
OPENCODE_HOME="${OPENCODE_HOME:-$HOME/.config/opencode}"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"

QUIET=0
REPO_ARG=""
for arg in "$@"; do
    case "$arg" in
        -q|--quiet) QUIET=1 ;;
        -h|--help)
            sed -n '2,55p' "${BASH_SOURCE[0]:-$0}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        --*)
            printf 'skill-drift-check: unknown option: %s\n' "$arg" >&2
            exit 2
            ;;
        *)
            if [ -n "$REPO_ARG" ]; then
                printf 'skill-drift-check: unexpected extra argument: %s\n' "$arg" >&2
                exit 2
            fi
            REPO_ARG="$arg"
            ;;
    esac
done
REPO_DIR="${REPO_ARG:-${REPO_DIR:-}}"

# ------------------------------ roots ----------------------------------------

ROOT_LABELS=()
ROOT_PATHS=()

add_root() {
    local label="$1" path="$2"
    if [ -d "$path" ]; then
        ROOT_LABELS+=("$label")
        ROOT_PATHS+=("$path")
    else
        printf 'skill-drift-check: skipping missing root: %s (%s)\n' "$label" "$path" >&2
    fi
}

add_root "settings/skills"          "$SETTINGS_DIR/skills"
add_root "settings/.claude/skills"  "$SETTINGS_DIR/.claude/skills"
add_root "opencode/skills"          "$OPENCODE_HOME/skills"
add_root "claude/skills"            "$CLAUDE_HOME/skills"
if [ -n "$REPO_DIR" ]; then
    add_root "repo/.claude/skills"   "$REPO_DIR/.claude/skills"
    add_root "repo/.opencode/skills" "$REPO_DIR/.opencode/skills"
fi

if [ "${#ROOT_PATHS[@]}" -eq 0 ]; then
    printf 'skill-drift-check: no skills root found — nothing to check\n' >&2
    exit 2
fi

# ------------------------------ workspace ------------------------------------

TMP="$(mktemp -d "${TMPDIR:-/tmp}/skill-drift-check.XXXXXX")"
# shellcheck disable=SC2329  # invoked indirectly by the trap below
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT HUP INT TERM

: > "$TMP/skills.all"

# Files that are never meaningful skill content.
find_file_filter='-name .DS_Store -o -name .git -o -name node_modules'

EXCLUDE_SKILLS=" "
if [ "${SKILL_DRIFT_INCLUDE_RUNTIME:-0}" != "1" ]; then
    # Mirrors sync-skills.sh: plugin-regenerated, not a committed skill.
    EXCLUDE_SKILLS=" skill-creator "
fi

# ------------------------------ collect --------------------------------------

i=0
while [ "$i" -lt "${#ROOT_PATHS[@]}" ]; do
    root="${ROOT_PATHS[$i]}"
    mkdir -p "$TMP/m/$i"
    for skill_dir in "$root"/*/; do
        [ -d "$skill_dir" ] || continue
        skill="$(basename "$skill_dir")"
        case "$EXCLUDE_SKILLS" in *" $skill "*) continue ;; esac
        manifest="$TMP/m/$i/$skill"
        : > "$manifest"
        (
            cd "$skill_dir" || exit 0
            # shellcheck disable=SC2086  # $find_file_filter must word-split into find args
            find . -type f ! \( $find_file_filter \) \
                ! -path './.git/*' ! -path '*/node_modules/*' \
            | LC_ALL=C sort \
            | while IFS= read -r f; do
                hash="$(shasum -a 256 "$f" | cut -d' ' -f1)"
                printf '%s  %s\n' "$hash" "${f#./}"
              done
        ) >> "$manifest"
        printf '%s\n' "$skill" >> "$TMP/skills.all"
    done
    i=$((i + 1))
done

LC_ALL=C sort -u "$TMP/skills.all" > "$TMP/skills.txt"

# ------------------------------ report ---------------------------------------

printf '== skill-drift-check (read-only) ==\n'
i=0
while [ "$i" -lt "${#ROOT_PATHS[@]}" ]; do
    printf '   [%d] %-24s %s\n' "$i" "${ROOT_LABELS[$i]}" "${ROOT_PATHS[$i]}"
    i=$((i + 1))
done
printf '\n%-40s %6s  %-12s %s\n' 'SKILL' 'COPIES' 'ROOTS' 'STATUS'
printf -- '%.0s-' $(seq 1 78); printf '\n'

duplicated=0
ok=0
drift=0
single=0

while IFS= read -r skill; do
    [ -n "$skill" ] || continue
    copies=0
    roots_with=""
    i=0
    while [ "$i" -lt "${#ROOT_PATHS[@]}" ]; do
        if [ -f "$TMP/m/$i/$skill" ]; then
            copies=$((copies + 1))
            roots_with="${roots_with}[$i] "
        fi
        i=$((i + 1))
    done
    if [ "$copies" -eq 1 ]; then
        single=$((single + 1))
        continue
    fi

    duplicated=$((duplicated + 1))
    ref_root=""
    ref_digest=""
    status=OK
    i=0
    while [ "$i" -lt "${#ROOT_PATHS[@]}" ]; do
        if [ -f "$TMP/m/$i/$skill" ]; then
            digest="$(shasum -a 256 "$TMP/m/$i/$skill" | cut -d' ' -f1)"
            if [ -z "$ref_digest" ]; then
                ref_digest="$digest"
                ref_root="$i"
            elif [ "$digest" != "$ref_digest" ]; then
                status=DRIFT
            fi
        fi
        i=$((i + 1))
    done

    printf '%-40s %6s  %-12s %s\n' "$skill" "$copies" "$roots_with" "$status"

    if [ "$status" = "DRIFT" ]; then
        drift=$((drift + 1))
        if [ "$QUIET" -eq 0 ]; then
            i=0
            while [ "$i" -lt "${#ROOT_PATHS[@]}" ]; do
                if [ -f "$TMP/m/$i/$skill" ] && [ "$i" != "$ref_root" ]; then
                    if ! diff -q "$TMP/m/$ref_root/$skill" "$TMP/m/$i/$skill" >/dev/null 2>&1; then
                        printf '    [%d] %s  vs  [%d] %s\n' \
                            "$ref_root" "${ROOT_LABELS[$ref_root]}" "$i" "${ROOT_LABELS[$i]}"
                        diff -u "$TMP/m/$ref_root/$skill" "$TMP/m/$i/$skill" \
                            | sed -n '3,14p' | sed 's/^/      /'
                    fi
                fi
                i=$((i + 1))
            done
        fi
    else
        ok=$((ok + 1))
    fi
done < "$TMP/skills.txt"

printf -- '%.0s-' $(seq 1 78); printf '\n'
printf 'Duplicated skills: %d  (OK: %d, DRIFT: %d)  |  single-root skills: %d\n' \
    "$duplicated" "$ok" "$drift" "$single"

if [ "$drift" -gt 0 ]; then
    printf 'RESULT: DRIFT detected (%d skill(s)) — copies must be reconciled.\n' "$drift"
    exit 1
fi
printf 'RESULT: no drift among duplicated skills.\n'
exit 0
