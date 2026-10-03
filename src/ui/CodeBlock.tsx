import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ThemedToken } from "@pierre/diffs";
import { Check, ClipboardCheck, Copy, Play } from "lucide-react";
import { api } from "../lib/api";
import { blockCommand } from "../lib/shell-command";
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

/**
 * Types a command into the thread's terminal for the user to run; false when
 * it couldn't. Only a thread on the desktop offers it.
 */
export const RunCommand = createContext<
  ((command: string) => Promise<boolean>) | null
>(null);

/** ▶ beside a command: types it at the terminal's prompt, never presses Enter. */
function RunCommandButton({
  command,
  className,
}: {
  command: string;
  className: string;
}) {
  const run = useContext(RunCommand);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  if (!run) return null;
  const label = copied
    ? "The terminal couldn't take it, so it's copied instead"
    : command.includes("\n")
      ? "Paste into terminal"
      : "Type in terminal";
  return (
    <button
      type="button"
      className={className}
      title={label}
      aria-label={label}
      onClick={() =>
        void run(command).then((typed) => {
          // A busy shell, or one that would run each line on its own.
          if (!typed)
            void api.writeClipboard(command).then(
              () => setCopied(true),
              () => {},
            );
        })
      }
    >
      {copied ? <ClipboardCheck size={13} /> : <Play size={12} />}
    </button>
  );
}

/** Inline code that is a command, with ▶ on hover in a thread that has a terminal. */
export function InlineCommand({
  command,
  children,
}: {
  command: string;
  children: ReactNode;
}) {
  const run = useContext(RunCommand);
  if (!run) return <code>{children}</code>;
  return (
    <span className="inline-command">
      <code>{children}</code>
      <RunCommandButton command={command} className="inline-command-run" />
    </span>
  );
}

/** A fenced code block, coloured with the active syntax theme when its language is known. */
export const CodeBlock = memo(function CodeBlock({
  code,
  lang,
  closed = true,
}: {
  code: string;
  lang?: string;
  /** False while the fence is still streaming in: nothing is offered for half a block. */
  closed?: boolean;
}) {
  const theme = useSyncExternalStore(
    subscribeSyntaxTheme,
    syntaxTheme,
    () => null,
  );
  const [highlighted, setHighlighted] = useState<Highlighted | null>(null);
  const lastRun = useRef(0);
  const [copied, copy] = useCopy();
  const command = useMemo(
    () => (closed ? blockCommand(code, lang) : null),
    [code, lang, closed],
  );
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
  // The buttons sit outside <pre> so they stay put when long lines scroll,
  // and stick to the top of a block taller than the thread.
  return (
    <div className="markdown-code">
      <div className="markdown-code-tools">
        {command && (
          <RunCommandButton command={command} className="markdown-code-copy" />
        )}
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
    </div>
  );
});
