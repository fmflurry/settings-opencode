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

async function listChildFiles(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
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
    {
      role: "user",
      content:
        "Actually use the custom proxy provider instead of the built-in OpenAI provider.\nPreserve the response API shape.",
    },
    {
      role: "assistant",
      content:
        "I will change direction and update the provider wiring everywhere this correction applies.",
    },
    {
      role: "user",
      content:
        "Prefer the explicit proxy base URL and keep the provider naming consistent.",
    },
    {
      role: "assistant",
      content:
        "Understood. I will revise the configuration and related naming to match that preference.",
    },
  ];
}

function buildRepeatedRuleTranscript() {
  return [
    {
      role: "user",
      content:
        "Actually switch this setup to the custom proxy provider instead of the built-in OpenAI provider.",
    },
    {
      role: "assistant",
      content:
        "I will revise the provider wiring and keep the proxy configuration explicit across the setup.",
    },
    {
      role: "user",
      content:
        "Prefer the proxy base URL to stay explicit and keep the provider naming consistent.",
    },
    {
      role: "assistant",
      content:
        "I will apply that correction consistently instead of mixing built-in and proxy providers.",
    },
  ];
}

function buildMixedPatternTranscript() {
  return [
    {
      role: "user",
      content:
        "Actually use the facade here instead, and keep the component aligned with the existing project convention.",
    },
    {
      role: "assistant",
      content:
        "I will route the component through the facade and preserve the architecture guideline.",
    },
    {
      role: "user",
      content:
        "Prefer the design system tokens and naming convention already used across this project.",
    },
    {
      role: "assistant",
      content:
        "I will keep the facade usage, design system tokens, and naming convention consistent.",
    },
  ];
}

function buildWeakTranscript() {
  return [
    {
      role: "user",
      content: "Prefer this version.",
    },
    {
      role: "assistant",
      content: "Okay.",
    },
  ];
}

function buildSecretTranscript() {
  return [
    {
      role: "user",
      content:
        "Actually use the proxy provider instead. apiKey=sk-secretsecretsecret123456 and keep the proxy URL explicit.",
    },
    {
      role: "assistant",
      content:
        "I will revise the provider wiring. Authorization: Bearer super-secret-token-value.",
    },
    {
      role: "user",
      content:
        "Prefer the custom provider naming and keep the token out of the checked-in settings.",
    },
  ];
}

