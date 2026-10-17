import fs from 'node:fs';
import path from 'node:path';

// Case-sensitive on purpose: "high-level", "low-latency", "reasoning_effort high",
// and model slugs such as grok-4.7-high are not review severities.
const REVIEW_SEVERITY = /\b(CRITICAL|HIGH|MEDIUM|LOW)\b/g;

export const SOURCE_ROOTS = [
  '.claude/agents',
  '.claude/commands',
  '.claude/rules',
  '.claude/skills',
  'skills',
  'prompts',
  'instructions',
  'commands',
  'contexts',
  'tools',
  'README.md',
  'opencode.jsonc',
  'plugins/fmflurry-harness',
];

const TEXT_EXT = new Set(['.md', '.txt', '.py', '.ts', '.mjs', '.json', '.jsonc', '.mdc', '.sh']);

// Whole-file exceptions: business risk scales, not review finding tags.
const ALLOW_FILE = [
  /(^|\/)gdpr-specialist\.(md|txt)$/,
  /(^|\/)gdpr-compliance\//,
  /(^|\/)gdpr-review\.md$/,
  /(^|\/)postgres-dba\.(md|txt)$/,
  /(^|\/)postgres-backup-restore\//,
  /(^|\/)postgres-container-ops\//,
  /(^|\/)postgres-health-check\//,
  /(^|\/)db-backup-check\.md$/,
  /(^|\/)db-health\.md$/,
];

export function reviewSeverityWords(line) {
  return [...line.matchAll(REVIEW_SEVERITY)].map((match) => match[1]);
}

export function isAllowedReviewSeverity(rel, line) {
  const norm = String(rel).replaceAll('\\', '/');
  if (ALLOW_FILE.some((re) => re.test(norm))) return true;
  // /plan risk buckets. A review-severity CRITICAL on this command is not a risk level.
  if (/(^|\/)plan\.md$/.test(norm)) return !/\bCRITICAL\b/.test(line);
  // External scanner levels (npm audit, dotnet vulnerable packages, CVE ratings).
  if (/\bnpm audit\b|\baudit-level\b|\bdotnet list package\b|\bCVEs?\b/.test(line)) return true;
  // Overall risk rating on the security report, not a finding tag.
  if (/^\s*- \*\*Risk Level:\*\* HIGH \/ MEDIUM \/ LOW\s*$/.test(line)) return true;
  return false;
}

function scanFile(root, file, hits) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const words = reviewSeverityWords(lines[i]);
    if (words.length === 0 || isAllowedReviewSeverity(rel, lines[i])) continue;
    hits.push({ file: rel, line: i + 1, word: words.join(','), text: lines[i].trim() });
  }
}

function walk(root, dir, hits) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, abs, hits);
    else if (entry.isFile() && TEXT_EXT.has(path.extname(entry.name))) scanFile(root, abs, hits);
  }
}

export function scanReviewSeverities(root) {
  const hits = [];
  for (const relRoot of SOURCE_ROOTS) {
    const abs = path.join(root, relRoot);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) walk(root, abs, hits);
    else scanFile(root, abs, hits);
  }
  return hits;
}
