// The thread and message menus' smaller actions: copying, marking, sharing out.
import type { RefObject } from "react";
import { Alert, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { quoteExcerpt, quoteMarkdown } from "../../../shared/composer-quotes";
import type { ChatMessage } from "../../../shared/projects";
import { withoutMention } from "../../../shared/remote-compose";
import type { ComposerHandle } from "./Composer";
import type { MenuItem } from "./Sheet";

/** What the thread menu offers beside triage: unread, its name, its branch and worktree. */
export function threadExtras({
  branch,
  worktree,
  onUnread,
  onRegenerate,
}: {
  branch?: string;
  /** Its own worktree's folder, while it has one. */
  worktree?: string;
  onUnread: () => void;
  /** Left out where the desktop can't take it from a phone. */
  onRegenerate?: () => void;
}): MenuItem[] {
  return [
    {
      label: "Mark as unread",
      hint: "Back to the list, marked for later",
      onPress: onUnread,
    },
    ...(onRegenerate
      ? [
          {
            label: "Regenerate title",
            hint: "A fresh name from the conversation so far",
            onPress: onRegenerate,
          },
        ]
      : []),
    ...(branch
      ? [
          {
            label: "Copy branch name",
            hint: branch,
            onPress: () => void Clipboard.setStringAsync(branch),
          },
        ]
      : []),
    ...(worktree
      ? [
          {
            label: "Copy worktree path",
            hint: worktree,
            onPress: () => void Clipboard.setStringAsync(worktree),
          },
        ]
      : []),
  ];
}

/** A message's text as it reads, without the `@agent` a send leads with. */
const text = (m: ChatMessage) =>
  m.role === "user" ? withoutMention(m.body) : m.body;

/** Quote into the composer and share out, for a message's hold menu. */
export function messageExtras(
  m: ChatMessage,
  composer: RefObject<Pick<ComposerHandle, "quote"> | null> | undefined,
): MenuItem[] {
  if (!text(m).trim()) return [];
  return [
    ...(composer
      ? [
          {
            label: "Quote",
            hint: "Into your reply, as a quote",
            onPress: () =>
              composer.current?.quote(quoteMarkdown(quoteExcerpt(text(m)))),
          },
        ]
      : []),
    {
      label: "Share…",
      onPress: () =>
        void Share.share({ message: text(m) }).catch((e) =>
          Alert.alert("Couldn't share it", e instanceof Error ? e.message : String(e)),
        ),
    },
  ];
}
