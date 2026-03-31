---
name: continuous-learning
description: Automatically extract high-signal draft learnings from OpenCode sessions for later curation.
version: 1.0.0
scope: opencode
hooks:
  - Stop
---

# Continuous Learning (OpenCode Skill)

Automatically evaluates OpenCode sessions at **session end** and extracts high-signal draft learnings for later review and promotion.

## When to Activate

Use this skill when you want:

- Automatic draft extraction from OpenCode sessions
- A **Stop hook** that evaluates the just-finished session transcript
- A workflow to review/curate learned drafts in:
  - `~/.config/opencode/skills/learned/*.draft.md`
  - `~/.config/opencode/skills/learned/.continuous-learning-index.json`
- Tuning for extraction thresholds and evidence requirements
- Comparing skill-based v1 extraction vs “instinct-based” v2 approaches

## How It Works

This skill runs as a **Stop hook** at the end of each OpenCode session:

1. **Session Evaluation**
   - Ensures the session is “worth learning from” (default: `20+` messages)
2. **Pattern Detection**
   - Scans transcript for repeated `user_corrections` and `project_specific` conventions
3. **Draft Extraction**
    - Writes at most one draft per session into:
      - `~/.config/opencode/skills/learned/<descriptive-slug>.draft.md`
    - Stores learning metadata in:
      - `~/.config/opencode/skills/learned/.continuous-learning-index.json`
    - Each extracted draft is:
      - Named deterministically from the inferred rule
      - Deduplicated by learned rule instead of by whole session
      - Saved with full-message evidence blocks for later curation

## Learned File Naming

Learned drafts are written with meaningful, descriptive names derived from the
session content rather than generic pattern categories:

- `<descriptive-slug>.draft.md` (e.g., `provider-proxy-openai-user-corrections.draft.md`)
- `<descriptive-slug>-2.draft.md` (counter suffix for rare collisions)

The slug is built from the most distinctive terms found in the session transcript.
The content also includes `rule_key:` and `rule_signature:` in frontmatter for deduplication.

## Files / Layout

Recommended structure:

- `~/.config/opencode/skills/continuous-learning/`
  - `skill.md` (this file)
  - `config.json`
  - `hooks/stop.sh`
  - `bin/evaluate-session.js` (or `evaluate-session.py`)

Learned output:

- `~/.config/opencode/skills/learned/<descriptive-slug>.draft.md`
- `~/.config/opencode/skills/learned/.continuous-learning-index.json`

## Configuration

Edit `config.json`:

```json
{
  "min_session_length": 20,
  "extraction_threshold": "medium",
  "auto_approve": false,
  "skills_root_path": "~/.config/opencode/skills/",
  "learned_metadata_path": "~/.config/opencode/skills/learned/",
  "patterns_to_detect": [
    "user_corrections",
    "project_specific"
  ],
  "ignore_patterns": ["simple_typos", "one_time_fixes", "external_api_issues"],
  "max_skills_per_session": 1,
  "dedupe_window_sessions": 20,
  "min_matching_messages": 2,
  "min_distinct_keywords": 2
}
```

Legacy note: `learned_skills_path` is still supported for backward compatibility.
If it points to `.../skills/learned/`, the generator still writes drafts into
`.../skills/learned/<slug>.draft.md` and keeps metadata in the same directory.

Shared setup note: if you want learned drafts shared between OpenCode and
ClaudeCode, point `skills_root_path` to `~/.claude/skills/` and
`learned_metadata_path` to `~/.claude/skills/learned/`.

## Review Workflow

Use `/curate-learned-skills` to browse drafts under `learned/` and promote the useful ones into one or more real skills.
