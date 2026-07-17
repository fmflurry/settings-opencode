import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { asPersonalNotice, digest, personalNotice, renderArticle13Notice } from "./notices.ts";
import { defaultLearningStateRoot } from "./runtime.ts";
import { createProposalQueue, type ActivationMetadata } from "./proposal-queue.ts";

type Command = "list" | "show" | "accept" | "approve" | "reject" | "export" | "delete" | "delete-all" | "status" | "notice" | "enable" | "disable" | "purge";
type PersonalProfile = "local-owner" | "personal-household" | "personal-harness";

function commandFrom(argumentsList: readonly string[]): Command | null {
  const command = argumentsList[2];
  return command === "list" || command === "show" || command === "accept" || command === "approve" || command === "reject" || command === "export" || command === "delete" || command === "delete-all" || command === "status" || command === "notice" || command === "enable" || command === "disable" || command === "purge" ? command : null;
}

function isUuid(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function option(argumentsList: readonly string[], name: string): string | null {
  const index = argumentsList.indexOf(name);
  const value = index < 0 ? undefined : argumentsList[index + 1];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function source(path: string | null): unknown | null {
  if (path === null || !isAbsolute(path) || /[\u0000-\u001f\u007f-\u009f]/.test(path)) return null;
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 65_536 || (metadata.mode & 0o022) !== 0 || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) return null;
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function isPersonalProfile(profile: string | null): profile is PersonalProfile {
  return profile === "local-owner" || profile === "personal-household" || profile === "personal-harness";
}

function writePersonalNotice(notice: ReturnType<typeof asPersonalNotice>, json: boolean): void {
  if (notice === null) return;
  const destination = json ? process.stderr : process.stdout;
  destination.write(`${renderArticle13Notice(notice)}\n`);
}

function activation(argumentsList: readonly string[], json: boolean): ActivationMetadata | null {
  const profile = option(argumentsList, "--profile");
  const controller = option(argumentsList, "--controller");
  const lawfulBasis = option(argumentsList, "--lawful-basis");
  const householdContext = option(argumentsList, "--household-context");
  if (!isPersonalProfile(profile) || !controller || !lawfulBasis || !householdContext) return null;
  const notice = option(argumentsList, "--notice-file") === null ? personalNotice : asPersonalNotice(source(option(argumentsList, "--notice-file")));
  if (notice === null) return null;
  writePersonalNotice(notice, json);
  if (option(argumentsList, "--notice-version") !== notice.version || option(argumentsList, "--notice-hash") !== digest(notice) || option(argumentsList, "--acknowledge-notice") !== digest(notice)) return null;
  return { noticeAcknowledgedAt: Date.now(), profile, noticeVersion: notice.version, noticeHash: digest(notice), controller, lawfulBasis, householdContext, noticeRecord: notice };
}

async function main(): Promise<void> {
  const command = commandFrom(process.argv);
  if (!command) {
    process.exitCode = 2;
    return;
  }
  const root = defaultLearningStateRoot(process.env, homedir());
  const json = process.argv.includes("--json");
  const queue = createProposalQueue({ statePath: join(root, "proposals.json") });
  const id = process.argv[3];
  let result: unknown;
  if (command === "list") result = await queue.list();
  if (command === "show") result = isUuid(id) ? await queue.get(id) : null;
  if (command === "accept" || command === "approve") result = isUuid(id) ? await queue.accept(id) : false;
  if (command === "reject") result = isUuid(id) ? await queue.reject(id) : false;
  if (command === "export") result = id === undefined ? await queue.exportAll() : isUuid(id) ? await queue.export(id) : [];
  if (command === "delete") result = isUuid(id) ? await queue.delete(id) : false;
  if (command === "delete-all") result = await queue.deleteAll();
  if (command === "status") result = await queue.status();
  if (command === "notice") {
    const argumentsList = process.argv.slice(3);
    const profile = option(argumentsList, "--profile");
    const notice = isPersonalProfile(profile)
      ? option(argumentsList, "--notice-file") === null ? personalNotice : asPersonalNotice(source(option(argumentsList, "--notice-file")))
      : null;
    if (notice === null) {
      process.exitCode = 2;
      return;
    }
    writePersonalNotice(notice, json);
    result = { digest: digest(notice), version: notice.version };
  }
  if (command === "enable") {
    const metadata = activation(process.argv.slice(3), json);
    if (!metadata) {
      process.exitCode = 2;
      return;
    }
    await queue.setEnabled(true, metadata);
    result = await queue.status();
  }
  if (command === "disable") {
    await queue.setEnabled(false);
    result = await queue.status();
  }
  if (command === "purge") result = await queue.purgeExpired();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

void main();
