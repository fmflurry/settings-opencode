import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_RAG_SNIPPETS = 3;
const MAX_CHUNK_CHARS = 900;
const MAX_INJECTED_CONTEXT_CHARS = 2200;
const ENV_RAG_PATHS = "OPENCODE_FIGMA_RAG_PATHS";

const DEFAULT_RAG_RELATIVE_PATHS = [
  ".opencode/figma-rag.md",
  "docs/figma-rag.md",
  "figma-rag.md",
];

const FIGMA_HINTS = [
  "figma",
  "node-id",
  "auto layout",
  "design token",
  "variant",
  "frame",
  "component set",
  "code connect",
];

const IMPLEMENTATION_HINTS = [
  "implement",
  "implementation",
  "build",
  "create",
  "code",
  "component",
  "ui",
  "react",
  "vue",
  "html",
  "css",
  "tailwind",
  "frontend",
];

const tokenize = (value) => {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }

  const tokens = value.toLowerCase().match(/[a-z0-9]+/g);
  if (!tokens) {
    return [];
  }

  return tokens.filter((token) => token.length > 2);
};

const hasKeyword = (text, keywords) => {
  if (typeof text !== "string") {
    return false;
  }

  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      return true;
    }
  }

  return false;
};

const isFigmaImplementationIntent = (text) => {
  if (typeof text !== "string" || text.trim().length === 0) {
    return false;
  }

  const normalized = text.toLowerCase();
  const hasFigmaUrl = /https?:\/\/(www\.)?figma\.com\/(design|file|board|make)\//.test(normalized);
  const hasNodeId = /node-id=\d+[-:]\d+/.test(normalized);
  const hasFigmaSignals = hasFigmaUrl || hasNodeId || hasKeyword(normalized, FIGMA_HINTS);
  const hasImplementationSignals = hasKeyword(normalized, IMPLEMENTATION_HINTS);

  return hasFigmaSignals && hasImplementationSignals;
};

const isFigmaToolName = (toolName) => {
  if (typeof toolName !== "string") {
    return false;
  }

  const normalized = toolName.toLowerCase();
  return (
    normalized === "figma" ||
    normalized.startsWith("figma_") ||
    normalized.startsWith("figma.") ||
    normalized.includes("figma")
  );
};

const readServerName = (args) => {
  if (!args || typeof args !== "object") {
    return undefined;
  }

  if (typeof args.server === "string") {
    return args.server;
  }

  if (typeof args.serverName === "string") {
    return args.serverName;
  }

  if (typeof args.mcp === "string") {
    return args.mcp;
  }

  return undefined;
};

const isFigmaMcpCall = (toolName, args) => {
  if (isFigmaToolName(toolName)) {
    return true;
  }

  if (typeof toolName !== "string") {
    return false;
  }

  const normalized = toolName.toLowerCase();
  if (!normalized.includes("mcp")) {
    return false;
  }

  if (!args || typeof args !== "object") {
    return false;
  }

  const server = readServerName(args);

  if (typeof server === "string" && server.toLowerCase() === "figma") {
    return true;
  }

  return false;
};

const notifyMac = async ($, title, message) => {
  const safeTitle = title.replaceAll('"', '\\"');
  const safeMessage = message.replaceAll('"', '\\"');
  const script = `display notification "${safeMessage}" with title "${safeTitle}"`;

  try {
    await $`osascript -e ${script}`;
  } catch {
  }
};

const toast = async (client, title, message) => {
  if (!client || !client.tui || typeof client.tui.showToast !== "function") {
    return;
  }

  try {
    await client.tui.showToast({
      title,
      message,
      variant: "info",
      duration: 2500,
    });
  } catch {
  }
};

const extractTextFromParts = (parts) => {
  if (!Array.isArray(parts)) {
    return "";
  }

  const chunks = [];
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      part.type === "text" &&
      typeof part.text === "string" &&
      part.text.trim().length > 0
    ) {
      chunks.push(part.text.trim());
    }
  }

  return chunks.join("\n\n");
};

const normalizeChunkText = (text) => {
  if (typeof text !== "string") {
    return "";
  }

  return text.replace(/\r\n/g, "\n").trim();
};

