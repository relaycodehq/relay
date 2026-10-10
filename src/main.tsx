import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "./ui/ui";
import ProjectShell from "./app/ProjectShell";
import ThreadWindowShell from "./app/ThreadWindowShell";
import { drawsWindowControls, WindowControls } from "./app/WindowControls";
import "./styles.css";
import { initAppearance } from "./lib/appearance";
import { initWindowFocus } from "./lib/window-focus";
import { initFocusRing } from "./lib/focus-ring";
import { initTypography } from "./lib/typography";
import { initChatWidth } from "./lib/chat-width";
import { initShortcuts } from "./lib/shortcuts";
import { followChatEvents } from "./lib/chat-events";
import { followSounds } from "./features/sounds/follow-sounds";
import { playPushedSounds } from "./features/sounds/pushed-sounds";
import { startRegistryAgents } from "./features/agents/registry-agents";
import { followThreadWindows } from "./features/thread-windows/thread-windows";
import { threadWindowOf } from "../shared/thread-windows";
// The menubar's hidden sound player loads this page too, for its sounds alone.
if (window.relay && new URLSearchParams(location.search).has("sounds"))
  playPushedSounds();
else startApp();

function startApp() {
  // A thread popped out of the main window, in a window of its own.
  const thread = threadWindowOf(location.search);
  initAppearance();
  initTypography();
  initChatWidth();
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
  if (window.relay) {
    followChatEvents(client);
    followThreadWindows();
    // The main window plays every thread's sounds, its own windows' too.
    if (!thread) followSounds(client);
    // Threads on a registry agent need its name before anything lists them.
    startRegistryAgents();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {/* The preload bridge only exists in the desktop app; a browser tab on
        the dev server would otherwise crash on the first API call. */}
      {window.relay ? (
        <>
          <ErrorBoundary>
            <QueryClientProvider client={client}>
              {thread ? (
                <ThreadWindowShell thread={thread} />
              ) : (
                <ProjectShell />
              )}
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
}
