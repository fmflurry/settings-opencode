import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  logNotification,
  markSubagentEnd,
  markSubagentStart,
  shouldDeliver,
  type NotificationLogEntry,
} from "./lib/notification-gate.ts";

test("keeps the notification gate helper outside the auto-discovered plugin root", () => {
  assert.equal(existsSync(new URL("./notification-gate.ts", import.meta.url)), false);
});

function withIsolatedNotifyEnv<T>(run: (stateDir: string, logPath: string) => T): T {
  const stateDir = mkdtempSync(join(tmpdir(), "notify-gate-state-"));
  const logPath = join(mkdtempSync(join(tmpdir(), "notify-gate-log-")), "notify.log");
  const previousStateDir = process.env.NOTIFY_STATE_DIR;
  const previousLogPath = process.env.NOTIFY_LOG;
  const previousTtl = process.env.NOTIFY_INFLIGHT_TTL_SECONDS;

  process.env.NOTIFY_STATE_DIR = stateDir;
  process.env.NOTIFY_LOG = logPath;

  try {
    return run(stateDir, logPath);
  } finally {
    if (previousStateDir === undefined) delete process.env.NOTIFY_STATE_DIR;
    else process.env.NOTIFY_STATE_DIR = previousStateDir;
    if (previousLogPath === undefined) delete process.env.NOTIFY_LOG;
    else process.env.NOTIFY_LOG = previousLogPath;
    if (previousTtl === undefined) delete process.env.NOTIFY_INFLIGHT_TTL_SECONDS;
    else process.env.NOTIFY_INFLIGHT_TTL_SECONDS = previousTtl;
  }
}

test("logs an entry even when the notification is suppressed", () => {
  withIsolatedNotifyEnv((_stateDir, logPath) => {
    // Arrange
    const sessionID = "session-log-suppressed";
    markSubagentStart(sessionID, "call-1");
    const entry: NotificationLogEntry = {
      harness: "claude-code",
      event: "Stop",
      sessionID,
      notificationClass: "turn-end",
      decision: "SUPPRESSED:subagents-inflight",
      title: "Task done",
    };

    // Act
    const delivered = shouldDeliver(entry);
    logNotification(entry);

    // Assert
    assert.equal(delivered, false);
    const logContents = readFileSync(logPath, "utf8");
    assert.match(logContents, /SUPPRESSED:subagents-inflight/);
  });
});

test("suppresses a turn-end notification while one subagent marker is present", () => {
  withIsolatedNotifyEnv(() => {
    // Arrange
    const sessionID = "session-inflight-suppress";
    markSubagentStart(sessionID, "call-1");

    // Act
    const delivered = shouldDeliver({
      harness: "claude-code",
      event: "Stop",
      sessionID,
      notificationClass: "turn-end",
      decision: "pending",
      title: "Task done",
    });

    // Assert
    assert.equal(delivered, false);
  });
});

test("delivers a permission notification while a subagent marker is present", () => {
  withIsolatedNotifyEnv(() => {
    // Arrange
    const sessionID = "session-permission-through";
    markSubagentStart(sessionID, "call-1");

    // Act
    const delivered = shouldDeliver({
      harness: "claude-code",
      event: "Notification",
      sessionID,
      notificationClass: "permission",
      decision: "pending",
      title: "Needs approval",
    });

    // Assert
    assert.equal(delivered, true);
  });
});

test("suppresses a second delivery inside the debounce window", () => {
  withIsolatedNotifyEnv(() => {
    // Arrange
    const sessionID = "session-debounce";
    const entry: NotificationLogEntry = {
      harness: "claude-code",
      event: "Stop",
      sessionID,
      notificationClass: "turn-end",
      decision: "pending",
      title: "Task done",
    };

    // Act
    const firstDelivered = shouldDeliver(entry);
    const secondDelivered = shouldDeliver(entry);

    // Assert
    assert.equal(firstDelivered, true);
    assert.equal(secondDelivered, false);
  });
});

test("ignores an inflight marker older than the TTL", () => {
  withIsolatedNotifyEnv((stateDir) => {
    // Arrange
    process.env.NOTIFY_INFLIGHT_TTL_SECONDS = "1";
    const sessionID = "session-stale-marker";
    markSubagentStart(sessionID, "call-1");
    const markerPath = join(stateDir, sessionID, "inflight", "call-1");
    const staleTime = new Date(Date.now() - 10_000);
    utimesSync(markerPath, staleTime, staleTime);

    // Act
    const delivered = shouldDeliver({
      harness: "claude-code",
      event: "Stop",
      sessionID,
      notificationClass: "turn-end",
      decision: "pending",
      title: "Task done",
    });

    // Assert
    assert.equal(delivered, true);
  });
});

test("markSubagentEnd removes only the marker for its callID", () => {
  withIsolatedNotifyEnv((stateDir) => {
    // Arrange
    const sessionID = "session-selective-remove";
    markSubagentStart(sessionID, "call-a");
    markSubagentStart(sessionID, "call-b");

    // Act
    markSubagentEnd(sessionID, "call-a");

    // Assert
    const remaining = readdirSync(join(stateDir, sessionID, "inflight"));
    assert.deepEqual(remaining, ["call-b"]);
  });
});
