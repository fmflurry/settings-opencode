#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const DEFAULT_CONFIG = {
  min_session_length: 10,
  extraction_threshold: "medium",
  auto_approve: false,
  learned_skills_path: "~/.config/opencode/skills/learned/",
  patterns_to_detect: [
    "error_resolution",
    "user_corrections",
    "workarounds",
    "debugging_techniques",
    "project_specific",
  ],
  ignore_patterns: ["simple_typos", "one_time_fixes", "external_api_issues"],
  max_skills_per_session: 3,
  dedupe_window_sessions: 20,
};

const PATTERN_DEFS = {
  error_resolution: {
    title: "Error Resolution Pattern",
    tags: ["error-resolution", "stability"],
    keywords: [
      "error",
      "stack trace",
      "exception",
      "fix",
      "failing test",
      "regression",
      "diagnose",
      "repro",
      "root cause",
    ],
    steps: [
      "Capture the exact failure and affected scope.",
      "Identify the smallest reproducible scenario.",
      "Patch the root cause, then verify with targeted tests.",
      "Document guardrails to avoid recurrence.",
    ],
    caveats: [
      "Do not overfit to a single failing example if broader behavior differs.",
      "Avoid masking failures with broad catch-all handlers.",
    ],
  },
  user_corrections: {
    title: "User Correction Integration Pattern",
    tags: ["feedback-loop", "alignment"],
    keywords: [
      "correction",
      "actually",
      "instead",
      "prefer",
      "should be",
      "not this",
      "adjust",
      "revise",
      "change direction",
    ],
    steps: [
      "Extract the correction as a concrete rule.",
      "Apply the rule to current work and nearby decisions.",
      "Re-validate outputs against updated expectations.",
      "Capture the correction in reusable guidance.",
    ],
    caveats: [
      "Do not partially apply corrections; update all relevant touchpoints.",
      "If corrections conflict, prefer latest explicit user instruction.",
    ],
  },
  workarounds: {
    title: "Safe Workaround Pattern",
    tags: ["workaround", "delivery"],
    keywords: [
      "workaround",
      "temporary",
      "fallback",
      "mitigate",
      "unblock",
      "compatibility",
      "hotfix",
      "short-term",
    ],
    steps: [
      "Confirm the blocker and expected business impact.",
      "Implement the smallest safe workaround behind clear boundaries.",
      "Add validation or tests proving no regression in core paths.",
      "Record follow-up to remove workaround when root fix is ready.",
    ],
    caveats: [
      "Workarounds must be explicit and easy to remove.",
      "Avoid introducing hidden behavioral differences without documentation.",
    ],
  },
  debugging_techniques: {
    title: "Structured Debugging Pattern",
    tags: ["debugging", "analysis"],
    keywords: [
      "debug",
      "investigate",
      "inspect",
      "log",
      "trace",
      "breakpoint",
      "reproduce",
      "isolate",
      "hypothesis",
      "verify",
    ],
    steps: [
      "Form one hypothesis at a time from observable symptoms.",
      "Instrument selectively (logs, runtime values, targeted reads).",
      "Narrow scope until one causative change is identified.",
      "Validate fix with focused and then broader checks.",
    ],
    caveats: [
      "Avoid noisy instrumentation that obscures signal.",
      "Prefer deterministic repro over probabilistic assumptions.",
    ],
  },
  project_specific: {
    title: "Project-Specific Convention Pattern",
    tags: ["project-conventions", "consistency"],
    keywords: [
      "convention",
      "guideline",
      "architecture",
      "facade",
      "use case",
      "lint",
      "naming",
      "translation",
      "design system",
      "token",
    ],
    steps: [
      "Identify recurring project conventions applied during the session.",
      "Translate each convention into a simple decision checklist.",
      "Show one concrete example from this session.",
      "List anti-patterns that should be rejected in future work.",
    ],
    caveats: [
      "Conventions evolve; revalidate periodically against source docs.",
      "Do not generalize project-specific rules to unrelated repositories.",
    ],
  },
};

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key.startsWith("--")) {
      args[key.slice(2)] = value;
      i += 1;
    }
  }
  return args;
}

