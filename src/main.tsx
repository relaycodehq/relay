import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "./components/ui";
import ProjectShell from "./components/ProjectShell";
import {
  drawsWindowControls,
  WindowControls,
} from "./components/WindowControls";
import "./styles.css";
import { initAppearance } from "./lib/appearance";
import { initWindowFocus } from "./lib/window-focus";
import { initFocusRing } from "./lib/focus-ring";
import { initTypography } from "./lib/typography";
import { initShortcuts } from "./lib/shortcuts";
initAppearance();
initTypography();
initWindowFocus();
initFocusRing();
initShortcuts();
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30000,
      gcTime: 120000,
    },
    mutations: { retry: false },
  },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The preload bridge only exists in the desktop app; a browser tab on
        the dev server would otherwise crash on the first API call. */}
    {window.relay ? (
      <>
        <ErrorBoundary>
          <QueryClientProvider client={client}>
            <ProjectShell />
          </QueryClientProvider>
        </ErrorBoundary>
        {drawsWindowControls && <WindowControls />}
      </>
    ) : (
      <div className="empty">
        <h2>Relay runs in its desktop app</h2>
        <p>
          This is the renderer dev server. Start Relay with{" "}
          <code>npm run dev</code> to open it in Electron.
        </p>
      </div>
    )}
  </StrictMode>,
);
