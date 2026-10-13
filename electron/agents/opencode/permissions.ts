import type {
  AgentDecision,
  AskAgentRequest,
  RuntimeMode,
} from "../../../shared/agent-modes";
import { relative } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import type { LinkedFolder } from "../../../shared/projects";
import type { PermissionRequest, QuestionRequest } from "./events";
import { readsOnly } from "../../agent-host/read-only-bash";
import { relayToolRules } from "./mcp";

type PermissionAction = "allow" | "ask" | "deny";
export type PermissionRule = {
  permission: string;
  pattern: string;
  action: PermissionAction;
};
const rule = (
  permission: string,
  action: PermissionAction,
  pattern = "*",
): PermissionRule => ({ permission, pattern, action });

/** Reading is safe everywhere, except secrets in env files. */
const reading = [
  rule("read", "allow"),
  rule("read", "ask", "*.env"),
  rule("read", "ask", "*.env.*"),
  rule("read", "allow", "*.env.example"),
  rule("glob", "allow"),
  rule("grep", "allow"),
  rule("list", "allow"),
  rule("lsp", "allow"),
  rule("skill", "allow"),
  rule("todowrite", "allow"),
  rule("question", "allow"),
];
/**
 * A session's rules for a runtime mode; later rules win in OpenCode.
 * `auto` asks like Supervised: OpenCode has no reviewer to approve routine
 * actions for the user.
 *
 * A tool denied outright drops out of the request, and OpenCode Zen's free
 * models refuse a request without `bash`. So what a run may not do is left
 * to ask, and the run rejects what it can't put to the user.
 *
 * Every session keeps off other threads' Relay tools, full access too: a
 * call to one would act as that thread.
 */
export function permissionRules(
  mode: RuntimeMode | undefined,
  options: {
    readOnly?: boolean;
    title?: boolean;
    cwd?: string;
    links?: readonly LinkedFolder[];
    /** The thread's own Relay tools server; see ./mcp. */
    relayServer?: string;
  },
): PermissionRule[] {
  const rules = modeRules(mode, options);
  return [
    ...(options.title || (mode === "full-access" && !options.readOnly)
      ? rules
      : [...rules, ...linkRules(options.links ?? [], options)]),
    ...relayToolRules(options.relayServer),
  ];
}

/**
 * Linked folders are reached without asking. Edits in a read-only one still
 * ask; OpenCode names an edited file from the project, so the rule names the
 * folder both ways.
 */
function linkRules(
  links: readonly LinkedFolder[],
  { cwd, readOnly }: { cwd?: string; readOnly?: boolean },
) {
  const under = (dir: string) => `${dir.replaceAll("\\", "/")}/*`;
  return links.flatMap((link) => [
    rule("external_directory", "allow", under(link.path)),
    // A reviewer edits nothing anywhere; that rule stands.
    ...(link.access === "read" && !readOnly
      ? [
          rule("edit", "ask", under(link.path)),
          ...(cwd
            ? [rule("edit", "ask", under(relative(cwd, link.path)))]
            : []),
        ]
      : []),
  ]);
}

function modeRules(
  mode: RuntimeMode | undefined,
  options: { readOnly?: boolean; title?: boolean },
): PermissionRule[] {
  if (options.title) return [rule("*", "ask")];
  if (options.readOnly)
    return [
      rule("*", "ask"),
      ...reading,
      // Each command goes to readOnlyReply, the check Claude's reviewers go
      // through too; a glob like `rg *` would also let `rg --pre=…` through.
      rule("bash", "ask"),
      rule("edit", "deny"),
      rule("question", "deny"),
      // A general subagent is not guaranteed to inherit the reviewer's restrictions.
      rule("task", "deny"),
      // OpenCode and reviewers keep large tool output here. No access to
      // arbitrary external folders is granted just to read a temporary diff.
      ...[...new Set([tmpdir(), realpathSync(tmpdir())])].map((dir) =>
        rule(
          "external_directory",
          "allow",
          `${dir.replaceAll("\\", "/").replace(/\/$/, "")}/opencode/*`,
        ),
      ),
    ];
  // A helper job: it reads the project and answers.
  if (!mode) return [rule("*", "ask"), ...reading, rule("question", "deny")];
  if (mode === "full-access")
    return [rule("*", "allow"), rule("external_directory", "allow")];
  return [
    rule("*", "ask"),
    ...reading,
    rule("bash", "ask"),
    rule("edit", mode === "auto-accept-edits" ? "allow" : "ask"),
    rule("webfetch", "ask"),
    rule("websearch", "ask"),
    rule("codesearch", "ask"),
    rule("external_directory", "ask"),
    rule("doom_loop", "ask"),
  ];
}

/**
 * A reviewer's answer, with nobody to ask: a command runs when every part of
 * it only reads, and nothing else does. OpenCode hands the whole command
 * along; the patterns are its parts, with their redirects.
 */
