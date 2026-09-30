// Settings → Keyboard shortcuts: click a keycap and press new keys.
// Open http://127.0.0.1:5177/previews/shortcuts.html
import "./desktop-stub";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/styles.css";
import "../src/components/projects.css";
import { initAppearance } from "../src/lib/appearance";
import { initShortcuts } from "../src/lib/shortcuts";
import { Settings } from "../src/components/Settings";

initAppearance();
initShortcuts();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Settings
        account={null}
        initialCategory="shortcuts"
        onClose={() => {}}
        onDisconnect={async () => {}}
      />
    </QueryClientProvider>
  </StrictMode>,
);
