import type {
  AgentDecision,
  AskAgentRequest,
  RuntimeMode,
} from "../../../shared/agent-modes";
import { relative } from "node:path";
import type { LinkedFolder } from "../../../shared/projects";
import type { PermissionRequest, QuestionRequest } from "./events";

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
/** Commands a reviewer may run: they read the repository and change nothing. */
const readOnlyCommands = [
  "git status*",
  "git diff*",
  "git log*",
  "git show*",
  "git blame*",
  "git branch*",
  "git rev-parse*",
  "git ls-files*",
  "git grep*",
  "ls*",
  "cat *",
  "head *",
  "tail *",
  "wc *",
  "rg *",
  "grep *",
  "find *",
];

/**
 * A session's rules for a runtime mode; later rules win in OpenCode.
 * `auto` asks like Supervised: OpenCode has no reviewer to approve routine
 * actions for the user.
 *
 * A tool denied outright drops out of the request, and OpenCode Zen's free
 * models refuse a request without `bash`. So what a run may not do is left
 * to ask, and the run rejects what it can't put to the user.
 */
export function permissionRules(
  mode: RuntimeMode | undefined,
  options: {
    readOnly?: boolean;
    title?: boolean;
    cwd?: string;
    links?: readonly LinkedFolder[];
  },
): PermissionRule[] {
  const rules = modeRules(mode, options);
  return options.title || (mode === "full-access" && !options.readOnly)
    ? rules
    : [...rules, ...linkRules(options.links ?? [], options)];
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
      rule("bash", "deny"),
      ...readOnlyCommands.map((pattern) => rule("bash", "allow", pattern)),
      rule("edit", "deny"),
      rule("question", "deny"),
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
 * Asks the user about one permission and answers OpenCode with `once` or
 * `reject`. Accepting for the whole session isn't offered: OpenCode keeps an
 * `always` grant for the project directory, where other threads work too.
 */
export async function askPermission(
  request: PermissionRequest,
  ask: AskAgentRequest,
  signal: AbortSignal,
): Promise<"once" | "reject"> {
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
          : request.permission === "webfetch" ||
              request.permission === "websearch"
            ? ["Allow this web request?", text("url") || patterns]
            : [`Allow ${request.permission}?`, patterns];
  const decisions: AgentDecision[] = ["accept", "decline", "cancel"];
  const response = await ask(
    { kind: "approval", title, detail, decisions },
    signal,
  );
  if (response.kind !== "approval")
    throw new Error("Invalid approval response.");
  return response.decision === "accept" ? "once" : "reject";
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
