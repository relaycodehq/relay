import DOMPurify from "dompurify";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

type Mermaid = (typeof import("mermaid"))["default"];

let loading: Promise<Mermaid> | undefined;
let configuredLook: string | undefined;
// Mermaid's settings are global and it measures text in the page, so
// diagrams are drawn one after another.
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;
/** Drawn SVGs by look and source: a thread opened again redraws nothing. */
const drawn = new Map<string, string>();
const KEEP_DRAWN = 64;

/**
 * What the app currently looks like, as far as a diagram cares; changes when
 * the theme or its colours do. Read from what applyToDocument sets on <html>.
 */
function diagramLook() {
  const root = document.documentElement;
  return [
    root.dataset.theme,
    ...["--surface", "--inbox", "--text", "--accent"].map((name) =>
      root.style.getPropertyValue(name),
    ),
  ].join(" ");
}
function subscribeLook(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "style"],
  });
  return () => observer.disconnect();
}

/** The app's colours as Mermaid's base theme takes them: plain hex or rgb. */
function themeVariables() {
  const style = getComputedStyle(document.documentElement);
  const context = document.createElement("canvas").getContext("2d");
  const color = (name: string, fallback: string) => {
    const value = style.getPropertyValue(name).trim();
    if (!context || !value) return fallback;
    context.fillStyle = fallback;
    context.fillStyle = value;
    return context.fillStyle;
  };
  const dark = document.documentElement.dataset.theme !== "light";
  const text = color("--text", dark ? "#e6e6e6" : "#303237");
  const background = color("--inbox", dark ? "#1e1e1e" : "#f7f7f8");
  return {
    darkMode: dark,
    background,
    edgeLabelBackground: background,
    primaryColor: color("--surface", dark ? "#262626" : "#ffffff"),
    primaryTextColor: text,
    primaryBorderColor: color("--accent", "#6565a9"),
    secondaryColor: color("--accent-soft", dark ? "#2c2c3a" : "#eeeef7"),
    tertiaryColor: color("--hover", dark ? "#2a2a2a" : "#e5e5e9"),
    lineColor: color("--muted", "#898b93"),
    textColor: text,
    noteBkgColor: color("--accent-soft", dark ? "#2c2c3a" : "#eeeef7"),
    noteTextColor: text,
    fontFamily: style.getPropertyValue("--font-sans").trim() || "sans-serif",
    fontSize: "13px",
  };
}

/**
 * The source comes from an agent, so Mermaid's own "strict" mode isn't the only
 * thing between it and the page. Labels are HTML inside <foreignObject>, which
 * has to survive.
 */
function sanitizeSvg(svg: string) {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ["foreignObject"],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  });
}

/** The diagram's SVG, or a rejection with Mermaid's complaint about the source. */
function draw(code: string, look: string): Promise<string> {
  const key = `${look}\n${code}`;
  const known = drawn.get(key);
  if (known) return Promise.resolve(known);
  const run = queue.then(async () => {
    // Loaded on the first diagram; it's large and most threads have none.
    const mermaid = await (loading ??= import("mermaid").then(
      (module) => module.default,
    ));
    if (configuredLook !== look) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "base",
        themeVariables: themeVariables(),
      });
      configuredLook = look;
    }
    const id = `relay-mermaid-${nextId++}`;
    try {
      const { svg } = await mermaid.render(id, code);
      const safe = sanitizeSvg(svg);
      drawn.set(key, safe);
      if (drawn.size > KEEP_DRAWN) drawn.delete(drawn.keys().next().value!);
      return safe;
    } finally {
      // What it measured in, left behind when the source didn't parse.
      document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = run.catch(() => {});
  return run;
}

/** Mermaid's first line says what's wrong; the rest points at it in ASCII. */
const complaint = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .split("\n")[0]!
    .replace(/:?\s*$/, "");

/**
 * A ```mermaid block drawn as its diagram, once it nears the screen. Until
 * then, and while drawing, it shows `pending` (the source) in its place.
 */
export function MermaidDiagram({
  code,
  pending,
  onError,
}: {
  code: string;
  pending: ReactNode;
  onError: (message: string) => void;
}) {
  const look = useSyncExternalStore(subscribeLook, diagramLook, () => "");
  const box = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState(() => drawn.get(`${look}\n${code}`));
  const [near, setNear] = useState(!!svg);
  useEffect(() => {
    if (near || !box.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [near]);
  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    draw(code, look).then(
      (next) => !cancelled && setSvg(next),
      (error) => !cancelled && onError(complaint(error) || "Unknown error"),
    );
    return () => {
      cancelled = true;
    };
  }, [near, code, look]);
  return (
    <div ref={box}>
      {svg ? (
        <div
          className="markdown-diagram"
          role="img"
          aria-label="Diagram"
          // Already through sanitizeSvg in draw().
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        pending
      )}
    </div>
  );
}
