// Pieces the three account options share: meters, the row menu, adding an
// account, and a thread with a composer to switch from.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Hourglass, MoreHorizontal, Plus } from "lucide-react";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import { UsageDial } from "../../src/features/agents/UsageDial";
import { agentName } from "../../shared/agents";
import type { UsageMeter } from "../../shared/provider-usage";
import { ModelPicker } from "./picker-mock";
import {
  meters,
  resetClock,
  type Account,
  type Accounts,
  type Provider,
} from "./accounts-data";

/** One limit as a thin bar with what's left, like the usage popover's rows. */
export function Bar({ meter, wide }: { meter: UsageMeter; wide?: boolean }) {
  return (
    <div className="acc-bar" data-pace={meter.pace} data-wide={wide || undefined}>
      <div className="acc-bar-top">
        <span>{meter.kind === "session" ? "5h" : "Week"}</span>
        <span className="acc-bar-left">{meter.leftPercent}% left</span>
      </div>
      <div className="acc-bar-track">
        <span style={{ width: `${meter.leftPercent}%` }} />
      </div>
      {wide && <small>{meter.resetLabel}</small>}
    </div>
  );
}

export function Bars({ account, wide }: { account: Account; wide?: boolean }) {
  return (
    <div className="acc-bars">
      {meters(account).map((m) => (
        <Bar key={m.kind} meter={m} wide={wide} />
      ))}
    </div>
  );
}

export function Dial({ account }: { account: Account }) {
  return <UsageDial meters={meters(account)} />;
}

/** Marks the account new threads start on, so it reads at a glance. */
export function InUse() {
  return <span className="acc-in-use">In use</span>;
}

export function Who({ account }: { account: Account }) {
  return (
    <span className="acc-who">
      {account.plan} · {account.email}
      {account.system && <> · {account.provider === "claude" ? "~/.claude" : "~/.codex"}</>}
    </span>
  );
}

export function RowMenu({
  account,
  store,
  onRename,
}: {
  account: Account;
  store: Accounts;
  onRename: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className="icon-button acc-more"
        aria-label={`More for ${account.label}`}
      >
        <MoreHorizontal size={15} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="composer-popup-positioner" align="end" sideOffset={4}>
          <Menu.Popup className="composer-select-popup acc-menu">
            <Menu.Item className="composer-select-item" onClick={onRename}>
              Rename
            </Menu.Item>
            <Menu.Item className="composer-select-item">Sign in again</Menu.Item>
            {!account.system && (
              <>
                <Menu.Separator className="composer-menu-separator" />
                <Menu.Item
                  className="composer-select-item acc-danger"
                  disabled={store.of(account.provider).length < 2}
                  onClick={() => store.remove(account)}
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

/** A label that turns into a field while renaming. */
export function Name({
  account,
  store,
  editing,
  onDone,
}: {
  account: Account;
  store: Accounts;
  editing: boolean;
  onDone: () => void;
}) {
  const [value, setValue] = useState(account.label);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  if (!editing) return <b className="acc-name">{account.label}</b>;
  const done = () => {
    if (value.trim()) store.rename(account.id, value.trim());
    onDone();
  };
  return (
    <input
      ref={input}
      className="acc-rename"
      value={value}
      aria-label="Account name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") done();
        if (e.key === "Escape") onDone();
      }}
    />
  );
}

/**
 * Adding an account: name it, then the CLI's own browser sign-in runs with
 * a config folder of its own. Here the sign-in is simulated.
 */
export function AddAccount({
  provider,
  store,
  compact,
}: {
  provider: Provider;
  store: Accounts;
  compact?: boolean;
}) {
  const [step, setStep] = useState<"idle" | "name" | "waiting">("idle");
  const [name, setName] = useState("");
  const cli = provider === "claude" ? "claude login" : "codex login";
  if (step === "idle")
    return (
      <button
        type="button"
        className={compact ? "acc-add-link" : "acc-add"}
        onClick={() => setStep("name")}
      >
        <Plus size={13} /> Add {compact ? "account" : `${agentName(provider)} account`}
      </button>
    );
  if (step === "waiting")
    return (
      <div className="acc-adding" role="status">
        <span className="spin-dot" aria-hidden />
        Finish signing in to <b>{name}</b> in your browser. Relay ran{" "}
        <code>{cli}</code> with a config folder of its own.
      </div>
    );
  return (
    <form
      className="acc-adding"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setStep("waiting");
        setTimeout(() => {
          store.add(provider, name.trim());
          setStep("idle");
          setName("");
        }, 1800);
      }}
    >
      <input
        autoFocus
        placeholder="Name, e.g. Work"
        value={name}
        aria-label="Account name"
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="primary-action" disabled={!name.trim()}>
        Sign in…
      </button>
      <button type="button" onClick={() => setStep("idle")}>
        Cancel
      </button>
    </form>
  );
}

export function ProviderHead({
  provider,
  children,
}: {
  provider: Provider;
  children?: ReactNode;
}) {
  return (
    <div className="acc-provider">
      <ProviderIcon provider={provider} />
      <b>{agentName(provider)}</b>
      <span className="acc-provider-tools">{children}</span>
    </div>
  );
}

/**
 * Today's limit strip, only when the thread really waits: auto-switch off or
 * no account with room. Moving on shows nothing but a line in the thread.
 */
export function LimitNotice({ store }: { store: Accounts }) {
  const current = store.byId(store.thread.accountId)!;
  if (current.sessionUsed < 100) return null;
  return (
    <div className="waiting-strip" role="status">
      <div className="waiting-strip-head">
        <Hourglass size={15} />
        <span className="waiting-strip-text">
          <b>{agentName(current.provider)} hit its usage limit</b>
          <span> · resumes the answer at {resetClock(current)}</span>
        </span>
        <button type="button">Don't resume</button>
      </div>
    </div>
  );
}

/** A short thread above a composer whose toolbar the option fills in. */
export function ThreadMock({
  store,
  tools,
  note,
}: {
  store: Accounts;
  tools: ReactNode;
  note?: ReactNode;
}) {
  const current = store.byId(store.thread.accountId)!;
  return (
    <div className="acc-thread">
      <div className="acc-messages">
        <p className="acc-user">Split the settings page into sections, keep search working.</p>
        <p className="acc-answer">
          Moved each category into <code>sections/</code> and kept the search
          index in one place. Running the settings specs next…
        </p>
        {note && <p className="acc-system">{note}</p>}
      </div>
      <LimitNotice store={store} />
      <div className="project-composer acc-composer">
        <div className="acc-input">Ask for follow-up changes</div>
        <div className="composer-tools">
          <ModelPicker store={store} model={current.provider === "claude" ? "Opus 5.5" : "GPT-6 Astra"} />
          {tools}
        </div>
      </div>
    </div>
  );
}
