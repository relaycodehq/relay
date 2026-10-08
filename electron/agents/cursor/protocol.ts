// Cursor's SDK runs in a worker process of Relay's own, so it can live in the
// agent host and outlive a restart of Relay. The two speak one JSON object per
// line: Relay asks with an `id`, the worker answers with the same `id`, and a
// running turn's updates come between as events.

/** A model the SDK lists, cut down to what Relay reads. */
export interface CursorModel {
  id: string;
  name: string;
  description: string;
  /** What its settings offer, e.g. `{ id: "reasoning", values: ["low", "high"] }`. */
  parameters: { id: string; values: string[] }[];
  /** The settings it runs with when none are picked. */
  defaults: { id: string; value: string }[];
}

type CursorAuth =
  { status: "logged-out" } | { status: "logged-in"; email?: string };

export interface CursorRun {
  /** Names this turn's events. */
  run: string;
  /** The agent to resume; left out, a new one starts. */
  agentId?: string;
  cwd: string;
  /** Linked folders it may edit, as more workspace roots; read-only ones it reads by path. */
  dirs?: string[];
  prompt: string;
  images: { data: string; mimeType: string }[];
  model?: string;
  /** A setting of the model, e.g. its reasoning effort. */
  effort?: string;
  mode: "agent" | "plan";
  sandbox: boolean;
  autoReview: boolean;
  /** Only these tools; the rest are off. */
  tools?: string[];
  /** Replaces Cursor's own instructions; for one-off helper jobs. */
  systemPrompt?: string;
  /** Loads the project's and the user's own Cursor rules, MCP servers and hooks; false for helper jobs. */
  ambient: boolean;
}

export interface CursorRunResult {
  agentId: string;
  status: "finished" | "error" | "cancelled";
  text: string;
  error?: string;
  /** The SDK's code for why the run failed, when it gave one. */
  errorCode?: string;
}

export interface CursorMethods {
  models: { params: Record<string, never>; result: CursorModel[] };
  "auth.status": { params: Record<string, never>; result: CursorAuth };
  /** Opens the browser and waits for the sign-in to finish. */
  "auth.login": { params: Record<string, never>; result: CursorAuth };
  "auth.logout": { params: Record<string, never>; result: CursorAuth };
  run: { params: CursorRun; result: CursorRunResult };
  cancel: { params: { run: string }; result: null };
  /** Sends a message into the turn that is running; rejects when it can't go in. */
  steer: { params: { run: string; text: string }; result: null };
}
export type CursorMethod = keyof CursorMethods;

export interface CursorRequest<M extends CursorMethod = CursorMethod> {
  id: number;
  method: M;
  params: CursorMethods[M]["params"];
}

export type CursorReply =
  | { id: number; result: unknown }
  | { id: number; error: { name: string; message: string } };

/** What the SDK reports while a turn runs; Relay reads these in `activity.ts`. */
export interface CursorEvent {
  event: "update";
  run: string;
  update: CursorUpdate;
}

/** The SDK's own `InteractionUpdate`s that Relay uses, loosely typed: it's their shape, not ours. */
export interface CursorUpdate {
  type: string;
  [field: string]: unknown;
}

export const isReply = (line: unknown): line is CursorReply =>
  !!line &&
  typeof line === "object" &&
  typeof (line as CursorReply).id === "number" &&
  ("result" in line || "error" in line);

export const isEvent = (line: unknown): line is CursorEvent =>
  !!line &&
  typeof line === "object" &&
  (line as CursorEvent).event === "update";
