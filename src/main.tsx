import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "./ui/ui";
import ProjectShell from "./app/ProjectShell";
import ThreadWindowShell from "./app/ThreadWindowShell";
import {
  drawsWindowControls,
  followFullScreen,
  followWindowControlsOverlay,
  WindowControls,
} from "./app/WindowControls";
import "./styles.css";
import { initAppearance } from "./lib/appearance";
import { initWindowFocus } from "./lib/window-focus";
import { initCleanCopy } from "./lib/clean-copy";
import { initFocusRing } from "./lib/focus-ring";
import { initContextMenuKey } from "./lib/context-menu-key";
import { initTypography } from "./lib/typography";
import { initChatWidth } from "./lib/chat-width";
import { initShortcuts } from "./lib/shortcuts";
import { followChatEvents } from "./lib/chat-events";
import { followSounds } from "./features/sounds/follow-sounds";
import { playPushedSounds } from "./features/sounds/pushed-sounds";
import { startRegistryAgents } from "./features/agents/registry-agents";
import { followThreadWindows } from "./features/thread-windows/thread-windows";
import { threadWindowOf } from "../shared/thread-windows";
import { startDraftSync } from "./features/composer/draft-sync";
import { followHeldSends } from "./features/composer/held-sends";
import { DragTray } from "./features/bug-report/DragTray";
import { followMainSettings } from "./features/settings/follow-main-settings";
import { shareReviewSetups } from "./features/deep-review/review-setups";
const search = new URLSearchParams(location.search);
// The menubar's hidden sound player loads this page too, for its sounds
// alone, and so does the hidden one that sends a phone's draft.
if (window.relay && search.has("sounds")) playPushedSounds();
else if (window.relay && search.has("drafts")) followHeldSends();
else if (window.relay && search.has("drag-tray")) startDragTray();
else startApp();

/** The tray of report files Relay floats over GitHub, to drag in. */
function startDragTray() {
  initAppearance();
  document.documentElement.classList.add("drag-tray-page");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <DragTray />
    </StrictMode>,
  );
}

function startApp() {
  // A thread popped out of the main window, in a window of its own.
  const thread = threadWindowOf(location.search);
  initAppearance();
  initTypography();
  initChatWidth();
  initWindowFocus();
  initCleanCopy();
  initFocusRing();
  initContextMenuKey();
  initShortcuts();
  followWindowControlsOverlay();
  followFullScreen();
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
    followMainSettings(client);
    followThreadWindows();
    // The main window plays every thread's sounds, its own windows' too.
    if (!thread) followSounds(client);
    // Each window shares what's typed in it; the main one takes what came from elsewhere.
    startDraftSync({ takes: !thread });
    if (!thread) followHeldSends();
    // Agents start deep reviews with the setups the sheet keeps.
    if (!thread) shareReviewSetups();
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
