#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const DEFAULT_CONFIG = {
  min_session_length: 20,
  extraction_threshold: "medium",
  auto_approve: false,
  skills_root_path: "",
  learned_metadata_path: "",
  learned_skills_path: "~/.config/opencode/skills/learned/",
  patterns_to_detect: ["user_corrections", "project_specific"],
  ignore_patterns: ["simple_typos", "one_time_fixes", "external_api_issues"],
  max_skills_per_session: 1,
  dedupe_window_sessions: 20,
  min_matching_messages: 2,
  min_distinct_keywords: 2,
};

const ALLOWED_PATTERN_NAMES = new Set(["user_corrections", "project_specific"]);

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

function trimTrailingSeparators(input) {
  const value = String(input || "");
  if (!value) {
    return value;
  }

  return value.replace(/[\\/]+$/, "") || value;
}

function resolveLearnedStoragePaths(config) {
  const explicitSkillsRoot = trimTrailingSeparators(
    expandHome(config.skills_root_path || ""),
  );
  const explicitMetadataRoot = trimTrailingSeparators(
    expandHome(config.learned_metadata_path || ""),
  );
  const legacyLearnedRoot = trimTrailingSeparators(
    expandHome(config.learned_skills_path || ""),
  );

  if (explicitSkillsRoot) {
    return {
      skillsRoot: explicitSkillsRoot,
      learnedMetadataRoot:
        explicitMetadataRoot || path.join(explicitSkillsRoot, "learned"),
    };
  }

  if (!legacyLearnedRoot) {
    return {
      skillsRoot: "",
      learnedMetadataRoot: "",
    };
  }

  if (path.basename(legacyLearnedRoot) === "learned") {
    return {
      skillsRoot: path.dirname(legacyLearnedRoot),
      learnedMetadataRoot: legacyLearnedRoot,
    };
  }

  return {
    skillsRoot: legacyLearnedRoot,
    learnedMetadataRoot: path.join(legacyLearnedRoot, "learned"),
  };
}

async function pickLearnedDraftFileName({ learnedMetadataRoot, baseName }) {
  const normalizedBase = slugifyAscii(baseName);
  const initial = `${normalizedBase || "learned-skill"}.draft.md`;
  const initialFilePath = path.join(learnedMetadataRoot, initial);
  if (!(await fileExists(initialFilePath))) {
    return initial;
  }

  let counter = 2;
  // Avoid unbounded loops; we will never hit this in practice.
  while (counter < 1000) {
    const candidate = `${normalizedBase || "learned-skill"}-${counter}.draft.md`;
    const candidateFilePath = path.join(learnedMetadataRoot, candidate);
    if (!(await fileExists(candidateFilePath))) {
      return candidate;
    }
    counter += 1;
  }

  throw new Error("Unable to pick a unique learned draft file");
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

function normalizeMessage(role, content) {
  const normalizedRole = String(role || "message").trim() || "message";
  const normalizedContent = String(content || "")
    .replace(/\r\n/g, "\n")
    .trim();

  return {
    role: normalizedRole,
    content: normalizedContent,
  };
}

function entryToMessage(entry) {
  if (typeof entry === "string") {
    return normalizeMessage("message", entry);
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const role = String(entry.role || entry.type || "message");
  const content = String(entry.content || entry.message || entry.text || "");
  return normalizeMessage(role, content);
}

function parseRoleDelimitedTranscript(raw) {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const rolePattern = /^\s*(user|assistant|system|tool|commentary)\s*[:|-]\s*(.*)$/i;
  const messages = [];
  let currentRole = "message";
  let currentLines = [];

  function pushCurrentMessage() {
    if (currentLines.length === 0) {
      return;
    }

    const message = normalizeMessage(currentRole, currentLines.join("\n"));
    if (message.content) {
      messages.push(message);
    }
    currentLines = [];
  }

  for (const line of lines) {
    const match = line.match(rolePattern);
    if (match) {
      pushCurrentMessage();
      currentRole = match[1].toLowerCase();
      currentLines = [match[2]];
      continue;
    }

    currentLines.push(line);
  }

  pushCurrentMessage();
  return messages;
}

function parsePlainTextTranscript(raw) {
  const normalizedRaw = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!normalizedRaw) {
    return [];
  }

  const paragraphBlocks = normalizedRaw
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  const blocks =
    paragraphBlocks.length > 1
      ? paragraphBlocks
      : normalizedRaw
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);

  return blocks.map((block) => normalizeMessage("message", block));
}

