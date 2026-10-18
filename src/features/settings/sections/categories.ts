import {
  AudioLines,
  Bell,
  Bug,
  Bot,
  FolderGit2,
  Info,
  Keyboard,
  ListTodo,
  MessagesSquare,
  Mic,
  MonitorUp,
  Palette,
  Smartphone,
  Sparkles,
  SquarePen,
  Volume2,
  Zap,
} from "lucide-react";
import type { SettingsCategory } from "../../../lib/settings-page";

/** A heading in the nav over the categories that share it. */
export type CategoryGroup = { label: string; icon: typeof Palette };

const aiAgents: CategoryGroup = { label: "AI & agents", icon: Sparkles };
const voice: CategoryGroup = { label: "Voice", icon: AudioLines };

export const categories: {
  id: SettingsCategory;
  label: string;
  description: string;
  icon: typeof Palette;
  group?: CategoryGroup;
}[] = [
  {
    id: "appearance",
    label: "Appearance",
    description: "Colours, glass, the sidebar and text.",
    icon: Palette,
  },
  {
    id: "composer",
    label: "Composer",
    description: "What the composer shows, and what Send does.",
    icon: SquarePen,
  },
  {
    id: "threads",
    label: "Threads",
    description:
      "What Relay does with a thread while it works, waits and goes quiet. Each project can do its own thing in Project settings.",
    icon: MessagesSquare,
  },
  {
    id: "project",
    label: "Project settings",
    description:
      "What one project does its own way. Anything left alone follows the rest of Settings.",
    icon: FolderGit2,
  },
  {
    id: "agents",
    label: "Agents",
    description:
      "The agents Relay runs, the accounts they sign in with, and where new threads start.",
    icon: Bot,
    group: aiAgents,
  },
  {
    id: "relay-models",
    label: "Used by Relay",
    description:
      "Models Relay calls itself, outside your threads: review, commits, and the side check that reads along.",
    icon: Sparkles,
    group: aiAgents,
  },
  {
    id: "quick-switch",
    label: "Quick switch",
    description:
      "Presets of agent, model and effort you step through in the composer.",
    icon: Zap,
    group: aiAgents,
  },

  {
    id: "integrations",
    label: "Integrations",
    description:
      "Git, the hosts your pull requests and CI come from, and the services Relay can work with.",
    icon: ListTodo,
  },
  {
    id: "phone",
    label: "Phone",
    description: "Follow and answer your threads from the Relay phone app.",
    icon: Smartphone,
  },
  {
    id: "computers",
    label: "Computers",
    description:
      "Hand a thread to another computer running Relay, like an always-on desktop or server at home, and bring it back later.",
    icon: MonitorUp,
  },
  {
    id: "dictation",
    label: "Dictation",
    description: "Speak your messages; words appear as you talk.",
    icon: Mic,
    group: voice,
  },
  {
    id: "read-aloud",
    label: "Read aloud",
    description:
      "Have answers read to you by a voice that runs on this computer.",
    icon: Volume2,
    group: voice,
  },
  {
    id: "sounds",
    label: "Sounds",
    description:
      "A sound when a thread finishes, needs you or fails while you're looking elsewhere. Each project can pick its own.",
    icon: Bell,
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    description: "Everything you can do from the keyboard.",
    icon: Keyboard,
  },
  {
    id: "report",
    label: "Report a problem",
    description:
      "Tell us what went wrong. You see everything that would be sent, and nothing leaves this computer until you send it.",
    icon: Bug,
  },
  {
    id: "about",
    label: "About",
    description: "Version and changelog.",
    icon: Info,
  },
];

export const categoryOf = (id: SettingsCategory) =>
  categories.find((c) => c.id === id)!;

/** A category's name with its group's in front, for search and the window title. */
export const fullLabel = (id: SettingsCategory) => {
  const { label, group } = categoryOf(id);
  return group ? `${group.label} › ${label}` : label;
};
