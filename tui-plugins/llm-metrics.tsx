/** @jsxImportSource @opentui/solid */
/**
 * llm-metrics TUI plugin — live per-session LLM metrics in the sidebar.
 *
 * Maintains its own in-memory MetricsState (the shared pure reducer) fed from
 * the TUI event bus, and renders the current session's latest-call tok/s,
 * tokens in/out, model, cost, finish reason, and a rolling-avg tok/s. All
 * derivation lives in the shared lib; the SolidJS component is presentation
 * only.
 */

import { For, Show, createMemo, createSignal } from "solid-js";

import type {
  TuiDialogSelectOption,
  TuiHostSlotMap,
  TuiPlugin,
  TuiSlotContext,
  TuiThemeCurrent,
} from "@opencode-ai/plugin/tui";

import {
  createMetricsState,
  isSessionWorking,
  reduceEvent,
  selectLive,
  selectRecordsForVisible,
  sessionSubtree,
  visibleSubtree,
} from "../plugins/llm-metrics-lib/derive.ts";
import { pickLatestRequestExchange } from "../plugins/llm-metrics-lib/exchange.ts";
import type { ExchangeMessage } from "../plugins/llm-metrics-lib/exchange.ts";
import { readHeaderSnapshots } from "../plugins/llm-metrics-lib/header-store.ts";
import {
  formatCost,
  deriveAgentLabel,
  formatNumber,
  truncateLabel,
} from "../plugins/llm-metrics-lib/format.ts";
import { selectLatestHeaderSnapshot } from "../plugins/llm-metrics-lib/headers.ts";
import { rollingGenAvg } from "../plugins/llm-metrics-lib/stats.ts";
import type {
  LiveSnapshot,
  MetricEvent,
  MetricPart,
  MetricRecord,
  MetricsState,
} from "../plugins/llm-metrics-lib/types.ts";

/** Rolling-avg window for the sidebar tok/s figure. */
const ROLLING_K = 10;

/** Throttle for live-snapshot recomputation per session (ms). */
const LIVE_TICK_MS = 100;

/**
 * Chars-per-token ratio for the live tok/s ESTIMATE (prose ~4 chars/token;
 * the exact figure snaps in from genTokensPerSec at step-finish).
 */
const CHARS_PER_TOKEN = 4;

/** Cap retained records so a long-running TUI does not grow unbounded. */
const MAX_TUI_RECORDS = 500;

// tok/s color thresholds (records/sec), matching the CLI dashboard.
const TPS_GREEN = 50;
const TPS_AMBER = 20;

/** kv key under which the display toggles are persisted. */
const KV_KEY = "llm-metrics:toggles";

/** Persisted display-toggle state (subagent consumption, cost line, hides). */
type Toggles = {
  showSubagents: boolean;
  showCost: boolean;
  hiddenSubagents: string[];
};

/** Default toggles: subagent consumption and cost line both visible, nothing hidden. */
const DEFAULTS: Toggles = {
  showSubagents: true,
  showCost: true,
  hiddenSubagents: [],
};

/** One compact per-session row in the subagent breakdown. */
interface SessionRow {
  sessionID: string;
  label: string;
  isRoot: boolean;
  /** Whether the session is currently working (live or mid-turn). */
  working: boolean;
  active: boolean;
  modelID: string;
  latestSpeed: number | null;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  shortID: string;
  fullID: string;
  latestAt: number;
}

type SessionLifecycleState = "busy" | "retry" | "idle";