function expandHome(input) {
  if (!input) {
    return input;
  }
  if (input === "~") {
    return process.env.HOME || input;
  }
  if (input.startsWith("~/")) {
    return path.join(process.env.HOME || "", input.slice(2));
  }
  return input;
}

function slugifyAscii(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pickLearnedFileName({ learnedRoot, baseName, extension }) {
  const normalizedBase = slugifyAscii(baseName);
  const initial = `${normalizedBase}${extension}`;
  const initialPath = path.join(learnedRoot, initial);
  if (!(await fileExists(initialPath))) {
    return initial;
  }

  let counter = 2;
  // Avoid unbounded loops; we will never hit this in practice.
  while (counter < 1000) {
    const candidate = `${normalizedBase}-${counter}${extension}`;
    const candidatePath = path.join(learnedRoot, candidate);
    if (!(await fileExists(candidatePath))) {
      return candidate;
    }
    counter += 1;
  }

  throw new Error("Unable to pick a unique learned skill filename");
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function resolveOpencodeDataRoot() {
  const home = process.env.HOME || "";
  const xdgDataHome = process.env.XDG_DATA_HOME || "";

  if (xdgDataHome) {
    return path.join(xdgDataHome, "opencode");
  }

  if (home) {
    return path.join(home, ".local", "share", "opencode");
  }

  return "";
}

function isSafeSessionId(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  if (!value.startsWith("ses_")) {
    return false;
  }

  if (value.includes('"') || value.includes("'") || value.includes(";")) {
    return false;
  }

  return /^[A-Za-z0-9_]+$/.test(value);
}

function sqliteJsonQuery(dbPath, sql) {
  if (!dbPath || typeof dbPath !== "string") {
    return [];
  }
  if (!sql || typeof sql !== "string") {
    return [];
  }

  try {
    const result = spawnSync("sqlite3", ["-cmd", ".mode json", dbPath, sql], {
      encoding: "utf8",
    });

    if (!result || typeof result.status !== "number" || result.status !== 0) {
      return [];
    }

    const stdout = (result.stdout || "").trim();
    if (!stdout) {
      return [];
    }

    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildTranscriptFromOpencodeSqlite(sessionId) {
  if (!isSafeSessionId(sessionId)) {
    return "";
  }

  const dataRoot = resolveOpencodeDataRoot();
  if (!dataRoot) {
    return "";
  }

  const dbPath = path.join(dataRoot, "opencode.db");

  const messageRows = sqliteJsonQuery(
    dbPath,
    `SELECT id, data FROM message WHERE session_id='${sessionId}' ORDER BY time_created ASC;`,
  );

  if (messageRows.length === 0) {
    return "";
  }

  const partRows = sqliteJsonQuery(
    dbPath,
    `SELECT message_id, data FROM part WHERE session_id='${sessionId}' ORDER BY time_created ASC;`,
  );

  const partsByMessageID = new Map();
  for (const row of partRows) {
    if (!row || typeof row !== "object") continue;
    const messageID = row.message_id;
    const data = row.data;
    if (typeof messageID !== "string" || messageID.length === 0) continue;
    if (typeof data !== "string" || data.length === 0) continue;

    let part;
    try {
      part = JSON.parse(data);
    } catch {
      part = undefined;
    }

    if (!part || typeof part !== "object") continue;

    const existing = partsByMessageID.get(messageID);
    if (Array.isArray(existing)) {
      existing.push(part);
    } else {
      partsByMessageID.set(messageID, [part]);
    }
  }

  const transcript = [];

  for (const row of messageRows) {
    if (!row || typeof row !== "object") continue;
    const messageID = row.id;
    const data = row.data;
    if (typeof messageID !== "string" || messageID.length === 0) continue;
    if (typeof data !== "string" || data.length === 0) continue;

    let message;
    try {
      message = JSON.parse(data);
    } catch {
      message = undefined;
    }

    if (!message || typeof message !== "object") continue;

    const role = typeof message.role === "string" ? message.role : "message";
    const parts = partsByMessageID.get(messageID);
    const content = Array.isArray(parts)
      ? parts
          .filter(
            (part) => part && typeof part === "object" && part.type === "text",
          )
          .map((part) =>
            typeof part.text === "string" ? part.text.trim() : "",
          )
          .filter((value) => value.length > 0)
          .join("\n\n")
      : "";

    transcript.push({ role, content });
  }

  return JSON.stringify(transcript);
}

async function listJsonFilePaths(directoryPath) {
  try {
    const entries = await fs.readdir(directoryPath);
    return entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(directoryPath, name));
  } catch {
    return [];
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function partSortKey(part) {
  if (!part || typeof part !== "object") {
    return 0;
  }

  const time = part.time;
  if (time && typeof time === "object") {
    if (typeof time.start === "number") return time.start;
    if (typeof time.created === "number") return time.created;
  }

  return 0;
}

function renderPartToText(part) {
  if (!part || typeof part !== "object") {
    return "";
  }

  if (part.type === "text" && typeof part.text === "string") {
    return part.text;
  }

  if (part.type === "tool" && typeof part.tool === "string") {
    const state = part.state;
    if (
      state &&
      typeof state === "object" &&
      typeof state.status === "string"
    ) {
      if (state.status === "completed") {
        const title = typeof state.title === "string" ? state.title : "";
        return title
          ? `[tool:${part.tool}] ${title}`
          : `[tool:${part.tool}] completed`;
      }

      if (state.status === "error") {
        const error = typeof state.error === "string" ? state.error : "";
        return error
          ? `[tool:${part.tool}] error: ${error}`
          : `[tool:${part.tool}] error`;
      }

      if (state.status === "running") {
        return `[tool:${part.tool}] running`;
      }

      if (state.status === "pending") {
        return `[tool:${part.tool}] pending`;
      }
    }

    return `[tool:${part.tool}]`;
  }

  return "";
}

async function buildTranscriptFromOpencodeStorage(sessionId) {
  if (!sessionId) {
    return "";
  }

  const sqliteTranscript = buildTranscriptFromOpencodeSqlite(sessionId);
  if (sqliteTranscript) {
    return sqliteTranscript;
  }

  const dataRoot = resolveOpencodeDataRoot();
  if (!dataRoot) {
    return "";
  }

  const storageRoot = path.join(dataRoot, "storage");
  const messageRoot = path.join(storageRoot, "message", sessionId);
  const partRoot = path.join(storageRoot, "part");

  const messageFilePaths = await listJsonFilePaths(messageRoot);
  if (messageFilePaths.length === 0) {
    return "";
  }

  const messages = [];
  for (const filePath of messageFilePaths) {
    try {
      const msg = await readJson(filePath);
      if (!msg || typeof msg !== "object") continue;
      if (msg.sessionID !== sessionId) continue;
      if (typeof msg.id !== "string" || typeof msg.role !== "string") continue;

      const created =
        msg.time && typeof msg.time.created === "number" ? msg.time.created : 0;
      messages.push({
        id: msg.id,
        role: msg.role,
        created,
      });
    } catch {
      // ignore unreadable message files
    }
  }

  messages.sort((a, b) => a.created - b.created);

  const transcript = [];

  for (const msg of messages) {
    const partsDir = path.join(partRoot, msg.id);
    const partFilePaths = await listJsonFilePaths(partsDir);

    const parts = [];
    for (const partPath of partFilePaths) {
      try {
        const part = await readJson(partPath);
        if (!part || typeof part !== "object") continue;
        if (part.sessionID !== sessionId) continue;
        if (part.messageID !== msg.id) continue;
        parts.push(part);
      } catch {
        // ignore unreadable part files
      }
    }

    parts.sort((a, b) => partSortKey(a) - partSortKey(b));

    const content = parts
      .map((part) => renderPartToText(part))
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0)
      .join("\n\n");

    transcript.push({
      role: msg.role,
      content,
    });
  }

  return JSON.stringify(transcript);
}

function normalizeTranscript(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  if (Array.isArray(payload)) {
    const merged = payload
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object") {
          const role = String(entry.role || "message");
          const text = String(entry.content || entry.text || "");
          return `${role}: ${text}`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return {
      text: merged,
      messageCount: payload.length,
    };
  }

  if (payload && typeof payload === "object") {
    const candidates = [
      payload.messages,
      payload.events,
      payload.transcript,
      payload.items,
    ];
    const firstArray = candidates.find(Array.isArray);
    if (firstArray) {
      const merged = firstArray
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          if (entry && typeof entry === "object") {
            const role = String(entry.role || entry.type || "message");
            const text = String(
              entry.content || entry.message || entry.text || "",
            );
            return `${role}: ${text}`;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
      return {
        text: merged,
        messageCount: firstArray.length,
      };
    }
  }

  const lines = raw.split(/\r?\n/);
  const rolePattern = /^\s*(user|assistant|system|tool)\s*[:|-]/i;
  const roleLines = lines.filter((line) => rolePattern.test(line));
  const approxMessages = roleLines.length > 0 ? roleLines.length : lines.length;

  return {
    text: raw,
    messageCount: approxMessages,
  };
}

function thresholdValue(threshold) {
  switch (String(threshold || "").toLowerCase()) {
    case "low":
      return 1;
    case "high":
      return 3;
    case "medium":
    default:
      return 2;
  }
}

function extractSessionFingerprint(text) {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function scorePattern(textLower, patternName) {
  const def = PATTERN_DEFS[patternName];
  if (!def) {
    return 0;
  }

  return def.keywords.reduce((score, keyword) => {
    return score + (textLower.includes(keyword.toLowerCase()) ? 1 : 0);
  }, 0);
}

function collectExamples(text, keywords) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const picks = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    const hit = keywords.some((keyword) =>
      lower.includes(keyword.toLowerCase()),
    );
    if (hit) {
      picks.push(line);
    }
    if (picks.length >= 2) {
      break;
    }
  }

  if (picks.length === 0) {
    return [
      "No direct excerpt available; inferred from recurring session flow.",
    ];
  }

  return picks.map((line) =>
    line.length > 160 ? `${line.slice(0, 157)}...` : line,
  );
}

/**
 * Extract a meaningful, descriptive slug from the session transcript
 * by finding the most distinctive keyword phrases that co-occur with
 * the pattern keywords. Produces names like "angular-facade-correction"
 * instead of generic "error-resolution-pattern".
 */
function deriveDescriptiveSlug(text, patternName, keywords) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Collect lines that match pattern keywords
  const matchingLines = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    const hit = keywords.some((kw) => lower.includes(kw.toLowerCase()));
    if (hit && line.length > 10 && line.length < 300) {
      matchingLines.push(lower);
    }
    if (matchingLines.length >= 20) break;
  }

  if (matchingLines.length === 0) {
    return slugifyAscii(patternName);
  }

  // Extract meaningful nouns/terms from matching lines
  // Filter out common stop words and pattern keywords themselves
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "need",
    "must",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "under",
    "again",
    "further",
    "then",
    "once",
    "here",
    "there",
    "when",
    "where",
    "why",
    "how",
    "all",
    "each",
    "every",
    "both",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "not",
    "only",
    "own",
    "same",
    "so",
    "than",
    "too",
    "very",
    "just",
    "because",
    "but",
    "and",
    "or",
    "if",
    "while",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "i",
    "you",
    "he",
    "she",
    "we",
    "they",
    "me",
    "him",
    "her",
    "us",
    "them",
    "my",
    "your",
    "his",
    "our",
    "their",
    "what",
    "which",
    "who",
    "whom",
    "user",
    "assistant",
    "message",
    "tool",
    "text",
    "file",
    "line",
    "error",
    "fix",
    "use",
    "using",
    "used",
    "also",
    "like",
    "get",
    "set",
    "new",
    "old",
    "see",
    "try",
    "run",
    "make",
    "let",
    "put",
  ]);

  const patternKwSet = new Set(keywords.map((k) => k.toLowerCase()));

  const wordFreq = new Map();
  const joined = matchingLines.join(" ");
  const words = joined.match(/[a-z][a-z0-9]{2,}/g) || [];

  for (const word of words) {
    if (stopWords.has(word) || patternKwSet.has(word)) continue;
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  }

  // Pick top 2-3 most frequent distinctive terms
  const sorted = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word);

  if (sorted.length === 0) {
    return slugifyAscii(patternName);
  }

  // Combine with a short category hint
  const categoryHint = patternName.replace(/_/g, "-");
  const descriptive = sorted.join("-");
  return slugifyAscii(`${descriptive}-${categoryHint}`);
}

