import { net } from "electron";
import { z } from "zod";
import { emptyWorkspace } from "../../shared/types";
import { workspaceSchema } from "../../shared/validation";
import { seal } from "../app/login";
import { Gitea } from "../pull-requests/gitea";
import { teaSetup, teaToken } from "../source-control/tea";
import { GITHUB_SERVER } from "../../shared/source-control";
import { takes, type ApiContext, type Handlers } from "./context";

/** Signing in and out of Gitea, and what the window starts from. */
export function accountHandlers(ctx: ApiContext) {
  const { store, login, links, triage, projectChecks, blame } = ctx;
  /** Whose Pull requests page it is: the Gitea account's, else GitHub's, as the page picks. */
  const pageAccount = () => login.client?.account.id ?? GITHUB_SERVER;
  async function signIn(server: string, token: string) {
    login.cancelRestore();
    const next = await Gitea.connect(server, token, (url, options) =>
      net.fetch(url, options),
    );
    const encryptedToken = (await seal(token)) ?? undefined;
    next.account.persistent = encryptedToken !== undefined;
    await store.update((s) => {
      s.account = next.account;
      s.encryptedToken = encryptedToken;
    });
    triage.cancel();
    projectChecks.stop();
    blame.dispose();
    login.client?.dispose();
    login.client = next;
    return next.account;
  }
  return {
    bootstrap: () => {
      const client = login.client;
      return {
        account: client?.account ?? null,
        platform: process.platform,
        loginRestore: login.restore,
        savedServer: store.get().account?.server,
        sidebarView: store.get().sidebarView,
        pendingUrl: links.take(),
        workspace: workspaceSchema.parse(
          store.get().workspaces?.[pageAccount()] ?? emptyWorkspace(),
        ),
      };
    },
    githubAccount: () => ctx.github.account(),
    retryLoginRestore: () => {
      void login.restoreSaved(store);
    },
    cancelLoginRestore: () => {
      login.cancelRestore();
    },
    saveWorkspace: takes([workspaceSchema], async (workspace) => {
      const accountId = pageAccount();
      await store.update((s) => {
        s.workspaces ??= {};
        s.workspaces[accountId] = workspace;
      });
    }),
    connect: takes(
      [z.string().max(2048), z.string().trim().min(1).max(4096)],
      (server, token) => signIn(server, token),
    ),
    teaSetup: () => teaSetup(),
    connectWithTea: takes([z.string().max(200)], async (name) => {
      const login = (await teaSetup()).logins.find((l) => l.name === name);
      if (!login) throw new Error(`tea has no login called ${name}.`);
      return signIn(login.url, await teaToken(login));
    }),
    disconnect: async () => {
      blame.dispose();
      projectChecks.stop();
      login.cancelRestore();
      await store.update((s) => {
        delete s.account;
        delete s.encryptedToken;
      });
      triage.cancel();
      login.client?.dispose();
      login.client = null;
    },
  } satisfies Handlers;
}
