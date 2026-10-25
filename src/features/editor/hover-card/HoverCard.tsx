import { createElement, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { EditorState } from "@codemirror/state";
import type { LspLocation } from "../../../../shared/language-servers";
import { FileEntryIcon } from "../../../ui/FileEntryIcon";
import { RichText } from "../../../ui/RichText";
import type { OpenTarget } from "../editor-types";
import { highlightRuns, type CodeRun } from "./highlight-runs";
import { hoverParts, type DocTag } from "./hover-parts";
import { oneParamPerLine } from "./signature-lines";
import "./hover-card.css";

type CardProps = {
  /** The owner's name and what it is; a Rust module path is a module, anything else a class. */
  owner?: { name: string; module: boolean };
  signature?: CodeRun[];
  docs: string;
  tags: DocTag[];
  /** Where the symbol is declared, once the server says; how to go there. */
  declaration?: { place: Promise<LspLocation | undefined>; open: (place: LspLocation) => void };
};

/** JetBrains' docs card: owner, declaration, docs, and the file it's declared in. */
function HoverCard({ owner, signature, docs, tags, declaration }: CardProps) {
  return (
    <>
      {owner && (
        <div className="hover-card-owner">
          <span className="hover-card-kind" data-module={owner.module || undefined} aria-hidden>
            {owner.module ? "M" : "C"}
          </span>
          {owner.name}
        </div>
      )}
      {signature && (
        <pre className="hover-card-signature">
          {signature.map((run, i) => (
            <span key={i} className={run.className}>
              {run.text}
            </span>
          ))}
        </pre>
      )}
      {(docs || tags.length > 0) && (
        <div className="hover-card-docs">
          {docs && <RichText text={docs} />}
          {tags.length > 0 && <DocTags tags={tags} />}
        </div>
      )}
      {declaration && <DeclarationFooter {...declaration} />}
    </>
  );
}

/**
 * The file the symbol is declared in. Its row is there from the start and
 * fills in when the server answers, so the card keeps its size and place.
 */
function DeclarationFooter({ place, open }: NonNullable<CardProps["declaration"]>) {
  const [found, setFound] = useState<LspLocation>();
  useEffect(() => {
    let shown = true;
    void place.then((answer) => {
      if (shown) setFound(answer);
    });
    return () => {
      shown = false;
    };
  }, [place]);
  return (
    <div className="hover-card-footer">
      {found && (
        <button type="button" className="hover-card-place" onClick={() => open(found)}>
          <FileEntryIcon path={found.path} directory={false} />
          <span>{placeLabel(found)}</span>
        </button>
      )}
    </div>
  );
}

/** The doc tags as JetBrains lays them out: a label, and its entries beside it. */
function DocTags({ tags }: { tags: DocTag[] }) {
  return (
    <dl className="hover-card-tags">
      {tags.map((tag) => (
        <div key={tag.label}>
          <dt>{tag.label}:</dt>
          <dd>
            {tag.entries.map((entry, i) => (
              <RichText key={i} text={entry} />
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** How the card names a declaration's file: by its project path, or by its package for one outside. */
function placeLabel(place: LspLocation) {
  if (!place.outside) return place.path;
  const parts = place.path.split(/[\\/]/);
  const modules = parts.lastIndexOf("node_modules");
  if (modules >= 0) return parts.slice(modules + 1).join("/");
  return parts.slice(-2).join("/");
}

/**
 * A card for a server's hover or completion docs, as a tooltip's content.
 * Rendered at once: CodeMirror places the card by the size it has when
 * created, and an empty card placed above the word grows down over it.
 */
export function mountHoverCard(
  state: EditorState,
  markdown: string,
  declared?: Promise<LspLocation | undefined>,
  onOpen?: (target: OpenTarget) => void,
) {
  const parts = hoverParts(markdown);
  const member = !!parts.owner;
  const props: CardProps = {
    owner: parts.owner ? { name: parts.owner, module: parts.owner.includes("::") } : undefined,
    signature: parts.signature
      ? highlightRuns(state, oneParamPerLine(parts.signature), member)
      : undefined,
    docs: parts.docs,
    tags: parts.tags,
    declaration:
      declared && onOpen
        ? {
            place: declared,
            open: (place) =>
              onOpen({
                path: place.path,
                line: place.line + 1,
                column: place.character + 1,
                outside: place.outside,
              }),
          }
        : undefined,
  };
  const dom = document.createElement("div");
  dom.className = "hover-card";
  const root = createRoot(dom);
  flushSync(() => root.render(createElement(HoverCard, props)));
  return { dom, destroy: () => root.unmount() };
}
