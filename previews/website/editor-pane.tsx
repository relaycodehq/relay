// The Files pane with the code editor: a tab, the real CodeMirror view on a
// sample file, and the status line under it. A pointer click on the call
// opens its docs, then its usages; a click on the wrong argument shows the
// language server's error.
import { useEffect, useRef, useState } from "react";
import type { EditorState } from "@codemirror/state";
import { Files as FilesIcon, History, X } from "lucide-react";
import { EditorPath } from "../../src/ui/EditorPath";
import { mountHoverCard } from "../../src/features/editor/hover-card/HoverCard";
import "../../src/features/editor/editor.css";
import "../../src/features/editor/symbol-picker.css";
import { errorText, hover, path, usages } from "./editor-sample";
import { useSampleEditor, type Spot } from "./sample-editor";

type Popup = "docs" | "usages" | "error";

/** A card below the word when it fits there (`room` px), else above it. */
function cardNear(spot: Spot, frameHeight: number, room: number, left = spot.left) {
  const below = spot.top + spot.height + 4;
  if (below + room <= frameHeight) return { left, top: below };
  return { left, bottom: frameHeight - spot.top + 4 };
}

const place = (spot: Spot) => ({
  left: spot.left,
  top: spot.top,
  width: spot.width,
  height: spot.height,
});

/** The hover card the editor draws for the call, mounted from the app's own component. */
function DocsCard({ state }: { state: EditorState }) {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The card renders its own React root, which can't start or stop during this render.
    let card: ReturnType<typeof mountHoverCard> | undefined;
    const mounted = setTimeout(() => {
      card = mountHoverCard(state, hover);
      slot.current?.append(card.dom);
    });
    return () => {
      clearTimeout(mounted);
      setTimeout(() => card?.destroy());
    };
  }, [state]);
  return <div ref={slot} />;
}

function UsagesList() {
  return (
    <div className="symbol-picker" role="dialog" aria-label="Usages">
      <div className="symbol-picker-head">
        <strong>Usages of reorder</strong>
        <span>{usages.length} places</span>
      </div>
      <div className="symbol-picker-list">
        {usages.map((usage, index) => {
          const folder = usage.path.slice(0, usage.path.lastIndexOf("/"));
          const first = usage.path !== usages[index - 1]?.path;
          return (
            <div key={usage.line + usage.path}>
              {first ? (
                <div className="symbol-picker-file">
                  {usage.path.split("/").pop()}
                  <span>{folder}</span>
                </div>
              ) : null}
              <div className="symbol-picker-row" aria-selected={index === 1}>
                <span className="symbol-picker-line">{usage.line}</span>
                <code>{usage.preview}</code>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EditorPane() {
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const spots = useSampleEditor(host, frame);
  const [popup, setPopup] = useState<Popup>();
  const choose = (next: Popup) => setPopup(popup === next ? undefined : next);
  return (
    <section className="rw-editor project-inline-editor" aria-label="Files">
      <div className="editor-tabs">
        <div className="editor-tabs-strip" role="tablist">
          <div role="tab" aria-selected className="editor-tab active">
            <FilesIcon size={12} />
            <span className="editor-tab-name">queue.ts</span>
            <span className="editor-tab-close">
              <X size={12} />
            </span>
          </div>
        </div>
      </div>
      <div className="rw-editor-code" ref={frame}>
        <div className="local-editor-surface">
          <div className="code-editor" ref={host} />
        </div>
        {spots ? (
          <>
            <button
              type="button"
              className="rw-spot"
              aria-label="reorder"
              data-rw-symbol
              style={place(spots.symbol)}
              onClick={() => choose("docs")}
            />
            <button
              type="button"
              className="rw-spot"
              aria-label="Wrong argument"
              data-rw-error
              style={place(spots.mistake)}
              onClick={() => choose("error")}
            />
            {popup === "docs" ? (
              <div className="rw-tip" style={cardNear(spots.symbol, spots.frameHeight, 230)}>
                <DocsCard state={spots.view.state} />
                <button type="button" className="rw-tip-action" data-rw-usages onClick={() => choose("usages")}>
                  Find usages <kbd>⌥F7</kbd>
                </button>
              </div>
            ) : null}
            {popup === "error" ? (
              <div className="rw-tip rw-tip-error" style={cardNear(spots.mistake, spots.frameHeight, 60, spots.mistake.left - 80)}>
                {errorText}
              </div>
            ) : null}
          </>
        ) : null}
        {popup === "usages" ? (
          <div className="rw-usages">
            <UsagesList />
          </div>
        ) : null}
      </div>
      <div className="editor-bar">
        <EditorPath path={path} />
        <span className="lsp-status">TypeScript · ready</span>
        <span className="editor-bar-gap" />
        <History size={14} />
        <span className="rw-editor-errors">1 error</span>
      </div>
    </section>
  );
}
