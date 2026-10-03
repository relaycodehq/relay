// Image reads in an agent's trace: the picture as the row's icon, grown above
// on hover like a sent image's pill. Sample turns and generated sample images.
// Open http://127.0.0.1:5177/previews/read-image-thumbs/
import "../_shared/desktop-stub";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/composer/prompt/prompt-input.css";
import { initAppearance } from "../../src/lib/appearance";
import type { AgentActivity, ChatMessage } from "../../shared/projects";
import {
  AgentTurn,
  type ReadImages,
} from "../../src/features/agent-turn/AgentTurn";
import type { PreviewImage } from "../../src/features/images/ImagePreview";

initAppearance();

const projectRoot = "/Users/sample/relay";

function sampleImage(hue: number, w = 640, h = 400) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, `hsl(${hue} 70% 55%)`);
  grad.addColorStop(1, `hsl(${hue + 60} 70% 30%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#fffc";
  g.fillRect(40, 40, w - 80, 48);
  g.fillRect(40, 110, w / 2, 220);
  g.font = "bold 28px sans-serif";
  g.fillStyle = "#222";
  g.fillText(`sample ${hue}`, 56, 74);
  return canvas.toDataURL("image/png");
}

const files: Record<string, string> = {
  "/tmp/d0.png": sampleImage(200),
  "/tmp/m1.png": sampleImage(20, 400, 800),
  [`${projectRoot}/tests/shots/sidebar.png`]: sampleImage(280, 900, 300),
};

const images: ReadImages = {
  find: (path): PreviewImage | undefined =>
    path in files || path.endsWith("missing.png")
      ? {
          key: path,
          name: path.split("/").at(-1)!,
          path,
          load: () =>
            path in files
              ? new Promise((r) => setTimeout(() => r(files[path]!), 400))
              : Promise.reject(new Error("gone")),
        }
      : undefined,
  open: (image) => alert(`Would open ${image.name} in the viewer`),
};

const step = (
  id: string,
  kind: AgentActivity["kind"],
  label: string,
  status: AgentActivity["status"] = "complete",
) => ({
  kind: "activity" as const,
  id,
  activity: { id, kind, label, status },
});

const finished: ChatMessage = {
  id: "done",
  role: "assistant",
  provider: "claude",
  status: "complete",
  body: "Both screenshots look right.",
  created: Date.now() - 64_000,
  ended: Date.now() - 2_000,
  version: 1,
  trace: [
    {
      kind: "commentary",
      id: "c1",
      text: "Taking screenshots of both themes.",
    },
    step("cmd", "command", "npx playwright test shots.spec.ts"),
    step("r0", "read", "/tmp/d0.png"),
    {
      kind: "commentary",
      id: "c2",
      text: "And the rest, one of them deleted since:",
    },
    step("r1", "read", "/tmp/m1.png"),
    step("r2", "read", `${projectRoot}/src/app/shell.css`),
    step("r3", "read", `${projectRoot}/tests/shots/sidebar.png`),
    step("r4", "read", "/tmp/missing.png"),
    { kind: "commentary", id: "c3", text: "One alone:" },
    step("r5", "read", `${projectRoot}/tests/shots/sidebar.png`),
  ],
} as ChatMessage;

const live: ChatMessage = {
  ...finished,
  id: "live",
  status: "streaming",
  body: "",
  ended: undefined,
  created: Date.now() - 9_000,
  trace: [
    step("lc", "command", "npx playwright screenshot"),
    step("lr", "read", "/tmp/d0.png"),
  ],
} as ChatMessage;

function App() {
  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: "0 24px" }}>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        Sample data. Hover an image row to peek, click to "open".
      </p>
      {[finished, live].map((m) => (
        <article key={m.id} className="project-message assistant">
          <AgentTurn
            message={m}
            projectRoot={projectRoot}
            onOpenFile={() => {}}
            onChanges={() => {}}
            images={images}
            open
          />
        </article>
      ))}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
