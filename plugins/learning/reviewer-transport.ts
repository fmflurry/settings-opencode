import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readSync, rmSync, writeSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";

import type { LocalReviewerConfiguration } from "./policy.ts";

const REVIEW_TIMEOUT_MS = 5_000;
const TERMINATION_GRACE_MS = 50;
const MAX_OUTPUT_BYTES = 8_192;
const HASH_BUFFER_BYTES = 64 * 1_024;
const SUPPORTED_POSIX_PLATFORMS = new Set(["darwin", "linux"]);

export interface ReviewerRequest {
  readonly signals: readonly { readonly kind: string; readonly summary: string }[];
}

interface VerifiedFile {
  readonly descriptor: number;
}

interface VerifiedReviewerFiles {
  readonly executable: VerifiedFile;
  readonly modelArtifact: VerifiedFile;
}

interface StagedReviewerFiles {
  readonly root: string;
  readonly executable: string;
  readonly modelArtifact: string;
}

function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function isSupportedPlatform(): boolean {
  return SUPPORTED_POSIX_PLATFORMS.has(process.platform) && typeof process.getuid === "function" && typeof constants.O_NOFOLLOW === "number";
}

function safeAbsolutePath(path: string): boolean {
  if (path.length === 0 || path.length > 4_096 || /[\u0000-\u001f\u007f-\u009f]/.test(path)) return false;
  const absolute = resolve(path);
  return path === absolute && path.split("/").every((segment, index) => index === 0 || (segment.length > 0 && segment !== "." && segment !== ".."));
}

function hasTrustedOwner(metadata: Stats): boolean {
  const uid = process.getuid?.();
  return typeof uid === "number" && (metadata.uid === uid || metadata.uid === 0);
}

function hasSafeMode(metadata: Stats): boolean {
  return (metadata.mode & 0o022) === 0;
}

function trustedAncestorDirectories(path: string): boolean {
  const target = resolve(path);
  const root = parse(target).root;
  let current = root;
  while (true) {
    try {
      const metadata = lstatSync(current);
      if (metadata.isSymbolicLink() || !metadata.isDirectory() || !hasTrustedOwner(metadata) || !hasSafeMode(metadata)) return false;
      if (current === dirname(target)) return true;
      const relative = target.slice(current.length).split("/").filter(Boolean)[0];
      if (!relative) return false;
      current = `${current}${current.endsWith("/") ? "" : "/"}${relative}`;
    } catch {
      return false;
    }
  }
}

function verifiedMetadata(metadata: Stats, executable: boolean): boolean {
  return metadata.isFile() && !metadata.isSymbolicLink() && hasTrustedOwner(metadata) && hasSafeMode(metadata) && (!executable || (metadata.mode & 0o111) !== 0);
}

function digestDescriptor(descriptor: number): string {
  const metadata = fstatSync(descriptor);
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  let position = 0;
  while (position < metadata.size) {
    const bytesRead = readSync(descriptor, buffer, 0, Math.min(buffer.byteLength, metadata.size - position), position);
    if (bytesRead === 0) throw new Error("reviewer artifact changed while being verified");
    digest.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return digest.digest("hex");
}

function openVerifiedFile(path: string, expectedHash: string, executable: boolean): VerifiedFile | null {
  if (!isSupportedPlatform() || !safeAbsolutePath(path) || !validDigest(expectedHash) || !trustedAncestorDirectories(path)) return null;
  let descriptor: number | null = null;
  let verified = false;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    if (!verifiedMetadata(metadata, executable) || digestDescriptor(descriptor) !== expectedHash.toLowerCase()) return null;
    verified = true;
    return { descriptor };
  } catch {
    return null;
  } finally {
    if (descriptor !== null && !verified) closeSync(descriptor);
  }
}

function closeVerifiedFiles(files: VerifiedReviewerFiles): void {
  closeSync(files.executable.descriptor);
  closeSync(files.modelArtifact.descriptor);
}

function copyDescriptor(source: number, destination: string, mode: number): boolean {
  let destinationDescriptor: number | null = null;
  try {
    const sourceMetadata = fstatSync(source);
    destinationDescriptor = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode);
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
    let position = 0;
    while (position < sourceMetadata.size) {
      const bytesRead = readSync(source, buffer, 0, Math.min(buffer.byteLength, sourceMetadata.size - position), position);
      if (bytesRead === 0) return false;
      let written = 0;
      while (written < bytesRead) written += writeSync(destinationDescriptor, buffer, written, bytesRead - written);
      position += bytesRead;
    }
    return true;
  } catch {
    return false;
  } finally {
    if (destinationDescriptor !== null) closeSync(destinationDescriptor);
  }
}