export function readOnlyReply(request: PermissionRequest): PermissionAnswer {
  const command = request.metadata?.command;
  const commands =
    typeof command === "string" ? [command] : (request.patterns ?? []);
  if (
    request.permission === "bash" &&
    commands.length &&
    commands.every(readsOnly)
  )
    return { reply: "once" };
  return {
    reply: "reject",
    message:
      request.permission === "bash"
        ? "Not allowed in a read-only review: only commands that read run. Use a read-only command instead."
        : `Not allowed in a read-only review: ${request.permission}. Carry on without it.`,
  };
}

/** With nobody to ask, a reject still fails only the call; a bare one ends OpenCode's turn. */
export const unattendedReject = (
  request: PermissionRequest,
): PermissionAnswer => ({
  reply: "reject",
  message: `Not allowed here: ${request.permission}. Carry on without it.`,
});

/** OpenCode's own glob: `*` spans anything, slashes too; `?` one character. */
const wildcard = (glob: string, value: string) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*")
      .replaceAll("?", ".")}$`,
    "s",
  ).test(value);

/**
 * What a thread said Always to, as the patterns OpenCode offers for it. Kept
 * in Relay and answered `once`: OpenCode's own `always` holds for every
 * session in the directory, where other threads work too.
 */
export class PermissionGrants {
  private granted: { permission: string; pattern: string }[] = [];

  covers(request: PermissionRequest) {
    const patterns = request.patterns ?? [];
    return (
      patterns.length > 0 &&
      patterns.every((target) =>
        this.granted.some(
          (g) =>
            g.permission === request.permission && wildcard(g.pattern, target),
        ),
      )
    );
  }

  grant(request: PermissionRequest) {
    for (const pattern of request.always ?? [])
      this.granted.push({ permission: request.permission, pattern });
  }
}

const grants = new Map<string, PermissionGrants>();
/** The grants of the thread whose session is kept under `key`. */
export const threadGrants = (key: string) => {
  let held = grants.get(key);
  if (!held) grants.set(key, (held = new PermissionGrants()));
  return held;
};
export const forgetThreadGrants = (key: string) => grants.delete(key);

/** How to answer OpenCode; `stop` ends the turn, as Claude's interrupt does. */
export type PermissionAnswer = {
  reply: "once" | "reject";
  /** With a reject, only the call fails and the agent carries on; without, OpenCode ends the turn. */
  message?: string;
  stop?: boolean;
};

/**
 * Asks the user about one permission: Once, Always (for this thread, when
 * OpenCode says what a yes would cover), Decline (the call fails, the agent
 * carries on) or Cancel (the turn ends).
 */
export async function askPermission(
  request: PermissionRequest,
  ask: AskAgentRequest,
  signal: AbortSignal,
  thread?: PermissionGrants,
): Promise<PermissionAnswer> {
  const metadata = request.metadata ?? {};
  const text = (key: string) =>
    typeof metadata[key] === "string" ? (metadata[key] as string) : "";
  const patterns = (request.patterns ?? []).filter(Boolean).join("\n");
  const [title, detail] =
    request.permission === "bash"
      ? ["Run this command?", text("command") || patterns]
      : request.permission === "edit"
        ? [
            "Allow these file changes?",
            text("diff").slice(0, 20000) || text("filepath") || patterns,
          ]
        : request.permission === "external_directory"
          ? ["Allow access outside the project?", patterns]
          : request.permission === "task"
            ? ["Start a subagent?", text("description") || patterns]
            : request.permission === "webfetch" ||
                request.permission === "websearch"
              ? ["Allow this web request?", text("url") || patterns]
              : [`Allow ${request.permission}?`, patterns];
  const canRemember = !!thread && !!request.always?.length;
  const decisions: AgentDecision[] = canRemember
    ? ["accept", "acceptForSession", "decline", "cancel"]
    : ["accept", "decline", "cancel"];
  const response = await ask(
    {
      kind: "approval",
      title,
      detail,
      decisions,
      // OpenCode hands a subagent only the thread's deny rules, never its asks.
      ...(request.permission === "task" && {
        note: "It won't ask before running commands or changing files.",
      }),
    },
    signal,
  );
  if (response.kind !== "approval")
    throw new Error("Invalid approval response.");
  switch (response.decision) {
    case "acceptForSession":
      if (canRemember) thread!.grant(request);
      return { reply: "once" };
    case "accept":
      return { reply: "once" };
    case "decline":
      return { reply: "reject", message: "Denied by the user." };
    default:
      return { reply: "reject", stop: true };
  }
}

/** Asks the user; OpenCode takes the chosen labels, question by question. */
export async function askQuestions(
  request: QuestionRequest,
  ask: AskAgentRequest,
  signal: AbortSignal,
): Promise<string[][]> {
  if (!request.questions.length || request.questions.length > 10)
    throw new Error("Invalid provider questions.");
  const response = await ask(
    {
      kind: "question",
      title: "OpenCode needs your input",
      questions: request.questions.map((q, index) => ({
        id: String(index),
        header: q.header ?? "",
        question: q.question,
        multiple: !!q.multiple,
        options: q.options.map((o) => ({
          label: o.label,
          description: o.description ?? "",
        })),
      })),
    },
    signal,
  );
  if (response.kind !== "question")
    throw new Error("Invalid question response.");
  return request.questions.map((_, index) => response.answers[index] ?? []);
}
