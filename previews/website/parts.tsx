// Small pieces the page uses in several places.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  Copy,
  Menu,
  Plus,
  Star,
  X,
} from "lucide-react";
import { relayMarkSvg, svgDataUrl } from "../../src/lib/relay-icon";
import { useScrollProgress } from "./motion";
import { formatCount, useStars } from "./live";
import { useSiteTheme } from "./theme";
import {
  BUILD_GUIDE,
  EMAIL,
  ISSUES,
  LICENSE,
  releaseNotes,
  REPO,
  VERSION,
} from "./content";

/** `size` is the ribbon's visible height; its SVG box has margins around it. */
export function Mark({ size = 20 }: { size?: number }) {
  const box = Math.round(size * 1.45);
  const { resolved } = useSiteTheme();
  const src = useMemo(
    () => svgDataUrl(relayMarkSvg(resolved.accent)),
    [resolved.accent],
  );
  return (
    <img
      className="site-mark"
      src={src}
      width={box}
      height={box}
      style={{ margin: (size - box) / 2 }}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="faq">
      {items.map((item, index) => (
        <div
          key={item.q}
          className="faq-item"
          data-open={open === index || undefined}
        >
          <button
            type="button"
            aria-expanded={open === index}
            onClick={() => setOpen(open === index ? null : index)}
          >
            {item.q}
            <Plus size={16} />
          </button>
          <div className="faq-answer">
            <p>{item.a}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** GitHub's mark; lucide has no brand icons. */
export function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const sections = [
  { id: "tour", label: "Product" },
  { id: "features", label: "Features" },
  { id: "themes", label: "Themes" },
  { id: "open-source", label: "Open source" },
  { id: "faq", label: "FAQ" },
];

/** The id of the section under the top of the window, for the nav to mark. */
function useCurrentSection(enabled: boolean): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      let found: string | null = null;
      for (const { id } of sections) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= window.innerHeight * 0.4) found = id;
      }
      setCurrent(found);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // The browser scrolls to the address's #hash after this runs; look again then.
    const settle = window.setTimeout(update, 300);
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("hashchange", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("hashchange", onScroll);
      window.clearTimeout(settle);
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return current;
}

/**
 * `home` is the way back to the main page from the current one ("" on the
 * main page, "../" on the download page), so the links work both on the site
 * and under the dev server's /previews/website/.
 */
export function SiteHeader({ home }: { home: string }) {
  const nav = useScrollProgress<HTMLElement>();
  const current = useCurrentSection(home === "");
  const stars = useStars();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) =>
      event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <header className="nav" ref={nav} data-open={open || undefined}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <a className="logo" href={home || "#top"}>
        <Mark size={22} />
        Relay
      </a>
      <nav id="site-nav" aria-label="Site" onClick={() => setOpen(false)}>
        {sections.map(({ id, label }) => (
          <a
            key={id}
            href={`${home}#${id}`}
            data-current={current === id || undefined}
          >
            {label}
          </a>
        ))}
        <a className="nav-only" href={`${home}download/`}>
          Download
        </a>
      </nav>
      <a className="cta ghost small" href={REPO} aria-label="Relay on GitHub">
        <GitHubMark size={14} />
        <span className="nav-label">GitHub</span>
        {stars !== null ? (
          <span className="stars">
            <Star size={11} />
            {formatCount(stars)}
          </span>
        ) : null}
      </a>
      <a className="cta small" href={`${home}download/`}>
        Download
        <ArrowDownToLine size={14} />
      </a>
      <button
        type="button"
        className="nav-menu"
        aria-expanded={open}
        aria-controls="site-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>
    </header>
  );
}

export function SiteFooter({ home }: { home: string }) {
  return (
    <footer className="footer">
      <div className="footer-brand">
        <span className="logo">
          <Mark size={18} />
          Relay
        </span>
        <p>
          One workspace for your coding agents. Open source under the MIT
          license, built in the Czech Republic.
        </p>
      </div>
      <div>
        <h4>Product</h4>
        <a href={`${home}#features`}>Features</a>
        <a href={`${home}download/`}>Download</a>
        <a href={releaseNotes}>Release notes</a>
      </div>
      <div>
        <h4>Open source</h4>
        <a href={REPO}>GitHub</a>
        <a href={ISSUES}>Issues</a>
        <a href={BUILD_GUIDE}>Build guide</a>
        <a href={LICENSE}>MIT license</a>
      </div>
      <div>
        <h4>Contact</h4>
        <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
        <a href={ISSUES}>Report a problem</a>
        <a href={`${REPO}/tree/main/previews/website`}>This website's source</a>
      </div>
      <p className="footer-base">
        Relay {VERSION} · Relay is an independent project. It has no affiliation
        with OpenAI, Anthropic, Google, OpenCode, Cursor, Amp or other agent
        makers.
      </p>
    </footer>
  );
}

/** A terminal command with a button that copies it. */
export function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const code = useRef<HTMLElement>(null);
  return (
    <div className="command">
      <code ref={code}>{text}</code>
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy command"}
        data-copied={copied || undefined}
        onClick={() =>
          navigator.clipboard
            .writeText(text)
            .then(() => setCopied(true))
            .catch(() =>
              window.getSelection()?.selectAllChildren(code.current!),
            )
        }
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}
