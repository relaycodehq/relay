import { useEffect, useId, useRef, useState } from "react";
import { LogIn, LogOut, Search } from "lucide-react";
import type { SettingsCategory } from "../lib/settings-page";
import {
  matches,
  searchWords,
  sections,
  type SettingEntry,
} from "../lib/settings-search";
import type { Account } from "../../shared/types";
import { api } from "../lib/api";
import { keys } from "../lib/mod-key";
import {
  bindings,
  comboLabel,
  comboWords,
  useShortcutOverrides,
} from "../lib/shortcuts";
import { command, shortcutGroups, shortcutIds } from "../../shared/shortcuts";
import { ShortcutKeys, ShortcutsResetAll } from "./ShortcutSettings";
import { useLeaveOnEscape } from "../lib/useLeaveOnEscape";
import { useUpdates } from "../lib/updates";
import {
  setSendKey,
  steerKeyLabel,
  useSendKey,
  type SendKey,
} from "../lib/send-key";
import { Avatar, ErrorBox } from "./ui";
import { UpdateCheck, updateLine } from "./UpdateCheck";
import { Changelog } from "./Changelog";
import { RoomHostingSettings } from "./RoomHostingSettings";
import { GitSettings } from "./GitSettings";
import {
  SourceControlRescan,
  SourceControlSettings,
} from "./SourceControlSettings";
import { PhoneRemoteSettings } from "./PhoneRemoteSettings";
import { ComputersMap, TakeThreadsOver } from "./ComputersSettings";
import {
  DictationMicrophoneSetting,
  DictationModelSetting,
  dictationModelLine,
} from "./DictationSettings";
import { useDictationModel } from "../lib/dictation/session";
import { PluginCard } from "./plugins/PluginSettings";
import { pluginIds, plugins } from "../../shared/plugins";
import { categories, categoryOf } from "./settings/categories";
import { Setting } from "./settings/Setting";
import { SettingsNav } from "./settings/SettingsNav";
import { useAppearanceEntries } from "./settings/appearance";
import { useModelEntries } from "./settings/models";
import "./settings.css";

export type { SettingsCategory };

