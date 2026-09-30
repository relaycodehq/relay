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
import { teaSetup } from "./tea";
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

async function gitea(store: Store, login: GiteaLogin, enabled: boolean) {
  const base = {
    kind: "gitea",
    name: sourceControlNames.gitea,
    cli: "tea",
    enabled,
  } as const;
  const tea = await teaSetup();
  const saved = store.get().account;
  const provider: SourceControlProvider = {
    ...base,
    ...(tea.path ? { path: tea.path } : {}),
    ...(tea.linked ? { linked: true } : {}),
    ...(tea.version ? { version: tea.version } : {}),
    signIn: "signed-out",
  };
  if (saved) {
    provider.account = `${saved.user.login} on ${new URL(saved.server).host}`;
    if (login.client) provider.signIn = "signed-in";
    else {
      provider.signIn = "unknown";
      provider.detail =
        login.restore === "failed"
          ? "The saved token couldn't be read from the system credential store."
          : "Unlocking the saved token…";
    }
    return provider;
  }
  provider.detail = tea.error
    ? tea.error
    : tea.logins.length
      ? `tea is logged in to ${tea.logins.map((l) => new URL(l.url).host).join(", ")}. Connect to use one.`
      : tea.path
        ? "Connect with a token, or run `tea login add` and connect with that login."
        : "Connect with a token, or link tea to sign in with one of its logins.";
  return provider;
}

/** Every host, as the tools and accounts on this computer report them. */
export function sourceControlStatus(
  store: Store,
  login: GiteaLogin,
): Promise<SourceControlProvider[]> {
  const settings = store.get().sourceControl;
  const on = (kind: SourceControlKind) => isSourceControlOn(settings, kind);
  return Promise.all([github(on("github")), gitea(store, login, on("gitea"))]);
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

const clis = {
  github: {
    name: "the GitHub CLI",
    says: (output: string) => /^gh version /.test(output),
  },
  gitea: {
    name: "tea",
    says: (output: string) =>
      /^Version: /.test(output.replace(/\u001b\[[0-9;]*m/g, "")),
  },
} satisfies Record<
  SourceControlKind,
  { name: string; says: (output: string) => boolean }
>;

/** Links the program at `path` as a host's CLI if it says it is that CLI. */
export async function linkCli(
  store: Store,
  kind: SourceControlKind,
  path: string,
) {
  const run = await runExecutable(path, ["--version"], 15_000);
  if (run.code !== 0 || !clis[kind].says(run.stdout))
    throw new Error(
      `That doesn't look like ${clis[kind].name}: it didn't say which version it is.${run.output.trim() ? `\n${run.output.trim().slice(-300)}` : ""}`,
    );
  await relink(store, kind, path);
}

/** Forgets a linked CLI; Relay then searches again. */
export const unlinkCli = (store: Store, kind: SourceControlKind) =>
  relink(store, kind, undefined);

async function relink(store: Store, kind: SourceControlKind, path?: string) {
  await store.update((s) => {
    const paths = { ...s.sourceControl?.paths };
    if (path) paths[kind] = path;
    else delete paths[kind];
    s.sourceControl = { ...s.sourceControl, paths };
  });
  applyLinkedTools(store);
}

export function applyLinkedTools(store: Store) {
  const { github, gitea } = store.get().sourceControl?.paths ?? {};
  setLinkedTools({
    ...(github ? { gh: github } : {}),
    ...(gitea ? { tea: gitea } : {}),
  });
}
