import { organizationLabel } from "../../shared/devops";
import {
  sourceControlNames,
  type SourceControlProvider,
} from "../../shared/source-control";
import { DevOpsUnreachable, type DevOps } from "../plugins/devops/service";
import { cliFields, probeCli } from "./clis";

/**
 * Azure DevOps as the work items plugin reaches it: with a personal access
 * token or the `az` login, asking Azure DevOps who that is.
 */
export async function azureDevOps(
  devops: DevOps,
): Promise<SourceControlProvider> {
  const { settings, hasPat } = devops.status();
  // Only the Azure CLI sign-in needs `az`, which takes seconds to start.
  const cli =
    settings.auth === "azure-cli" ? await probeCli("azure-devops") : {};
  const base = {
    kind: "azure-devops",
    name: sourceControlNames["azure-devops"],
    cli: "az",
    enabled: settings.enabled,
    ...cliFields(cli),
  } as const;
  if (!settings.organization)
    return { ...base, signIn: "signed-out", fix: "set-up" };
  const server = organizationLabel(settings.organization);
  if (settings.auth === "pat" && !hasPat)
    return {
      ...base,
      server,
      signIn: "signed-out",
      fix: "sign-in",
      detail: "Add a personal access token, or sign in with the Azure CLI.",
    };
  if (settings.auth === "azure-cli" && !cli.path)
    return {
      ...base,
      server,
      signIn: "unknown",
      fix: "link",
      detail: cli.error ?? "Install it with `brew install azure-cli`.",
    };
  try {
    const account = await devops.whoAmI();
    return {
      ...base,
      server,
      signIn: "signed-in",
      ...(account ? { account } : {}),
    };
  } catch (error) {
    const detail = (error as Error).message;
    if (error instanceof DevOpsUnreachable)
      return { ...base, server, signIn: "unknown", detail };
    // A token Azure DevOps turns down is fixed here; an `az` login in a terminal.
    return {
      ...base,
      server,
      signIn: "signed-out",
      detail,
      ...(settings.auth === "pat" ? { fix: "sign-in" as const } : {}),
    };
  }
}
