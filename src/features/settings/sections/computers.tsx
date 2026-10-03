import type { SettingEntry } from "../settings-search";
import { ComputersMap } from "../../handoff/ComputersSettings";
import { TakeThreadsOver } from "../../handoff/TakeThreadsOver";

export function computerEntries({
  onOpenChat,
  onClose,
}: {
  /** Opens a thread listed on a computer; Settings closes first. */
  onOpenChat?: (projectId: string, chatId: string) => void;
  onClose: () => void;
}): SettingEntry[] {
  return [
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
  ];
}