const splitIntoChunks = (content, source) => {
  const normalized = normalizeChunkText(content);
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const chunks = [];
  let buffer = "";

  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length <= MAX_CHUNK_CHARS) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      chunks.push({ source, text: buffer });
      buffer = "";
    }

    if (paragraph.length <= MAX_CHUNK_CHARS) {
      buffer = paragraph;
      continue;
    }

    let cursor = 0;
    while (cursor < paragraph.length) {
      const end = Math.min(cursor + MAX_CHUNK_CHARS, paragraph.length);
      const value = paragraph.slice(cursor, end).trim();
      if (value.length > 0) {
        chunks.push({ source, text: value });
      }
      cursor = end;
    }
  }

  if (buffer) {
    chunks.push({ source, text: buffer });
  }

  return chunks;
};

const scoreChunk = (queryTokens, chunkText) => {
  const chunkTokens = tokenize(chunkText);
  if (chunkTokens.length === 0 || queryTokens.size === 0) {
    return 0;
  }

  const uniqueChunkTokens = new Set(chunkTokens);
  let overlap = 0;
  for (const token of queryTokens) {
    if (uniqueChunkTokens.has(token)) {
      overlap += 1;
    }
  }

  if (overlap === 0) {
    return 0;
  }

  const normalized = chunkText.toLowerCase();
  let score = overlap / Math.sqrt(uniqueChunkTokens.size);
  if (normalized.includes("figma")) {
    score += 0.25;
  }
  if (normalized.includes("component")) {
    score += 0.15;
  }

  return score;
};

const resolveRagPaths = ({ directory, worktree, pluginDirectory }) => {
  const result = [];
  const pushIfNew = (value) => {
    if (!value || result.includes(value)) {
      return;
    }
    result.push(value);
  };

  const envPaths = (process.env[ENV_RAG_PATHS] || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  for (const value of envPaths) {
    if (path.isAbsolute(value)) {
      pushIfNew(path.normalize(value));
      continue;
    }

    pushIfNew(path.resolve(directory, value));
  }

  for (const relativePath of DEFAULT_RAG_RELATIVE_PATHS) {
    pushIfNew(path.resolve(directory, relativePath));
    pushIfNew(path.resolve(worktree, relativePath));
  }

  pushIfNew(path.resolve(pluginDirectory, "figma-rag.md"));
  return result;
};

const readFileWithCache = async (cache, filePath) => {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return "";
    }

    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      return cached.content;
    }

    const content = await readFile(filePath, "utf8");
    cache.set(filePath, {
      mtimeMs: fileStat.mtimeMs,
      content,
    });

    return content;
  } catch {
    return "";
  }
};

const retrieveRagSnippets = async ({
  query,
  directory,
  worktree,
  pluginDirectory,
  cache,
}) => {
  const ragPaths = resolveRagPaths({ directory, worktree, pluginDirectory });
  if (ragPaths.length === 0) {
    return [];
  }

  const allChunks = [];
  for (const ragPath of ragPaths) {
    const content = await readFileWithCache(cache, ragPath);
    if (!content) {
      continue;
    }

    const chunks = splitIntoChunks(content, ragPath);
    for (const chunk of chunks) {
      allChunks.push(chunk);
    }
  }

  if (allChunks.length === 0) {
    return [];
  }

  const queryTokens = new Set(tokenize(query));
  const scored = [];
  for (const chunk of allChunks) {
    const score = scoreChunk(queryTokens, chunk.text);
    if (score > 0) {
      scored.push({
        score,
        source: chunk.source,
        text: chunk.text,
      });
    }
  }

  scored.sort((left, right) => right.score - left.score);

  const selected = [];
  let totalChars = 0;
  for (const item of scored) {
    if (selected.length >= MAX_RAG_SNIPPETS) {
      break;
    }

    const snippet =
      item.text.length > MAX_CHUNK_CHARS
        ? `${item.text.slice(0, MAX_CHUNK_CHARS).trim()}...`
        : item.text;

    if (totalChars + snippet.length > MAX_INJECTED_CONTEXT_CHARS) {
      continue;
    }

    selected.push({
      source: path.relative(directory, item.source) || item.source,
      text: snippet,
    });
    totalChars += snippet.length;
  }

  return selected;
};

const createSessionState = () => ({
  lastFigmaToolAt: 0,
  lastFigmaIntentAt: 0,
  query: "",
  snippets: [],
});

const getSessionState = (sessions, sessionID) => {
  const key = typeof sessionID === "string" ? sessionID : "";
  if (!key) {
    return undefined;
  }

  const existing = sessions.get(key);
  if (existing) {
    return existing;
  }

  const state = createSessionState();
  sessions.set(key, state);
  return state;
};

