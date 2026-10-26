// A real CodeMirror view on the sample file, read-only, with the app's own
// theme, line numbers, indent guides, sticky scopes and minimap. It reports
// where two words sit so the tour's pointer has something to aim at.
import { useEffect, useState, type RefObject } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, highlightActiveLine, lineNumbers } from "@codemirror/view";
import { setDiagnostics } from "@codemirror/lint";
import { loadLanguage } from "../../src/lib/code-languages";
import { editorChrome } from "../../src/features/editor/editor-theme";
import { useEditorThemeNamed } from "../../src/features/editor/useEditorTheme";
import { shadowMount } from "../../src/features/editor/shadow-mount";
import { guides } from "../../src/features/editor/view-aids/guides";
import { stickyScopes } from "../../src/features/editor/view-aids/sticky-scopes";
import { minimap } from "../../src/features/editor/minimap/minimap";
import { useSiteTheme } from "./theme";
import { code, mistake, path, symbol } from "./editor-sample";

export interface Spot {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Spots {
  view: EditorView;
  /** The code's height, to tell whether a card fits below a word. */
  frameHeight: number;
  /** The call `reorder(...)` the hover is about. */
  symbol: Spot;
  /** The wrong argument. */
  mistake: Spot;
}

function spotOf(view: EditorView, from: number, to: number, origin: DOMRect): Spot {
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);
  if (!start || !end) return { left: 0, top: 0, width: 0, height: 0 };
  return {
    left: start.left - origin.left,
    top: start.top - origin.top,
    width: end.left - start.left,
    height: start.bottom - start.top,
  };
}

/** Where the words sit inside `frame`, once the view has drawn them; undefined before. */
function measure(view: EditorView, frame: HTMLElement): Spots | undefined {
  const origin = frame.getBoundingClientRect();
  const callAt = code.indexOf(symbol.text, code.indexOf("moveUp"));
  const wrongAt = code.indexOf(mistake);
  if (callAt < 0 || wrongAt < 0) return undefined;
  return {
    view,
    frameHeight: origin.height,
    symbol: spotOf(view, callAt, callAt + symbol.word.length, origin),
    mistake: spotOf(view, wrongAt, wrongAt + mistake.length, origin),
  };
}

export function useSampleEditor(
  host: RefObject<HTMLDivElement | null>,
  frame: RefObject<HTMLDivElement | null>,
) {
  const { resolved } = useSiteTheme();
  const theme = useEditorThemeNamed(resolved.palette.syntax);
  const [spots, setSpots] = useState<Spots>();
  useEffect(() => {
    if (!theme) return;
    let stale = false;
    let view: EditorView | undefined;
    let watch: ResizeObserver | undefined;
    void loadLanguage(path).then((language) => {
      const mount = host.current;
      const root = frame.current;
      if (stale || !mount || !root) return;
      view = new EditorView({
        parent: shadowMount(mount),
        root: shadowMount(mount),
        state: EditorState.create({
          doc: code,
          extensions: [
            lineNumbers(),
            highlightActiveLine(),
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            editorChrome,
            theme,
            language ?? [],
            guides,
            stickyScopes,
            minimap,
          ],
        }),
      });
      const wrongAt = code.indexOf(mistake);
      view.dispatch(
        setDiagnostics(view.state, [
          { from: wrongAt, to: wrongAt + mistake.length, severity: "error", message: "" },
        ]),
      );
      const place = () => view && setSpots(measure(view, root));
      watch = new ResizeObserver(place);
      watch.observe(root);
      requestAnimationFrame(place);
    });
    return () => {
      stale = true;
      watch?.disconnect();
      view?.destroy();
    };
  }, [host, frame, theme]);
  return spots;
}
