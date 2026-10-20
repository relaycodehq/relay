import {
  linkName,
  type LinkSuggestion,
  type Project,
} from "../../../shared/projects";

/** Repositories beside `project` that share its name's first word, like acme-api beside acme-web. */
export function relatedFolders(
  project: Project,
  suggestions: readonly LinkSuggestion[],
) {
  const prefix = linkName(project.path).toLowerCase().split(/[-_.]/)[0];
  return suggestions.filter((s) => {
    if (!s.beside || s.path === project.path) return false;
    const name = linkName(s.path).toLowerCase();
    return name.startsWith(prefix) && /^[-_.]/.test(name.slice(prefix.length));
  });
}

/**
 * The project here at `path`. One on a paired computer can have the same path
 * (same user name, same folders) and is a different project.
 */
export const localProjectAt = (projects: readonly Project[], path: string) =>
  projects.find((p) => !p.computer && p.path === path);