const cleanupExpiredSessions = (sessions, now) => {
  for (const [sessionID, state] of sessions.entries()) {
    const latest = Math.max(state.lastFigmaIntentAt, state.lastFigmaToolAt);
    if (latest > 0 && now - latest > SESSION_TTL_MS) {
      sessions.delete(sessionID);
    }
  }
};

const buildSystemRagInjection = (state) => {
  const lines = [
    "Figma component implementation mode is active.",
    "Use retrieved RAG context as high-priority guidance while implementing components from Figma.",
    "Preserve repository conventions when context conflicts with retrieved guidance.",
    "If context is missing details, continue with best-practice implementation and clearly state assumptions.",
    "Retrieved context:",
  ];

  for (let index = 0; index < state.snippets.length; index += 1) {
    const snippet = state.snippets[index];
    lines.push(`RAG_${index + 1} source: ${snippet.source}`);
    lines.push(snippet.text);
  }

  return lines.join("\n");
};

export const FigmaMcpTriggerPlugin = async ({ $, client, directory, worktree }) => {
  let hasShownActiveToast = false;
  const ragFileCache = new Map();
  const sessionStateByID = new Map();
  const pluginDirectory = path.dirname(fileURLToPath(import.meta.url));

  return {
    "chat.message": async (input, output) => {
      cleanupExpiredSessions(sessionStateByID, Date.now());

      const userText = extractTextFromParts(output?.parts);
      if (!isFigmaImplementationIntent(userText)) {
        return;
      }

      const state = getSessionState(sessionStateByID, input.sessionID);
      if (!state) {
        return;
      }

      state.lastFigmaIntentAt = Date.now();
      state.query = userText;
      state.snippets = await retrieveRagSnippets({
        query: userText,
        directory,
        worktree,
        pluginDirectory,
        cache: ragFileCache,
      });

      if (state.snippets.length > 0) {
        await toast(
          client,
          "OpenCode Figma",
          `RAG context attached (${state.snippets.length} snippet${
            state.snippets.length > 1 ? "s" : ""
          })`,
        );
      }
    },
    "experimental.chat.system.transform": async (input, output) => {
      cleanupExpiredSessions(sessionStateByID, Date.now());

      if (!input?.sessionID || !Array.isArray(output?.system)) {
        return;
      }

      const state = sessionStateByID.get(input.sessionID);
      if (!state || state.snippets.length === 0) {
        return;
      }

      const now = Date.now();
      const hasFreshIntent = now - state.lastFigmaIntentAt <= SESSION_TTL_MS;
      const hasFreshToolCall = now - state.lastFigmaToolAt <= SESSION_TTL_MS;
      if (!hasFreshIntent && !hasFreshToolCall) {
        return;
      }

      output.system.push(buildSystemRagInjection(state));
    },
    "tool.execute.before": async (input, output) => {
      const shouldTrigger = isFigmaMcpCall(input.tool, output?.args);
      if (!shouldTrigger) {
        return;
      }

      const state = getSessionState(sessionStateByID, input.sessionID);
      if (state) {
        state.lastFigmaToolAt = Date.now();
      }

      if (!hasShownActiveToast) {
        hasShownActiveToast = true;
        await toast(client, "OpenCode", "Figma trigger plugin active");
      }

      await Promise.all([
        toast(client, "OpenCode Figma", `${input.tool} started`),
        notifyMac($, "OpenCode Figma", `${input.tool} started`),
      ]);

      try {
        if (client?.app && typeof client.app.log === "function") {
          await client.app.log({
            body: {
              service: "figma-mcp-trigger",
              level: "info",
              message: "Figma MCP tool execution started",
              extra: {
                tool: input.tool,
                callID: input.callID,
                sessionID: input.sessionID,
              },
            },
          });
        }
      } catch {
      }
    },
    "tool.execute.after": async (input, output) => {
      const shouldTrigger = isFigmaMcpCall(input.tool, output?.metadata);
      if (!shouldTrigger) {
        return;
      }

      const state = getSessionState(sessionStateByID, input.sessionID);
      if (state) {
        state.lastFigmaToolAt = Date.now();
      }

      await Promise.all([
        toast(client, "OpenCode Figma", `${input.tool} completed`),
        notifyMac($, "OpenCode Figma", `${input.tool} completed`),
      ]);

      try {
        if (client?.app && typeof client.app.log === "function") {
          await client.app.log({
            body: {
              service: "figma-mcp-trigger",
              level: "info",
              message: "Figma MCP tool execution completed",
              extra: {
                tool: input.tool,
                callID: input.callID,
                sessionID: input.sessionID,
              },
            },
          });
        }
      } catch {
      }
    },
  };
};
