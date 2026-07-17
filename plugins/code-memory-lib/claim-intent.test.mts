/** Proposal-only learning must never emit automatic code-memory claim writes. */

import test from "node:test";
import assert from "node:assert/strict";

import { detectClaimIntent, formatClaimNudge, isPureQuestion } from "./claim-intent.ts";

test("automatic claim detection is disabled for every direct input shape", () => {
  for (const input of [
    "I love Clean Architecture!",
    "we use Postgres for everything",
    "Alice owns the billing module",
    "how does authentication work?",
    "",
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(detectClaimIntent(input), null);
  }
});

test("the retained compatibility helpers cannot instruct a claim write", () => {
  assert.equal(formatClaimNudge({ kind: "preference", snippet: "Prefer terse output", suggestion: "prefers" }), "");
  assert.equal(isPureQuestion("does this work?"), true);
  assert.equal(isPureQuestion("we use Postgres. is that wise?"), false);
});
