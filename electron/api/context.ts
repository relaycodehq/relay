import { z } from "zod";
import { parseWorkspaceId, workspaceIdSchema } from "../../shared/workspaces";
import type { ApiMethod, Repo } from "../../shared/types";
import type { AgentUpdates } from "../agent-updates";
import type { AppLinks } from "../app/links";
import type { GiteaLogin } from "../app/login";
import type { Menubar } from "../app/menubar";
import type { AppWindow } from "../app/window";
import type { BlameService } from "../blame";
import type { Ci } from "../ci";
import type { ProjectChecks } from "../checks/service";
import type { DevOps } from "../devops";
import type { Dictation } from "../dictation/service";
import type { LiveSyncs } from "../live-sync";
import type { ProjectChats } from "../project-chats";
import type { Place, Projects } from "../projects";
import type { PullRequestCreation } from "../pull-request-create";
import type { PhoneRemote } from "../remote/phone-remote";
import type { RoomService } from "../rooms/service";
import type { Store } from "../store";
import type { TriageService } from "../triage/service";
import type { Updater } from "../updater";

export interface Services {
  store: Store;
  projects: Projects;
  projectChats: ProjectChats;
  rooms: RoomService;
  devops: DevOps;
  triage: TriageService;
  phoneRemote(): PhoneRemote | undefined;
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

/**
 * Handlers for some of the Api's methods. Grouped methods can share one
 * function that tells them apart by name.
 */
export type Handlers = {
  [M in ApiMethod]?: (args: unknown[], method: M) => unknown;
};

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
  return {
    ...services,
    requireClient,
    repoKey,
    prKey,
    linkedFolder,
    requireFolder,
    place,
    placeRoot,
  };
}

export type ApiContext = ReturnType<typeof apiContext>;
