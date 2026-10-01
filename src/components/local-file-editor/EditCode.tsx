import { EditProvider } from "@pierre/diffs/react";
import type { useEditableDiff } from "../../lib/useEditableDiff";
import { useSyntaxThemes } from "../../lib/appearance";
import { useTheme } from "../../lib/useTheme";
import { StyledDiffCodeView } from "../../vendor/t3code/StyledDiffCodeView";
import type { useSymbolNavigation } from "../SymbolNavigation";
import { createEditor } from "./create-editor";

/** The editable diff in Pierre's code view. */
export function EditCode({
  view,
  symbols,
  compare,
  onEdit,
}: {
  view: ReturnType<typeof useEditableDiff>;
  symbols: ReturnType<typeof useSymbolNavigation>["handlers"];
  compare: boolean;
  onEdit: (contents: string) => void;
}) {
  const theme = useTheme();
  const syntaxThemes = useSyntaxThemes();
  return (
    <EditProvider createEditor={createEditor}>
      <StyledDiffCodeView
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
          useTokenTransformer: true,
          theme: syntaxThemes,
          themeType: theme,
          diffStyle: compare ? "split" : "unified",
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
