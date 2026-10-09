import {
  Bot,
  FolderGit2,
  Info,
  Keyboard,
  ListTodo,
  Mic,
  MonitorUp,
  Palette,
  Puzzle,
  Smartphone,
  Sparkles,
  Volume2,
  Zap,
} from "lucide-react";
import type { SettingsCategory } from "../../../lib/settings-page";

/** A heading in the nav over the categories that share it. */
export type CategoryGroup = { label: string; icon: typeof Palette };

const aiModels: CategoryGroup = { label: "AI models", icon: Sparkles };

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
    description: "Theme, typography, colour mode, accent and app icon.",
    icon: Palette,
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
    group: aiModels,
  },
  {
    id: "relay-models",
    label: "Used by Relay",
    description:
      "Models Relay calls itself, outside your threads: review, commits, and the side check that reads along.",
    icon: Sparkles,
    group: aiModels,
  },
  {
    id: "quick-switch",
    label: "Quick switch",
    description:
      "Presets of agent, model and effort you step through in the composer.",
    icon: Zap,
    group: aiModels,
  },
  {
    id: "integrations",
    label: "Integrations",
    description:
      "Git, and the hosts your pull requests, CI and work items come from.",
    icon: ListTodo,
  },
  {
    id: "plugins",
    label: "Plugins",
    description:
      "Extras that ship with Relay and stay out of sight until you turn them on.",
    icon: Puzzle,
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
      "Hand a thread to another computer running Relay, like a Mac mini at home, and bring it back later.",
    icon: MonitorUp,
  },
  {
    id: "dictation",
    label: "Dictation",
    description: "Speak your messages; words appear as you talk.",
    icon: Mic,
  },
  {
    id: "read-aloud",
    label: "Read aloud",
    description:
      "Have answers read to you by a voice that runs on this computer.",
    icon: Volume2,
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    description: "Everything you can do from the keyboard.",
    icon: Keyboard,
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