function buildSkillContent({
  skillName,
  signature,
  title,
  category,
  tags,
  examples,
  steps,
  caveats,
  sessionId,
  messageCount,
  autoApprove,
}) {
  const statusLine = autoApprove ? "approved" : "review-required";
  const safeSessionId = sessionId || "unknown-session";

  const yaml = [
    "---",
    `name: ${skillName}`,
    `title: ${title}`,
    signature ? `signature: ${signature}` : null,
    "version: 1.0.0",
    "source: continuous-learning",
    `category: ${category}`,
    `status: ${statusLine}`,
    `session_id: ${safeSessionId}`,
    `message_count: ${messageCount}`,
    `tags: [${tags.join(", ")}]`,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const sectionExamples = examples.map((e) => `- ${e}`).join("\n");
  const sectionSteps = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const sectionCaveats = caveats.map((c) => `- ${c}`).join("\n");

  return [
    yaml,
    "",
    `# ${title}`,
    "",
    "## When to use",
    `Use this pattern when handling recurring ${category.replaceAll("_", " ")} workflows.`,
    "",
    "## Steps",
    sectionSteps,
    "",
    "## Examples",
    sectionExamples,
    "",
    "## Caveats",
    sectionCaveats,
    "",
  ].join("\n");
}

async function loadConfig(configPath) {
  const parsed = await readJsonFile(configPath, {});
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const configPath = args.config;

  if (!configPath) {
    process.stderr.write("Missing required --config argument\n");
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig(configPath);
  const learnedRoot = expandHome(config.learned_skills_path);
  const sessionId = args["session-id"] || process.env.OPENCODE_SESSION_ID || "";

  if (!learnedRoot) {
    process.stderr.write("Unable to resolve learned skills output path\n");
    process.exitCode = 1;
    return;
  }

  await fs.mkdir(learnedRoot, { recursive: true });

  let rawTranscript;
  const transcriptPath = args.transcript || "";
  if (transcriptPath) {
    try {
      rawTranscript = await fs.readFile(transcriptPath, "utf8");
    } catch {
      process.stdout.write(
        "Transcript file not readable; skipping extraction\n",
      );
      return;
    }
  } else if (sessionId) {
    rawTranscript = await buildTranscriptFromOpencodeStorage(sessionId);
    if (!rawTranscript) {
      process.stdout.write("No transcript available; skipping extraction\n");
      return;
    }
  } else {
    process.stdout.write("No transcript available; skipping extraction\n");
    return;
  }

  const normalized = normalizeTranscript(rawTranscript);
  if (normalized.messageCount < Number(config.min_session_length || 10)) {
    process.stdout.write(
      `Session too short (${normalized.messageCount} messages); skipping\n`,
    );
    return;
  }

  const textLower = normalized.text.toLowerCase();
  const threshold = thresholdValue(config.extraction_threshold);
  const allowPatterns = new Set(config.patterns_to_detect || []);
  const ignorePatterns = new Set(config.ignore_patterns || []);

  const ranked = Object.keys(PATTERN_DEFS)
    .filter((name) => allowPatterns.has(name) && !ignorePatterns.has(name))
    .map((name) => ({
      name,
      score: scorePattern(textLower, name),
    }))
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(config.max_skills_per_session || 3));

  if (ranked.length === 0) {
    process.stdout.write("No strong patterns detected; no skills generated\n");
    return;
  }

  const indexPath = path.join(learnedRoot, ".continuous-learning-index.json");
  const indexData = await readJsonFile(indexPath, {
    session_history: [],
    skill_signatures: [],
  });

  const sessionFingerprint = extractSessionFingerprint(normalized.text);
  const alreadyProcessed = (indexData.session_history || []).some(
    (entry) => entry && entry.fingerprint === sessionFingerprint,
  );

  if (alreadyProcessed) {
    process.stdout.write(
      "Session already processed; skipping duplicate extraction\n",
    );
    return;
  }

  const created = [];

  for (const item of ranked) {
    const def = PATTERN_DEFS[item.name];
    const signatureBase = `${item.name}:${sessionFingerprint}`;
    const signature = crypto
      .createHash("sha1")
      .update(signatureBase)
      .digest("hex")
      .slice(0, 12);

    const existing = (indexData.skill_signatures || []).some(
      (entry) => entry && entry.signature === signature,
    );
    if (existing) {
      continue;
    }

    const extension = config.auto_approve ? ".md" : ".draft.md";

    const descriptiveSlug = deriveDescriptiveSlug(
      normalized.text,
      item.name,
      def.keywords,
    );

    const fileName = await pickLearnedFileName({
      learnedRoot,
      baseName: descriptiveSlug,
      extension,
    });

    const skillName = path.basename(fileName, extension);
    const outputPath = path.join(learnedRoot, fileName);
    const examples = collectExamples(normalized.text, def.keywords);

    const content = buildSkillContent({
      skillName,
      signature,
      title: def.title,
      category: item.name,
      tags: def.tags,
      examples,
      steps: def.steps,
      caveats: def.caveats,
      sessionId,
      messageCount: normalized.messageCount,
      autoApprove: Boolean(config.auto_approve),
    });

    await fs.writeFile(outputPath, content, "utf8");
    created.push(outputPath);

    indexData.skill_signatures = [
      ...(indexData.skill_signatures || []),
      {
        signature,
        category: item.name,
        file: fileName,
        timestamp: new Date().toISOString(),
      },
    ];
  }

  indexData.session_history = [
    ...(indexData.session_history || []),
    {
      fingerprint: sessionFingerprint,
      session_id: sessionId || null,
      timestamp: new Date().toISOString(),
      generated: created.map((file) => path.basename(file)),
    },
  ];

  const dedupeWindow = Number(config.dedupe_window_sessions || 20);
  if (Number.isFinite(dedupeWindow) && dedupeWindow > 0) {
    indexData.session_history = indexData.session_history.slice(-dedupeWindow);
    indexData.skill_signatures = indexData.skill_signatures.slice(
      -dedupeWindow * 3,
    );
  }

  await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2), "utf8");

  if (created.length === 0) {
    process.stdout.write("Patterns detected but all were deduplicated\n");
    return;
  }

  process.stdout.write(
    `Generated ${created.length} learned skill(s):\n${created.join("\n")}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`continuous-learning failed: ${message}\n`);
  process.exitCode = 1;
});