function normalizeTranscript(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  let messages = [];

  if (Array.isArray(payload)) {
    messages = payload.map((entry) => entryToMessage(entry)).filter(Boolean);
  } else if (payload && typeof payload === "object") {
    const candidates = [
      payload.messages,
      payload.events,
      payload.transcript,
      payload.items,
    ];
    const firstArray = candidates.find(Array.isArray);
    if (firstArray) {
      messages = firstArray.map((entry) => entryToMessage(entry)).filter(Boolean);
    }
  }

  if (messages.length === 0) {
    messages = parseRoleDelimitedTranscript(raw);
  }

  if (messages.length === 0) {
    messages = parsePlainTextTranscript(raw);
  }

  if (messages.length === 0) {
    messages = [normalizeMessage("message", raw)].filter(
      (message) => message.content.length > 0,
    );
  }

  const text = messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n\n");

  return {
    text,
    messages,
    messageCount: messages.length,
  };
}

function thresholdValue(threshold) {
  switch (String(threshold || "").toLowerCase()) {
    case "low":
      return 4;
    case "high":
      return 10;
    case "medium":
    default:
      return 7;
  }
}

function extractSessionFingerprint(text) {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function scorePatternAnalysis(messages, patternName) {
  const def = PATTERN_DEFS[patternName];
  if (!def) {
    return {
      patternName,
      score: 0,
      matchingMessages: [],
      distinctKeywordHits: [],
      userMatchCount: 0,
    };
  }

  const distinctKeywordHits = new Set();
  const matchingMessages = [];
  let userMatchCount = 0;

  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }

    const content = String(message.content || "");
    const lower = content.toLowerCase();
    const hits = def.keywords.filter((keyword) =>
      lower.includes(keyword.toLowerCase()),
    );

    if (hits.length === 0) {
      continue;
    }

    for (const hit of hits) {
      distinctKeywordHits.add(hit.toLowerCase());
    }

    if (String(message.role || "").toLowerCase() === "user") {
      userMatchCount += 1;
    }

    matchingMessages.push({
      role: String(message.role || "message"),
      content,
      keywordHits: hits,
    });
  }

  return {
    patternName,
    score: matchingMessages.length * 2 + distinctKeywordHits.size,
    matchingMessages,
    distinctKeywordHits: [...distinctKeywordHits],
    userMatchCount,
  };
}

/**
 * Extract a meaningful, descriptive slug from the session transcript
 * by finding the most distinctive keyword phrases that co-occur with
 * the pattern keywords. Produces names like "angular-facade-correction"
 * instead of generic "error-resolution-pattern".
 */
function deriveDescriptiveSlug(matchingMessages, patternName, keywords) {
  const matchingTexts = matchingMessages
    .map((message) => redactSensitiveText(String(message.content || "")).toLowerCase())
    .filter(Boolean);

  if (matchingTexts.length === 0) {
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
    "apikey",
    "authorization",
    "bearer",
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
    "redacted",
    "redacted_api_key",
    "redacted_token",
  ]);

  const patternKwSet = new Set(keywords.map((k) => k.toLowerCase()));

  const wordFreq = new Map();
  const joined = matchingTexts.join(" ");
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

function pickEvidenceMessages(matchingMessages) {
  if (!Array.isArray(matchingMessages) || matchingMessages.length === 0) {
    return [];
  }

  return matchingMessages.slice(0, 3).map((message) => ({
    role: String(message.role || "message"),
    content: redactSensitiveText(String(message.content || "").trim()),
  }));
}

