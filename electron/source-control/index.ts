import {
  isSourceControlOn,
  sourceControlKinds,
  type SourceControlKind,
  type SourceControlProvider,
} from "../../shared/source-control";
import { giteaOn, type GiteaLogin } from "../app/login";
import type { Store } from "../app/store";
import { gitea } from "./gitea";
import { github } from "./github";

export { applyLinkedTools, linkCli, resolveCliPath, unlinkCli } from "./clis";

/**
 * The pull request and CI hosts, as the tools and accounts on this computer
 * report them. Azure DevOps is the work items plugin's, in Settings → Plugins.
 */
export function sourceControlStatus(
  store: Store,
  login: GiteaLogin,
): Promise<SourceControlProvider[]> {
  const settings = store.get().sourceControl;
  const on = (kind: SourceControlKind) => isSourceControlOn(settings, kind);
  return Promise.all([
    github(on("github")),
    gitea(store, login, giteaOn(store.get())),
  ]);
}

/** A host turned off stops showing its CI; Gitea off isn't signed in to at all. */
export async function setSourceControlEnabled(
  store: Store,
  kind: SourceControlKind,
  enabled: boolean,
) {
  await store.update((s) => {
    const off = new Set(s.sourceControl?.off ?? []);
    const on = new Set(s.sourceControl?.on ?? []);
    (enabled ? off : on).delete(kind);
    (enabled ? on : off).add(kind);
    s.sourceControl = {
      ...s.sourceControl,
      off: sourceControlKinds.filter((k) => off.has(k)),
      on: sourceControlKinds.filter((k) => on.has(k)),
    };
  });
}
