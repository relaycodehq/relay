import { expect, it } from "vitest";
import type { Project } from "../../../shared/projects";
import { localProjectAt, relatedFolders } from "./related";

it("offers the repos beside a project that share its name's first word", () => {
  const project = { id: "w", path: "/Users/you/work/acme-web" } as Project;
  const beside = (name: string) => ({
    path: `/Users/you/work/${name}`,
    repository: true,
    beside: true,
  });
  const related = relatedFolders(project, [
    beside("acme-api"),
    beside("Acme_docs"),
    beside("acme"),
    beside("acmeish"),
    beside("dotfiles"),
    { path: "/Users/you/other/acme-mobile", repository: true, beside: false },
  ]);
  expect(related.map((s) => s.path.split("/").pop())).toEqual([
    "acme-api",
    "Acme_docs",
  ]);
});

it("matches a folder here to a project here, not one on a paired computer at the same path", () => {
  const path = "/Users/you/code/relay";
  const there = {
    id: "r",
    path,
    computer: { id: "wsl", name: "Ubuntu", projectId: "x" },
  } as Project;
  expect(localProjectAt([there], path)).toBeUndefined();
  const here = { id: "h", path } as Project;
  expect(localProjectAt([there, here], path)).toBe(here);
});
