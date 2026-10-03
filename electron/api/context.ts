import { z } from "zod";
import { chatIsEmpty } from "../../shared/chat-activity";
import type { ChatSummary } from "../../shared/projects";
import { parseWorkspaceId, workspaceIdSchema } from "../../shared/workspaces";
import type { Api, ApiMethod, Repo } from "../../shared/types";
import type { AgentUpdates } from "../agents/agent-updates";
import type { AppLinks } from "../app/links";
import type { GiteaLogin } from "../app/login";
import type { Menubar } from "../app/menubar";
import type { AppWindow } from "../app/window";
import type { BlameService } from "../git/blame";
import type { Ci } from "../ci";
import type { ProjectChecks } from "../checks/service";
import type { DevOps } from "../plugins/devops/service";
import type { ClockifyPlugin } from "../plugins/clockify/service";
import type { Dictation } from "../dictation/service";
import type { LiveSyncs } from "../projects/live-sync";
import type { ProjectChats } from "../project-chats";
import type { PullMerges } from "../project-chats/pull-merges";
import type { Place, Projects } from "../projects/projects";
import type { PullRequestCreation } from "../pull-requests/pull-request-create";
import type { PhoneRemote } from "../remote/phone-remote";
import type { Computers } from "../handoff/computers";
import type { Handoffs } from "../handoff/sender";
import type { RoomService } from "../rooms/service";
import type { Store } from "../app/store";
import type { TriageService } from "../triage/service";
import type { Updater } from "../app/updater";

export interface Services {
  store: Store;
  projects: Projects;
  projectChats: ProjectChats;
  pullMerges: PullMerges;
  rooms: RoomService;
  devops: DevOps;
  clockify: ClockifyPlugin;
  triage: TriageService;
  phoneRemote(): PhoneRemote | undefined;
  /** Computers this one hands threads to; unset until Relay has started. */
  handoffs(): { computers: Computers; sender: Handoffs } | undefined;
  login: GiteaLogin;
  window: AppWindow;
  menubar: Menubar;
  links: AppLinks;
  projectChecks: ProjectChecks;
  blame: BlameService;
  ci: Ci;
  liveSyncs: LiveSyncs;
  pullRequestCreation: PullRequestCreation;
  updater: Updater;
  dictation: Dictation;
  agentUpdates: AgentUpdates;
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

/** A handler that parses each argument with the schema at its position. */
export function takes<const S extends readonly z.ZodType[], R>(
  schemas: S,
  handle: (...args: z.output<z.ZodTuple<S, null>>) => R,
): ((args: unknown[]) => R) &
  ArgTypes<z.input<z.ZodTuple<S, null>>, z.output<z.ZodTuple<S, null>>> {
  return (args) =>
    handle(
      ...(schemas.map((schema, i) => schema.parse(args[i])) as z.output<
        z.ZodTuple<S, null>
      >),
    );
}

export const pageSchema = z.number().int().min(1).max(100000);

/** The services, plus the lookups most handlers share. */
export function apiContext(services: Services) {
  const { store, projects, projectChats, login } = services;
  const requireClient = () => login.require();
  const repoKey = (r: { owner: string; name: string }) =>
    JSON.stringify([requireClient().account.id, r.owner, r.name]);
  const prKey = (r: { owner: string; name: string; number: number }) =>
    JSON.stringify([requireClient().account.id, r.owner, r.name, r.number]);
  /** The checkout linked to a Gitea repository, if any. */
  const linkedFolder = (r: Repo): string | undefined =>
    store.get().folders[repoKey(r)];
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
    const { projectId, chatId } = parseWorkspaceId(
      workspaceIdSchema.parse(where),
    );
    if (!chatId) return { ...(await projects.inspect(projectId)), projectId };
    return {
      root: await projectChats.worktreeRoot(projectId, chatId),
      plain: false,
      projectId,
      chatId,
    };
  }
  const placeRoot = async (where: unknown) => (await place(where)).root;
  /** An unused PR thread is still a review in the making once files are viewed or drafted. */
  function reviewStarted(chat: ChatSummary) {
    if (chat.scope.kind !== "pr" || !login.client) return false;
    const p = store.get().progress[prKey(chat.scope.ref)];
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
