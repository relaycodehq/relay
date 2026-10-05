// Git's rules for a new branch's name: `git check-ref-format refs/heads/<name>`
// plus what `git branch` refuses on top, a leading dash and HEAD.

const forbidden: [RegExp, string][] = [
  [/\s/, "spaces"],
  [/\.\./, ".."],
  [/@\{/, "@{"],
  [/[~^:?*[\\]/, ""],
];

/** Why git wouldn't take `name` for a new branch; undefined when it would. */
export function branchNameProblem(name: string): string | undefined {
  if (!name) return "Give the branch a name.";
  if (name.startsWith("-")) return "A branch name can't start with -.";
  if (name === "HEAD") return "HEAD can't be a branch name.";
  if (/[\x00-\x1f\x7f]/.test(name))
    return "Branch names can't contain control characters.";
  for (const [pattern, what] of forbidden) {
    const found = name.match(pattern);
    if (found) return `Branch names can't contain ${what || found[0]}.`;
  }
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//"))
    return "Every part between slashes needs a name.";
  if (name.endsWith(".")) return "A branch name can't end with a dot.";
  for (const part of name.split("/")) {
    if (part.startsWith("."))
      return "A part between slashes can't start with a dot.";
    if (part.endsWith(".lock"))
      return "A part between slashes can't end with .lock.";
  }
}