const MetricsSidebar = (props: {
  sessionID: string;
  records: () => MetricRecord[];
  /** Reducer state (carries the session hierarchy used for subtree resolution). */
  hierarchy: () => MetricsState;
  liveMap: () => Record<string, LiveSnapshot>;
  lifecycleBySession: () => Record<string, SessionLifecycleState>;
  agentBySession: () => Record<string, string>;
  theme: TuiThemeCurrent;
  /** Whether subagent (child-session) consumption is included in the view. */
  showSubagents: () => boolean;
  /** Whether the cost line is shown. */
  showCost: () => boolean;
  /** Per-subagent sessionIDs hidden from the breakdown. */
  hiddenSubagents: () => ReadonlySet<string>;
}) => {
  /** Visible portion of the subagent subtree: the full subtree when subagent
   *  consumption is ON (minus per-subagent hides), else just the root session.
   *  The root sessionID is always kept (visibleSubtree guarantees it). */
  const visibleSet = createMemo(() =>
    props.showSubagents()
      ? visibleSubtree(props.hierarchy(), props.sessionID, props.hiddenSubagents())
      : new Set([props.sessionID]),
  );
  /** Records for the visible sessions only, live-resolved => race-safe even if a
   *  record preceded its `session.created` (re-filters once the hierarchy lands). */
  const sessionRecords = createMemo(() =>
    selectRecordsForVisible(props.records(), visibleSet()),
  );
  /** Live mid-stream snapshot for the visible sessions: scan liveMap keys ∈
   *  visibleSet and pick the most-recently-started stream (smallest elapsed ≈
   *  greatest gen-start). Reports that session's own ticking estimate. */
  const activeLive = createMemo<LiveSnapshot | null>(() => {
    const map = props.liveMap();
    const visible = visibleSet();
    let best: LiveSnapshot | null = null;
    for (const key of visible) {
      const snap = map[key];
      if (snap === undefined) continue;
      if (best === null || snap.elapsedMs < best.elapsedMs) best = snap;
    }
    return best;
  });

  // ── Aggregate over the visible sessions (summed over completed `message`
  //    records to avoid double-counting per-step `call`s — same rule as the CLI). ─
  const subtreeMessages = createMemo(() =>
    sessionRecords().filter((r) => r.kind === "message"),
  );
  const aggIn = createMemo(() => subtreeMessages().reduce((s, r) => s + r.tokens.input, 0));
  const aggOut = createMemo(() => subtreeMessages().reduce((s, r) => s + r.tokens.output, 0));
  const aggCost = createMemo(() => subtreeMessages().reduce((s, r) => s + r.cost, 0));
  const aggAvgGen = createMemo(() => rollingGenAvg(sessionRecords(), ROLLING_K));
  const activeSessionID = createMemo(() => activeLive()?.sessionID ?? null);

  const shortSessionID = (sessionID: string): string =>
    sessionID.length <= 8 ? sessionID : `…${sessionID.slice(-8)}`;
  const formatSpeedValue = (tps: number): string => {
    const rounded = tps >= 10 ? Math.round(tps).toString() : tps.toFixed(1);
    return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
  };
  const formatCompactSpeed = (tps: number | null, pending = false): string => {
    if (tps === null) return pending ? "…/s" : "-";
    return `${formatSpeedValue(tps)}/s`;
  };
  const formatSummarySpeed = (tps: number | null): string =>
    tps === null ? "-" : `${formatSpeedValue(tps)} tok/s`;
  const formatElapsed = (elapsedMs: number): string => `${(elapsedMs / 1000).toFixed(1)}s`;
  const formatTokenPair = (tokensIn: number, tokensOut: number): string =>
    `${formatNumber(tokensIn)}/${formatNumber(tokensOut)}`;
  const modelLabel = (modelID: string, max: number): string =>
    truncateLabel(modelID === "" ? "-" : modelID, max);
  /** One normalized row per visible session, ordered by active/working/latest. */
  const sessionRows = createMemo<SessionRow[]>(() => {
    const bySession = new Map<string, MetricRecord[]>();
    for (const r of sessionRecords()) {
      const list = bySession.get(r.sessionID);
      if (list === undefined) bySession.set(r.sessionID, [r]);
      else list.push(r);
    }
    const hier = props.hierarchy().sessions;
    const allRecords = props.records();
    const liveBySession = props.liveMap();
    const lifecycleBySession = props.lifecycleBySession();
    const agentBySession = props.agentBySession();
    const liveIDs = new Set(Object.keys(liveBySession));
    const currentActiveSessionID = activeSessionID();
    const now = Date.now();
    const rows: SessionRow[] = [];
    for (const sid of visibleSet()) {
      const recs = bySession.get(sid) ?? [];
      const isRoot = sid === props.sessionID;
      const liveSnap = liveBySession[sid];
      const lifecycleState = lifecycleBySession[sid] ?? null;
      const working = isSessionWorking(allRecords, liveIDs, sid, lifecycleState);
      const active = sid === currentActiveSessionID;
      let latestGen: number | null = liveSnap?.liveTokensPerSec ?? null;
      if (latestGen === null) {
        for (let i = recs.length - 1; i >= 0; i--) {
          const g = recs[i].genTokensPerSec;
          if (g !== null) {
            latestGen = g;
            break;
          }
        }
      }
      let tin = 0;
      let tout = 0;
      let cost = 0;
      let latestAt =
        liveSnap !== undefined || lifecycleState === "busy" || lifecycleState === "retry"
          ? now
          : 0;
      for (const r of recs) {
        if (r.at > latestAt) latestAt = r.at;
        if (r.kind === "message") {
          tin += r.tokens.input;
          tout += r.tokens.output;
          cost += r.cost;
        }
      }
      const last = recs.length > 0 ? recs[recs.length - 1] : null;
      const label = deriveAgentLabel({
        sessionID: sid,
        title: hier[sid]?.title,
        agent: agentBySession[sid],
        isRoot,
      });
      rows.push({
        sessionID: sid,
        label,
        isRoot,
        working,
        active,
        modelID: liveSnap?.modelID ?? (last !== null ? last.modelID : ""),
        latestSpeed: latestGen,
        tokensIn: tin,
        tokensOut: tout,
        cost,
        shortID: shortSessionID(sid),
        fullID: sid,
        latestAt,
      });
    }
    rows.sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        Number(b.working) - Number(a.working) ||
        b.latestAt - a.latestAt,
    );
    return rows;
  });
  const conductorRows = createMemo(() => sessionRows().filter((row) => row.isRoot));
  const subagentRows = createMemo(() => sessionRows().filter((row) => !row.isRoot));
  const nowRunningRow = createMemo<SessionRow | null>(() => {
    const rows = sessionRows();
    return rows.find((row) => row.active || row.working) ?? null;
  });
  const nowRunningLive = createMemo<LiveSnapshot | null>(() => {
    const row = nowRunningRow();
    if (row === null) return null;
    return props.liveMap()[row.sessionID] ?? null;
  });
  const tpsColor = (tps: number | null) => {
    if (tps === null) return props.theme.textMuted;
    if (tps >= TPS_GREEN) return props.theme.success;
    if (tps >= TPS_AMBER) return props.theme.warning;
    return props.theme.error;
  };
  const rowSummary = (row: SessionRow): string =>
    `${row.working ? "Running" : "Done"} · ${modelLabel(row.modelID, 18)} · tokens ${formatTokenPair(row.tokensIn, row.tokensOut)}${props.showCost() ? ` · ${formatCost(row.cost)}` : ""} · ${row.shortID}`;

  return (
    <box width="100%" flexDirection="column" gap={1}>
      <text fg={props.theme.textMuted}>── llm-metrics ──</text>
      <box flexDirection="column">
        <Show when={nowRunningRow() !== null} fallback={<text fg={props.theme.textMuted}>No active agent</text>}>
          <box flexDirection="column">
            <box flexDirection="row" justifyContent="space-between" width="100%">
              <text fg={props.theme.text}>{truncateLabel(`Running ${nowRunningRow()?.label ?? ""}`, 28)}</text>
              <text fg={tpsColor(nowRunningLive()?.liveTokensPerSec ?? nowRunningRow()?.latestSpeed ?? null)}>
                {nowRunningLive() !== null
                  ? formatCompactSpeed(nowRunningLive()?.liveTokensPerSec ?? null, true)
                  : formatCompactSpeed(nowRunningRow()?.latestSpeed ?? null)}
              </text>
            </box>
            <Show
              when={nowRunningLive() !== null}
              fallback={
                <text fg={props.theme.textMuted}>
                  {`${modelLabel(nowRunningRow()?.modelID ?? "", 20)} · latest ${formatSummarySpeed(nowRunningRow()?.latestSpeed ?? null)}`}
                </text>
              }
            >
              <text fg={props.theme.textMuted}>
                {`${modelLabel(nowRunningLive()?.modelID ?? "", 20)} · ~${formatNumber(Math.round(nowRunningLive()?.estTokens ?? 0))} tok · ${formatElapsed(nowRunningLive()?.elapsedMs ?? 0)}`}
              </text>
            </Show>
            <text fg={props.theme.textMuted}>{nowRunningRow()?.fullID ?? ""}</text>
          </box>
        </Show>
      </box>
      <box flexDirection="column">
        <text fg={props.theme.textMuted}>Overview</text>
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <text fg={props.theme.textMuted}>Tokens in / out</text>
          <text fg={props.theme.text}>{formatTokenPair(aggIn(), aggOut())}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <text fg={props.theme.textMuted}>Avg generation speed</text>
          <text fg={props.theme.text}>{formatSummarySpeed(aggAvgGen())}</text>
        </box>
        <Show when={props.showCost()}>
          <box flexDirection="row" justifyContent="space-between" width="100%">
            <text fg={props.theme.textMuted}>Total cost</text>
            <text fg={props.theme.text}>{formatCost(aggCost())}</text>
          </box>
        </Show>
      </box>
      <box flexDirection="column">
        <text fg={props.theme.textMuted}>Conductor</text>
        <box flexDirection="column">
          <For each={conductorRows()}>
            {(row) => (
              <box flexDirection="column">
                <box flexDirection="row" justifyContent="space-between" width="100%">
                  <text fg={props.theme.text}>{truncateLabel(row.label, 24)}</text>
                  <text fg={tpsColor(row.latestSpeed)}>
                    {formatCompactSpeed(row.latestSpeed, row.active)}
                  </text>
                </box>
                <text fg={props.theme.textMuted}>{rowSummary(row)}</text>
              </box>
            )}
          </For>
        </box>
      </box>
      <Show when={subagentRows().length > 0}>
        <box flexDirection="column">
          <text fg={props.theme.textMuted}>Sub-agents</text>
          <box flexDirection="column">
            <For each={subagentRows()}>
              {(row) => (
                <box flexDirection="column">
                  <box flexDirection="row" justifyContent="space-between" width="100%">
                    <text fg={props.theme.text}>{truncateLabel(row.label, 24)}</text>
                    <text fg={tpsColor(row.latestSpeed)}>
                      {formatCompactSpeed(row.latestSpeed, row.active)}
                    </text>
                  </box>
                  <text fg={props.theme.textMuted}>{rowSummary(row)}</text>
                </box>
              )}
            </For>
          </box>
        </box>
      </Show>
    </box>
  );
};

