import { organizationLabel } from "../../shared/devops";
import {
  sourceControlNames,
  type SourceControlProvider,
} from "../../shared/source-control";
import { DevOpsUnreachable } from "../plugins/devops/client";
import type { DevOps } from "../plugins/devops/service";
import { runExecutable } from "../platform/executables";
import { cliFields, probeCli, probeTimeout } from "./clis";

const installAz =
  process.platform === "darwin"
    ? "Install it with `brew install azure-cli`."
    : process.platform === "win32"
      ? "Install it with `winget install -e --id Microsoft.AzureCLI`."
      : "Install it from https://aka.ms/InstallAzureCLI.";

/**
 * Azure DevOps pull requests and Pipelines through the `az` login, which
 * reaches every organization the account is in.
 */
export async function azureCli(
  enabled: boolean,
): Promise<SourceControlProvider> {
  const cli = await probeCli("azure-devops");
  const base = {
    kind: "azure-devops",
    name: sourceControlNames["azure-devops"],
    cli: "az",
    enabled,
    ...cliFields(cli),
  } as const;
  if (!cli.path)
    return {
      ...base,
      signIn: "unknown",
      fix: "link",
      detail: cli.error ?? installAz,
    };
  if (!cli.version) return { ...base, signIn: "unknown", detail: cli.error };
  const run = await runExecutable(
    cli.path,
    ["account", "show", "--query", "user.name", "--output", "tsv"],
    probeTimeout,
  );
  return { ...base, ...parseAzAccount(run) };
}

/** What `az account show` says about the login. */
export function parseAzAccount(run: {
  code: number | null;
  stdout: string;
  output: string;
  timedOut?: boolean;
}): Pick<SourceControlProvider, "signIn" | "account" | "detail"> {
  if (run.timedOut)
    return { signIn: "unknown", detail: "`az` didn't answer in time." };
  const account = run.stdout.trim();
  if (run.code === 0 && account) return { signIn: "signed-in", account };
  if (/az login/i.test(run.output))
    return {
      signIn: "signed-out",
      detail: "Run `az login` in a terminal to sign in.",
    };
  return { signIn: "unknown", detail: run.output.trim().slice(-300) };
}

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
      detail: cli.error ?? installAz,
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
