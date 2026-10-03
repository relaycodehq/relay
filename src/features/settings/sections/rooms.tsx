import type { SettingEntry } from "../settings-search";
import { RoomHostingSettings } from "../RoomHostingSettings";

export function roomEntries(): SettingEntry[] {
  return [
    {
      id: "room-hosting",
      category: "rooms",
      title: "Room hosting",
      keywords: "server share invitation setup key host",
      block: true,
      render: () => <RoomHostingSettings />,
    },
  ];
}