const tui: TuiPlugin = async (api) => {
  const DialogSelect = api.ui.DialogSelect;

  let state: MetricsState = createMetricsState();
  const [records, setRecords] = createSignal<MetricRecord[]>([]);
  /** Reducer state carrying the session hierarchy (subagent tree). Refreshed on
   *  `session.created` (the only event that mutates `state.sessions`) so the
   *  sidebar's subtree resolution stays race-safe without recomputing on the
   *  high-frequency delta stream. */
  const [hierarchy, setHierarchy] = createSignal<MetricsState>(state);
  /** sessionID -> live mid-stream snapshot (cleared when the step finishes). */
  const [liveMap, setLiveMap] = createSignal<Record<string, LiveSnapshot>>({});
  const [lifecycleBySession, setLifecycleBySession] = createSignal<
    Record<string, SessionLifecycleState>
  >({});
  const [agentBySession, setAgentBySession] = createSignal<Record<string, string>>({});
  /** Per-session throttle guard for live recomputation (epoch ms). */
  const lastLiveTick: Record<string, number> = {};

  // ── Display toggles (persisted to kv across restarts) ──────────────────────
  const init: Toggles = { ...DEFAULTS, ...api.kv.get<Partial<Toggles>>(KV_KEY, {}) };
  const [showSubagents, setShowSubagents] = createSignal(init.showSubagents);
  const [showCost, setShowCost] = createSignal(init.showCost);
  const [hiddenSubagents, setHiddenSubagents] = createSignal<ReadonlySet<string>>(
    new Set(init.hiddenSubagents),
  );
  /** Persist the current toggles to kv (called after every mutation). */
  const persist = (): void => {
    api.kv.set(KV_KEY, {
      showSubagents: showSubagents(),
      showCost: showCost(),
      hiddenSubagents: [...hiddenSubagents()],
    });
  };

  const feed = (ev: MetricEvent): void => {
    const result = reduceEvent(state, ev);
    state = result.state;
    if (ev.type === "session.created") {
      // Hierarchy changed => refresh so a record that preceded its
      // session.created is picked up once the entry lands.
      setHierarchy(state);
    }
    if (result.records.length > 0) {
      setRecords((prev) => {
        const next = prev.concat(result.records);
        return next.length > MAX_TUI_RECORDS ? next.slice(-MAX_TUI_RECORDS) : next;
      });
    }
  };

  /**
   * Recompute a session's live snapshot from the reducer state via the pure
   * `selectLive` (Date.now() lives here, in the caller). High-frequency deltas
   * are throttled to LIVE_TICK_MS; low-frequency boundary events force-refresh
   * so the headline snaps estimate <-> exact at step-start/step-finish. A null
   * snapshot deletes the entry (the sidebar falls back to the exact figure).
   */
  const refreshLive = (sessionID: string, force = false): void => {
    const now = Date.now();
    const last = lastLiveTick[sessionID];
    if (!force && last !== undefined && now - last < LIVE_TICK_MS) return;
    lastLiveTick[sessionID] = now;
    const snap = selectLive(state, sessionID, now, CHARS_PER_TOKEN);
    setLiveMap((prev) => {
      if (snap === null) {
        if (prev[sessionID] === undefined) return prev;
        const next = { ...prev };
        delete next[sessionID];
        return next;
      }
      return { ...prev, [sessionID]: snap };
    });
  };

  const unsubs: Array<() => void> = [];

  unsubs.push(
    api.event.on("message.updated", (e) => {
      const info = e.properties.info;
      // Only assistant messages carry LLM metrics (also narrows the union).
      if (info.role !== "assistant") return;
      if (info.agent.trim().length > 0) {
        setAgentBySession((prev) =>
          prev[info.sessionID] === info.agent ? prev : { ...prev, [info.sessionID]: info.agent },
        );
      }
      feed({ type: "message.updated", info });
    }),
  );

  unsubs.push(
    api.event.on("message.part.updated", (e) => {
      // The reducer switches on part.type and ignores untracked part types.
      feed({ type: "message.part.updated", part: e.properties.part as MetricPart });
      // Force (unthrottled): step-start/step-finish reset live accumulation,
      // and no further deltas arrive to trigger a refresh after a boundary.
      refreshLive(e.properties.sessionID, true);
    }),
  );

  unsubs.push(
    api.event.on("message.part.delta", (e) => {
      feed({
        type: "message.part.delta",
        sessionID: e.properties.sessionID,
        messageID: e.properties.messageID,
        partID: e.properties.partID,
        field: e.properties.field,
        delta: e.properties.delta,
      });
      refreshLive(e.properties.sessionID);
    }),
  );

  unsubs.push(
    api.event.on("message.removed", (e) => {
      feed({ type: "message.removed", messageID: e.properties.messageID });
    }),
  );

  // Session hierarchy: subagents are OpenCode child sessions (info.parentID).
  unsubs.push(
    api.event.on("session.created", (e) => {
      feed({
        type: "session.created",
        sessionID: e.properties.info.id,
        parentID: e.properties.info.parentID ?? null,
        title: e.properties.info.title,
      });
    }),
  );

  unsubs.push(
    api.event.on("session.status", (e) => {
      setLifecycleBySession((prev) => ({ ...prev, [e.properties.sessionID]: e.properties.status.type }));
    }),
  );

  unsubs.push(
    api.event.on("session.idle", (e) => {
      setLifecycleBySession((prev) => ({ ...prev, [e.properties.sessionID]: "idle" }));
    }),
  );

  unsubs.push(
    api.event.on("session.deleted", (e) => {
      const sessionID = e.properties.info.id;
      feed({ type: "session.deleted", sessionID });
      delete lastLiveTick[sessionID];
      setLifecycleBySession((prev) => {
        if (prev[sessionID] === undefined) return prev;
        const next = { ...prev };
        delete next[sessionID];
        return next;
      });
      setLiveMap((prev) => {
        if (prev[sessionID] === undefined) return prev;
        const next = { ...prev };
        delete next[sessionID];
        return next;
      });
    }),
  );

  api.lifecycle.onDispose(() => {
    for (const unsub of unsubs) unsub();
  });

  // ── ctrl+p command: categorized option picker + request-details modal ───────

  /** The active session id when on a session route; null elsewhere. */
  const currentSessionID = (): string | null => {
    const r = api.route.current;
    if (r.name !== "session") return null;
    return typeof r.params.sessionID === "string" ? r.params.sessionID : null;
  };

  /** The last selected (toggled) menu option's value. Re-highlighted via the
   *  DialogSelect `current` prop when the picker re-opens after a toggle, so the
   *  cursor stays on the just-toggled line (it persists — only its visible/hidden
   *  label flips) instead of jumping back to the top. */
  const [lastMenuValue, setLastMenuValue] = createSignal<string | undefined>(undefined);

  /** One hide/show option per NON-root session in the active session's subtree
   *  (includes currently-hidden ones so they can be re-shown). */
  const subagentOptions = (): TuiDialogSelectOption<string>[] => {
    const sid = currentSessionID();
    if (sid === null) return [];
    const hier = hierarchy();
    const hidden = hiddenSubagents();
    const allRecords = records();
    const liveIDs = new Set(Object.keys(liveMap()));
    const options: TuiDialogSelectOption<string>[] = [];
    for (const id of sessionSubtree(hier, sid)) {
      if (id === sid) continue; // skip the root session
      const label = truncateLabel(
        deriveAgentLabel({
          sessionID: id,
          title: hier.sessions[id]?.title,
          agent: agentBySession()[id],
          isRoot: false,
        }),
        32,
      );
      const status = isSessionWorking(allRecords, liveIDs, id, lifecycleBySession()[id] ?? null)
        ? "Running"
        : "Done";
      options.push({
        title: `${label} · ${status} · ${hidden.has(id) ? "hidden" : "visible"}`,
        value: `toggle-sub:${id}`,
        category: "Subagents",
      });
    }
    return options;
  };

  /** The full categorized menu (display toggles, per-subagent hides, inspect). */
  const menuOptions = (): TuiDialogSelectOption<string>[] => [
    {
      title: `Subagent consumption: ${showSubagents() ? "ON" : "OFF"}`,
      value: "toggle-subagents",
      category: "Display",
    },
    {
      title: `Cost line: ${showCost() ? "ON" : "OFF"}`,
      value: "toggle-cost",
      category: "Display",
    },
    ...subagentOptions(),
    {
      title: "Open latest request details",
      value: "open-details",
      category: "Inspect",
    },
  ];

  /** Replace the dialog with a freshly-built picker. Re-opened after each toggle
   *  so the options reflect the new state (no reliance on reactive options). */
  const openMenu = (): void => {
    api.ui.dialog.replace(() => (
      <DialogSelect
        title="llm-metrics"
        options={menuOptions()}
        current={lastMenuValue()}
        onSelect={(o) => onMenuSelect(o.value as string)}
      />
    ));
  };

  const onMenuSelect = (value: string): void => {
    // Remember the selection BEFORE re-opening so `current` re-highlights it.
    setLastMenuValue(value);
    if (value === "toggle-subagents") {
      setShowSubagents((v) => !v);
      persist();
      openMenu();
    } else if (value === "toggle-cost") {
      setShowCost((v) => !v);
      persist();
      openMenu();
    } else if (value.startsWith("toggle-sub:")) {
      const id = value.slice("toggle-sub:".length);
      setHiddenSubagents((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      persist();
      openMenu();
    } else if (value === "open-details") {
      void openDetails();
    }
  };

  /** Fetch the active session's messages, extract the latest request/response
   *  exchange (keyed off the latest USER message so the request shows mid-stream),
   *  and open it in the HOST dialog shell. `dialog.replace()` already renders the
   *  centered overlay; this plugin only provides the dialog BODY content. */
  const openDetails = async (): Promise<void> => {
    const sid = currentSessionID();
    if (sid === null) {
      api.ui.toast({ variant: "warning", message: "No active session" });
      return;
    }
    api.ui.toast({ message: "Loading request…" });
    let res: Awaited<ReturnType<typeof api.client.session.messages>>;
    try {
      res = await api.client.session.messages({ sessionID: sid });
    } catch {
      api.ui.toast({ variant: "error", message: "Failed to load request" });
      return;
    }
    if ("error" in res && res.error !== undefined) {
      api.ui.toast({ variant: "error", message: "Failed to load request" });
      return;
    }
    const messages = (res.data ?? []) as ExchangeMessage[];
    const messageCount = messages.length;
    const details = pickLatestRequestExchange(messages);
    const headerSnapshots = readHeaderSnapshots(sid);
    const headerSnapshot = selectLatestHeaderSnapshot(headerSnapshots, {
      sessionID: sid,
      userMessageID: details?.userMessageID ?? null,
      assistantMessageID: details?.assistantMessageID ?? null,
    });
    const maxDetailsHeight = Math.max(12, Math.min(api.renderer.height - 10, 40));
    api.ui.dialog.replace(() => (
      <box paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="column" gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={api.theme.current.text}>Latest request details</text>
          <text fg={api.theme.current.textMuted} onMouseUp={() => api.ui.dialog.clear()}>
            esc
          </text>
        </box>
        {details === null ? (
          <text fg={api.theme.current.textMuted}>No request found in this session.</text>
        ) : (
          <>
            <box flexDirection="column" width="100%">
              <text fg={api.theme.current.text}>session: {sid}</text>
              <text fg={api.theme.current.textMuted} wrapMode="word" width="100%">
                messages: {messageCount} · req: {details.requestText.length} chars · resp:{" "}
                {details.responseText.length} chars
              </text>
              <text fg={api.theme.current.text} wrapMode="word" width="100%">
                model: {details.modelID === "" ? "-" : details.modelID}
              </text>
              <text fg={api.theme.current.text}>cost: {formatCost(details.cost)}</text>
            </box>
            <scrollbox
              scrollY
              stickyStart="top"
              maxHeight={maxDetailsHeight}
              paddingRight={1}
              width="100%"
            >
              <box flexDirection="column" width="100%">
                <text fg={api.theme.current.textMuted}>── Request ──</text>
                <text fg={api.theme.current.text} wrapMode="word" width="100%">
                  {details.requestText === "" ? "(none)" : details.requestText}
                </text>
                <text fg={api.theme.current.textMuted}>
                  ── Request headers (sanitized, best-effort) ──
                </text>
                <Show
                  when={headerSnapshot !== null && headerSnapshot.requestHeaders.length > 0}
                  fallback={
                    <text fg={api.theme.current.textMuted}>
                      No captured request headers for this turn.
                    </text>
                  }
                >
                  <For each={headerSnapshot?.requestHeaders ?? []}>
                    {(header) => (
                      <text fg={api.theme.current.text} wrapMode="word" width="100%">
                        {header.name}: {header.value}
                      </text>
                    )}
                  </For>
                </Show>
                <text fg={api.theme.current.textMuted}>── Response ──</text>
                <text fg={api.theme.current.text} wrapMode="word" width="100%">
                  {details.responseText === "" ? "(response in progress…)" : details.responseText}
                </text>
                <text fg={api.theme.current.textMuted}>── Response headers (errors only) ──</text>
                <Show
                  when={headerSnapshot !== null && headerSnapshot.responseHeaders.length > 0}
                  fallback={
                    <text fg={api.theme.current.textMuted}>
                      Response headers are only available on provider error turns in the current plugin surface.
                    </text>
                  }
                >
                  <For each={headerSnapshot?.responseHeaders ?? []}>
                    {(header) => (
                      <text fg={api.theme.current.text} wrapMode="word" width="100%">
                        {header.name}: {header.value}
                      </text>
                    )}
                  </For>
                </Show>
              </box>
            </scrollbox>
          </>
        )}
      </box>
    ));
    api.ui.dialog.setSize("xlarge");
  };

  api.command.register(() => [
    {
      title: "llm-metrics",
      value: "metrics-llm",
      description: "Toggle metrics display & inspect the latest request",
      category: "metrics",
      onSelect: openMenu,
    },
  ]);

  // Host slot contract (opentui SlotRenderer): the render fn takes TWO args —
  // (context, props). context is { theme }; the slot's own props ({ session_id })
  // arrive as arg 2. Reading session_id off arg 1 yields undefined and the
  // per-session filter never matches (sidebar stuck on "waiting for data…").
  api.slots.register({
    order: 20,
    slots: {
      sidebar_content: (ctx: TuiSlotContext, slotProps: TuiHostSlotMap["sidebar_content"]) => (
        <MetricsSidebar
          sessionID={slotProps.session_id}
          records={records}
          hierarchy={hierarchy}
          liveMap={liveMap}
          lifecycleBySession={lifecycleBySession}
          agentBySession={agentBySession}
          theme={ctx.theme.current}
          showSubagents={showSubagents}
          showCost={showCost}
          hiddenSubagents={hiddenSubagents}
        />
      ),
    },
  });
};

export default {
  id: "llm-metrics",
  tui,
};
