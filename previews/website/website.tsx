// A draft of Relay's public website. It wears the app's own Relay theme and
// mounts the app's own components on sample data, so what it shows is what
// the app draws. Product facts follow README.md and docs/phone.md.
// Open http://127.0.0.1:5177/previews/website/
import "../_shared/desktop-stub";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowRight, ArrowUpRight } from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/sidebar/sidebar.css";
import "../../src/features/agents/composer-model-picker.css";
import "../../src/features/changes/changed-files.css";
import "./website.css";
import { initSiteTheme, useSiteTheme } from "./theme";
import { ThemesSection } from "./themes";
import { initWindowFocus } from "../../src/lib/window-focus";
import { AppWindow, scriptMs, type Stop } from "./app-window";
import {
  PhoneSync,
  QuickSwitchDemo,
  UsageDemo,
  WorktreeGraph,
} from "./sections";
import { startLanes } from "./hero-lanes";
import { AgentWord } from "./agent-word";
import { Reveal, reducedMotion, useActive } from "./motion";
import { Faq, GitHubMark, SiteFooter, SiteHeader } from "./parts";
import { installStubs } from "./stubs";
import {
  faq,
  features,
  openSource,
  platforms,
  promises,
  REPO,
  VERSION,
} from "./content";
import { osName, useOs } from "./live";

// The site always wears Relay's own dark theme, whatever the previews were left on.
initSiteTheme();
initWindowFocus();

installStubs();

function Lanes() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ref, active] = useActive<HTMLDivElement>(0.05);
  const lanes = useRef<ReturnType<typeof startLanes>>(undefined);
  // Redrawn in the new colours when the visitor picks a theme.
  const { resolved } = useSiteTheme();
  useEffect(() => {
    lanes.current = startLanes(canvas.current!, {
      line: resolved.palette.border,
      run: resolved.accent,
    });
    return () => lanes.current?.stop();
  }, [resolved]);
  useEffect(() => {
    lanes.current?.run(active && !reducedMotion());
  }, [active, resolved]);
  return (
    <div className="hero-lanes" ref={ref} aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}

const tour: { stop: Stop; title: string; text: string }[] = [
  {
    stop: "threads",
    title: "Run threads in parallel",
    text: "Activity shows the state of each thread: working, done, or needs input.",
  },
  {
    stop: "review",
    title: "Review the changes",
    text: "Changes shows the working tree next to the thread. You stage and commit there.",
  },
  {
    stop: "deep",
    title: "Get a deep review",
    text: "Two models read the changes. A lead agent checks each finding and keeps the confirmed ones.",
  },
  {
    stop: "terminal",
    title: "Open a terminal",
    text: "Each thread has its own terminal. Running lists the processes that stay active.",
  },
];

/** Tilts the window up from the page as it scrolls into view. */
function useRise<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (reducedMotion()) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const element = ref.current;
      if (!element) return;
      const top = element.getBoundingClientRect().top;
      const from = window.innerHeight;
      const to = window.innerHeight * 0.3;
      const risen = Math.min(1, Math.max(0, (from - top) / (from - to)));
      element.style.setProperty("--risen", risen.toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return ref;
}

function Tour() {
  const [ref, active] = useActive<HTMLDivElement>(0.3);
  const rise = useRise<HTMLDivElement>();
  const [index, setIndex] = useState(0);
  // Bumped when a stop is picked again, so its progress line starts over.
  const [lap, setLap] = useState(0);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target.closest("input, textarea")
      )
        return;
      const slot = Number(event.key);
      if (slot >= 1 && slot <= tour.length) setIndex(slot - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const current = tour[index];
  return (
    <div className="tour" ref={ref}>
      <div className="tour-list" role="tablist" aria-label="Product tour">
        {tour.map((item, i) => (
          <button
            key={item.stop}
            type="button"
            role="tab"
            aria-selected={i === index}
            onClick={() => {
              setIndex(i);
              setLap((value) => value + 1);
            }}
          >
            <kbd>{i + 1}</kbd>
            <strong>{item.title}</strong>
            <span>{item.text}</span>
            {i === index ? (
              <i
                key={lap}
                style={{
                  animationDuration: `${scriptMs(item.stop)}ms`,
                  animationPlayState: active ? "running" : "paused",
                }}
              />
            ) : null}
          </button>
        ))}
      </div>
      <div className="tour-window" ref={rise}>
        <AppWindow
          stop={current.stop}
          active={active}
          onDone={() => setIndex((value) => (value + 1) % tour.length)}
        />
      </div>
    </div>
  );
}

const rows = [
  {
    eyebrow: "Agents",
    title: "Switch agents mid-thread",
    text: "Each thread has its own agent, model and effort. Press ⌃⌘← or ⌃⌘→ to select the next preset. A new agent gets a note about the earlier work.",
    demo: <QuickSwitchDemo />,
  },
  {
    eyebrow: "Worktrees",
    title: "Give a thread its own branch",
    text: "A thread can work in its own Git worktree. The thread has its own branch and its own folder. You merge the branch when the work is ready.",
    demo: <WorktreeGraph />,
  },
  {
    eyebrow: "Usage",
    title: "See how much usage is left",
    text: "Relay shows the percent that remains for Claude and Codex. One bar is for the 5-hour session. One bar is for the week. The mark on the weekly bar shows an even pace.",
    demo: <UsageDemo />,
  },
];

