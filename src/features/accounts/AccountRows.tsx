import { useEffect, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { LoaderCircle, MoreHorizontal, Plus } from "lucide-react";
import { api } from "../../lib/api";
import { agents } from "../../../shared/agents";
import {
  accountsOf,
  type AccountProvider,
  type AgentAccount,
  type AgentAccountsState,
} from "../../../shared/agent-accounts";
import { AccountBars, headroom } from "./AccountBars";
import { useAgentAccounts } from "./agent-accounts";
import { useAccountsUsage } from "./useAccountUsage";
import "./accounts.css";

type OnError = (error: unknown) => void;

/**
 * An agent's accounts as lines of its card in Settings → AI models → Agents:
 * the one new threads start on is picked by clicking its line.
 */
export function AccountRows({
  provider,
  onError,
}: {
  provider: AccountProvider;
  onError: OnError;
}) {
  const state = useAgentAccounts();
  const list = state ? accountsOf(state, provider) : [];
  const usage = useAccountsUsage(
    provider,
    list.map((a) => a.id),
  );
  if (!state) return null;
  const several = list.length > 1;
  return (
    <>
      {list.map((account) => (
        <AccountRow
          key={account.id}
          account={account}
          usage={usage[account.id]}
          several={several}
          inUse={state.inUse[provider] === account.id}
          onError={onError}
        />
      ))}
      <div className="accounts-add-line">
        <AddAccount provider={provider} state={state} onError={onError} />
      </div>
    </>
  );
}

function AccountRow({
  account,
  usage,
  several,
  inUse,
  onError,
}: {
  account: AgentAccount;
  usage: Parameters<typeof AccountBars>[0]["usage"];
  several: boolean;
  inUse: boolean;
  onError: OnError;
}) {
  const [renaming, setRenaming] = useState(false);
  const { provider, id } = account;
  const out = headroom(usage) === 0;
  const who = [
    account.signedIn ? account.plan : "Signed out",
    account.email,
    account.system && (provider === "claude" ? "~/.claude" : "~/.codex"),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className="accounts-row"
      data-several={several || undefined}
      data-in-use={(several && inUse) || undefined}
      data-out={out || undefined}
    >
      {/* The whole line picks the account, not just its radio. */}
      <label className="accounts-pick">
        {several && (
          <input
            type="radio"
            name={`account-in-use-${provider}`}
            checked={inUse}
            onChange={() => api.useAgentAccount(provider, id).catch(onError)}
          />
        )}
        <span className="accounts-text">
          <span className="accounts-title">
            {renaming ? (
              <Rename
                label={account.label}
                onDone={(label) => {
                  setRenaming(false);
                  if (label && label !== account.label)
                    api.renameAgentAccount(provider, id, label).catch(onError);
                }}
              />
            ) : (
              <b>{account.label}</b>
            )}
            {several && inUse && (
              <span className="accounts-in-use">New threads</span>
            )}
            {out && usage?.windows.length ? (
              <span className="accounts-quiet">Out until reset</span>
            ) : null}
          </span>
          <span className="accounts-who">{who}</span>
        </span>
        <AccountBars usage={usage} />
      </label>
      <RowMenu
        account={account}
        onRename={() => setRenaming(true)}
        onError={onError}
      />
    </div>
  );
}

function Rename({
  label,
  onDone,
}: {
  label: string;
  onDone: (label: string | null) => void;
}) {
  const [value, setValue] = useState(label);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  return (
    <input
      ref={input}
      className="accounts-rename"
      aria-label="Account name"
      value={value}
      maxLength={40}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.preventDefault()}
      onBlur={() => onDone(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(value.trim() || null);
        if (e.key === "Escape") onDone(null);
      }}
    />
  );
}

function RowMenu({
  account,
  onRename,
  onError,
}: {
  account: AgentAccount;
  onRename: () => void;
  onError: OnError;
}) {
  const { provider, id } = account;
  return (
    <Menu.Root>
      <Menu.Trigger
        className="icon-button accounts-more"
        aria-label={`More for ${account.label}`}
      >
        <MoreHorizontal size={15} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="composer-popup-positioner"
          align="end"
          sideOffset={4}
        >
          <Menu.Popup className="composer-select-popup accounts-menu">
            <Menu.Item className="composer-select-item" onClick={onRename}>
              Rename
            </Menu.Item>
            <Menu.Item
              className="composer-select-item"
              onClick={() =>
                api.signInAgentAccount(provider, id).catch(onError)
              }
            >
              Sign in again
            </Menu.Item>
            {!account.system && (
              <>
                <Menu.Separator className="composer-menu-separator" />
                <Menu.Item
                  className="composer-select-item accounts-danger"
                  onClick={() =>
                    api.removeAgentAccount(provider, id).catch(onError)
                  }
                >
                  Sign out and remove
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Names a new account, then runs the CLI's own browser sign-in with a
 * folder of its own; it joins the list once that finishes.
 */
function AddAccount({
  provider,
  state,
  onError,
}: {
  provider: AccountProvider;
  state: AgentAccountsState;
  onError: OnError;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const waiting =
    state.signingIn?.provider === provider ? state.signingIn : null;
  if (waiting)
    return (
      <span className="accounts-adding" role="status">
        <LoaderCircle size={12} className="spin" aria-hidden />
        Finish signing in to <b>{waiting.label}</b> in your browser
        <button
          type="button"
          onClick={() => api.cancelAgentAccountSignIn().catch(onError)}
        >
          Cancel
        </button>
      </span>
    );
  if (!naming)
    return (
      <>
        {state.signInError && !state.signingIn && (
          <span className="accounts-error" role="alert">
            {state.signInError}
          </span>
        )}
        <button
          type="button"
          className="accounts-add"
          disabled={!!state.signingIn}
          onClick={() => setNaming(true)}
        >
          <Plus size={13} /> Add account
        </button>
      </>
    );
  return (
    <form
      className="accounts-adding"
      onSubmit={(e) => {
        e.preventDefault();
        const label = name.trim();
        if (!label) return;
        setNaming(false);
        setName("");
        api.addAgentAccount(provider, label).catch(onError);
      }}
    >
      <input
        autoFocus
        aria-label="Account name"
        placeholder="Name, e.g. Work"
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setNaming(false)}
      />
      <button type="submit" className="primary-action" disabled={!name.trim()}>
        Sign in with {agents[provider].cli}
      </button>
      <button type="button" onClick={() => setNaming(false)}>
        Cancel
      </button>
    </form>
  );
}
