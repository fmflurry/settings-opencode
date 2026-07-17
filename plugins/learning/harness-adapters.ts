export interface DirectPromptSink {
  capture(prompt: { readonly harness: "opencode" | "claude"; readonly sessionId: string; readonly text: string }): Promise<void>;
}

export interface CaptureGate {
  isEnabled(sessionId: string): Promise<boolean>;
}

export const MAX_OPENCODE_PROMPT_PARTS = 16;
export const MAX_OPENCODE_PROMPT_BYTES = 8_192;
export const MAX_CLAUDE_PROMPT_BYTES = 8_192;
const encoder = new TextEncoder();

interface OpenCodePart {
  readonly type?: string;
  readonly text?: string;
  readonly synthetic?: boolean;
}

interface OpenCodeMessage {
  readonly role?: string;
  readonly sessionId?: string;
  readonly parts?: readonly OpenCodePart[];
}

export async function captureOpenCodeDirectMessage(sink: DirectPromptSink, message: OpenCodeMessage, gate?: CaptureGate): Promise<void> {
  if (message.role !== "user" || typeof message.sessionId !== "string") return;
  if (gate && !(await gate.isEnabled(message.sessionId))) return;
  const parts = message.parts;
  if (!parts || parts.length > MAX_OPENCODE_PROMPT_PARTS) return;
  let text = "";
  let textBytes = 0;
  for (const part of parts) {
    if (part.type !== "text" || part.synthetic === true || typeof part.text !== "string") continue;
    const separator = text.length === 0 ? "" : "\n";
    const nextBytes = encoder.encode(separator).byteLength + encoder.encode(part.text).byteLength;
    if (textBytes + nextBytes > MAX_OPENCODE_PROMPT_BYTES) return;
    text += separator + part.text;
    textBytes += nextBytes;
  }
  text = text.trim();
  if (text) await sink.capture({ harness: "opencode", sessionId: message.sessionId, text });
}

interface ClaudeUserPromptSubmitPayload {
  readonly session_id?: string;
  readonly user_prompt?: string;
  readonly transcript_path?: unknown;
}

export async function captureClaudeUserPrompt(sink: DirectPromptSink, payload: ClaudeUserPromptSubmitPayload, gate?: CaptureGate): Promise<void> {
  if (typeof payload.session_id !== "string") return;
  if (gate && !(await gate.isEnabled(payload.session_id))) return;
  if (typeof payload.user_prompt !== "string" || encoder.encode(payload.user_prompt).byteLength > MAX_CLAUDE_PROMPT_BYTES) return;
  const text = payload.user_prompt.trim();
  if (text) await sink.capture({ harness: "claude", sessionId: payload.session_id, text });
}
