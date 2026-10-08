import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { NewProject } from "../../shared/projects";
import { git } from "../git/git";
import { createGithubRepo, githubLogin } from "./github";

const gitignore = ".DS_Store\n.env\n";

/**
 * Throws, before anything is made, when Git couldn't make the first commit.
 * Asked from the nearest folder that's there, for configs that differ by folder.
 */
async function checkIdentity(location: string, signal: AbortSignal) {
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
    git(dir, ["config", key], { signal }).then(
      (v) => v.trim(),
      () => "",
    );
  const [name, email] = await Promise.all([
    asked("user.name"),
    asked("user.email"),
  ]);
  signal.throwIfAborted();
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
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (spec.git) await checkIdentity(spec.location, signal);
  const github = spec.github && spec.git ? await githubLogin(signal) : null;
  signal.throwIfAborted();
  onStep("Creating the folder", 0.1);
  await mkdir(spec.location, { recursive: true });
  signal.throwIfAborted();
  // Only clean up the destination if this call made it.
  await mkdir(dest);
  let publishing = false;
  try {
    signal.throwIfAborted();
    if (!spec.git) return;
    onStep("git init", 0.3);
    await git(dest, ["init"], { signal });
    signal.throwIfAborted();
    await writeFile(join(dest, ".gitignore"), gitignore, {
      flag: "wx",
      signal,
    });
    onStep("First commit", 0.5);
    await git(dest, ["add", ".gitignore"], { signal });
    await git(dest, ["commit", "-m", `Start ${spec.name}`], { signal });
    signal.throwIfAborted();
    if (!github) return;
    onStep(`Creating ${github.login}/${spec.name} on GitHub`, 0.7);
    signal.throwIfAborted();
    publishing = true;
    await createGithubRepo(
      github.path,
      dest,
      spec.name,
      spec.private ? "private" : "public",
      signal,
    );
    signal.throwIfAborted();
  } catch (error) {
    if (publishing) {
      // GitHub may have accepted the request already; preserve the local history.
      throw new Error(
        `${signal.aborted ? "Cancelled." : (error as Error).message} Your local repository is at ${dest}; use Open a folder to add it. Check GitHub before trying publication again.`,
      );
    }
    await rm(dest, { recursive: true, force: true });
    if (signal.aborted) throw new Error("Cancelled.");
    throw error;
  }
}
