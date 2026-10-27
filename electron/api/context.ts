import { z } from "zod";
import { chatIsEmpty } from "../../shared/chat-activity";
import type { ChatSummary } from "../../shared/projects";
import { parseWorkspaceId, workspaceIdSchema } from "../../shared/workspaces";
import { idSchema } from "../../shared/validation";
import type { Api, ApiMethod, Repo } from "../../shared/types";
import type { AgentUpdates } from "../agents/agent-updates";
import type { AppLinks } from "../app/links";
import type { GiteaLogin } from "../app/login";
import type { PullHost } from "../pull-requests/host";
import type { PullHosts } from "../pull-requests/hosts";
import type { Menubar } from "../app/menubar";
import type { AppWindow } from "../app/window";
import type { BlameService } from "../git/blame";
import type { Ci } from "../ci";
import type { ProjectChecks } from "../checks/service";
import type { DevOps } from "../plugins/devops/service";
import type { ClockifyPlugin } from "../plugins/clockify/service";
import type { Dictation } from "../dictation/service";
import type { ReadAloud } from "../read-aloud";
import type { ProjectChats } from "../project-chats";
import type { PullMerges } from "../project-chats/pull-merges";
import type { Place, Projects } from "../projects/projects";
import type { PullRequestCreation } from "../pull-requests/pull-request-create";
import type { PhoneRemote } from "../remote/phone-remote";
import type { Computers } from "../handoff/computers";
import type { Handoffs } from "../handoff/sender";
import type { RemoteProjects } from "../handoff/remote-projects";
import type { Store } from "../app/store";
import type { TriageService } from "../triage/service";
import type { Updater } from "../app/updater";
import type { DevBuild } from "../app/dev-build";
import type { AgentAccounts } from "../agents/accounts";
import type { ProjectAdding } from "../project-add";
import type { Devices } from "../devices";
import type { ThreadPreviews } from "../preview";
import type { Drafts } from "../drafts";
import type { DragTray } from "../bug-report/drag-tray";
import type { BugReports } from "../bug-report/service";
import type { TreeWatch } from "../git/tree-watch";
import type { ElsewhereWatch } from "../git/elsewhere-watch";
import type { SettingsFile } from "../settings";
import type { Schedules } from "../schedules";
import type { LanguageServers } from "../language-servers";

export interface Services {
  store: Store;
  projects: Projects;
  projectChats: ProjectChats;
  /** Prompts Relay sends on its own; see shared/schedules. */
  schedules: Schedules;
  pullMerges: PullMerges;
  devops: DevOps;
  clockify: ClockifyPlugin;
  triage: TriageService;
  phoneRemote(): PhoneRemote | undefined;
  /** Computers this one hands threads to; unset until Relay has started. */
  handoffs():
    | { computers: Computers; sender: Handoffs; remote: RemoteProjects }
    | undefined;
  login: GiteaLogin;
  /** GitHub, Gitea and Azure DevOps, picked by a repository's server. */
  hosts: PullHosts;
  window: AppWindow;
  menubar: Menubar;
  links: AppLinks;
  projectChecks: ProjectChecks;
  blame: BlameService;
  ci: Ci;
  pullRequestCreation: PullRequestCreation;
  updater: Updater;
  devBuild: DevBuild;
  dictation: Dictation;
  readAloud: ReadAloud;
  agentUpdates: AgentUpdates;
  agentAccounts: AgentAccounts;
  projectAdding: ProjectAdding;
  /** Unsent drafts, shared with phones. */
  drafts: Drafts;
  /** Desktop browser views; absent when Relay runs headless. */
  previews?: ThreadPreviews;
  /** Simulators and emulators in the panel; absent when Relay runs headless. */
  devices?: Devices;
  /** The problem report; absent when Relay runs headless. */
  bugReports?: BugReports;
  /** The report's files floated over GitHub to drag in; absent headless. */
  dragTray?: DragTray;
  /** Tells windows when their working tree may have changed; absent headless. */
  treeWatch?: TreeWatch;
  /** Tells windows when other repositories a thread changed files in may have; absent headless. */
  elsewhereWatch?: ElsewhereWatch;
  /** settings.json, which windows follow and the main process reads. */
  settingsFile: SettingsFile;
  /** Hover, definitions and completion from language servers, one per folder. */
  languageServers: LanguageServers;
}

/** What a method's promise resolves to in the page. */
type Reply<M extends ApiMethod> = Awaited<ReturnType<Api[M]>>;

declare const argTypes: unique symbol;
/**
 * Type-only: what a `takes` handler accepts and hands on, so Handlers can
 * hold it against the method's declared parameters.
 */
type ArgTypes<In, Out> = { readonly [argTypes]?: (args: In) => Out };

/**
 * Handlers for some of the Api's methods, each answering with what the Api
 * declares for it. One written with `takes` must also accept every argument
 * list the declaration allows and parse it into one the declaration allows.
 */
export type Handlers = {
  [M in ApiMethod]?: ((args: unknown[]) => Reply<M> | Promise<Reply<M>>) &
    ArgTypes<Parameters<Api[M]>, Parameters<Api[M]>>;
};

