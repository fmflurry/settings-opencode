---
name: continuous-learning
description: Automatically extract reusable patterns from OpenCode sessions and save them as learned skills for future use.
version: 1.0.0
scope: opencode
hooks:
  - Stop
---

# Continuous Learning (OpenCode Skill)

Automatically evaluates OpenCode sessions at **session end** and extracts reusable patterns into new “learned skills” for future reuse.

## When to Activate

Use this skill when you want:

- Automatic pattern extraction from OpenCode sessions
- A **Stop hook** that evaluates the just-finished session transcript
- A workflow to review/curate learned skills in:
  - `~/.config/opencode/skills/learned/`
- Tuning for extraction thresholds, categories, and auto-approval
- Comparing skill-based v1 extraction vs “instinct-based” v2 approaches

## How It Works

This skill runs as a **Stop hook** at the end of each OpenCode session:

1. **Session Evaluation**
   - Ensures the session is “worth learning from” (default: `10+` messages)
2. **Pattern Detection**
   - Scans transcript for repeated solutions, corrections, debugging flows, and conventions
3. **Skill Extraction**
   - Writes one or more skill files into:
     - `~/.config/opencode/skills/learned/`
   - Each extracted skill is:
     - Named deterministically
     - Tagged by pattern type(s)
     - Saved with a short “When to use / Steps / Examples / Caveats” template

## Learned File Naming

Learned skills are written with meaningful, descriptive names derived from the
session content rather than generic pattern categories:

- `<descriptive-slug>.draft.md` (e.g., `angular-facade-debugging.draft.md`)
- `<descriptive-slug>-2.draft.md` (counter suffix for collisions)

The slug is built from the most distinctive terms found in the session transcript.
The content also includes a `signature:` in frontmatter for deduplication.

## Files / Layout

Recommended structure:

- `~/.config/opencode/skills/continuous-learning/`
  - `skill.md` (this file)
  - `config.json`
  - `hooks/stop.sh`
  - `bin/evaluate-session.js` (or `evaluate-session.py`)

Learned output:

- `~/.config/opencode/skills/learned/*.md`

## Configuration

Edit `config.json`:

```json
{
  "min_session_length": 10,
  "extraction_threshold": "medium",
  "auto_approve": false,
  "learned_skills_path": "~/.config/opencode/skills/learned/",
  "patterns_to_detect": [
    "error_resolution",
    "user_corrections",
    "workarounds",
    "debugging_techniques",
    "project_specific"
  ],
  "ignore_patterns": ["simple_typos", "one_time_fixes", "external_api_issues"],
  "max_skills_per_session": 3,
  "dedupe_window_sessions": 20
}
```
