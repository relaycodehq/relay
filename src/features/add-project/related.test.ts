import { expect, it } from "vitest";
import type { Project } from "../../../shared/projects";
import { relatedFolders } from "./related";

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
