import {
  memo,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { ThemedToken } from "@pierre/diffs";
import { Check, Copy } from "lucide-react";
import { useCopy } from "../lib/useCopy";

// Tokenizing runs on the main thread; past this a block stays plain.
const MAX_HIGHLIGHT_LENGTH = 40_000;
// Streaming grows the block every token; re-tokenize at most this often.
const HIGHLIGHT_THROTTLE_MS = 120;

interface Highlighted {
  code: string;
  lang: string;
  theme: string;
  lines: ThemedToken[][];
}

// Read from the attributes applyToDocument sets on <html>, so the markdown
// renderer doesn't depend on the appearance store (or localStorage).
function syntaxTheme() {
  const { theme, syntax } = document.documentElement.dataset;
  return syntax ?? (theme === "light" ? "pierre-light" : "pierre-dark");
}
function subscribeSyntaxTheme(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-syntax"],
  });
  return () => observer.disconnect();
}

export async function tokenize(code: string, lang: string, theme: string) {
  // Loaded lazily so the markdown renderer doesn't pull Shiki in up front.
  const { getSharedHighlighter } = await import("@pierre/diffs");
  const highlighter = await getSharedHighlighter({
    themes: [theme],
    langs: [lang],
  });
  return highlighter.codeToTokens(code, { lang, theme }).tokens;
}

export function tokenStyle(token: ThemedToken): CSSProperties | undefined {
  const style = token.fontStyle ?? 0;
  if (!token.color && !style) return undefined;
  return {
    color: token.color,
    fontStyle: style & 1 ? "italic" : undefined,
    fontWeight: style & 2 ? "bold" : undefined,
    textDecoration: style & 4 ? "underline" : undefined,
  };
}

/** A fenced code block, coloured with the active syntax theme when its language is known. */
export const CodeBlock = memo(function CodeBlock({
  code,
  lang,
}: {
  code: string;
  lang?: string;
}) {
  const theme = useSyncExternalStore(
    subscribeSyntaxTheme,
    syntaxTheme,
    () => null,
  );
  const [highlighted, setHighlighted] = useState<Highlighted | null>(null);
  const lastRun = useRef(0);
  const [copied, copy] = useCopy();
  const enabled = !!lang && !!theme && code.length <= MAX_HIGHLIGHT_LENGTH;
  useEffect(() => {
    if (!enabled || !lang || !theme) return;
    let cancelled = false;
    const wait = Math.max(
      0,
      lastRun.current + HIGHLIGHT_THROTTLE_MS - performance.now(),
    );
    const timer = setTimeout(() => {
      lastRun.current = performance.now();
      tokenize(code, lang, theme).then(
        (lines) => {
          if (!cancelled) setHighlighted({ code, lang, theme, lines });
        },
        // Unknown fence languages simply stay plain.
        () => {},
      );
    }, wait);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, lang, theme, enabled]);

  // While a streamed block grows, keep the highlighted prefix and append
  // the new text plainly until the next pass catches up.
  const usable =
    enabled &&
    highlighted &&
    highlighted.lang === lang &&
    highlighted.theme === theme &&
    code.startsWith(highlighted.code)
      ? highlighted
      : null;
  // The button sits outside <pre> so it stays put when long lines scroll.
  return (
    <div className="markdown-code">
      <pre>
        <code className={lang ? `language-${lang}` : undefined}>
          {usable ? (
            <>
              {usable.lines.map((line, index) => (
                <span key={index}>
                  {index > 0 && "\n"}
                  {line.map((token, i) => (
                    <span key={i} style={tokenStyle(token)}>
                      {token.content}
                    </span>
                  ))}
                </span>
              ))}
              {code.slice(usable.code.length)}
            </>
          ) : (
            code
          )}
        </code>
      </pre>
      <button
        type="button"
        className="markdown-code-copy"
        title={copied ? "Copied" : "Copy code"}
        aria-label={copied ? "Copied" : "Copy code"}
        onClick={() => copy(code)}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
});