export function Settings({
  account,
  onClose,
  onDisconnect,
  onConnect,
  onOpenChat,
  initialCategory = "appearance",
  onWhere,
}: {
  initialCategory?: SettingsCategory;
  /** Where Settings is, for the window title: a category or the search. */
  onWhere?: (label: string) => void;
  account: Account | null;
  onClose: () => void;
  onDisconnect: () => Promise<void>;
  onConnect?: () => void;
  /** Opens a thread, e.g. one listed under Computers. */
  onOpenChat?: (projectId: string, chatId: string) => void;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const headingId = useId();
  useEffect(() => searchInput.current?.focus(), []);
  const [category, setCategory] = useState<SettingsCategory>(initialCategory);
  const [query, setQuery] = useState("");
  // Escape clears the search, then leaves.
  useLeaveOnEscape(() => (query ? setQuery("") : onClose()));
  const [error, setError] = useState<unknown>();
  const appearanceEntries = useAppearanceEntries();

  const modelEntries = useModelEntries(setError);

  // Releases stamp their own version at build time; the updater knows it.
  const updates = useUpdates();
  const dictationModel = useDictationModel();
  const sendKey = useSendKey();
  // Search finds shortcuts by their current keys.
  useShortcutOverrides();

  const sendKeyEntry: SettingEntry = {
    id: "send-key",
    category: "shortcuts",
    section: "Composer",
    title: "Send messages with",
    description:
      {
        enter: "Enter sends the message. Shift+Enter adds a new line.",
        "shift-enter": "Shift+Enter sends the message. Enter adds a new line.",
        "mod-enter": `${keys("⌘", "Ctrl+")}Enter sends the message. Enter adds a new line.`,
      }[sendKey] +
      ` While an agent is working, this queues the message and ${steerKeyLabel(sendKey)} steers the current answer instead.`,
    keywords:
      "enter return send submit message newline composer chat queue steer",
    render: () => (
      <div className="segmented settings-segmented">
        {(
          [
            ["enter", "Enter"],
            ["shift-enter", "Shift Enter"],
            ["mod-enter", `${keys("⌘", "Ctrl ")}Enter`],
          ] as [SendKey, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            className={sendKey === value ? "active" : ""}
            aria-pressed={sendKey === value}
            onClick={() => setSendKey(value)}
          >
            {label}
          </button>
        ))}
      </div>
    ),
  };
  const entries: SettingEntry[] = [
    ...appearanceEntries,
    {
      id: "gitea",
      category: "account",
      title: "Gitea account",
      description: account
        ? account.server
        : "Connect to review pull requests and link projects to their remote.",
      keywords: "sign in login token server connect",
      render: () =>
        account ? (
          <div className="settings-account">
            <Avatar name={account.user.login} />
            <strong>{account.user.login}</strong>
          </div>
        ) : onConnect ? (
          <button className="primary" onClick={onConnect}>
            <LogIn size={14} />
            Connect Gitea
          </button>
        ) : (
          <span className="setting-muted">Not connected</span>
        ),
    },
    ...(account
      ? [
          {
            id: "credentials",
            category: "account" as const,
            title: "Credential storage",
            description: account.persistent
              ? "Your token is encrypted using the operating system’s credential protection."
              : "Your token is kept for this session only because secure credential storage is unavailable.",
            keywords: "keychain token secure encryption",
            render: () => (
              <span className="setting-pill">
                {account.persistent ? "Encrypted" : "Session only"}
              </span>
            ),
          },
          {
            id: "disconnect",
            category: "account" as const,
            title: "Disconnect account",
            description:
              "Local drafts, read marks, and folder links are preserved for this account.",
            keywords: "sign out logout remove",
            render: () => (
              <button
                className="danger subtle"
                onClick={() => void onDisconnect().catch(setError)}
              >
                <LogOut size={14} />
                Disconnect account
              </button>
            ),
          },
        ]
      : []),
    ...modelEntries,
    {
      id: "git",
      category: "integrations",
      title: "Git",
      description:
        "Relay finds it by itself, the one your terminal runs first. Link another here.",
      keywords: "git executable path program install branch folder exe",
      block: true,
      render: () => <GitSettings />,
    },
    {
      id: "source-control",
      category: "integrations",
      title: "Source control",
      description:
        "CI and pull requests from GitHub and Gitea. Relay uses the CLIs and accounts on this computer.",
      keywords:
        "github gitea forgejo gh tea cli ci actions pull request host sign in login link path token",
      block: true,
      accessory: () => <SourceControlRescan />,
      render: () => <SourceControlSettings onConnect={onConnect} />,
    },
    ...pluginIds.map((id): SettingEntry => ({
      id: `plugin-${id}`,
      category: "plugins",
      title: plugins[id].title,
      description: plugins[id].description,
      keywords: `plugin extension ${plugins[id].keywords}`,
      card: (title) => <PluginCard id={id} title={title} />,
    })),
    {
      id: "room-hosting",
      category: "rooms",
      title: "Room hosting",
      keywords: "server share invitation setup key host",
      block: true,
      render: () => <RoomHostingSettings />,
    },
    {
      id: "phone-remote",
      category: "phone",
      title: "Phone access",
      description:
        "Pair a phone to see what your agents are doing, answer their questions and send messages while you're away from the desk.",
      keywords: "phone mobile android remote qr pair tailscale",
      block: true,
      render: () => <PhoneRemoteSettings />,
    },
    {
      id: "computers-map",
      category: "computers",
      title: "Your computers",
      description:
        "Pick one to see the threads on it. Hand a thread over from its header; its agent writes a note, the worktree is committed and it carries on there.",
      keywords:
        "computer handoff hand off mac mini server vps remote pair tailscale continue away bring back",
      block: true,
      render: () => (
        <ComputersMap
          onOpenChat={
            onOpenChat &&
            ((projectId, chatId) => {
              onClose();
              onOpenChat(projectId, chatId);
            })
          }
        />
      ),
    },
    {
      id: "computers-accept",
      category: "computers",
      section: "Take threads over",
      title: "On the computer that stays on",
      description:
        "Turn this on on the Mac mini or server, then pair the other computer with the link it shows.",
      keywords:
        "computer handoff accept receive mac mini server pairing link tailscale",
      block: true,
      render: () => <TakeThreadsOver />,
    },
    {
      id: "dictation-model",
      category: "dictation",
      title: "Speech model",
      description: dictationModelLine(dictationModel),
      keywords:
        "dictation voice speech microphone parakeet download model transcribe",
      render: () => <DictationModelSetting />,
    },
    {
      id: "dictation-shortcut",
      category: "dictation",
      title: "Shortcut",
      description: command("dictate").description,
      keywords: "dictation voice speech keyboard shortcut hotkey push to talk",
      render: () => <ShortcutKeys id="dictate" />,
    },
    {
      id: "dictation-microphone",
      category: "dictation",
      title: "Microphone",
      keywords: "dictation voice input device audio mic",
      render: () => <DictationMicrophoneSetting />,
    },
    {
      id: "shortcuts-intro",
      category: "shortcuts",
      title: "Change a shortcut",
      description:
        "Click one and press the keys you want; Esc cancels and ⌫ removes it. They're kept on this computer.",
      keywords: "keyboard shortcut hotkey keybinding rebind customize reset",
      render: () => <ShortcutsResetAll />,
    },
    ...shortcutGroups.flatMap((group): SettingEntry[] => [
      ...(group === "Composer" ? [sendKeyEntry] : []),
      ...shortcutIds
        .filter((id) => command(id).group === group)
        .map((id) => ({
          id: "shortcut:" + id,
          category: "shortcuts" as const,
          section: group,
          title: command(id).title,
          description: command(id).description,
          keywords: [
            "keyboard shortcut hotkey keybinding",
            command(id).keywords,
            ...bindings(id).map(
              (c) => comboLabel(c, command(id).digits) + " " + comboWords(c),
            ),
          ].join(" "),
          render: () => <ShortcutKeys id={id} />,
        })),
    ]),
    {
      id: "version",
      category: "about",
      title: "Relay",
      description: updateLine(updates),
      keywords: "version about check for updates upgrade",
      render: () => <UpdateCheck />,
    },
    {
      id: "changelog",
      category: "about",
      title: "Changelog",
      description: "What changed in each version.",
      keywords: "changelog release notes what's new version history",
      block: true,
      render: () => <Changelog />,
    },
    {
      id: "credits",
      category: "about",
      title: "Credits",
      description: "Built with code from T3 Code.",
      keywords: "license open source t3 code",
      render: () => (
        <a
          href="https://github.com/pingdotgg/t3code"
          onClick={(e) => {
            e.preventDefault();
            void api.openExternal(e.currentTarget.href);
          }}
        >
          T3 Code on GitHub
        </a>
      ),
    },
  ];

  const words = searchWords(query);
  const results = words.length
    ? entries.filter((e) => matches(e, words, categoryOf(e.category).label))
    : [];
  const current = categoryOf(category);
  const where = words.length ? "Search results" : current.label;
  useEffect(() => onWhere?.(where), [where]);

  return (
    <section className="settings-screen" aria-labelledby={headingId}>
      <SettingsNav
        headingId={headingId}
        inputRef={searchInput}
        query={query}
        setQuery={setQuery}
        category={category}
        results={words.length ? results : null}
        onPick={(id) => {
          setQuery("");
          setCategory(id);
        }}
        onClose={onClose}
      />
      <main className="settings-pane">
        <header>
          <h3>{where}</h3>
          <p>
            {words.length
              ? `${results.length} ${results.length === 1 ? "setting" : "settings"} matching “${query.trim()}”`
              : current.description}
          </p>
        </header>
        <div className="settings-content">
          {words.length ? (
            results.length ? (
              categories
                .filter((c) => results.some((e) => e.category === c.id))
                .map((c) => (
                  <div key={c.id} className="settings-group">
                    <h5>{c.label}</h5>
                    {results
                      .filter((e) => e.category === c.id)
                      .map((e) => (
                        <Setting key={e.id} entry={e} query={query} />
                      ))}
                  </div>
                ))
            ) : (
              <div className="settings-empty">
                <Search size={20} />
                <p>No settings match “{query.trim()}”.</p>
              </div>
            )
          ) : (
            sections(entries.filter((e) => e.category === category)).map(
              ({ section, list }, i) => (
                <div key={section ?? i} className="settings-group">
                  {section && <h5>{section}</h5>}
                  {list.map((e) => (
                    <Setting key={e.id} entry={e} query={query} />
                  ))}
                </div>
              ),
            )
          )}
          {!!error && <ErrorBox error={error} />}
        </div>
      </main>
    </section>
  );
}
