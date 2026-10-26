import type { AgentUpdates } from "../agents/agent-updates";
import { signInCursor, signOutCursor } from "../agents/cursor/account";
import type { Dispatch } from "../api";
import type { GiteaLogin } from "../app/login";
import { computerName } from "../platform/computer-name";
import type { Projects } from "../projects/projects";
import type { PhoneRemote } from "../remote/phone-remote";
import type { ChatSummary } from "../../shared/projects";
import { errorMessage } from "../../shared/error-message";
import type { ControlApi, CursorLogin, ThreadRow } from "./control";
import type { HeadlessSpeech } from "./speech";
import type { HeadlessUpdater } from "./updater";
import { headlessVersion } from "./version";

/** What the `relay` command can ask a running headless Relay. */
export function controlApi({
  home,
  startedAt,
  remote,
  projects,
  login,
  listChats,
  agentUpdates,
  updater,
  speech,
  dispatch,
  stop,
}: {
  home: string;
  startedAt: number;
  remote: PhoneRemote;
  projects: Projects;
  login: GiteaLogin;
  listChats: (projectId: string) => ChatSummary[];
  agentUpdates: AgentUpdates;
  updater: HeadlessUpdater;
  speech: HeadlessSpeech;
  dispatch: Dispatch;
  /** Stops Relay; `detach` leaves the agents' sessions running. */
  stop: (detach: boolean) => void;
}): ControlApi {
  /** Cursor's sign-in, done on another device from the link it gives. */
  let cursorLogin: CursorLogin | undefined;

  const listThreads = async (): Promise<ThreadRow[]> => {
    const list = await projects.list(login.client);
    return list
      .flatMap((project) =>
        listChats(project.id)
          .filter((chat) => !chat.empty && !chat.archivedAt)
          .map((chat) => threadRow(chat, project.name)),
      )
      .sort((a, b) => b.updated - a.updated);
  };

  return {
    async status() {
      const known = agentUpdates.current;
      const [state, list, versions] = await Promise.all([
        remote.state(),
        projects.list(login.client),
        // Asked once; after that a stale answer goes out while a fresh one is found.
        known.checkedAt ? known : agentUpdates.check(),
      ]);
      if (known.checkedAt && Date.now() - known.checkedAt > 5 * 60_000)
        void agentUpdates.check().catch(() => {});
      const rows = list.flatMap((p) => listChats(p.id));
      return {
        version: headlessVersion,
        name: computerName(),
        pid: process.pid,
        startedAt,
        home,
        remote: state,
        projects: list.length,
        threads: {
          working: rows.filter((c) => c.running).length,
          waiting: rows.filter((c) => c.waiting).length,
          total: rows.filter((c) => !c.empty && !c.archivedAt).length,
        },
        agents: versions.agents,
        update: updater.now,
      };
    },
    async pair(pipe = false) {
      if (pipe) await remote.setPipes(true);
      else if (!(await remote.state()).listening) await remote.setEnabled(true);
      const pairing = await remote.pairing({ pipe });
      return { ...pairing, remote: await remote.state() };
    },
    update: (check) => (check ? updater.check() : updater.install()),
    remote: (enabled) => remote.setEnabled(enabled),
    removeDevice: (id) => remote.revoke(id),
    projects: () => projects.list(login.client),
    addProject: (path) => projects.add(path, login.client),
    removeProject: async (id) => {
      await dispatch("removeProject", [id]);
    },
    threads: listThreads,
    async stop({ force, detach }) {
      if (!force && !detach) {
        const working = (await listThreads()).filter(
          (t) => t.state === "working",
        );
        if (working.length)
          throw new Error(
            `${working.length === 1 ? "A thread is" : `${working.length} threads are`} still working: ${working
              .map((t) => `“${t.title}”`)
              .join(
                ", ",
              )}. Stop with --force to end them, or restart to keep them going.`,
          );
      }
      // Answered first; the socket closes as Relay goes.
      setTimeout(() => stop(!!detach), 50);
    },
    async cursorSignIn() {
      if (cursorLogin?.status === "waiting" && cursorLogin.url)
        return { ...cursorLogin };
      const login: CursorLogin = { status: "waiting" };
      cursorLogin = login;
      await new Promise<void>((resolve, reject) => {
        signInCursor((url) => {
          login.url = url;
          resolve();
        }).then(
          () => {
            login.status = "done";
            void agentUpdates.check(true);
            resolve();
          },
          (e) => {
            login.status = "failed";
            login.error = errorMessage(e);
            reject(e);
          },
        );
      });
      return { ...login };
    },
    cursorSignInState: async () => (cursorLogin ? { ...cursorLogin } : null),
    async cursorSignOut() {
      cursorLogin = undefined;
      await signOutCursor();
      await agentUpdates.check(true);
    },
    speech: async () => speech.state(),
    installSpeech: async (engine, voice) => speech.install(engine, voice),
    removeSpeech: (engine, voice) => speech.remove(engine, voice),
    call: (method, args) =>
      dispatch(method as Parameters<Dispatch>[0], args.slice(0, 10)),
  };
}

function threadRow(chat: ChatSummary, project: string): ThreadRow {
  const state: ThreadRow["state"] = chat.sentTo
    ? "away"
    : chat.running
      ? "working"
      : chat.waiting
        ? "waiting"
        : chat.settledAt || chat.archivedAt
          ? "settled"
          : "idle";
  return {
    id: chat.id,
    projectId: chat.projectId,
    project,
    title: chat.title,
    ...(chat.provider ? { provider: chat.provider } : {}),
    state,
    updated: chat.updated,
    ...(chat.branch ? { branch: chat.branch } : {}),
    ...(chat.sentTo
      ? { computer: chat.sentTo.computer }
      : chat.cameFrom && !chat.cameFrom.returnedAt
        ? { computer: chat.cameFrom.computer }
        : {}),
  };
}
