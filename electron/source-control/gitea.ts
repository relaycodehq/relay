import {
  sourceControlNames,
  type SourceControlProvider,
} from "../../shared/source-control";
import type { GiteaLogin } from "../app/login";
import type { Store } from "../app/store";
import { cliFields } from "./clis";
import { teaSetup } from "./tea";

/** The Gitea account Relay is signed in to, and the `tea` it can sign in with. */
export async function gitea(
  store: Store,
  login: GiteaLogin,
  enabled: boolean,
): Promise<SourceControlProvider> {
  const tea = await teaSetup();
  const base = {
    kind: "gitea",
    name: sourceControlNames.gitea,
    cli: "tea",
    enabled,
    ...cliFields(tea),
  } as const;
  const saved = store.get().account;
  if (!saved) {
    const hosts = tea.logins.map((l) => new URL(l.url).host);
    return {
      ...base,
      signIn: "signed-out",
      fix: "connect",
      ...(tea.error
        ? { detail: tea.error }
        : hosts.length
          ? { detail: `tea has a login for ${hosts.join(", ")}.` }
          : {}),
    };
  }
  const who = {
    account: saved.user.login,
    server: new URL(saved.server).host,
  };
  if (login.client) return { ...base, ...who, signIn: "signed-in" };
  return {
    ...base,
    ...who,
    signIn: "unknown",
    detail:
      login.restore === "failed"
        ? "The saved token couldn't be read from the system credential store."
        : "Unlocking the saved token…",
  };
}
