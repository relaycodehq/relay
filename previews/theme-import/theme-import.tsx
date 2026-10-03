// Typography and VS Code themes from Open VSX in the Appearance settings. Search and install
// hit the live Open VSX API; account and the rest are sample data.
// Open http://127.0.0.1:5177/previews/theme-import.html
import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../../src/app/projects.css";
import { initAppearance } from "../../src/lib/appearance";
import { initTypography } from "../../src/lib/typography";
import { Settings } from "../../src/features/settings/Settings";
import { ThemeCodePreview } from "../../src/features/settings/ThemeCodePreview";
import { useAppearance } from "../../src/lib/appearance";
import type { Api } from "../../shared/types";

initAppearance();
initTypography();

Object.assign(window.relay as Partial<Api>, {
  updateState: async () => ({ status: "off", current: "preview" }),
  aiSettings: () => new Promise(() => {}),
});

const queryClient = new QueryClient();

function Preview() {
  const [open, setOpen] = useState(true);
  const look = useAppearance();
  return (
    <div style={{ padding: 32, maxWidth: 820 }}>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        Live Open VSX search and install · everything else is sample data ·{" "}
        <button type="button" onClick={() => setOpen(true)}>
          Open settings
        </button>{" "}
        <button
          type="button"
          onClick={() => {
            localStorage.removeItem("relay-imported-themes");
            localStorage.removeItem("relay-appearance");
            location.reload();
          }}
        >
          Reset preview
        </button>
      </p>
      <ThemeCodePreview look={look} />
      {open && (
        <Settings
          account={null}
          initialCategory="appearance"
          onClose={() => setOpen(false)}
          onDisconnect={async () => {}}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
