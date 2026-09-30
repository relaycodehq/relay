import { net } from "electron";
import { z } from "zod";
import { emptyWorkspace } from "../../shared/types";
import { workspaceSchema } from "../../shared/validation";
import { seal } from "../app/login";
import { Gitea } from "../gitea";
import { teaSetup, teaToken } from "../source-control/tea";
import type { ApiContext, Handlers } from "./context";

/** Signing in and out of Gitea, and what the window starts from. */
export function accountHandlers(ctx: ApiContext) {
  const {
    store,
    login,
    links,
    triage,
    rooms,
    liveSyncs,
    projectChecks,
    blame,
    requireClient,
  } = ctx;
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
          (client && store.get().workspaces?.[client.account.id]) ??
            emptyWorkspace(),
        ),
      };
    },
    retryLoginRestore: () => {
      void login.restoreSaved(store);
    },
    cancelLoginRestore: () => {
      login.cancelRestore();
    },
    saveWorkspace: async (args) => {
      const accountId = requireClient().account.id;
      const workspace = workspaceSchema.parse(args[0]);
      await store.update((s) => {
        s.workspaces ??= {};
        s.workspaces[accountId] = workspace;
      });
    },
    connect: (args) =>
      signIn(
        z.string().max(2048).parse(args[0]),
        z.string().trim().min(1).max(4096).parse(args[1]),
      ),
    teaSetup: () => teaSetup(),
    connectWithTea: async (args) => {
      const name = z.string().max(200).parse(args[0]);
      const login = (await teaSetup()).logins.find((l) => l.name === name);
      if (!login) throw new Error(`tea has no login called ${name}.`);
      return signIn(login.url, await teaToken(login));
    },
    disconnect: async () => {
      await liveSyncs.stopAll();
      await rooms.dispose();
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
