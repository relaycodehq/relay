// Settings → Composer toolbar: drag the composer's controls into your order.
// Open http://127.0.0.1:5177/previews/composer-order.html (?agent=codex)
import "./desktop-stub";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/styles.css";
import "../src/components/projects.css";
import "../src/components/settings.css";
import { initAppearance } from "../src/lib/appearance";
import { initWindowFocus } from "../src/lib/window-focus";
import { SettingsCard, SettingsRow } from "../src/components/SettingsCard";
import {
  ComposerToolbarReset,
  ComposerToolbarSettings,
} from "../src/components/ComposerToolbarSettings";
import { defaultAISettings } from "../shared/settings";
import type { Api } from "../shared/types";
import type { AgentProvider } from "../shared/agents";

initAppearance();
initWindowFocus();

const agent = (new URLSearchParams(location.search).get("agent") ??
  "claude") as AgentProvider;
Object.assign(window.relay as Partial<Api>, {
  aiSettings: async () => ({ ...defaultAISettings, threadProvider: agent }),
  agentDefaults: async () => null,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <div style={{ maxWidth: 700, margin: "28px auto", padding: "0 26px" }}>
        <p style={{ color: "var(--muted)", fontSize: 11 }}>
          Sample data · the real settings component, saved to this browser
        </p>
        <SettingsCard>
          <SettingsRow
            label="Composer toolbar"
            below={<ComposerToolbarSettings />}
          >
            <ComposerToolbarReset />
          </SettingsRow>
        </SettingsCard>
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
