// Settings → AI models, reworked: what lives on the page today split by
// what it's about. Two directions on sample data.
// Open http://127.0.0.1:5177/previews/ai-models/
import "../_shared/desktop-stub";
import "./seed-presets";
import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  FolderGit2,
  Info,
  Keyboard,
  ListTodo,
  Mic,
  MonitorUp,
  MoreHorizontal,
  Palette,
  Plus,
  Puzzle,
  Search,
  Smartphone,
  Sparkles,
  Volume2,
  Zap,
} from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/settings/settings.css";
import "../../src/features/accounts/accounts.css";
import "../../src/features/agents/composer-model-picker.css";
import "../_shared/chrome.css";
import "./ai-models.css";
import { initAppearance } from "../../src/lib/appearance";
import {
  agentName,
  agentProviders,
  agentInfo,
} from "../../shared/agents";
import type { AgentProvider } from "../../shared/agents";
import { defaultAISettings, type AISettings } from "../../shared/settings";
import type { WatchScope } from "../../shared/watch";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import { ModelField } from "../../src/features/agents/ModelField";
import { AccountBars } from "../../src/features/accounts/AccountBars";
import { QuickSwitchSettings } from "../../src/features/quick-switch/QuickSwitchSettings";
import {
  Segmented,
  SettingsCard,
  SettingsRow,
  SettingsSelect,
} from "../../src/ui/SettingsCard";
import { sampleAgents, type SampleAccount, type SampleAgent } from "./ai-models-data";

initAppearance();

type Variant = "a" | "b" | "c";
type Page = "agents" | "models" | "helpers" | "quick";

type NavPage = {
  id: Page;
  label: string;
  icon: typeof Bot;
  description: string;
};
/** A category, or a heading over sub-pages (C). */
type NavItem = NavPage | { label: string; icon: typeof Bot; children: NavPage[] };

const otherCategories = {
  before: [
    ["Appearance", Palette],
    ["Project settings", FolderGit2],
  ],
  after: [
    ["Integrations", ListTodo],
    ["Plugins", Puzzle],
    ["Phone", Smartphone],
    ["Computers", MonitorUp],
    ["Dictation", Mic],
    ["Read aloud", Volume2],
  ],
  last: [
    ["Keyboard shortcuts", Keyboard],
    ["About", Info],
  ],
} as const;

const quickPage: NavPage = {
  id: "quick",
  label: "Quick switch",
  icon: Zap,
  description:
    "Presets of agent, model and effort that ⌃⌘←→ step through in the composer.",
};

/** Where each direction puts things: right after Project settings, and late in the list. */
const navOf: Record<Variant, { main: NavItem[]; late: NavItem[] }> = {
  a: {
    main: [
      {
        id: "agents",
        label: "Agents",
        icon: Bot,
        description:
          "The agents Relay runs, the accounts they use, and the models behind Relay's own helpers.",
      },
    ],
    late: [quickPage],
  },
  b: {
    main: [
      {
        id: "agents",
        label: "Agents",
        icon: Bot,
        description:
          "Which agents are on this computer, and the accounts they sign in with.",
      },
      {
        id: "models",
        label: "Models",
        icon: Sparkles,
        description:
          "Which model does what: Relay's helpers, and the presets you switch between.",
      },
    ],
    late: [],
  },
  c: {
    main: [
      {
        label: "AI models",
        icon: Sparkles,
        children: [
          {
            id: "agents",
            label: "Agents",
            icon: Bot,
            description:
              "The agents Relay runs and the accounts they sign in with.",
          },
          {
            id: "helpers",
            label: "Used by Relay",
            icon: Sparkles,
            description:
              "Models Relay calls itself, outside your threads: review, commits, and the side check that reads along.",
          },
          quickPage,
        ],
      },
    ],
    late: [],
  },
};

const pagesIn = (items: NavItem[]): NavPage[] =>
  items.flatMap((item) => ("children" in item ? item.children : [item]));

