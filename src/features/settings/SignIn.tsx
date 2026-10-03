import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileCode2,
  GitPullRequest,
  Inbox,
  PanelLeft,
} from "lucide-react";
import { parseRoomInvitation } from "../../../shared/rooms";
import type { Account, Bootstrap } from "../../../shared/types";
import { api } from "../../lib/api";
import { TeaHint, TeaLogins } from "./TeaSignIn";
import { ErrorBox } from "../../ui/ui";

/** Gitea's sign-in: a saved login being unlocked, or the server and token form. */
export function SignIn({
  onConnected,
  loginRestore,
  savedServer,
  platform,
  onRestoreAction,
  invitationUrl,
}: {
  onConnected: (a: Account) => Promise<void>;
  loginRestore: Bootstrap["loginRestore"];
  savedServer?: string;
  platform: string;
  onRestoreAction: (action: "retry" | "cancel") => Promise<void>;
  invitationUrl?: string;
}) {
  // No built-in default: releases are public, and a work host doesn't belong in them.
  const [server, setServer] = useState(savedServer ?? ""),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    if (!invitationUrl || token) return;
    try {
      const project = parseRoomInvitation(invitationUrl).project;
      if (project) setServer(project.server);
    } catch {
      /* Normal PR links continue through the existing sign-in flow. */
    }
  }, [invitationUrl, token]);
  const restoreAction = async (action: "retry" | "cancel") => {
    setBusy(true);
    setError(undefined);
    try {
      await onRestoreAction(action);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="welcome-sidebar">
        <div className="titlebar">
          <span className="traffic-space" />
          <PanelLeft size={19} />
        </div>
        <div className="brand">
          <span className="brand-icon">
            <GitPullRequest size={22} />
          </span>
          <div>
            Relay<small>A little more focus.</small>
          </div>
        </div>
        <div className="welcome-nav">
          <Inbox size={17} /> Your review inbox
        </div>
        <div className="welcome-nav">
          <FileCode2 size={17} /> Every line, side by side
        </div>
        <div className="welcome-nav">
          <Check size={17} /> Pick up where you left off
        </div>
        <div className="welcome-bottom">
          Built for the work between
          <br />
          “PR opened” and “looks good.”
        </div>
      </div>
      <main className="welcome-main">
        <div className="titlebar" />
        <div className="connect-card">
          {loginRestore === "unlocking" ? (
            <>
              <span className="eyebrow">PICKING UP WHERE YOU LEFT OFF</span>
              <h1>Unlocking your saved sign-in.</h1>
              <p role="status">
                Waiting for{" "}
                {platform === "darwin"
                  ? "macOS Keychain"
                  : "your system keyring"}
                . If a permission dialog appears, allow access to your saved
                Gitea login. Your review will reopen automatically.
              </p>
              {!!error && <ErrorBox error={error} />}
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void restoreAction("cancel")}
              >
                Sign in again
              </button>
            </>
          ) : (
            <>
              <span className="eyebrow">YOUR CODE. A CLEARER VIEW.</span>
              <h1>
                Make room for
                <br />a better review.
              </h1>
              <p>
                Your Gitea pull requests, in a focused desktop workspace. Less
                waiting. More understanding.
              </p>
              {loginRestore === "failed" && (
                <ErrorBox
                  error="Your saved sign-in could not be unlocked. Retry access to your system keyring, or sign in below. Your saved review is still here."
                  retry={() => void restoreAction("retry")}
                />
              )}
              <TeaLogins onConnected={onConnected} />
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError(undefined);
                  try {
                    const a = await api.connect(server, token);
                    setToken("");
                    await onConnected(a);
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Gitea server
                  <input
                    autoFocus
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    type="url"
                    required
                    placeholder="https://git.example.com"
                  />
                </label>
                <label>
                  Personal access token
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                    placeholder="Paste your token here"
                  />
                </label>
                <p className="field-note">
                  Create a token with <b>read:user</b>, <b>write:repository</b>,
                  and <b>write:issue</b> access. Include private repositories if
                  needed.
                </p>
                {!!error && <ErrorBox error={error} />}
                <button
                  className="primary connect-button"
                  disabled={busy || !token.trim()}
                >
                  {busy ? "Connecting…" : "Connect to Gitea"}
                  <ArrowRight size={16} />
                </button>
              </form>
              <button
                className="text-button"
                disabled={!server.trim()}
                onClick={() => {
                  try {
                    void api
                      .openExternal(
                        `${new URL(server).href.replace(/\/$/, "")}/user/settings/applications`,
                      )
                      .catch(setError);
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                Create a token in Gitea <ArrowUpRight size={14} />
              </button>
              <TeaHint />
              <div className="connection-footnote">
                <span className="dot green" /> Direct connection · Credentials
                stay on this device
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
