import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Moon, Sun, Monitor } from "lucide-react";
import type { Account } from "../../shared/types";
import { aiSettingsSchema, type AISettings } from "../../shared/settings";
import { api } from "../lib/api";
import { useAISettings } from "../lib/useAISettings";
import { Avatar, ErrorBox, Modal } from "./ui";
import { ModelField } from "./ModelField";
import { RoomHostingSettings } from "./RoomHostingSettings";
export function Settings({
  account,
  onClose,
  onDisconnect,
}: {
  account: Account;
  onClose: () => void;
  onDisconnect: () => Promise<void>;
}) {
  const settings = useAISettings(),
    qc = useQueryClient();
  const [draft, setDraft] = useState<AISettings>();
  const [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  const values = draft ?? settings.data;
  const change = (kind: keyof AISettings, value: AISettings["questions"]) => {
    if (values) {
      setDraft({ ...values, [kind]: value });
      setSaved(false);
    }
  };
  const [theme, setTheme] = useState(localStorage.getItem("theme") ?? "system");
  const [error, setError] = useState<unknown>();
  const apply = (v: string) => {
    setTheme(v);
    localStorage.setItem("theme", v);
    document.documentElement.dataset.theme = v;
  };
  return (
    <Modal title="Settings" className="settings-modal" onClose={onClose}>
      <div className="settings-account">
        <Avatar name={account.user.login} />
        <div>
          <strong>{account.user.login}</strong>
          <p>{account.server}</p>
        </div>
      </div>
      <p className="field-note">
        {account.persistent
          ? "Your token is encrypted using the operating system’s credential protection."
          : "Your token is kept for this session only because secure credential storage is unavailable."}
      </p>
      <label>Appearance</label>
      <div className="segmented appearance">
        {[
          ["system", Monitor],
          ["light", Sun],
          ["dark", Moon],
        ].map(([v, I]) => {
          const Icon = I as typeof Monitor;
          return (
            <button
              key={String(v)}
              className={theme === v ? "active" : ""}
              onClick={() => apply(String(v))}
            >
              <Icon size={15} />
              {String(v)}
            </button>
          );
        })}
      </div>
      <section className="ai-settings">
        <h3>Codex</h3>
        <p className="field-note">
          Uses your signed-in Codex CLI. Model availability depends on your
          account.
        </p>
        {values ? (
          <>
            <ModelField
              label="Grouping"
              value={values.grouping}
              onChange={(value) => change("grouping", value)}
            />
            <ModelField
              label="Line questions"
              value={values.questions}
              allowDefault
              onChange={(value) => change("questions", value)}
            />
            <p className="field-note">
              Fast mode uses more credits where available. Existing grouping
              checkpoints keep their saved model, reasoning effort and speed;
              these settings apply to new analyses and questions.
            </p>
            <div className="settings-save">
              <button
                className="primary"
                disabled={
                  !draft ||
                  saving ||
                  !aiSettingsSchema.safeParse(values).success
                }
                onClick={async () => {
                  setSaving(true);
                  setError(undefined);
                  try {
                    const next = await api.saveAISettings(values);
                    qc.setQueryData(["ai-settings"], next);
                    setDraft(undefined);
                    setSaved(true);
                  } catch (error) {
                    setError(error);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Saving…" : "Save AI settings"}
              </button>
              {saved && <span role="status">Settings saved</span>}
            </div>
          </>
        ) : settings.error ? (
          <ErrorBox
            error={settings.error}
            retry={() => void settings.refetch()}
          />
        ) : (
          <p>Loading model settings…</p>
        )}
      </section>
      <RoomHostingSettings />
      <div className="shortcut-list">
        <span>
          Settings <kbd>⌘ / Ctrl ,</kbd>
        </span>
        <span>
          Search pull requests <kbd>⌘ / Ctrl F</kbd>
        </span>
        <span>
          Open PR URL <kbd>⌘ / Ctrl K</kbd>
        </span>
        <span>
          Toggle file list <kbd>⌘ / Ctrl B</kbd>
        </span>
        <span>
          Toggle pull requests <kbd>⌘ / Ctrl Shift B</kbd>
        </span>
        <span>
          Mark file as read <kbd>V</kbd>
        </span>
        <span>
          Next / previous file <kbd>J / K</kbd>
        </span>
      </div>
      {!!error && <ErrorBox error={error} />}
      <button
        className="danger subtle"
        onClick={() => void onDisconnect().catch(setError)}
      >
        <LogOut size={16} />
        Disconnect account
      </button>
      <p className="field-note">
        Local drafts, read marks, and folder links are preserved for this
        account.
      </p>
      <p className="about">
        Review Relay 0.1.0 · Built with code from{" "}
        <a
          href="https://github.com/pingdotgg/t3code"
          onClick={(e) => {
            e.preventDefault();
            void api.openExternal(e.currentTarget.href);
          }}
        >
          T3 Code
        </a>
      </p>
    </Modal>
  );
}
