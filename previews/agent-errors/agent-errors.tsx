import "../_shared/desktop-stub";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import "../../src/styles.css";
import { initAppearance, setMode } from "../../src/lib/appearance";
import { Message } from "../../src/features/thread/ProjectMessage";

initAppearance();

const samples = {
  "Unsupported model": JSON.stringify({
    type: "error",
    status: 400,
    error: {
      type: "invalid_request_error",
      message:
        "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
    },
  }),
  "Provider error":
    'API Error: 429 {"error":{"type":"rate_limit_error","message":"Too many requests. Try again later."}}',
  "Plain text": "Connection closed before the answer finished.",
  "Unknown response":
    '{"type":"error","status":500,"error":{"code":"internal_error"}}',
};

function Preview() {
  const [sample, setSample] =
    useState<keyof typeof samples>("Unsupported model");
  const [resumed, setResumed] = useState(false);
  const [dark, setDark] = useState(true);
  return (
    <main style={{ maxWidth: 760, margin: "48px auto", padding: "0 24px" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          marginBottom: 32,
        }}
      >
        <span className="muted">Agent errors · sample data</span>
        <select
          aria-label="Error example"
          value={sample}
          onChange={(e) => {
            setSample(e.target.value as keyof typeof samples);
            setResumed(false);
          }}
        >
          {Object.keys(samples).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <button
          onClick={() => {
            setMode(dark ? "light" : "dark");
            setDark(!dark);
          }}
        >
          {dark ? "Light theme" : "Dark theme"}
        </button>
      </div>
      <Message
        key={sample}
        message={{
          id: "sample-error",
          provider: "codex",
          role: "assistant",
          status: "failed",
          body: "",
          created: Date.now(),
          version: 1,
          error: samples[sample],
        }}
        chatId=""
        projectRoot="/sample/project"
        onReply={() => setResumed(true)}
        onChanges={() => {}}
        onTurnDiff={() => {}}
        onOpenFile={() => {}}
        onRewind={async () => ({ conflicts: [] })}
      />
      <button
        className="resume-answer"
        onClick={() => setResumed(true)}
        disabled={resumed}
      >
        <RotateCcw size={13} />{" "}
        {resumed ? "Resume requested (sample)" : "Resume answer"}
      </button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <Preview />
  </QueryClientProvider>,
);
