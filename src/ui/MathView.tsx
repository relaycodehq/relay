import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useCopy } from "../lib/useCopy";

type Katex = (typeof import("katex"))["default"];

// KaTeX and its fonts are a few hundred KB that most threads never need, so
// they load when the first formula appears; until then the source shows.
let katex: Katex | undefined;
let failed = false;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

function loadKatex() {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")])
    .then(([module]) => {
      katex = module.default;
    })
    .catch((error) => {
      failed = true;
      console.error("KaTeX failed to load", error);
    })
    .finally(() => listeners.forEach((listener) => listener()));
}

function useKatex() {
  const loaded = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => katex,
    () => undefined,
  );
  useEffect(() => {
    if (!loaded && !failed) loadKatex();
  }, [loaded]);
  return loaded;
}

/** Formulas come from an agent: no links, no raw HTML, no runaway sizes. */
function typeset(katex: Katex, tex: string, display: boolean) {
  return katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    strict: "ignore",
    trust: false,
    output: "htmlAndMathml",
    maxSize: 30,
    maxExpand: 500,
    errorColor: "var(--danger)",
  });
}

export function InlineMath({ tex }: { tex: string }) {
  const loaded = useKatex();
  const html = useMemo(
    () => (loaded ? typeset(loaded, tex, false) : undefined),
    [loaded, tex],
  );
  return html ? (
    <span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <code>{tex}</code>
  );
}

/** A formula on its own lines; `closed` is false while it is still arriving. */
export function BlockMath({ tex, closed }: { tex: string; closed: boolean }) {
  const loaded = useKatex();
  const [copied, copy] = useCopy();
  const html = useMemo(
    () => (loaded && closed ? typeset(loaded, tex, true) : undefined),
    [loaded, closed, tex],
  );
  return (
    <div className="math-block">
      {html ? (
        <div
          className="math-block-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="math-block-source">{tex}</pre>
      )}
      {html && (
        <button
          type="button"
          className="math-block-copy"
          title={copied ? "Copied" : "Copy LaTeX"}
          aria-label={copied ? "Copied" : "Copy LaTeX"}
          onClick={() => copy(tex)}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      )}
    </div>
  );
}
