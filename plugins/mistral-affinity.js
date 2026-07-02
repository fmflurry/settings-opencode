import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(CONFIG_DIR, "data");
const SESSION_DIR = join(DATA_DIR, "mistral-affinity");
const LEGACY_STATE_FILE = join(DATA_DIR, "mistral-affinity.json");
const HEADER_NAME = "x-affinity";
const MISTRAL_PROVIDER_IDS = new Set(["mistral", "myMistral"]);
const MISTRAL_NPM_PACKAGE = "@ai-sdk/mistral";
const READ_RETRY_ATTEMPTS = 5;
const READ_RETRY_DELAY_MS = 10;

const affinityCache = new Map();
const affinityInFlight = new Map();
let legacyStatePromise;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error, code) {
  return isObject(error) && error.code === code;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLegacyState(value) {
  if (!isObject(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(
      ([sessionID, affinity]) =>
        typeof sessionID === "string" && typeof affinity === "string",
    ),
  );
}

async function loadLegacyState() {
  try {
    return parseLegacyState(JSON.parse(await readFile(LEGACY_STATE_FILE, "utf8")));
  } catch {
    return {};
  }
}

function getLegacyState() {
  legacyStatePromise ??= loadLegacyState();
  return legacyStatePromise;
}

function sessionFileFor(sessionID) {
  const filename = createHash("sha256").update(sessionID).digest("hex");
  return join(SESSION_DIR, `${filename}.json`);
}

function parseSessionAffinity(value, sessionID) {
  if (!isObject(value)) return undefined;
  if (value.sessionID !== sessionID) return undefined;
  if (typeof value.affinity !== "string" || value.affinity.length === 0) return undefined;
  return value.affinity;
}

async function readSessionFile(sessionID) {
  try {
    const affinity = parseSessionAffinity(
      JSON.parse(await readFile(sessionFileFor(sessionID), "utf8")),
      sessionID,
    );
    return affinity ? { affinity, exists: true } : { exists: true };
  } catch (error) {
    return { exists: !isNodeError(error, "ENOENT") };
  }
}

async function readSessionPathAffinity(path, sessionID) {
  try {
    return parseSessionAffinity(JSON.parse(await readFile(path, "utf8")), sessionID);
  } catch {
    return undefined;
  }
}

async function readSessionAffinity(sessionID) {
  const sessionFile = await readSessionFile(sessionID);
  if (sessionFile.affinity) affinityCache.set(sessionID, sessionFile.affinity);
  return sessionFile.affinity;
}

async function readSessionAffinityWithRetry(sessionID) {
  for (let attempt = 0; attempt < READ_RETRY_ATTEMPTS; attempt += 1) {
    const affinity = await readSessionAffinity(sessionID);
    if (affinity) return affinity;
    if (attempt < READ_RETRY_ATTEMPTS - 1) await delay(READ_RETRY_DELAY_MS);
  }

  return undefined;
}

async function legacyAffinityFor(sessionID) {
  return (await getLegacyState())[sessionID];
}

async function writeSessionAffinity(sessionID, affinity) {
  await mkdir(SESSION_DIR, { recursive: true });
  const sessionFile = sessionFileFor(sessionID);
  const tempFile = `${sessionFile}.tmp.${process.pid}.${Date.now()}.${randomUUID()}`;
  let tempCreated = false;
  let publishError;

  try {
    await writeFile(tempFile, `${JSON.stringify({ sessionID, affinity }, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    tempCreated = true;
    await link(tempFile, sessionFile);
  } catch (error) {
    publishError = error;
    throw error;
  } finally {
    if (tempCreated) {
      try {
        await unlink(tempFile);
      } catch (error) {
        if (!publishError && !isNodeError(error, "ENOENT")) throw error;
      }
    }
  }

  return affinity;
}

async function repairSessionAffinity(sessionID, affinity) {
  const sessionFile = sessionFileFor(sessionID);
  const corruptFile = `${sessionFile}.corrupt.${process.pid}.${Date.now()}.${randomUUID()}`;
  let movedAffinity;

  try {
    await rename(sessionFile, corruptFile);
    movedAffinity = await readSessionPathAffinity(corruptFile, sessionID);
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) return (await readSessionAffinityWithRetry(sessionID)) ?? affinity;
  }

  try {
    return await writeSessionAffinity(sessionID, movedAffinity ?? affinity);
  } catch (error) {
    if (isNodeError(error, "EEXIST")) return (await readSessionAffinityWithRetry(sessionID)) ?? movedAffinity ?? affinity;

    return movedAffinity ?? affinity;
  }
}

async function createSessionAffinity(sessionID, affinity) {
  try {
    return await writeSessionAffinity(sessionID, affinity);
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) return affinity;

    return (await readSessionAffinityWithRetry(sessionID)) ?? (await repairSessionAffinity(sessionID, affinity));
  }
}

function isMistralProvider(input) {
  return (
    MISTRAL_PROVIDER_IDS.has(input.model?.providerID) ||
    MISTRAL_PROVIDER_IDS.has(input.provider?.info?.id) ||
    input.model?.api?.npm === MISTRAL_NPM_PACKAGE
  );
}

async function resolveAffinityForSession(sessionID) {
  const sessionFile = await readSessionFile(sessionID);
  if (sessionFile.affinity) {
    affinityCache.set(sessionID, sessionFile.affinity);
    return sessionFile.affinity;
  }

  if (sessionFile.exists) {
    const affinity = affinityCache.get(sessionID) ?? (await legacyAffinityFor(sessionID)) ?? randomUUID();
    const savedAffinity = await createSessionAffinity(sessionID, affinity);

    affinityCache.set(sessionID, savedAffinity);
    return savedAffinity;
  }

  const affinity = (await legacyAffinityFor(sessionID)) ?? affinityCache.get(sessionID) ?? randomUUID();
  const savedAffinity = await createSessionAffinity(sessionID, affinity);

  affinityCache.set(sessionID, savedAffinity);
  return savedAffinity;
}

async function affinityForSession(sessionID) {
  const inFlight = affinityInFlight.get(sessionID);
  if (inFlight) return inFlight;

  const affinityPromise = resolveAffinityForSession(sessionID).finally(() => {
    affinityInFlight.delete(sessionID);
  });
  affinityInFlight.set(sessionID, affinityPromise);
  return affinityPromise;
}

export const MistralAffinityPlugin = async ({ client }) => {
  async function logFailure(error) {
    try {
      await client.app.log({
        body: {
          service: "mistral-affinity",
          level: "error",
          message: "Failed to set Mistral affinity header",
          extra: {
            error: error instanceof Error ? error.message : String(error),
          },
        },
      });
    } catch {
      // OpenCode chat should continue if plugin logging fails.
    }
  }

  return {
    "chat.headers": async (input, output) => {
      if (!isMistralProvider(input)) return;

      try {
        output.headers[HEADER_NAME] = await affinityForSession(input.sessionID);
      } catch (error) {
        await logFailure(error);
      }
    },
  };
};