test("writes a draft under learned/ only and preserves full message evidence", async () => {
  const tempDir = await createTempDir();
  const skillsRoot = path.join(tempDir, "skills");
  const learnedMetadataRoot = path.join(skillsRoot, "learned");
  const configPath = path.join(tempDir, "config.json");
  const transcriptPath = path.join(tempDir, "transcript.json");

  await fs.mkdir(skillsRoot, { recursive: true });
  await writeJson(configPath, {
    min_session_length: 1,
    extraction_threshold: "medium",
    auto_approve: false,
    skills_root_path: skillsRoot,
    learned_metadata_path: learnedMetadataRoot,
    patterns_to_detect: ["user_corrections", "debugging_techniques"],
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
  const draftFiles = await listChildFiles(learnedMetadataRoot);
  const generatedDrafts = draftFiles.filter((name) => name.endsWith(".draft.md"));

  assert.deepEqual(directories, ["learned"]);
  assert.equal(generatedDrafts.length, 1);

  const draftPath = path.join(learnedMetadataRoot, generatedDrafts[0]);
  const skillContent = await fs.readFile(draftPath, "utf8");
  const indexPath = path.join(learnedMetadataRoot, ".continuous-learning-index.json");

  assert.doesNotMatch(generatedDrafts[0], /user-corrections-user-corrections/);
  assert.match(skillContent, /^status: draft$/m);
  assert.match(skillContent, /^source: continuous-learning$/m);
  assert.match(skillContent, /^rule_key: /m);
  assert.match(skillContent, /Preserve the response API shape\./);
  assert.ok(await fs.stat(indexPath));
  assert.match(
    result.stdout,
    /Ignoring unsupported pattern categories: debugging_techniques/,
  );
  assert.match(result.stdout, /Generated 1 learned skill\(s\):/);
  assert.match(result.stdout, /\.draft\.md/);
});

test("dedupes repeated learned rules across sessions instead of by session fingerprint", async () => {
  const tempDir = await createTempDir();
  const skillsRoot = path.join(tempDir, "skills");
  const learnedMetadataRoot = path.join(skillsRoot, "learned");
  const configPath = path.join(tempDir, "config.json");
  const transcriptPathOne = path.join(tempDir, "transcript-one.json");
  const transcriptPathTwo = path.join(tempDir, "transcript-two.json");

  await fs.mkdir(learnedMetadataRoot, { recursive: true });
  await writeJson(configPath, {
    min_session_length: 1,
    extraction_threshold: "medium",
    auto_approve: false,
    skills_root_path: skillsRoot,
    learned_metadata_path: learnedMetadataRoot,
    patterns_to_detect: ["user_corrections"],
    ignore_patterns: [],
    max_skills_per_session: 1,
    dedupe_window_sessions: 20,
  });
  await writeJson(transcriptPathOne, buildTranscript());
  await writeJson(transcriptPathTwo, buildRepeatedRuleTranscript());

  const firstResult = runEvaluator({
    configPath,
    transcriptPath: transcriptPathOne,
    sessionId: "ses_testRuleDedupeOne123",
  });
  const secondResult = runEvaluator({
    configPath,
    transcriptPath: transcriptPathTwo,
    sessionId: "ses_testRuleDedupeTwo123",
  });

  assert.equal(firstResult.status, 0, firstResult.stderr);
  assert.equal(secondResult.status, 0, secondResult.stderr);

  const draftFiles = await listChildFiles(learnedMetadataRoot);
  const generatedDrafts = draftFiles.filter((name) => name.endsWith(".draft.md"));

  assert.equal(generatedDrafts.length, 1);
  assert.match(
    secondResult.stdout,
    /Patterns detected but all were deduplicated|No strong patterns detected; no skills generated/,
  );
});

test("caps output at one draft even when both supported categories are strong", async () => {
  const tempDir = await createTempDir();
  const skillsRoot = path.join(tempDir, "skills");
  const learnedMetadataRoot = path.join(skillsRoot, "learned");
  const configPath = path.join(tempDir, "config.json");
  const transcriptPath = path.join(tempDir, "transcript.json");

  await fs.mkdir(skillsRoot, { recursive: true });
  await writeJson(configPath, {
    min_session_length: 1,
    extraction_threshold: "medium",
    auto_approve: false,
    skills_root_path: skillsRoot,
    learned_metadata_path: learnedMetadataRoot,
    patterns_to_detect: ["user_corrections", "project_specific"],
    ignore_patterns: [],
    max_skills_per_session: 1,
    dedupe_window_sessions: 20,
  });
  await writeJson(transcriptPath, buildMixedPatternTranscript());

  const result = runEvaluator({
    configPath,
    transcriptPath,
    sessionId: "ses_testOutputCap123",
  });

  assert.equal(result.status, 0, result.stderr);

  const draftFiles = await listChildFiles(learnedMetadataRoot);
  const generatedDrafts = draftFiles.filter((name) => name.endsWith(".draft.md"));

  assert.equal(generatedDrafts.length, 1);
});

test("skips weak evidence even with a low threshold", async () => {
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
    patterns_to_detect: ["user_corrections", "project_specific"],
    ignore_patterns: [],
    max_skills_per_session: 1,
    dedupe_window_sessions: 20,
  });
  await writeJson(transcriptPath, buildWeakTranscript());

  const result = runEvaluator({
    configPath,
    transcriptPath,
    sessionId: "ses_testWeakEvidence123",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No strong patterns detected; no skills generated/);
});

test("redacts secrets while keeping full evidence messages", async () => {
  const tempDir = await createTempDir();
  const skillsRoot = path.join(tempDir, "skills");
  const learnedMetadataRoot = path.join(skillsRoot, "learned");
  const configPath = path.join(tempDir, "config.json");
  const transcriptPath = path.join(tempDir, "transcript.json");

  await fs.mkdir(skillsRoot, { recursive: true });
  await writeJson(configPath, {
    min_session_length: 1,
    extraction_threshold: "medium",
    auto_approve: false,
    skills_root_path: skillsRoot,
    learned_metadata_path: learnedMetadataRoot,
    patterns_to_detect: ["user_corrections"],
    ignore_patterns: [],
    max_skills_per_session: 1,
    dedupe_window_sessions: 20,
  });
  await writeJson(transcriptPath, buildSecretTranscript());

  const result = runEvaluator({
    configPath,
    transcriptPath,
    sessionId: "ses_testSecretRedaction123",
  });

  assert.equal(result.status, 0, result.stderr);

  const draftFiles = await listChildFiles(learnedMetadataRoot);
  const generatedDrafts = draftFiles.filter((name) => name.endsWith(".draft.md"));
  const draftPath = path.join(learnedMetadataRoot, generatedDrafts[0]);
  const skillContent = await fs.readFile(draftPath, "utf8");

  assert.doesNotMatch(generatedDrafts[0], /secretsecretsecret123456/);
  assert.doesNotMatch(generatedDrafts[0], /redacted|apikey|authorization|bearer/i);
  assert.match(skillContent, /apiKey=\[REDACTED\]/);
  assert.match(skillContent, /Authorization: Bearer \[REDACTED_TOKEN\]/);
  assert.doesNotMatch(skillContent, /sk-secretsecretsecret123456/);
  assert.doesNotMatch(skillContent, /super-secret-token-value/);
});

test("supports plain-text transcripts without collapsing them to one message", async () => {
  const tempDir = await createTempDir();
  const skillsRoot = path.join(tempDir, "skills");
  const learnedMetadataRoot = path.join(skillsRoot, "learned");
  const configPath = path.join(tempDir, "config.json");
  const transcriptPath = path.join(tempDir, "transcript.txt");

  await fs.mkdir(skillsRoot, { recursive: true });
  await writeJson(configPath, {
    min_session_length: 4,
    extraction_threshold: "medium",
    auto_approve: false,
    skills_root_path: skillsRoot,
    learned_metadata_path: learnedMetadataRoot,
    patterns_to_detect: ["user_corrections"],
    ignore_patterns: [],
    max_skills_per_session: 1,
    dedupe_window_sessions: 20,
  });
  await fs.writeFile(
    transcriptPath,
    [
      "user: Actually use the custom proxy provider instead.",
      "assistant: I will update the provider wiring.",
      "user: Prefer the explicit proxy base URL and consistent provider naming.",
      "assistant: I will apply that correction everywhere this setting is used.",
    ].join("\n"),
    "utf8",
  );

  const result = runEvaluator({
    configPath,
    transcriptPath,
    sessionId: "ses_testPlainTextTranscript123",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Generated 1 learned skill\(s\):/);
});

test("keeps legacy learned_skills_path configs working in draft-only mode", async () => {
  const tempDir = await createTempDir();
  const skillsRoot = path.join(tempDir, "skills");
  const learnedMetadataRoot = path.join(skillsRoot, "learned");
  const configPath = path.join(tempDir, "config.json");
  const transcriptPath = path.join(tempDir, "transcript.json");

  await fs.mkdir(learnedMetadataRoot, { recursive: true });
  await writeJson(configPath, {
    min_session_length: 1,
    extraction_threshold: "medium",
    auto_approve: false,
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
    sessionId: "ses_testLegacyDraftPath123",
  });

  assert.equal(result.status, 0, result.stderr);

  const directories = await listChildDirectories(skillsRoot);
  const draftFiles = await listChildFiles(learnedMetadataRoot);
  const generatedDrafts = draftFiles.filter((name) => name.endsWith(".draft.md"));

  assert.deepEqual(directories, ["learned"]);
  assert.equal(generatedDrafts.length, 1);
  assert.match(result.stdout, /\.draft\.md/);
});

test("falls through to a lower-ranked new pattern when the top-ranked one is deduplicated", async () => {
  const tempDir = await createTempDir();
  const skillsRoot = path.join(tempDir, "skills");
  const learnedMetadataRoot = path.join(skillsRoot, "learned");
  const configPath = path.join(tempDir, "config.json");
  const transcriptPathOne = path.join(tempDir, "transcript-one.json");
  const transcriptPathTwo = path.join(tempDir, "transcript-two.json");

  await fs.mkdir(skillsRoot, { recursive: true });
  await writeJson(configPath, {
    min_session_length: 1,
    extraction_threshold: "medium",
    auto_approve: false,
    skills_root_path: skillsRoot,
    learned_metadata_path: learnedMetadataRoot,
    patterns_to_detect: ["user_corrections", "project_specific"],
    ignore_patterns: [],
    max_skills_per_session: 1,
    dedupe_window_sessions: 20,
  });
  await writeJson(transcriptPathOne, buildTranscript());
  await writeJson(transcriptPathTwo, buildMixedPatternTranscript());

  const firstResult = runEvaluator({
    configPath,
    transcriptPath: transcriptPathOne,
    sessionId: "ses_testDedupedTopPatternOne123",
  });
  const secondResult = runEvaluator({
    configPath,
    transcriptPath: transcriptPathTwo,
    sessionId: "ses_testDedupedTopPatternTwo123",
  });

  assert.equal(firstResult.status, 0, firstResult.stderr);
  assert.equal(secondResult.status, 0, secondResult.stderr);

  const draftFiles = await listChildFiles(learnedMetadataRoot);
  const generatedDrafts = draftFiles.filter((name) => name.endsWith(".draft.md"));
  const draftContents = await Promise.all(
    generatedDrafts.map((name) =>
      fs.readFile(path.join(learnedMetadataRoot, name), "utf8"),
    ),
  );

  assert.equal(generatedDrafts.length, 2);
  assert.ok(
    draftContents.some((content) => /^category: project_specific$/m.test(content)),
  );
});

test("migrates legacy skill_signatures entries into rule-based dedupe", async () => {
  const seedDir = await createTempDir();
  const seedSkillsRoot = path.join(seedDir, "skills");
  const seedLearnedRoot = path.join(seedSkillsRoot, "learned");
  const seedConfigPath = path.join(seedDir, "config.json");
  const seedTranscriptPath = path.join(seedDir, "transcript.json");

  await fs.mkdir(seedSkillsRoot, { recursive: true });
  await writeJson(seedConfigPath, {
    min_session_length: 1,
    extraction_threshold: "medium",
    auto_approve: false,
    skills_root_path: seedSkillsRoot,
    learned_metadata_path: seedLearnedRoot,
    patterns_to_detect: ["user_corrections"],
    ignore_patterns: [],
    max_skills_per_session: 1,
    dedupe_window_sessions: 20,
  });
  await writeJson(seedTranscriptPath, buildTranscript());

  const seedResult = runEvaluator({
    configPath: seedConfigPath,
    transcriptPath: seedTranscriptPath,
    sessionId: "ses_testLegacySeed123",
  });

  assert.equal(seedResult.status, 0, seedResult.stderr);

  const seededDraftFiles = await listChildFiles(seedLearnedRoot);
  const seededDraftName = seededDraftFiles.find((name) => name.endsWith(".draft.md"));

  assert.ok(seededDraftName);

  const tempDir = await createTempDir();
  const skillsRoot = path.join(tempDir, "skills");
  const learnedMetadataRoot = path.join(skillsRoot, "learned");
  const configPath = path.join(tempDir, "config.json");
  const transcriptPath = path.join(tempDir, "transcript.json");
  const indexPath = path.join(learnedMetadataRoot, ".continuous-learning-index.json");

  await fs.mkdir(learnedMetadataRoot, { recursive: true });
  await writeJson(configPath, {
    min_session_length: 1,
    extraction_threshold: "medium",
    auto_approve: false,
    skills_root_path: skillsRoot,
    learned_metadata_path: learnedMetadataRoot,
    patterns_to_detect: ["user_corrections"],
    ignore_patterns: [],
    max_skills_per_session: 1,
    dedupe_window_sessions: 20,
  });
  await writeJson(transcriptPath, buildTranscript());
  await writeJson(indexPath, {
    session_history: [],
    skill_signatures: [
      {
        signature: "legacy-session-signature",
        category: "user_corrections",
        file: seededDraftName,
        timestamp: new Date().toISOString(),
      },
    ],
  });

  const result = runEvaluator({
    configPath,
    transcriptPath,
    sessionId: "ses_testLegacyMigration123",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Patterns detected but all were deduplicated/);

  const draftFiles = await listChildFiles(learnedMetadataRoot);
  const generatedDrafts = draftFiles.filter((name) => name.endsWith(".draft.md"));

  assert.equal(generatedDrafts.length, 0);
});
