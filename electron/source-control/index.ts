import {
  isSourceControlOn,
  sourceControlKinds,
  type SourceControlKind,
  type SourceControlProvider,
} from "../../shared/source-control";
import type { GiteaLogin } from "../app/login";
import type { DevOps } from "../devops";
import type { Store } from "../store";
import { azureDevOps } from "./azure-devops";
import { gitea } from "./gitea";
import { github } from "./github";

export { applyLinkedTools, linkCli, resolveCliPath, unlinkCli } from "./clis";

/** Every host, as the tools and accounts on this computer report them. */
export function sourceControlStatus(
  store: Store,
  login: GiteaLogin,
  devops: DevOps,
): Promise<SourceControlProvider[]> {
  const settings = store.get().sourceControl;
  const on = (kind: SourceControlKind) => isSourceControlOn(settings, kind);
  return Promise.all([
    github(on("github")),
    gitea(store, login, on("gitea")),
    azureDevOps(devops),
  ]);
}

/**
 * A host turned off stops showing its CI; Azure DevOps keeps its own switch,
 * the one its work item cards follow.
 */
export async function setSourceControlEnabled(
  store: Store,
  devops: DevOps,
  kind: SourceControlKind,
  enabled: boolean,
) {
  if (kind === "azure-devops") {
    await devops.setEnabled(enabled);
    return;
  }
  await store.update((s) => {
    const off = new Set(s.sourceControl?.off ?? []);
    if (enabled) off.delete(kind);
    else off.add(kind);
    s.sourceControl = {
      ...s.sourceControl,
      off: sourceControlKinds.filter((k) => off.has(k)),
    };
  });
}
