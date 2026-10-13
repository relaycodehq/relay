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
import type { DiffsHighlighter, ThemedToken } from "@pierre/diffs";
import {
  Check,
  ClipboardCheck,
  Code as CodeIcon,
  Copy,
  Play,
  Workflow,
} from "lucide-react";
import { api } from "../lib/api";
import { blockCommand } from "../lib/shell-command";
import { useCopy } from "../lib/useCopy";
import { MermaidDiagram } from "./MermaidDiagram";

// Tokenizing a block from scratch runs on the main thread; past this it stays plain.
const MAX_HIGHLIGHT_LENGTH = 40_000;
// Streaming grows the block every token; tokenize new lines at most this often.
const HIGHLIGHT_THROTTLE_MS = 120;

type GrammarState = NonNullable<
  ReturnType<DiffsHighlighter["codeToTokens"]>["grammarState"]
>;

export interface Highlighted {
  code: string;
  lang: string;
  theme: string;
  lines: ThemedToken[][];
  /** Where the grammar stood after the last line, to carry on from there. */
  grammar?: GrammarState;
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

async function highlighter(lang: string, theme: string) {
  // Loaded lazily so the markdown renderer doesn't pull Shiki in up front.
  const { getSharedHighlighter } = await import("@pierre/diffs");
  return getSharedHighlighter({ themes: [theme], langs: [lang] });
}

export async function tokenize(code: string, lang: string, theme: string) {
  return (await highlighter(lang, theme)).codeToTokens(code, { lang, theme })
    .tokens;
}

/**
 * Tokenizes `code`, and when `prior` holds its first lines, only the lines
 * after them: a streamed block costs the same per pass however long it gets.
 */
export async function highlight(
  code: string,
  lang: string,
  theme: string,
  prior: Highlighted | null,
): Promise<Highlighted> {
  const shiki = await highlighter(lang, theme);
  if (
    prior?.grammar &&
    prior.lang === lang &&
    prior.theme === theme &&
    code.startsWith(prior.code + "\n")
  ) {
    const more = shiki.codeToTokens(code.slice(prior.code.length + 1), {
      lang,
      theme,
      grammarState: prior.grammar,
    });
    return {
      code,
      lang,
      theme,
      lines: [...prior.lines, ...more.tokens],
      grammar: more.grammarState,
    };
  }
  const { tokens, grammarState } = shiki.codeToTokens(code, { lang, theme });
  return { code, lang, theme, lines: tokens, grammar: grammarState };
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

// Lines keep their token arrays between passes, so only new ones re-render.
const TokenLine = memo(function TokenLine({
  line,
  first,
}: {
  line: ThemedToken[];
  first: boolean;
}) {
  return (
    <span>
      {!first && "\n"}
      {line.map((token, i) => (
        <span key={i} style={tokenStyle(token)}>
          {token.content}
        </span>
      ))}
    </span>
  );
});

/** A fenced code block, coloured with the active syntax theme when its language is known. */
export const CodeBlock = memo(function CodeBlock({
  code,
  lang,
  closed = true,
  tools,
}: {
  code: string;
  lang?: string;
  /** False while the fence is still streaming in: nothing is offered for half a block. */
  closed?: boolean;
  /** More buttons beside Copy, like the pin that keeps the block in notes. */
  tools?: ReactNode;
}) {
  const theme = useSyncExternalStore(
    subscribeSyntaxTheme,
    syntaxTheme,
    () => null,
  );
  const [highlighted, setHighlighted] = useState<Highlighted | null>(null);
  const latest = useRef<Highlighted | null>(null);
  const lastRun = useRef(0);
  const [copied, copy] = useCopy();
  const [showSource, setShowSource] = useState(false);
  const [diagramError, setDiagramError] = useState<string>();
  const diagram = lang === "mermaid" && closed && !diagramError;
  const command = useMemo(
    () => (closed ? blockCommand(code, lang) : null),
    [code, lang, closed],
  );
  const enabled = !!lang && !!theme && code.length <= MAX_HIGHLIGHT_LENGTH;
  // While the fence is open only whole lines are tokenized: the grammar state
  // after a finished line is what the next pass carries on from.
  const target = closed
    ? code
    : code.slice(0, Math.max(0, code.lastIndexOf("\n")));
  useEffect(() => {
    if (!enabled || !lang || !theme || !target) return;
    const prior = latest.current;
    if (prior?.code === target && prior.lang === lang && prior.theme === theme)
      return;
    let cancelled = false;
    const wait = Math.max(
      0,
      lastRun.current + HIGHLIGHT_THROTTLE_MS - performance.now(),
    );
    const timer = setTimeout(() => {
      lastRun.current = performance.now();
      highlight(target, lang, theme, latest.current).then(
        (next) => {
          if (cancelled) return;
          latest.current = next;
          setHighlighted(next);
        },
        // Unknown fence languages simply stay plain.
        () => {},
      );
    }, wait);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [target, lang, theme, enabled]);

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
  const source = (
    <pre>
      <code className={lang ? `language-${lang}` : undefined}>
        {usable ? (
          <>
            {usable.lines.map((line, index) => (
              <TokenLine key={index} line={line} first={index === 0} />
            ))}
            {code.slice(usable.code.length)}
          </>
        ) : (
          code
        )}
      </code>
    </pre>
  );
  // The buttons sit outside <pre> so they stay put when long lines scroll,
  // and stick to the top of a block taller than the thread.
  return (
    <div className="markdown-code">
      <div className="markdown-code-tools">
        {command && (
          <RunCommandButton command={command} className="markdown-code-copy" />
        )}
        {diagram && (
          <button
            type="button"
            className="markdown-code-copy"
            title={showSource ? "Show diagram" : "Show source"}
            aria-label={showSource ? "Show diagram" : "Show source"}
            onClick={() => setShowSource((shown) => !shown)}
          >
            {showSource ? <Workflow size={13} /> : <CodeIcon size={13} />}
          </button>
        )}
        {tools}
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
      {diagram && !showSource ? (
        <MermaidDiagram
          code={code}
          pending={source}
          onError={setDiagramError}
        />
      ) : (
        source
      )}
      {diagramError && (
        <small className="markdown-code-error">
          Couldn't draw this diagram: {diagramError}
        </small>
      )}
    </div>
  );
});