/** `value` as `schema` reads it; the error is the first problem in words, not Zod's JSON list of them. */
function parsed(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(result.error.issues[0]?.message ?? "Invalid request.");
}

/** A handler that parses each argument with the schema at its position. */
export function takes<const S extends readonly z.ZodType[], R>(
  schemas: S,
  handle: (...args: z.output<z.ZodTuple<S, null>>) => R,
): ((args: unknown[]) => R) &
  ArgTypes<z.input<z.ZodTuple<S, null>>, z.output<z.ZodTuple<S, null>>> {
  return (args) =>
    handle(
      ...(schemas.map((schema, i) => parsed(schema, args[i])) as z.output<
        z.ZodTuple<S, null>
      >),
    );
}

/** A missing optional argument reaches the handler as undefined from the page and as null over the phone's JSON. */
export const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);

export const pageSchema = z.number().int().min(1).max(100000);
export const messageIdSchema = z.string().min(1).max(200);
/** The paired computer an agent call asks about, for a project living there; unset for this one. */
export const computerIdSchema = idSchema
  .nullish()
  .transform((v) => v ?? undefined);

/** Where calls about projects on paired computers go, once Relay has started. */
export function remoteProjects(ctx: Pick<ApiContext, "handoffs">) {
  const handoffs = ctx.handoffs();
  if (!handoffs) throw new Error("Relay is still starting.");
  return handoffs.remote;
}

/** The services, plus the lookups most handlers share. */
export function apiContext(services: Services) {
  const { store, projects, projectChats, login, hosts } = services;
  const requireClient = () => login.require();
  /**
   * The host a repository is on. Refs saved before they carried one belong to
   * the project that has that repository, or else to the Gitea account.
   */
  function serverOf(r: Repo) {
    if (r.server) return r.server;
    const servers = new Set(
      (store.get().projects ?? []).flatMap((p) =>
        p.repository &&
        p.repository.owner.toLowerCase() === r.owner.toLowerCase() &&
        p.repository.name.toLowerCase() === r.name.toLowerCase()
          ? [p.repository.server]
          : [],
      ),
    );
    if (servers.size === 1) return [...servers][0];
    return login.client?.account.server;
  }
  const requireServer = (r: Repo) =>
    serverOf(r) ?? requireClient().account.server;
  /** The client for a repository's host. */
  const clientFor = (r: Repo): Promise<PullHost> =>
    hosts.require(requireServer(r));
  const accountOf = (r: Repo) => hosts.accountKey(requireServer(r));
  const repoKey = (r: Repo) => JSON.stringify([accountOf(r), r.owner, r.name]);
  const prKey = (r: Repo & { number: number }) =>
    JSON.stringify([accountOf(r), r.owner, r.name, r.number]);
  /** The checkout linked to a repository: one picked for it, or the project that has it. */
  const linkedFolder = (r: Repo): string | undefined =>
    store.get().folders[repoKey(r)] ??
    (store.get().projects ?? []).find(
      (p) =>
        !p.removed &&
        p.repository &&
        p.repository.server === serverOf(r) &&
        p.repository.owner.toLowerCase() === r.owner.toLowerCase() &&
        p.repository.name.toLowerCase() === r.name.toLowerCase(),
    )?.path;
  function requireFolder(
    r: Repo,
    message = "Link this repository to a local folder first.",
  ) {
    const dir = linkedFolder(r);
    if (!dir) throw new Error(message);
    return dir;
  }
  /** The folder a workspace id names: the project's checkout, or a thread's worktree. */
  async function place(
    where: unknown,
  ): Promise<Place & { projectId: string; chatId?: string }> {
    const { projectId, chatId, worktree } = parseWorkspaceId(
      workspaceIdSchema.parse(where),
    );
    if (!chatId) return { ...(await projects.inspect(projectId)), projectId };
    return {
      root: await projectChats.worktrees.rootFor(projectId, chatId, worktree),
      plain: false,
      projectId,
      chatId,
    };
  }
  const placeRoot = async (where: unknown) => (await place(where)).root;
  /** An unused PR thread is still a review in the making once files are viewed or drafted. */
  function reviewStarted(chat: ChatSummary) {
    if (chat.scope.kind !== "pr") return false;
    let key: string;
    try {
      key = prKey(chat.scope.ref);
    } catch {
      // A Gitea PR while signed out of Gitea keys by an account it can't name.
      return false;
    }
    const p = store.get().progress[key];
    return (
      !!p &&
      (Object.keys(p.read).length > 0 ||
        p.drafts.length > 0 ||
        p.marks.length > 0 ||
        !!p.reviewBody?.trim())
    );
  }
  /** A project's threads as the sidebar and phones list them. */
  const listChats = (projectId: string) =>
    projectChats
      .list(projectId)
      .map((c) =>
        chatIsEmpty(c) && reviewStarted(c) ? { ...c, empty: false } : c,
      );
  return {
    ...services,
    requireClient,
    serverOf,
    requireServer,
    clientFor,
    repoKey,
    prKey,
    linkedFolder,
    requireFolder,
    place,
    placeRoot,
    listChats,
  };
}

export type ApiContext = ReturnType<typeof apiContext>;
