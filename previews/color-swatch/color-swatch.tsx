// Colour values in chat's inline code get a swatch that grows on hover.
// Open http://127.0.0.1:5177/previews/color-swatch.html
import "../_shared/desktop-stub";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../../src/features/agents/composer-model-picker.css";
import { initAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { RichText } from "../../src/ui/ui";

initAppearance();
initWindowFocus();

const SAMPLE = `\`#1A4165\` sits on the very first line, so its square has to escape the scroller.

- Old navy \`#1A4165\` for the header and primary buttons
- Paper \`#F5F3EE\` as the page background
- Signal red \`rgb(229 57 53)\` for destructive actions only
- Warm amber \`hsl(38 92% 55%)\` for warnings, and the overlay scrim is \`#0008\`
- Accent is \`oklch(0.72 0.14 250)\` so it stays readable in both themes

Things that are **not** colours stay plain code: issue \`#123\`, \`src/theme.ts\`, \`--accent\`, \`red\`.`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div style={{ maxWidth: 720, margin: "28px auto", padding: "0 26px" }}>
      <p style={{ color: "var(--muted)", fontSize: 11 }}>
        Sample data · the real chat markdown renderer in a scrolling box
      </p>
      <div
        className="color-preview-scroller"
        style={{
          height: 260,
          overflow: "auto",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "10px 14px",
        }}
      >
        <RichText text={SAMPLE} />
      </div>
    </div>
  </StrictMode>,
);
