const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const scriptPath = path.join(__dirname, "evaluate-session.js");

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "continuous-learning-"));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function listChildDirectories(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function runEvaluator({ configPath, transcriptPath, sessionId }) {
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      "--config",
      configPath,
      "--transcript",
      transcriptPath,
      "--session-id",
      sessionId,
    ],
    { encoding: "utf8" },
  );
}

function buildTranscript() {
  return [
    { role: "user", content: "actually adjust the layout and revise the spacing" },
    { role: "assistant", content: "I will change direction and adjust the output" },
    { role: "user", content: "prefer this version instead" },
  ];
}

test("writes learned skills to skills/<slug>/SKILL.md when explicit paths are configured", async () => {
  const tempDir = await createTempDir();
  const skillsRoot = path.join(tempDir, "skills");
  const learnedMetadataRoot = path.join(skillsRoot, "learned");
  const configPath = path.join(tempDir, "config.json");
  const transcriptPath = path.join(tempDir, "transcript.json");

  await fs.mkdir(skillsRoot, { recursive: true });
  await writeJson(configPath, {
    min_session_length: 1,
    extraction_threshold: "low",
    auto_approve: false,
    skills_root_path: skillsRoot,
    learned_metadata_path: learnedMetadataRoot,
    patterns_to_detect: ["user_corrections"],
    ignore_patterns: [],
    max_skills_per_session: 1,
    dedupe_window_sessions: 20,
  });
  await writeJson(transcriptPath, buildTranscript());

  const result = runEvaluator({
    configPath,
    transcriptPath,
    sessionId: "ses_testExplicitPaths123",
  });

  assert.equal(result.status, 0, result.stderr);

  const directories = await listChildDirectories(skillsRoot);
  const generatedSkillDirectories = directories.filter((name) => name !== "learned");

  assert.equal(generatedSkillDirectories.length, 1);

  const skillDirectory = path.join(skillsRoot, generatedSkillDirectories[0]);
  const skillPath = path.join(skillDirectory, "SKILL.md");
  const skillContent = await fs.readFile(skillPath, "utf8");
  const indexPath = path.join(learnedMetadataRoot, ".continuous-learning-index.json");

  assert.match(skillContent, /^name: /m);
  assert.match(skillContent, /^status: review-required$/m);
  assert.ok(await fs.stat(indexPath));
  assert.match(result.stdout, /Generated 1 learned skill\(s\):/);
  assert.match(result.stdout, /SKILL\.md/);
});

test("keeps legacy learned_skills_path configs working while writing to skill directories", async () => {
  const tempDir = await createTempDir();
  const skillsRoot = path.join(tempDir, "skills");
  const learnedMetadataRoot = path.join(skillsRoot, "learned");
  const configPath = path.join(tempDir, "config.json");
  const transcriptPath = path.join(tempDir, "transcript.json");

  await fs.mkdir(learnedMetadataRoot, { recursive: true });
  await writeJson(configPath, {
    min_session_length: 1,
    extraction_threshold: "low",
    auto_approve: true,
    learned_skills_path: learnedMetadataRoot,
    patterns_to_detect: ["user_corrections"],
    ignore_patterns: [],
    max_skills_per_session: 1,
    dedupe_window_sessions: 20,
  });
  await writeJson(transcriptPath, buildTranscript());

  const result = runEvaluator({
    configPath,
    transcriptPath,
    sessionId: "ses_testLegacyPath123",
  });

  assert.equal(result.status, 0, result.stderr);

  const directories = await listChildDirectories(skillsRoot);
  const generatedSkillDirectories = directories.filter((name) => name !== "learned");

  assert.equal(generatedSkillDirectories.length, 1);

  const skillDirectory = path.join(skillsRoot, generatedSkillDirectories[0]);
  const skillPath = path.join(skillDirectory, "SKILL.md");
  const skillContent = await fs.readFile(skillPath, "utf8");
  const learnedEntries = await fs.readdir(learnedMetadataRoot);

  assert.match(skillContent, /^status: approved$/m);
  assert.ok(learnedEntries.includes(".continuous-learning-index.json"));
  assert.equal(
    learnedEntries.some((entry) => entry.endsWith(".md") || entry.endsWith(".draft.md")),
    false,
  );
});