function redactSensitiveText(text) {
  return String(text || "")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED_API_KEY]")
    .replace(/(Authorization\s*:\s*Bearer\s+)[^\s]+/gi, "$1[REDACTED_TOKEN]")
    .replace(
      /((?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?)[^\s"']+(["']?)/gi,
      "$1[REDACTED]$2",
    );
}

function buildRuleKey(patternName, descriptiveSlug) {
  const normalizedDescriptor = slugifyAscii(descriptiveSlug || patternName);
  const normalizedPattern = slugifyAscii(patternName);

  if (
    normalizedDescriptor === normalizedPattern ||
    normalizedDescriptor.endsWith(`-${normalizedPattern}`)
  ) {
    return normalizedDescriptor;
  }

  return slugifyAscii(`${normalizedDescriptor}-${normalizedPattern}`);
}

function buildRuleSignature(patternName, ruleKey) {
  return crypto
    .createHash("sha1")
    .update(`${patternName}:${ruleKey}`)
    .digest("hex")
    .slice(0, 12);
}

function extractRuleTerms(matchingMessages, keywords) {
  const ignoredWords = new Set([
    "about",
    "across",
    "apikey",
    "after",
    "again",
    "aligned",
    "apply",
    "assistant",
    "authorization",
    "bearer",
    "before",
    "built",
    "change",
    "configuration",
    "consistent",
    "content",
    "correction",
    "direction",
    "everywhere",
    "explicit",
    "keep",
    "match",
    "message",
    "naming",
    "project",
    "related",
    "response",
    "redacted",
    "redacted_api_key",
    "redacted_token",
    "revised",
    "setup",
    "shape",
    "should",
    "switch",
    "this",
    "through",
    "understood",
    "update",
    "user",
    "version",
    "will",
    "wiring",
  ]);
  const keywordSet = new Set(keywords.map((keyword) => keyword.toLowerCase()));
  const joinedText = matchingMessages
    .map((message) => redactSensitiveText(String(message.content || "")).toLowerCase())
    .join(" ");
  const words = joinedText.match(/[a-z][a-z0-9]{3,}/g) || [];
  const termFrequency = new Map();

  for (const word of words) {
    if (ignoredWords.has(word) || keywordSet.has(word)) {
      continue;
    }

    termFrequency.set(word, (termFrequency.get(word) || 0) + 1);
  }

  return [...termFrequency.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })
    .slice(0, 8)
    .map(([word]) => word);
}

function hasSimilarRule(indexData, patternName, ruleSignature, ruleTerms) {
  const existingRules = indexData.rule_signatures || [];

  for (const entry of existingRules) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    if (entry.signature === ruleSignature) {
      return true;
    }

    if (entry.category !== patternName || !Array.isArray(entry.rule_terms)) {
      continue;
    }

    const existingTerms = entry.rule_terms.filter(
      (term) => typeof term === "string" && term.length > 0,
    );
    const candidateTerms = ruleTerms.filter(
      (term) => typeof term === "string" && term.length > 0,
    );

    if (existingTerms.length === 0 || candidateTerms.length === 0) {
      continue;
    }

    const existingSet = new Set(existingTerms);
    const overlapCount = candidateTerms.filter((term) => existingSet.has(term)).length;
    const overlapRatio = overlapCount / Math.max(existingTerms.length, candidateTerms.length);

    if (overlapCount >= 3 && overlapRatio >= 0.5) {
      return true;
    }
  }

  return false;
}

