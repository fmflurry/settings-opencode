import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sha256 } from "./notices.ts";
import { invokeLocalReviewer, validateOfflineReviewer } from "./reviewer-transport.ts";

test("offline reviewer accepts only a verified owner-controlled executable and artifact", async () => {
  const root = mkdtempSync(join(homedir(), ".settings-opencode-offline-reviewer-"));
  const executable = join(root, "reviewer");
  const artifact = join(root, "model.artifact");
  const executableContents = "#!/bin/sh\nprintf '%s\\n' '{\"proposals\":[{\"kind\":\"preference\",\"title\":\"Prefer terse answers\",\"rationale\":\"Repeated direct preference\",\"change\":\"Respond concisely by default.\"}]}'\n";
  const artifactContents = "fixture-model";
  writeFileSync(executable, executableContents, { mode: 0o700 });
  writeFileSync(artifact, artifactContents, { mode: 0o600 });
  const configuration = {
    executable,
    executableHash: sha256(executableContents),
    modelArtifact: artifact,
    modelArtifactHash: sha256(artifactContents),
  };

  try {
    assert.equal(await validateOfflineReviewer(configuration), true);
    assert.match(await invokeLocalReviewer(configuration, { signals: [{ kind: "repeated-preference", summary: "Prefer terse responses." }] }), /^\{"proposals":/);

    chmodSync(artifact, 0o666);
    assert.equal(await validateOfflineReviewer(configuration), false);

    chmodSync(artifact, 0o600);
    const linkedExecutable = join(root, "linked-reviewer");
    symlinkSync(executable, linkedExecutable);
    assert.equal(await validateOfflineReviewer({ ...configuration, executable: linkedExecutable }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
