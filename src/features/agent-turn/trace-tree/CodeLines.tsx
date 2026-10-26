// Code highlighted in a file's own language, line by line beside a gutter:
// what a call wrote and what a read printed open this way.
import { useEffect, useState } from "react";
import type { ThemedToken } from "@pierre/diffs";
import { syntaxTheme, tokenize, tokenStyle } from "../../../ui/CodeBlock";

/** How a line of an edit changed; a read's lines have none. */
export type Mark = "removed" | "added" | "same";

const plain = (code: string): ThemedToken[][] =>
  code.split("\n").map((content) => [{ content, offset: 0 } as ThemedToken]);

/** The code's lines tokenized for `path`; plain until the highlighter has them. */
export function useLines(path: string, code: string) {
  const [lines, setLines] = useState<{ code: string; lines: ThemedToken[][] }>();
  useEffect(() => {
    let current = true;
    void (async () => {
      const { getFiletypeFromFileName } = await import("@pierre/diffs");
      const lang = getFiletypeFromFileName(path);
      const tokens = await tokenize(code, lang, syntaxTheme()).catch(() => null);
      if (current && tokens) setLines({ code, lines: tokens });
    })();
    return () => {
      current = false;
    };
  }, [path, code]);
  return lines?.code === code ? lines.lines : plain(code);
}

export function Line({ tokens, gutter, mark }: { tokens: ThemedToken[]; gutter: string | number; mark?: Mark }) {
  return (
    <div className={mark ? `written-line ${mark}` : "written-line"}>
      <span className="written-gutter">{gutter}</span>
      <span>
        {tokens.map((token, index) => (
          <span key={index} style={tokenStyle(token)}>
            {token.content}
          </span>
        ))}
        {"\n"}
      </span>
    </div>
  );
}
