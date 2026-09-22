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
    "Use folder names separated by / (up to eight levels).",
  );
export interface ProjectFolderNode {
  name: string;
  path: string;
  folders: ProjectFolderNode[];
  projects: Project[];
}
export function projectFolderTree(projects: Project[]): ProjectFolderNode {
  const root: ProjectFolderNode = {
    name: "",
    path: "",
    folders: [],
    projects: [],
  };
  for (const project of projects) {
    let node = root;
    for (const name of project.folder?.split("/").filter(Boolean) ?? []) {
      const path = node.path ? `${node.path}/${name}` : name;
      let child = node.folders.find((f) => f.path === path);
      if (!child) {
        child = { name, path, folders: [], projects: [] };
        node.folders.push(child);
      }
      node = child;
    }
    node.projects.push(project);
  }
  const sort = (node: ProjectFolderNode) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.folders.forEach(sort);
  };
  sort(root);
  return root;
}