function stageVerifiedReviewer(files: VerifiedReviewerFiles, configuration: LocalReviewerConfiguration): StagedReviewerFiles | null {
  const stagingParentProbe = join(homedir(), ".settings-opencode-reviewer-stage-probe");
  if (!trustedAncestorDirectories(stagingParentProbe)) return null;
  let root: string | null = null;
  let staged = false;
  try {
    root = mkdtempSync(join(homedir(), ".settings-opencode-reviewer-"));
    chmodSync(root, 0o700);
    const executable = join(root, "reviewer");
    const modelArtifact = join(root, "model.artifact");
    if (!copyDescriptor(files.executable.descriptor, executable, 0o700) || !copyDescriptor(files.modelArtifact.descriptor, modelArtifact, 0o600)) return null;
    const stagedExecutable = openVerifiedFile(executable, configuration.executableHash, true);
    const stagedArtifact = openVerifiedFile(modelArtifact, configuration.modelArtifactHash, false);
    if (stagedExecutable === null || stagedArtifact === null) {
      if (stagedExecutable !== null) closeSync(stagedExecutable.descriptor);
      if (stagedArtifact !== null) closeSync(stagedArtifact.descriptor);
      return null;
    }
    closeSync(stagedExecutable.descriptor);
    closeSync(stagedArtifact.descriptor);
    staged = true;
    return { root, executable, modelArtifact };
  } catch {
    return null;
  } finally {
    if (root !== null && !staged) rmSync(root, { recursive: true, force: true });
  }
}

function removeStagedReviewer(files: StagedReviewerFiles): void {
  rmSync(files.root, { recursive: true, force: true });
}

function revalidateStagedReviewer(files: StagedReviewerFiles, configuration: LocalReviewerConfiguration): boolean {
  const executable = openVerifiedFile(files.executable, configuration.executableHash, true);
  const modelArtifact = openVerifiedFile(files.modelArtifact, configuration.modelArtifactHash, false);
  if (executable === null || modelArtifact === null) {
    if (executable !== null) closeSync(executable.descriptor);
    if (modelArtifact !== null) closeSync(modelArtifact.descriptor);
    return false;
  }
  closeSync(executable.descriptor);
  closeSync(modelArtifact.descriptor);
  return true;
}

function openVerifiedReviewer(configuration: LocalReviewerConfiguration): VerifiedReviewerFiles | null {
  const executable = openVerifiedFile(configuration.executable, configuration.executableHash, true);
  if (executable === null) return null;
  const modelArtifact = openVerifiedFile(configuration.modelArtifact, configuration.modelArtifactHash, false);
  if (modelArtifact === null) {
    closeSync(executable.descriptor);
    return null;
  }
  return { executable, modelArtifact };
}

export async function validateOfflineReviewer(configuration: LocalReviewerConfiguration): Promise<boolean> {
  const files = openVerifiedReviewer(configuration);
  if (files === null) return false;
  closeVerifiedFiles(files);
  return true;
}

function requestPayload(request: ReviewerRequest): string {
  return JSON.stringify({
    contract: "proposal-learning-offline-reviewer-v1",
    signals: request.signals,
  });
}

function offlineEnvironment(): NodeJS.ProcessEnv {
  return {
    HOME: "/nonexistent",
    LANG: "C.UTF-8",
    NO_PROXY: "*",
    PATH: "/usr/bin:/bin",
  };
}

export async function invokeLocalReviewer(configuration: LocalReviewerConfiguration, request: ReviewerRequest, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return "";
  const files = openVerifiedReviewer(configuration);
  if (files === null) return "";
  const staged = stageVerifiedReviewer(files, configuration);
  closeVerifiedFiles(files);
  if (staged === null) return "";
  // The revalidation immediately before spawn covers the 0700 staging root.
  // Its bounded lifetime and unshared parent prevent untrusted pathname replacement.
  if (!trustedAncestorDirectories(staged.executable) || !trustedAncestorDirectories(staged.modelArtifact) || !revalidateStagedReviewer(staged, configuration)) {
    removeStagedReviewer(staged);
    return "";
  }
  return new Promise<string>((resolveResult) => {
    const child = spawn(staged.executable, ["--model-artifact", staged.modelArtifact], {
      env: offlineEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const output: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let closed = false;
    let cancellationRequested = false;
    let forceKill: NodeJS.Timeout | undefined;
    const finish = (value: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      signal?.removeEventListener("abort", abort);
      removeStagedReviewer(staged);
      resolveResult(value);
    };
    const abort = (): void => {
      if (cancellationRequested || closed) return;
      cancellationRequested = true;
      try {
        child.kill("SIGTERM");
      } catch {
        finish("");
        return;
      }
      forceKill = setTimeout(() => {
        if (!closed) {
          try {
            child.kill("SIGKILL");
          } catch {
            finish("");
          }
        }
      }, TERMINATION_GRACE_MS);
      forceKill.unref();
    };
    const timeout = setTimeout(abort, REVIEW_TIMEOUT_MS);
    timeout.unref();
    signal?.addEventListener("abort", abort, { once: true });
    child.stdin?.on("error", abort);
    child.stdin?.end(requestPayload(request));
    child.stdout?.on("data", (chunk: Buffer) => {
      if (cancellationRequested) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) { abort(); return; }
      output.push(chunk);
    });
    child.once("error", () => finish(""));
    child.once("close", (code) => {
      closed = true;
      finish(!cancellationRequested && code === 0 ? Buffer.concat(output).toString("utf8") : "");
    });
  });
}

export async function probeLocalReviewer(configuration: LocalReviewerConfiguration): Promise<boolean> {
  return validateOfflineReviewer(configuration);
}
