import { useEffect, useState, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { headingSlugs, markdownLink } from "./markdown-links";

/** The heading that `id` names in `root`, found by GitHub's anchor or by an HTML id. */
function findSection(root: HTMLElement, id: string) {
  const named = root.querySelector<HTMLElement>(
    `[id="user-content-${CSS.escape(id)}"], [name="user-content-${CSS.escape(id)}"]`,
  );
  if (named) return named;
  const headings = [
    ...root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  ];
  const slugs = headingSlugs(headings.map((h) => h.textContent ?? ""));
  return headings[slugs.indexOf(id.toLowerCase())];
}

/**
 * What a click on a link in the rendered Markdown does: a `#section` scrolls
 * to its heading inside `box`, a relative link opens its file or folder
 * through `onOpen`. A link that leads nowhere sets `notice` for a few seconds.
 */
export function useMarkdownLinks({
  where,
  path,
  box,
  onOpen,
}: {
  where: string;
  path: string;
  box: RefObject<HTMLElement | null>;
  onOpen?: (target: { path: string; directory: boolean }) => void;
}) {
  const qc = useQueryClient();
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const follow = async (href: string) => {
    const target = markdownLink(path, href);
    if (!target) return;
    setNotice("");
    if (target.kind === "outside")
      return setNotice(`${href} leads outside this project.`);
    if (target.kind === "section") {
      const heading = box.current && findSection(box.current, target.id);
      if (!heading) return setNotice(`No “${target.id}” section in this file.`);
      heading.scrollIntoView({ block: "start" });
      return;
    }
    if (!onOpen || target.path === path) return;
    const files = qc.getQueryData<string[]>(["project-files", where]);
    if (files?.includes(target.path))
      return onOpen({ path: target.path, directory: false });
    if (files?.some((file) => file.startsWith(`${target.path}/`)))
      return onOpen({ path: target.path, directory: true });
    // Not in the file list: either ignored by Git, or it doesn't exist.
    try {
      await api.projectFileInfo(where, target.path);
      onOpen({ path: target.path, directory: false });
    } catch {
      setNotice(`Can’t find ${target.path} in this project.`);
    }
  };
  return { notice, follow };
}
