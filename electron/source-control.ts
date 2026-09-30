import { parseVersion } from "../shared/agent-updates";
import {
  isSourceControlOn,
  parseGhAuth,
  sourceControlKinds,
  sourceControlNames,
  type SourceControlKind,
  type SourceControlProvider,
} from "../shared/source-control";
import type { GiteaLogin } from "./app/login";
import {
  findExecutable,
  linkedTool,
  runExecutable,
  setLinkedTools,
} from "./executables";
import type { FetchRequest } from "./gitea";
import type { Store } from "./store";

const probeTimeout = 8000;
const ghInstallHint =
  "Install the GitHub CLI (`brew install gh`, or cli.github.com), or link it here if it lives somewhere else.";

const firstLine = (text: string) => text.split(/\r?\n/, 1)[0].trim();

async function github(enabled: boolean): Promise<SourceControlProvider> {
  const linked = !!linkedTool("gh");
  const base = {
    kind: "github",
    name: sourceControlNames.github,
    cli: "gh",
    enabled,
    ...(linked ? { linked } : {}),
  } as const;
  let path: string;
  try {
    path = await findExecutable("gh");
  } catch (error) {
    return {
      ...base,
      signIn: "unknown",
      detail: linked ? (error as Error).message : ghInstallHint,
    };
  }
  const [version, auth] = await Promise.all([
    runExecutable(path, ["--version"], probeTimeout),
    runExecutable(
      path,
      ["auth", "status", "--hostname", "github.com"],
      probeTimeout,
    ),
  ]);
  const number = parseVersion(firstLine(version.stdout));
  if (version.code !== 0 || !number)
    return {
      ...base,
      path,
      signIn: "unknown",
      detail: `That program doesn't say which version it is.${version.output.trim() ? ` ${firstLine(version.output)}` : ""}`,
    };
  const result = auth.timedOut
    ? ({ signIn: "unknown", detail: "`gh` didn't answer in time." } as const)
    : parseGhAuth(auth.output, auth.code);
  return { ...base, path, version: number, ...result };
}

/** The version a Gitea or Forgejo server reports; it needs no login. */
async function giteaVersion(server: string, fetchRequest: FetchRequest) {
  try {
    const response = await fetchRequest(`${server}/api/v1/version`, {
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return undefined;
    const { version } = (await response.json()) as { version?: unknown };
    return typeof version === "string" ? parseVersion(version) : undefined;
  } catch {
    return undefined;
  }
}

async function gitea(
  store: Store,
  login: GiteaLogin,
  fetchRequest: FetchRequest,
  enabled: boolean,
): Promise<SourceControlProvider> {
  const base = {
    kind: "gitea",
    name: sourceControlNames.gitea,
    enabled,
  } as const;
  const saved = store.get().account;
  if (!saved)
    return {
      ...base,
      signIn: "signed-out",
      detail: "Connect your account under Account.",
    };
  const version = await giteaVersion(saved.server, fetchRequest);
  const common = {
    ...base,
    ...(version ? { version } : {}),
    account: saved.user.login,
  };
  if (login.client) return { ...common, signIn: "signed-in" };
  return {
    ...common,
    signIn: "unknown",
    detail:
      login.restore === "failed"
        ? "The saved token couldn't be read from the system credential store."
        : "Unlocking the saved token…",
  };
}

/** Every host, as the tools and accounts on this computer report them. */
export function sourceControlStatus(
  store: Store,
  login: GiteaLogin,
  fetchRequest: FetchRequest,
): Promise<SourceControlProvider[]> {
  const settings = store.get().sourceControl;
  const on = (kind: SourceControlKind) => isSourceControlOn(settings, kind);
  return Promise.all([
    github(on("github")),
    gitea(store, login, fetchRequest, on("gitea")),
  ]);
}

export async function setSourceControlEnabled(
  store: Store,
  kind: SourceControlKind,
  enabled: boolean,
) {
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

/** Links the `gh` at `path`, or forgets the linked one; Relay then searches again. */
export async function relinkGh(store: Store, path?: string) {
  await store.update((s) => {
    const paths = { ...s.sourceControl?.paths };
    if (path) paths.github = path;
    else delete paths.github;
    s.sourceControl = { ...s.sourceControl, paths };
  });
  applyLinkedTools(store);
}

export function applyLinkedTools(store: Store) {
  const github = store.get().sourceControl?.paths?.github;
  setLinkedTools(github ? { gh: github } : {});
}
