import { z } from "zod";
import type { Project } from "./projects";
export const projectFolderSchema = z
  .string()
  .trim()
  .max(240)
  .transform((value) =>
    value
      .split("/")
      .map((part) => part.trim())
      .join("/"),
  )
  .refine(
    (value) =>
      value === "" ||
      (value.split("/").length <= 8 &&
        value
          .split("/")
          .every(
            (part) =>
              part.length > 0 &&
              part !== "." &&
              part !== ".." &&
              !/[\\\x00-\x1f]/.test(part),
          )),
    "Use group names separated by / (up to eight levels).",
  );
/** One group name typed in the sidebar; nesting comes from where it's created. */
export const projectGroupNameSchema = z
  .string()
  .trim()
  .min(1, "Name the group.")
  .max(60)
  .refine(
    (value) => value !== "." && value !== ".." && !/[/\\\x00-\x1f]/.test(value),
    "Group names can't contain slashes.",
  );
export function joinGroup(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name;
}
export function parentGroup(path: string) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}
/**
 * Moves `path` along with group `from` when that group becomes `to`:
 * renaming passes the new path, ungrouping passes the parent.
 */
export function rebaseGroup(path: string, from: string, to: string) {
  if (path !== from && !path.startsWith(from + "/")) return path;
  const rest = path.slice(from.length + 1);
  return rest ? joinGroup(to, rest) : to;
}
export interface ProjectFolderNode {
  name: string;
  path: string;
  folders: ProjectFolderNode[];
  projects: Project[];
}
/** Builds the sidebar tree; `groups` adds groups that have no projects yet. */
export function projectFolderTree(
  projects: Project[],
  groups: string[] = [],
): ProjectFolderNode {
  const root: ProjectFolderNode = {
    name: "",
    path: "",
    folders: [],
    projects: [],
  };
  const reach = (folder: string) => {
    let node = root;
    for (const name of folder.split("/").filter(Boolean)) {
      const path = joinGroup(node.path, name);
      let child = node.folders.find((f) => f.path === path);
      if (!child) {
        child = { name, path, folders: [], projects: [] };
        node.folders.push(child);
      }
      node = child;
    }
    return node;
  };
  for (const group of groups) reach(group);
  for (const project of projects)
    reach(project.folder ?? "").projects.push(project);
  const sort = (node: ProjectFolderNode) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.folders.forEach(sort);
  };
  sort(root);
  return root;
}
/**
 * Moves a project into `folder`, placed before `before` or, without one,
 * after the folder's last project. Other projects keep their relative order.
 */
export function moveProjectInList<T extends Pick<Project, "id" | "folder">>(
  list: T[],
  id: string,
  folder: string,
  before: string | null,
): T[] {
  const moving = list.find((p) => p.id === id);
  if (!moving || before === id) return list;
  const rest = list.filter((p) => p !== moving);
  const moved = { ...moving };
  if (folder) moved.folder = folder;
  else delete moved.folder;
  let index = before ? rest.findIndex((p) => p.id === before) : -1;
  if (index < 0) {
    index = rest.length;
    for (let i = rest.length - 1; i >= 0; i--)
      if ((rest[i].folder ?? "") === folder) {
        index = i + 1;
        break;
      }
  }
  rest.splice(index, 0, moved);
  return rest;
}
