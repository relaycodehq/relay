// The README's hero image: the website's Relay window on sample data, with the
// name and what it is next to it, on a 1280×640 stage (GitHub's social preview
// size). ?shot drops the switcher so a headless browser can photograph it;
// ?w=1200&h=630 sizes the stage for the website's link preview;
// ?version=0.10.0 puts the release it is shot for in the sidebar footer.
import "../_shared/desktop-stub";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/sidebar/sidebar.css";
import "../../src/features/agents/composer-model-picker.css";
import "../../src/features/changes/changed-files.css";
import "../website/website.css";
import "./readme-hero.css";
import { agentName, type AgentProvider } from "../../shared/agents";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import { initSiteTheme, useSiteTheme } from "../website/theme";
import { installStubs } from "../website/stubs";
import { startLanes } from "../website/hero-lanes";
import { AppWindow } from "../website/app-window";
import { Mark } from "../website/parts";

initSiteTheme();
installStubs();

const layouts = [
  { id: "split", name: "A · Split" },
  { id: "stacked", name: "B · Stacked" },
  { id: "tilted", name: "C · Tilted" },
] as const;
type Layout = (typeof layouts)[number]["id"];

const params = new URLSearchParams(location.search);
const shot = params.has("shot");
const version = params.get("version");
if (version)
  window.relay.updateState = async () => ({ status: "idle", current: version });
const agents: AgentProvider[] = [
  "claude",
  "codex",
  "opencode",
  "cursor",
  "amp",
  "antigravity",
];

function Lanes() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { resolved } = useSiteTheme();
  useEffect(() => {
    const lanes = startLanes(canvas.current!, {
      line: resolved.palette.border,
      run: resolved.accent,
    });
    lanes.run(true);
    return () => lanes.stop();
  }, [resolved]);
  return (
    <div className="hero-lanes" aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}

function Words() {
  return (
    <div className="rh-words">
      <div className="rh-name">
        <Mark size={34} />
        Relay
      </div>
      <h1>One workspace for your coding agents</h1>
      <div className="rh-agents">
        {agents.map((agent) => (
          <span key={agent}>
            <ProviderIcon provider={agent} />
            {agentName(agent)}
          </span>
        ))}
        <span className="rh-acp">+ any ACP agent</span>
      </div>
      <div className="rh-fine">
        Open source · MIT · macOS, Windows, Linux · Android remote
      </div>
    </div>
  );
}

function Hero({ layout }: { layout: Layout }) {
  return (
    <div
      className="rh-stage site"
      data-layout={layout}
      style={{
        width: Number(params.get("w")) || undefined,
        height: Number(params.get("h")) || undefined,
      }}
    >
      <Lanes />
      <Words />
      <div className="rh-window">
        <AppWindow stop="review" active={false} onDone={() => {}} />
      </div>
    </div>
  );
}

function Page() {
  const [layout, setLayout] = useState<Layout>(
    (params.get("layout") as Layout) ?? "split",
  );
  if (shot) return <Hero layout={layout} />;
  return (
    <div className="rh-page">
      <div className="rh-switch" role="tablist">
        {layouts.map((l) => (
          <button
            key={l.id}
            role="tab"
            aria-selected={layout === l.id}
            onClick={() => setLayout(l.id)}
          >
            {l.name}
          </button>
        ))}
        <span>Sample data · 1280×640</span>
      </div>
      <Hero layout={layout} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>
  </StrictMode>,
);