function Preview() {
  const [variant, setVariant] = useState<Variant>("c");
  const [page, setPage] = useState<Page>("agents");
  useEffect(() => setPage("agents"), [variant]);
  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>AI models rework</strong>
        <span className="preview-tag">Preview · sample data</span>
        <div
          className="preview-segmented"
          role="radiogroup"
          aria-label="Direction"
        >
          {(
            [
              ["a", "A · One page, per agent"],
              ["b", "B · Agents and Models"],
              ["c", "C · Sub-pages"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={variant === id}
              onClick={() => setVariant(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <SettingsShell variant={variant} page={page} onPage={setPage}>
        {page === "quick" ? (
          <QuickSwitchPage />
        ) : page === "models" ? (
          <ModelsPage />
        ) : page === "helpers" ? (
          <HelpersPage />
        ) : variant === "b" ? (
          <AgentsPage />
        ) : (
          <PerAgentPage withHelpers={variant === "a"} />
        )}
      </SettingsShell>
    </div>
  );
}

function SettingsShell({
  variant,
  page,
  onPage,
  children,
}: {
  variant: Variant;
  page: Page;
  onPage: (page: Page) => void;
  children: ReactNode;
}) {
  const nav = navOf[variant];
  const pages = pagesIn([...nav.main, ...nav.late]);
  const current = pages.find((p) => p.id === page) ?? pages[0];
  const parent = nav.main.find(
    (item) => "children" in item && item.children.includes(current),
  );
  const inert = (list: readonly (readonly [string, typeof Bot])[]) =>
    list.map(([label, Icon]) => (
      <button key={label} type="button" tabIndex={-1}>
        <Icon size={15} />
        <span>{label}</span>
      </button>
    ));
  const link = ({ id, label, icon: Icon }: NavPage, sub?: boolean) => (
    <button
      key={id}
      type="button"
      className={`${page === id ? "active" : ""} ${sub ? "aim-sub" : ""}`}
      aria-current={page === id ? "page" : undefined}
      onClick={() => onPage(id)}
    >
      {!sub && <Icon size={15} />}
      <span>{label}</span>
    </button>
  );
  const items = (list: NavItem[]) =>
    list.map((item) =>
      "children" in item ? (
        <div key={item.label} className="aim-nav-group">
          <button
            type="button"
            className="aim-nav-parent"
            onClick={() => onPage(item.children[0].id)}
          >
            <item.icon size={15} />
            <span>{item.label}</span>
          </button>
          {item.children.map((child) => link(child, true))}
        </div>
      ) : (
        link(item)
      ),
    );
  return (
    <section className="settings-screen" aria-label="Settings">
      <aside className="projects-sidebar settings-nav">
        <button type="button" className="settings-back">
          <ArrowLeft size={15} />
          <span>Back to app</span>
        </button>
        <h2>Settings</h2>
        <div className="settings-search">
          <Search size={14} />
          <input aria-label="Search settings" placeholder="Search settings" />
        </div>
        <nav aria-label="Settings categories">
          {inert(otherCategories.before)}
          {items(nav.main)}
          {inert(otherCategories.after)}
          {items(nav.late)}
          {inert(otherCategories.last)}
        </nav>
      </aside>
      <main className="settings-pane">
        <header>
          <h3>
            {parent && <span className="aim-crumb">{parent.label} / </span>}
            {current.label}
          </h3>
          <p>{current.description}</p>
        </header>
        <div className="settings-content">{children}</div>
      </main>
    </section>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="settings-group">
      {title && <h5>{title}</h5>}
      {children}
    </div>
  );
}

/* ── A: one page, everything about an agent in its own card ── */

function PerAgentPage({ withHelpers }: { withHelpers: boolean }) {
  const [defaultAgent, setDefaultAgent] = useState<AgentProvider>("claude");
  return (
    <>
      <Group>
        <section className="setting">
          <div className="setting-text">
            <h4>New threads start on</h4>
            <p>Unless the project picked its own agent.</p>
          </div>
          <div className="setting-control">
            <AgentSelect value={defaultAgent} onChange={setDefaultAgent} />
          </div>
        </section>
      </Group>
      <Group title="Your agents">
        <div className="aim-agents">
          {sampleAgents.map((agent) => (
            <AgentCard key={agent.provider} agent={agent} />
          ))}
        </div>
        <p className="aim-footnote">
          Checked for newer versions 14:02 · <button type="button">Check now</button>
        </p>
      </Group>
      {withHelpers && <HelpersPage />}
    </>
  );
}

function AgentCard({ agent }: { agent: SampleAgent }) {
  const behind = agent.latest && agent.version !== agent.latest;
  const [inUse, setInUse] = useState(agent.accounts?.[0]?.id);
  return (
    <SettingsCard className="aim-agent">
      <div className="accounts-provider">
        <ProviderIcon provider={agent.provider} />
        <b>{agentName(agent.provider)}</b>
        <span className="aim-version">
          {agent.version
            ? [agent.version, agent.installer, !behind && "up to date"]
                .filter(Boolean)
                .join(" · ")
            : "Not set up"}
        </span>
        <span className="accounts-provider-tools">
          {behind && (
            <button type="button" className="primary aim-small">
              Update to {agent.latest}
            </button>
          )}
          <button
            type="button"
            className="icon-button accounts-more"
            aria-label={`More for ${agentName(agent.provider)}`}
            title="Change program… · Find automatically · Show output"
          >
            <MoreHorizontal size={15} />
          </button>
        </span>
      </div>
      {agent.accounts?.map((account) => (
        <AccountLine
          key={account.id}
          account={account}
          name={`${agent.provider}-account`}
          several={agent.accounts!.length > 1}
          inUse={inUse === account.id}
          onPick={() => setInUse(account.id)}
        />
      ))}
      {agent.accounts && (
        <div className="aim-add">
          <button type="button" className="accounts-add">
            <Plus size={13} /> Add account
          </button>
        </div>
      )}
      {agent.signIn && (
        <div className="aim-line">
          <span>{agent.note}</span>
          <button type="button" className="primary aim-small">
            Set up…
          </button>
        </div>
      )}
      {!agent.accounts && !agent.signIn && agent.note && (
        <div className="aim-line">
          <span>{agent.note}</span>
        </div>
      )}
    </SettingsCard>
  );
}

/** An account line: no reorder arrows, since nothing moves down the list any more. */
function AccountLine({
  account,
  name,
  several,
  inUse,
  onPick,
}: {
  account: SampleAccount;
  name: string;
  several: boolean;
  inUse: boolean;
  onPick: () => void;
}) {
  return (
    <div
      className="accounts-row aim-account"
      data-in-use={(several && inUse) || undefined}
    >
      <label className="accounts-pick" data-several={several || undefined}>
        {several && (
          <input type="radio" name={name} checked={inUse} onChange={onPick} />
        )}
        <span className="accounts-text">
          <span className="accounts-title">
            <b>{account.label}</b>
            {several && inUse && (
              <span className="accounts-in-use">New threads</span>
            )}
          </span>
          <span className="accounts-who">{account.who}</span>
        </span>
        <AccountBars usage={account.usage} />
      </label>
      <button
        type="button"
        className="icon-button accounts-more"
        aria-label={`More for ${account.label}`}
        title="Rename · Sign in again · Sign out and remove"
      >
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
}

/* ── B: Agents (what's installed, who's signed in) and Models (what does what) ── */

function AgentsPage() {
  const [defaultAgent, setDefaultAgent] = useState<AgentProvider>("claude");
  return (
    <>
      <Group>
        <section className="setting">
          <div className="setting-text">
            <h4>New threads start on</h4>
            <p>Unless the project picked its own agent.</p>
          </div>
          <div className="setting-control">
            <AgentSelect value={defaultAgent} onChange={setDefaultAgent} />
          </div>
        </section>
      </Group>
      <Group title="Installed">
        <SettingsCard>
          {sampleAgents.map((agent) => {
            const behind = agent.latest && agent.version !== agent.latest;
            return (
              <SettingsRow
                key={agent.provider}
                label={
                  <span className="aim-row-name">
                    <ProviderIcon provider={agent.provider} />
                    {agentInfo(agent.provider).cli}
                  </span>
                }
                hint={
                  agent.version
                    ? [agent.version, agent.installer, !behind && "up to date"]
                        .filter(Boolean)
                        .join(" · ")
                    : agent.note
                }
              >
                {behind && (
                  <button type="button" className="primary">
                    Update to {agent.latest}
                  </button>
                )}
                {agent.signIn && (
                  <button type="button" className="primary">
                    Set up…
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button accounts-more"
                  aria-label={`More for ${agentName(agent.provider)}`}
                >
                  <MoreHorizontal size={15} />
                </button>
              </SettingsRow>
            );
          })}
        </SettingsCard>
      </Group>
      <Group title="Accounts">
        <div className="accounts-settings">
          {sampleAgents
            .filter((a) => a.accounts)
            .map((agent) => (
              <AccountsCard key={agent.provider} agent={agent} />
            ))}
        </div>
      </Group>
    </>
  );
}

function AccountsCard({ agent }: { agent: SampleAgent }) {
  const [inUse, setInUse] = useState(agent.accounts?.[0]?.id);
  return (
    <SettingsCard className="accounts-card">
      <div className="accounts-provider">
        <ProviderIcon provider={agent.provider} />
        <b>{agentName(agent.provider)}</b>
        <span className="accounts-provider-tools">
          <button type="button" className="accounts-add">
            <Plus size={13} /> Add account
          </button>
        </span>
      </div>
      {agent.accounts!.map((account) => (
        <AccountLine
          key={account.id}
          account={account}
          name={`b-${agent.provider}-account`}
          several={agent.accounts!.length > 1}
          inUse={inUse === account.id}
          onPick={() => setInUse(account.id)}
        />
      ))}
    </SettingsCard>
  );
}

function ModelsPage() {
  return (
    <>
      <Group title="Relay's helpers">
        <HelperTasks />
      </Group>
      <Group title="Flag what I'd miss">
        <WatchCard />
      </Group>
      <Group title="Quick switch">
        <QuickSwitchSettings />
      </Group>
    </>
  );
}

function HelpersPage() {
  return (
    <>
      <Group title="Review and commits">
        <HelperTasks />
      </Group>
      <Group title="While agents work">
        <WatchCard />
      </Group>
    </>
  );
}

function QuickSwitchPage() {
  return <QuickSwitchSettings />;
}

/* ── Shared by both ── */

const helperRows: {
  key: "grouping" | "questions" | "split" | "commitMessage";
  label: string;
  hint: string;
  allowDefault?: boolean;
  anyAgent?: boolean;
}[] = [
  { key: "grouping", label: "Pull request steps", hint: "Groups a PR into reviewable steps" },
  { key: "questions", label: "Line questions", hint: "Answers what you ask about a line", allowDefault: true },
  { key: "split", label: "Commit splits", hint: "Splits changes into commits", allowDefault: true, anyAgent: true },
  { key: "commitMessage", label: "Commit messages", hint: "Drafts the commit message", allowDefault: true, anyAgent: true },
];

/** Saves on every change, like the rest of Settings; no Save button. */
function HelperTasks() {
  const [values, setValues] = useState<AISettings>(defaultAISettings);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(t);
  }, [saved]);
  return (
    <SettingsCard className="aim-helpers">
      {helperRows.map((row) => (
        <div key={row.key} className="aim-helper">
          <div className="settings-row-text">
            <span>{row.label}</span>
            <small>{row.hint}</small>
          </div>
          <ModelField
            label={row.label}
            value={values[row.key]}
            provider={values[`${row.key}Provider`]}
            providers={row.anyAgent ? agentProviders : undefined}
            allowDefault={row.allowDefault}
            onChange={(value, provider) => {
              setValues({
                ...values,
                [row.key]: value,
                [`${row.key}Provider`]: provider,
              });
              setSaved(true);
            }}
          />
        </div>
      ))}
      <p className="aim-saved" role="status">
        {saved ? "Saved" : "Default uses the agent's own model and effort."}
      </p>
    </SettingsCard>
  );
}

function WatchCard() {
  const [scope, setScope] = useState<WatchScope>("off");
  return (
    <SettingsCard>
      <SettingsRow
        label="Flag what I'd miss"
        hint="After a turn that did real work, Relay asks the same session one side question: is there anything here you'd likely miss? Usually the answer is no and nothing shows."
        below={
          <details className="aim-how">
            <summary>How it works</summary>
            <ul>
              <li>
                One check per turn, after the answer lands, and only when the
                agent made 3 or more tool calls or a subagent changed files.
              </li>
              <li>
                Claude runs it as Claude Code's <code>/btw</code> on the live
                session; Codex as a throwaway fork of the thread, like{" "}
                <code>/side</code>. Same model, same context, no tools, and
                nothing is written to the thread's transcript.
              </li>
              <li>
                It reuses the thread's prompt cache, so a check is mostly cache
                reads: about 7¢ on a long Opus 5.5 thread, billed to the
                thread's account.
              </li>
              <li>
                The bar is high: tests weakened to pass, errors swallowed,
                requirements quietly dropped, tradeoffs made in passing. It
                skips what the answer already says, anything shown before, and
                topics you closed with <i>I know this</i>.
              </li>
              <li>
                <b>+ Subagents</b> (Claude only): their transcripts aren't in
                the main context, so the check gets a digest of what each one
                changed and compares it with what you asked for.
              </li>
            </ul>
            <p>Last 7 days: 34 checks, 97¢ at API prices.</p>
          </details>
        }
      >
        <Segmented<WatchScope>
          label="Flag what I'd miss"
          value={scope}
          options={[
            ["off", "Off"],
            ["main", "Thread"],
            ["subagents", "+ Subagents"],
          ]}
          onChange={setScope}
        />
      </SettingsRow>
    </SettingsCard>
  );
}

function AgentSelect({
  value,
  onChange,
}: {
  value: AgentProvider;
  onChange: (provider: AgentProvider) => void;
}) {
  return (
    <SettingsSelect<AgentProvider>
      label="New threads start on"
      value={value}
      icon={<ProviderIcon provider={value} />}
      options={agentProviders.map((provider) => ({
        value: provider,
        label: agentName(provider),
        icon: <ProviderIcon provider={provider} />,
      }))}
      onChange={onChange}
    />
  );
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