/** The hero's download button, for the visitor's own system. */
function HeroDownload() {
  const os = useOs();
  // Android visitors get the desktop list: Relay itself runs on a computer.
  const build =
    platforms.find((p) => p.os === (os === "android" ? "mac" : os)) ??
    platforms[0];
  const others = [
    ...platforms.filter((p) => p.os && p !== build).map((p) => osName[p.os!]),
    "Android",
  ];
  const list = `${others.slice(0, -1).join(", ")} and ${others.at(-1)}`;
  return (
    <>
      <div className="hero-actions">
        <a className="cta" href={build.href}>
          Download for {osName[build.os!]}
          <ArrowDownToLine size={15} />
        </a>
        <a className="cta ghost" href={REPO}>
          <GitHubMark />
          View on GitHub
        </a>
      </div>
      <div className="hero-more">
        <a href="download/">
          Also for {list}
          <ArrowRight size={12} />
        </a>
        <a href="download/#headless">
          Server or a spare computer? Install headless
          <ArrowRight size={12} />
        </a>
      </div>
    </>
  );
}

function Site() {
  // The sections render after the page loads, too late for the browser to
  // scroll to the address's #hash by itself.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (!id) return;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "instant", block: "start" });
  }, []);
  return (
    <div className="site">
      <SiteHeader home="" />

      <main id="main">
        <section className="hero" id="top">
          <Lanes />
          <a className="hero-notice" href={REPO}>
            v{VERSION} <i>·</i> Relay is open source
            <ArrowRight size={12} />
          </a>
          <h1>
            One workspace for
            <AgentWord />
          </h1>
          <p>
            Relay runs your coding agents on your computer. You see each step.
            You review each edit.
          </p>
          <HeroDownload />
          <ul className="hero-facts">
            <li>6 agents + ACP</li>
            <li>No Relay account</li>
            <li>No API keys</li>
            <li>Open source, MIT</li>
          </ul>
        </section>

        <section className="wide" id="tour">
          <Tour />
        </section>

        <section className="centered" id="phone">
          <Reveal>
            <span className="eyebrow">Phone</span>
            <h2>Your threads, on your phone</h2>
            <p>
              The Android app shows your threads live. You answer approvals and
              commit from the phone.
            </p>
          </Reveal>
          <Reveal delay={120} className="sync-wrap">
            <PhoneSync />
          </Reveal>
        </section>

        <section className="rows">
          {rows.map((row) => (
            <div className="row" key={row.title}>
              <Reveal>
                <span className="eyebrow">{row.eyebrow}</span>
                <h2>{row.title}</h2>
                <p>{row.text}</p>
              </Reveal>
              <Reveal delay={120} className="row-demo">
                {row.demo}
              </Reveal>
            </div>
          ))}
        </section>

        <section className="block" id="features">
          <Reveal>
            <span className="eyebrow">Features</span>
            <h2>The full list</h2>
          </Reveal>
          <div className="grid">
            {features.map((feature, index) => (
              <Reveal key={feature.title} delay={(index % 3) * 70}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
                <code>{feature.detail}</code>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="block">
          <Reveal>
            <span className="eyebrow">Good to know</span>
            <h2>
              Runs on your computer,
              <br />
              with your accounts
            </h2>
          </Reveal>
          <div className="promises">
            {promises.map((item, index) => (
              <Reveal key={item.title} delay={index * 70}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <ThemesSection />

        <section className="block" id="open-source">
          <Reveal>
            <span className="eyebrow">Open source</span>
            <h2>Built in the open</h2>
            <p className="lede">
              Relay is free and open source under the MIT license. Read the
              code, report a problem or send a change. We want Relay to grow
              with the people who use it.
            </p>
          </Reveal>
          <div className="grid oss">
            {openSource.map((item, index) => (
              <Reveal key={item.title} delay={index * 70}>
                <a href={item.href}>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                  <code>
                    {item.link}
                    <ArrowUpRight size={12} />
                  </code>
                </a>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="faq-block" id="faq">
          <h2>Common questions</h2>
          <Faq items={faq} />
        </section>

        <section className="centered final" id="download">
          <Reveal>
            <h2>Try Relay</h2>
            <p>Free and open source. For macOS, Windows and Linux.</p>
          </Reveal>
          <div className="hero-actions">
            <a className="cta" href="download/">
              Download Relay
              <ArrowDownToLine size={15} />
            </a>
            <a className="cta ghost" href={REPO}>
              <GitHubMark />
              Star on GitHub
            </a>
          </div>
        </section>
      </main>
      <SiteFooter home="" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Site />
    </QueryClientProvider>
  </StrictMode>,
);
