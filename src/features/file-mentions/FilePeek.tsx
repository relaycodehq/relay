import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ThemedToken } from "@pierre/diffs";
import { api } from "../../lib/api";
import { tokenize, tokenStyle } from "../../ui/CodeBlock";
import { FileEntryIcon } from "../../ui/FileEntryIcon";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import type { FileTree, MentionItem } from "./mention-items";

/** What a peek shows of a file: enough to recognise it. */
const PEEK_LINES = 60;

function syntaxTheme() {
  const { theme, syntax } = document.documentElement.dataset;
  return syntax ?? (theme === "light" ? "pierre-light" : "pierre-dark");
}

function useTokens(path: string, code: string | undefined) {
  const [tokens, setTokens] = useState<{
    code: string;
    lines: ThemedToken[][];
  }>();
  useEffect(() => {
    if (code === undefined) return;
    let current = true;
    void (async () => {
      const { getFiletypeFromFileName } = await import("@pierre/diffs");
      const lang = getFiletypeFromFileName(path);
      const lines = await tokenize(code, lang, syntaxTheme()).catch(() => null);
      if (current && lines) setTokens({ code, lines });
    })();
    return () => {
      current = false;
    };
  }, [path, code]);
  return tokens && tokens.code === code ? tokens.lines : undefined;
}

function FileBody({ where, path }: { where: string; path: string }) {
  const file = useQuery({
    queryKey: ["project-file", where, path],
    queryFn: () => api.projectFile(where, path),
    staleTime: 30_000,
    retry: false,
  });
  const all = file.data?.contents.split("\n");
  const head = all?.slice(0, PEEK_LINES).join("\n");
  const tokens = useTokens(path, head);
  if (file.isPending) return <div className="mention-peek-code" />;
  if (!all) return <p className="mention-empty">No preview for this file.</p>;
  return (
    <>
      <pre className="mention-peek-code">
        {(tokens ?? head!.split("\n").map((text) => [{ content: text }])).map(
          (line, i) => (
            <div key={i}>
              <span className="mention-peek-n">{i + 1}</span>
              {line.map((t, j) => (
                <span
                  key={j}
                  style={
                    "color" in t ? tokenStyle(t as ThemedToken) : undefined
                  }
                >
                  {t.content}
                </span>
              ))}
            </div>
          ),
        )}
      </pre>
      <div className="mention-peek-foot">
        {all.length.toLocaleString()} {all.length === 1 ? "line" : "lines"}
      </div>
    </>
  );
}

function FolderBody({ path, tree }: { path: string; tree: FileTree }) {
  const entries = [...(tree.get(path) ?? [])].sort(
    ([a], [b]) =>
      Number(b.endsWith("/")) - Number(a.endsWith("/")) || a.localeCompare(b),
  );
  return (
    <ul className="mention-peek-folder">
      {entries.slice(0, 40).map(([name, entry]) => (
        <li key={name}>
          <FileEntryIcon path={path + name} directory={name.endsWith("/")} />
          <span>{name}</span>
          {name.endsWith("/") && <small>{entry.files}</small>}
        </li>
      ))}
      {entries.length > 40 && (
        <li className="muted">and {entries.length - 40} more</li>
      )}
    </ul>
  );
}

/** The selected file's first lines, or a folder's entries, beside the list. */
export function FilePeek({
  where,
  item,
  tree,
}: {
  where: string;
  item: MentionItem | undefined;
  tree: FileTree;
}) {
  return (
    <div className="mention-peek-pane" aria-hidden="true">
      {item && (
        <>
          <div className="mention-peek-head">
            <MiddleTruncate text={item.path} kind="path" />
            {item.change && (
              <span className={`mention-change ${item.change}`}>
                {item.change}
              </span>
            )}
          </div>
          {item.dir ? (
            <FolderBody path={item.path} tree={tree} />
          ) : (
            <FileBody where={where} path={item.path} />
          )}
        </>
      )}
    </div>
  );
}
