const ID = /^[A-Za-z0-9._:-]{1,200}$/;
const TOOL = /^[A-Za-z0-9._:-]{1,64}$/;
const SKILL = /^[a-z0-9:-]{1,64}$/;
const AGENT = /^[A-Za-z0-9._:-]{1,64}$/;
const SKILL_TOOL = /^(skill|use_skill|load_skill)$/i;
const SPAWN_TOOL = /^(task|agent)$/i;
const MESSAGE_CAP = 400;
const SESSION_CAP = 200;
const START_CAP = 400;

export type KpiState = {
  parent: Map<string, string>;
  agent: Map<string, string>;
  messages: Map<string, number>;
  started: Map<string, number>;
};

export function createKpiState(): KpiState {
  return {
    parent: new Map(),
    agent: new Map(),
    messages: new Map(),
    started: new Map(),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function remember<T>(map: Map<string, T>, key: string, value: T, max: number): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (typeof oldest !== "string") break;
    map.delete(oldest);
  }
}

export function sanitiseId(value: unknown): string {
  return typeof value === "string" && ID.test(value) ? value : "";
}

export function sanitiseTool(value: unknown): string {
  return typeof value === "string" && TOOL.test(value) ? value : "";
}

export function sanitiseSkill(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.trim().replace(/^\/+/, "").toLowerCase();
  return SKILL.test(name) ? name : "";
}

export function sanitiseAgent(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.trim();
  return AGENT.test(name) ? name : "";
}

function finiteToken(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1_000_000_000_000) {
    return null;
  }
  return Math.floor(value);
}

/** Input plus output only. Cache and reasoning stay out of the KPI total. */
export function usageTokens(info: unknown): number | null {
  const rec = asRecord(info);
  if (!rec) return null;
  const nested = asRecord(rec.tokens) ?? asRecord(rec.usage);
  if (!nested) return finiteToken(rec.tokens);
  const input = finiteToken(nested.input ?? nested.input_tokens);
  const output = finiteToken(nested.output ?? nested.output_tokens);
  if (input == null && output == null) return null;
  return (input ?? 0) + (output ?? 0);
}

export function skillFrom(args: unknown): string {
  if (typeof args === "string") return sanitiseSkill(args);
  const rec = asRecord(args);
  if (!rec) return "";
  return (
    sanitiseSkill(rec.skill) ||
    sanitiseSkill(rec.skill_name) ||
    sanitiseSkill(rec.name) ||
    sanitiseSkill(rec.command)
  );
}

export function agentFromArgs(args: unknown): string {
  const rec = asRecord(args);
  if (!rec) return "";
  return sanitiseAgent(rec.subagent_type) || sanitiseAgent(rec.agent_type) || sanitiseAgent(rec.agent);
}

export function sessionId(props: Record<string, unknown>): string {
  const direct = sanitiseId(props.sessionID);
  if (direct) return direct;
  const info = asRecord(props.info);
  return info ? sanitiseId(info.id) : "";
}

export function sessionParent(props: Record<string, unknown>): string {
  const info = asRecord(props.info);
  const parent = info?.parentID ?? props.parentID;
  return typeof parent === "string" && parent.length > 0 && parent.length <= 200 ? parent : "";
}

function sessionAgent(props: Record<string, unknown>): string {
  const info = asRecord(props.info) ?? props;
  return (
    sanitiseAgent(info.agent) ||
    sanitiseAgent(info.subagent_type) ||
    sanitiseAgent(info.agent_type) ||
    sanitiseAgent(info.mode)
  );
}

function withSession(args: string[], sid: string): string[] {
  if (sid) args.push(`session=${sid}`);
  return args;
}

function withTokens(args: string[], tokens: number | null): string[] {
  if (tokens != null) args.push(`tokens=${tokens}`);
  return args;
}

export function sessionTokenTotal(state: KpiState, sessionID: string): number | null {
  const prefix = `${sessionID}\0`;
  let sum = 0;
  let any = false;
  for (const [key, value] of state.messages) {
    if (!key.startsWith(prefix)) continue;
    sum += value;
    any = true;
  }
  if (!any || sum < 0 || sum >= 1_000_000_000_000) return null;
  return Math.floor(sum);
}

export function onSessionCreated(state: KpiState, props: Record<string, unknown>): string[] {
  const sid = sessionId(props);
  const parent = sessionParent(props);
  const agent = sessionAgent(props);
  if (sid && parent) remember(state.parent, sid, parent, SESSION_CAP);
  if (sid && parent && agent) remember(state.agent, sid, agent, SESSION_CAP);
  if (parent) {
    const args = withSession(["subagent_spawn"], sid);
    if (agent) args.push(`agent=${agent}`);
    return args;
  }
  return withSession(["session_start"], sid);
}

