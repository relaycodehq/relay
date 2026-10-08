// Sample data: a frontend repo whose agent needs the backend and shared types
// that live in repos of their own.
import type {
  AgentTrace,
  ChatMessage,
  ChatSummary,
  Project,
} from "../../shared/projects";

export const home = "/Users/you";
export const tilde = (path: string) =>
  path.startsWith(home) ? `~${path.slice(home.length)}` : path;

export type Access = "read" | "write";
export interface Link {
  path: string;
  /** What the agent is told is in there. */
  note: string;
  access: Access;
  /** Linked on the project, so every new thread has it, or on one thread. */
  scope: "project" | "thread";
}
export const folderName = (path: string) => path.split("/").pop() ?? path;

const now = Date.now();
const minute = 60_000;

export const projects: Project[] = [
  ["acme-web", "Acme Web"],
  ["acme-api", "Acme API"],
  ["acme-mobile", "Acme Mobile"],
].map(([id, name], i) => ({
  id,
  name,
  path: `${home}/work/${id}`,
  repository: null,
  added: i,
}));

export const chats: ChatSummary[] = (
  [
    ["checkout-422", "acme-web", "Checkout fails with 422 since this morning", 2],
    ["cart-badge", "acme-web", "Cart badge lags behind the count", 90],
    ["rate-limit", "acme-api", "Rate-limit the upload endpoint", 300],
  ] as const
).map(([id, projectId, title, ago]) => ({
  id,
  projectId,
  title,
  scope: { kind: "project" },
  created: now - (ago + 30) * minute,
  updated: now - ago * minute,
  branch: "main",
  provider: "claude",
}));

export const projectLinks: Link[] = [
  {
    path: `${home}/work/acme-api`,
    note: "Laravel API: routes, form requests, resources",
    access: "read",
    scope: "project",
  },
  {
    path: `${home}/work/acme-shared`,
    note: "TypeScript types and zod schemas both apps import",
    access: "write",
    scope: "project",
  },
];

/** Folders `/add-dir` and the picker offer that aren't Relay projects. */
export const recentFolders = [
  `${home}/work/acme-docs`,
  `${home}/work/acme-infra`,
  `${home}/work/acme-design-tokens`,
];
/** What path completion finds under each folder. */
export const disk: Record<string, string[]> = {
  [home]: ["work", "Documents", "Downloads", "PhpstormProjects"],
  [`${home}/work`]: [
    "acme-api",
    "acme-docs",
    "acme-infra",
    "acme-mobile",
    "acme-shared",
    "acme-design-tokens",
    "acme-web",
  ],
  [`${home}/PhpstormProjects`]: ["relay", "openusage"],
};

let traceId = 0;
const read = (label: string): AgentTrace => {
  const id = `t${++traceId}`;
  return {
    kind: "activity",
    id,
    activity: { id, kind: "read", label, status: "complete" },
  };
};
const search = (label: string): AgentTrace => {
  const id = `t${++traceId}`;
  return {
    kind: "activity",
    id,
    activity: { id, kind: "search", label, status: "complete" },
  };
};

export const messages: ChatMessage[] = [
  {
    id: "ask",
    role: "user",
    body: "Checkout fails with a 422 since this morning. Did the API change something?",
    status: "complete",
    created: now - 4 * minute,
    provider: "claude",
    version: 1,
  },
  {
    id: "answer",
    role: "assistant",
    body:
      "Yes. This morning's API deploy made `shipping_method` required on `POST /checkout` " +
      "(`acme-api/app/Http/Requests/CheckoutRequest.php`), and `CheckoutForm.tsx` only sends it " +
      "when the user changes the default.\n\nThe shared `CheckoutPayload` type in `acme-shared` " +
      "still marks it optional, which is why TypeScript didn't catch it. I can make it required " +
      "there and always send the default from the form.",
    status: "complete",
    created: now - 4 * minute + 2000,
    ended: now - 3 * minute,
    provider: "claude",
    model: { name: "Opus 5.5", effort: "high" },
    trace: [
      read(`${home}/work/acme-web/src/checkout/CheckoutForm.tsx`),
      search("shipping_method"),
      read(`${home}/work/acme-api/app/Http/Requests/CheckoutRequest.php`),
      read(`${home}/work/acme-api/routes/api.php`),
      read(`${home}/work/acme-shared/src/checkout.ts`),
    ],
    version: 1,
  },
];