function buildSkillContent({
  skillName,
  ruleKey,
  ruleSignature,
  title,
  category,
  tags,
  evidenceMessages,
  steps,
  caveats,
  sessionId,
  messageCount,
  distinctKeywordHits,
  ruleTerms,
}) {
  const safeSessionId = sessionId || "unknown-session";
  const description = `Draft extracted from recurring ${category.replaceAll("_", " ")} evidence for later curation.`;

  const yaml = [
    "---",
    `name: ${skillName}`,
    `description: ${description}`,
    `title: ${title}`,
    ruleKey ? `rule_key: ${ruleKey}` : null,
    ruleSignature ? `rule_signature: ${ruleSignature}` : null,
    "version: 1.0.0",
    "source: continuous-learning",
    `category: ${category}`,
    "status: draft",
    `session_id: ${safeSessionId}`,
    `message_count: ${messageCount}`,
    `evidence_messages: ${evidenceMessages.length}`,
    `distinct_keyword_hits: ${distinctKeywordHits.length}`,
    `rule_terms: [${ruleTerms.join(", ")}]`,
    `tags: [${tags.join(", ")}]`,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const sectionSteps = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const sectionCaveats = caveats.map((c) => `- ${c}`).join("\n");
  const sectionEvidence = evidenceMessages.length
    ? evidenceMessages
        .map((message) => {
          return [`### ${message.role}`, message.content].join("\n\n");
        })
        .join("\n\n")
    : "No direct evidence captured.";
  const candidateRuleLines = [
    `- Rule key: ${ruleKey}`,
    `- Category: ${category}`,
    `- Rule terms: ${ruleTerms.join(", ") || "none"}`,
    `- Distinct keyword hits: ${distinctKeywordHits.join(", ") || "none"}`,
  ].join("\n");

  return [
    yaml,
    "",
    `# ${title}`,
    "",
    "## Draft Purpose",
    description,
    "",
    "## Candidate Rule",
    candidateRuleLines,
    "",
    "## Steps",
    sectionSteps,
    "",
    "## Evidence",
    sectionEvidence,
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

function resolveEnabledPatterns(config) {
  const requestedPatterns = new Set(config.patterns_to_detect || []);
  const ignoredPatterns = new Set(config.ignore_patterns || []);

  return [...ALLOWED_PATTERN_NAMES].filter((patternName) => {
    return requestedPatterns.has(patternName) && !ignoredPatterns.has(patternName);
  });
}

function resolveUnsupportedPatterns(config) {
  const requestedPatterns = new Set(config.patterns_to_detect || []);
  return [...requestedPatterns].filter(
    (patternName) => !ALLOWED_PATTERN_NAMES.has(patternName),
  );
}

function meetsEvidenceBar(analysis, config) {
  if (!analysis || typeof analysis !== "object") {
    return false;
  }

  const minMatchingMessages = Number(config.min_matching_messages || 2);
  const minDistinctKeywords = Number(config.min_distinct_keywords || 2);
  const threshold = thresholdValue(config.extraction_threshold);

  if (analysis.matchingMessages.length < minMatchingMessages) {
    return false;
  }

  if (analysis.distinctKeywordHits.length < minDistinctKeywords) {
    return false;
  }

  if (
    analysis.patternName === "user_corrections" &&
    analysis.userMatchCount < 1
  ) {
    return false;
  }

  return analysis.score >= threshold;
}

function extractLegacyRuleKey(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return "";
  }

  if (filePath.endsWith("/SKILL.md")) {
    return path.basename(path.dirname(filePath));
  }

  if (filePath.endsWith(".draft.md")) {
    return path.basename(filePath, ".draft.md");
  }

  if (filePath.endsWith(".md")) {
    return path.basename(filePath, ".md");
  }

  return path.basename(filePath);
}

function migrateLegacySkillSignatures(indexData) {
  if (
    Array.isArray(indexData.rule_signatures) &&
    indexData.rule_signatures.length > 0
  ) {
    return indexData;
  }

  const legacyEntries = Array.isArray(indexData.skill_signatures)
    ? indexData.skill_signatures
    : [];

  if (legacyEntries.length === 0) {
    return {
      ...indexData,
      rule_signatures: Array.isArray(indexData.rule_signatures)
        ? indexData.rule_signatures
        : [],
    };
  }

  const migratedRuleSignatures = legacyEntries
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const category = typeof entry.category === "string" ? entry.category : "";
      const ruleKey = extractLegacyRuleKey(entry.file);
      if (!category || !ruleKey) {
        return null;
      }

      return {
        signature: buildRuleSignature(category, ruleKey),
        rule_key: ruleKey,
        category,
        rule_terms: [],
        file: entry.file,
        timestamp:
          typeof entry.timestamp === "string"
            ? entry.timestamp
            : new Date().toISOString(),
      };
    })
    .filter(Boolean);

  return {
    ...indexData,
    rule_signatures: migratedRuleSignatures,
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
  const { skillsRoot, learnedMetadataRoot } = resolveLearnedStoragePaths(config);
  const sessionId = args["session-id"] || process.env.OPENCODE_SESSION_ID || "";

  if (!skillsRoot || !learnedMetadataRoot) {
    process.stderr.write("Unable to resolve learned skills storage paths\n");
    process.exitCode = 1;
    return;
  }

  await fs.mkdir(skillsRoot, { recursive: true });
  await fs.mkdir(learnedMetadataRoot, { recursive: true });

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

  const unsupportedPatterns = resolveUnsupportedPatterns(config);
  if (unsupportedPatterns.length > 0) {
    process.stdout.write(
      `Ignoring unsupported pattern categories: ${unsupportedPatterns.join(", ")}\n`,
    );
  }

  const enabledPatterns = resolveEnabledPatterns(config);

  const ranked = enabledPatterns
    .map((name) => scorePatternAnalysis(normalized.messages, name))
    .filter((analysis) => meetsEvidenceBar(analysis, config))
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    process.stdout.write("No strong patterns detected; no skills generated\n");
    return;
  }

  const indexPath = path.join(
    learnedMetadataRoot,
    ".continuous-learning-index.json",
  );
  const loadedIndexData = await readJsonFile(indexPath, {
    session_history: [],
    rule_signatures: [],
  });
  const indexData = migrateLegacySkillSignatures(loadedIndexData);

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
  const maxSkillsPerSession = Number(config.max_skills_per_session || 1);

  for (const analysis of ranked) {
    if (created.length >= maxSkillsPerSession) {
      break;
    }

    const def = PATTERN_DEFS[analysis.patternName];
    const descriptiveSlug = deriveDescriptiveSlug(
      analysis.matchingMessages,
      analysis.patternName,
      def.keywords,
    );
    const ruleTerms = extractRuleTerms(analysis.matchingMessages, def.keywords);
    const ruleKey = buildRuleKey(analysis.patternName, descriptiveSlug);
    const ruleSignature = buildRuleSignature(analysis.patternName, ruleKey);

    const existing = hasSimilarRule(
      indexData,
      analysis.patternName,
      ruleSignature,
      ruleTerms,
    );
    if (existing) {
      continue;
    }

    const draftFileName = await pickLearnedDraftFileName({
      learnedMetadataRoot,
      baseName: ruleKey,
    });
    const skillName = path.basename(draftFileName, ".draft.md");
    const outputPath = path.join(learnedMetadataRoot, draftFileName);
    const relativeSkillPath = path.relative(learnedMetadataRoot, outputPath);
    const evidenceMessages = pickEvidenceMessages(analysis.matchingMessages);

    const content = buildSkillContent({
      skillName,
      ruleKey,
      ruleSignature,
      title: def.title,
      category: analysis.patternName,
      tags: def.tags,
      evidenceMessages,
      steps: def.steps,
      caveats: def.caveats,
      sessionId,
      messageCount: normalized.messageCount,
      distinctKeywordHits: analysis.distinctKeywordHits,
      ruleTerms,
    });

    await fs.writeFile(outputPath, content, "utf8");
    created.push(outputPath);

    indexData.rule_signatures = [
      ...(indexData.rule_signatures || []),
      {
        signature: ruleSignature,
        rule_key: ruleKey,
        category: analysis.patternName,
        rule_terms: ruleTerms,
        file: relativeSkillPath,
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
      generated: created.map((file) => path.relative(learnedMetadataRoot, file)),
    },
  ];

  const dedupeWindow = Number(config.dedupe_window_sessions || 20);
  if (Number.isFinite(dedupeWindow) && dedupeWindow > 0) {
    indexData.session_history = indexData.session_history.slice(-dedupeWindow);
    indexData.rule_signatures = (indexData.rule_signatures || []).slice(
      -dedupeWindow * 5,
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

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`continuous-learning failed: ${message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildSkillContent,
  buildRuleKey,
  buildRuleSignature,
  deriveDescriptiveSlug,
  main,
  pickLearnedDraftFileName,
  resolveLearnedStoragePaths,
};
