// GitHub as the `gh` CLI's login sees it: its repositories to clone, and
// a new repository for a new project.
import type { GithubRepo, GithubRepos } from "../../shared/projects";
import { findExecutable, runExecutable } from "../platform/executables";

const gh = () => findExecutable("gh").catch(() => null);

/** The repositories the login owns, collaborates on, or sees through its organisations. */
export async function githubRepos(): Promise<GithubRepos> {
  const path = await gh();
  if (!path)
    return {
      problem:
        "Install the GitHub CLI (`brew install gh`) to list your repositories.",
    };
  const [user, list] = await Promise.all([
    runExecutable(path, ["api", "user", "--jq", ".login"], 15000),
    runExecutable(
      path,
      [
        "api",
        "user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member",
      ],
      20000,
    ),
  ]);
  if (user.code !== 0 || list.code !== 0) {
    const said = `${user.output}\n${list.output}`;
    return {
      problem: /auth login|not logged|401/i.test(said)
        ? "Run `gh auth login` in a terminal to see your repositories."
        : user.timedOut || list.timedOut
          ? "GitHub didn't answer in time."
          : "GitHub didn't list your repositories. Paste a URL instead.",
    };
  }
  return { login: user.stdout.trim(), repos: parseRepos(list.stdout) };
}

export function parseRepos(json: string): GithubRepo[] {
  const rows = JSON.parse(json) as Record<string, unknown>[];
  return rows.flatMap((r) =>
    typeof r.full_name === "string" && typeof r.clone_url === "string"
      ? [
          {
            full: r.full_name,
            description: typeof r.description === "string" ? r.description : "",
            private: r.private === true,
            pushed: Date.parse(String(r.pushed_at ?? r.updated_at ?? "")) || 0,
            url: r.clone_url,
          },
        ]
      : [],
  );
}

/**
 * Git options that let a GitHub clone over HTTPS use the `gh` login when no
 * other credential helper answers, as `gh repo clone` does.
 */
export async function githubCredentials(host: string): Promise<string[]> {
  if (host !== "github.com") return [];
  const path = await gh();
  if (!path) return [];
  return [
    "-c",
    `credential.https://github.com.helper=!${JSON.stringify(path)} auth git-credential`,
  ];
}

/** The `gh` login, or why there's none; asked before anything is made. */
export async function githubLogin() {
  const path = await gh();
  if (!path)
    throw new Error(
      "Install the GitHub CLI (`brew install gh`) to create the repository.",
    );
  const user = await runExecutable(
    path,
    ["api", "user", "--jq", ".login"],
    15000,
  );
  if (user.code !== 0)
    throw new Error(
      "Run `gh auth login` in a terminal so Relay can create the repository.",
    );
  return { path, login: user.stdout.trim() };
}

/** Creates `owner/name` from the repository at `dir` and pushes its branch. */
export async function createGithubRepo(
  gh: string,
  dir: string,
  name: string,
  visibility: "private" | "public",
) {
  const run = await runExecutable(
    gh,
    [
      "repo",
      "create",
      name,
      `--${visibility}`,
      "--source",
      dir,
      "--remote",
      "origin",
      "--push",
    ],
    120000,
  );
  if (run.code !== 0)
    throw new Error(
      `The project is made, but GitHub didn't take the repository: ${run.output.trim().slice(-400)}`,
    );
}
