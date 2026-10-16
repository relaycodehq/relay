import { EditProvider } from "@pierre/diffs/react";
import type { useEditorView } from "./useEditorView";
import { useSyntaxThemes } from "../../../lib/appearance";
import { useTheme } from "../../../lib/useTheme";
import { DiffCodeView } from "../../diff/DiffCodeView";
import type { useSymbolNavigation } from "../../diff/SymbolNavigation";
import { createEditor } from "./create-editor";

/** The editable file, or its side-by-side comparison, in Pierre's code view. */
export function EditCode({
  view,
  symbols,
  onRender,
  onEdit,
}: {
  view: ReturnType<typeof useEditorView>;
  symbols: ReturnType<typeof useSymbolNavigation>["handlers"];
  /** Each render of the item, with its host element. */
  onRender?: (node: HTMLElement) => void;
  onEdit: (contents: string) => void;
}) {
  const theme = useTheme();
  const syntaxThemes = useSyntaxThemes();
  return (
    <EditProvider createEditor={createEditor}>
      <DiffCodeView
        viewerRef={view.viewer}
        className="diff-code-view local-edit-code"
        scrollPastEnd
        items={view.items}
        editorOptions={view.editorOptions}
        onItemEditChange={(event) => onEdit(event.file.contents)}
        onItemEditComplete={() => "reject"}
        unsafeCSSExtra={`:host {color-scheme:${theme} !important;} [data-diff], [data-file] {opacity:1 !important;} [data-code] {tab-size:2;}`}
        options={{
          ...symbols,
          onPostRender: (node, rendered) => {
            onRender?.(node);
            view.onPostRender(node, rendered);
          },
          useTokenTransformer: true,
          theme: syntaxThemes,
          themeType: theme,
          diffStyle: "split",
          expandUnchanged: true,
          disableFileHeader: true,
          diffIndicators: "bars",
          overflow: "scroll",
          lineDiffType: "word-alt",
          preferredHighlighter: "shiki-js",
          tokenizeMaxLength: 5000,
          tokenizeMaxLineLength: 1000,
          maxLineDiffLength: 1000,
        }}
      />
    </EditProvider>
  );
}