export function onSessionEnded(state: KpiState, props: Record<string, unknown>): string[] {
  const sid = sessionId(props);
  const parent = sessionParent(props) || (sid ? (state.parent.get(sid) ?? "") : "");
  const tokens = sid ? sessionTokenTotal(state, sid) : null;
  if (parent) {
    const agent = sessionAgent(props) || (sid ? (state.agent.get(sid) ?? "") : "");
    if (sid && agent) remember(state.agent, sid, agent, SESSION_CAP);
    const args = withSession(["subagent_stop"], sid);
    if (agent) args.push(`agent=${agent}`);
    return withTokens(args, tokens);
  }
  return withTokens(withSession(["session_end"], sid), tokens);
}

function messageInfo(props: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(props.info) ?? props;
}

/** Keep the latest input+output total per message. The session end emits it. */
export function onMessageUpdated(state: KpiState, props: Record<string, unknown>): void {
  const info = messageInfo(props);
  if (!info) return;
  const sid = sanitiseId(info.sessionID);
  if (!sid) return;
  const tokens = usageTokens(info);
  if (tokens != null) {
    const mid = sanitiseId(info.id) || "latest";
    remember(state.messages, `${sid}\0${mid}`, tokens, MESSAGE_CAP);
  }
  if (!state.parent.has(sid)) return;
  const agent = sanitiseAgent(info.agent) || sanitiseAgent(info.mode) || sanitiseAgent(info.subagent_type);
  if (agent) remember(state.agent, sid, agent, SESSION_CAP);
}

export function toolOk(input: unknown, output: unknown): boolean {
  for (const value of [input, output]) {
    const rec = asRecord(value);
    if (!rec) continue;
    if (rec.ok === false || rec.success === false || rec.is_error === true) return false;
    if (rec.status === "error" || rec.status === "failed" || rec.status === "failure") return false;
    if (typeof rec.error === "string" && rec.error.length > 0) return false;
    if (asRecord(rec.error)) return false;
  }
  return true;
}

function callKey(value: unknown): string {
  if (typeof value !== "string") return "";
  const key = value.trim();
  return key.length > 0 && key.length <= 200 ? key : "";
}

export function onToolBefore(
  state: KpiState,
  input: { tool?: unknown; sessionID?: unknown; callID?: unknown },
  args: unknown,
  now = Date.now(),
): string[][] {
  const tool = sanitiseTool(input.tool);
  if (!tool) return [];
  const key = callKey(input.callID);
  if (key) remember(state.started, key, now, START_CAP);
  const sid = sanitiseId(input.sessionID);
  const rawTool = typeof input.tool === "string" ? input.tool : "";
  const call = withSession(["tool_call", `tool_name=${tool}`], sid);
  if (SKILL_TOOL.test(rawTool)) {
    const skill = skillFrom(args);
    if (skill) call.push(`skill=${skill}`);
  }
  const events = [call];
  if (SPAWN_TOOL.test(rawTool)) {
    const agent = agentFromArgs(args);
    if (agent) call.push(`agent=${agent}`);
    const spawn = withSession(["subagent_spawn", `tool_name=${tool}`], sid);
    if (agent) spawn.push(`agent=${agent}`);
    events.push(spawn);
  }
  return events;
}

export function onToolAfter(
  state: KpiState,
  input: { tool?: unknown; sessionID?: unknown; callID?: unknown; args?: unknown },
  output: unknown,
  now = Date.now(),
): string[] {
  const tool = sanitiseTool(input.tool);
  if (!tool) return [];
  const key = callKey(input.callID);
  let duration: number | null = null;
  if (key && state.started.has(key)) {
    const start = state.started.get(key) ?? now;
    state.started.delete(key);
    const elapsed = now - start;
    if (elapsed >= 0 && elapsed < 86_400_000) duration = Math.floor(elapsed);
  }
  const sid = sanitiseId(input.sessionID);
  const rawTool = typeof input.tool === "string" ? input.tool : "";
  const args = withSession(
    ["tool_result", `tool_name=${tool}`, `ok=${toolOk(input, output) ? "true" : "false"}`],
    sid,
  );
  if (duration != null) args.push(`duration_ms=${duration}`);
  if (SKILL_TOOL.test(rawTool)) {
    const skill = skillFrom(input.args);
    if (skill) args.push(`skill=${skill}`);
  }
  if (SPAWN_TOOL.test(rawTool)) {
    const agent = agentFromArgs(input.args);
    if (agent) args.push(`agent=${agent}`);
  }
  return args;
}

export function onOpenCodeEvent(state: KpiState, event: Record<string, unknown>): string[][] {
  const type = event.type;
  if (typeof type !== "string") return [];
  const props = asRecord(event.properties) ?? {};
  if (type === "session.created") return [onSessionCreated(state, props)];
  if (type === "session.idle" || type === "session.deleted") return [onSessionEnded(state, props)];
  if (type === "message.updated") {
    onMessageUpdated(state, props);
    return [];
  }
  return [];
}
