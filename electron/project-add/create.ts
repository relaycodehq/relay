import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { NewProject } from "../../shared/projects";
import { git } from "../git/git";
import { createGithubRepo, githubLogin } from "./github";

const gitignore = ".DS_Store\n.env\n";

/**
 * Throws, before anything is made, when Git couldn't make the first commit.
 * Asked from the nearest folder that's there, for configs that differ by folder.
 */
async function checkIdentity(location: string) {
  let dir = location;
  while (
    !(await stat(dir).then(
      (s) => s.isDirectory(),
      () => false,
    )) &&
    dirname(dir) !== dir
  )
    dir = dirname(dir);
  const asked = (key: string) =>
    git(dir, ["config", key]).then(
      (v) => v.trim(),
      () => "",
    );
  const [name, email] = await Promise.all([
    asked("user.name"),
    asked("user.email"),
  ]);
  if (!name || !email)
    throw new Error(
      "Git doesn't know who you are yet. Run `git config --global user.name` and `user.email`, or turn off Set up git.",
    );
}

/**
 * Makes the folder for a new project: with git, a .gitignore and a first
 * commit when asked, and on GitHub too. Refuses a folder that's there.
 */
export async function createProjectFolder(
  spec: NewProject,
  dest: string,
  onStep: (step: string, progress: number) => void,
) {
  if (spec.git) await checkIdentity(spec.location);
  const github = spec.github && spec.git ? await githubLogin() : null;
  onStep("Creating the folder", 0.1);
  // Not recursive at the end: a folder that's there already must fail.
  await mkdir(spec.location, { recursive: true });
  await mkdir(dest);
  if (!spec.git) return;
  onStep("git init", 0.3);
  await git(dest, ["init"]);
  await writeFile(join(dest, ".gitignore"), gitignore, { flag: "wx" });
  onStep("First commit", 0.5);
  await git(dest, ["add", ".gitignore"]);
  await git(dest, ["commit", "-m", `Start ${spec.name}`]);
  if (!github) return;
  onStep(`Creating ${github.login}/${spec.name} on GitHub`, 0.7);
  await createGithubRepo(
    github.path,
    dest,
    spec.name,
    spec.private ? "private" : "public",
  );
}
