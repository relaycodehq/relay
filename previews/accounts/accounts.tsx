// Several Claude Code / Codex accounts: pick one in Settings or the composer,
// switch from the model picker, and move on down the list when one runs out.
// Open http://127.0.0.1:5177/previews/accounts/
import "../_shared/desktop-stub";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/settings/settings.css";
import "../../src/features/agents/composer-model-picker.css";
import "../../src/features/handoff/waiting-strip.css";
import "../_shared/chrome.css";
import "./accounts.css";
import { initAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { useAccounts, type Provider } from "./accounts-data";
import { AccountSettings } from "./account-settings";
import { AccountThread } from "./account-thread";
import { ToolbarBuilder } from "./toolbar-mock";

initAppearance();
initWindowFocus();

function Preview() {
  const store = useAccounts();
  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>Accounts</strong>
        <span className="preview-tag">Preview · sample data</span>
        <div className="preview-segmented" role="radiogroup" aria-label="Thread agent">
          {(["claude", "codex"] as Provider[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={store.thread.provider === p}
              onClick={() => store.setProvider(p)}
            >
              {p === "claude" ? "Claude Code" : "Codex"}
            </button>
          ))}
        </div>
        <button type="button" className="preview-button" onClick={store.hitLimit}>
          Hit the 5h limit
        </button>
        <button type="button" className="preview-button" onClick={store.reset}>
          Reset
        </button>
      </div>
      <div className="acc-stage">
        <section className="acc-pane" aria-label="Settings">
          <p className="acc-caption">Settings → AI models</p>
          <div className="setting block">
            <div className="setting-text">
              <h4>Accounts</h4>
              <p>
                Sign in to more than one Claude Code or Codex account. Each
                keeps its own sign-in folder; your usual one stays where the
                CLI put it.
              </p>
            </div>
            <div className="setting-control acc-settings">
              <AccountSettings store={store} />
            </div>
          </div>
          <p className="acc-caption acc-caption-gap">Settings → Appearance</p>
          <ToolbarBuilder store={store} />
        </section>
        <section className="acc-pane acc-pane-thread" aria-label="Thread">
          <p className="acc-caption">
            A thread · switch in the model picker's footer; the account control shows once it's on the bar
          </p>
          <AccountThread store={store} />
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
