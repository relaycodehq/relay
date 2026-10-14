// Each tile's loop and drawing, joined to its words in words.ts, which also
// sets the order. The drawings are in agents.tsx, threads.tsx, code.tsx,
// code-more.tsx and phone-tiles.tsx.
import type { ReactNode } from "react";
import type { Category, Loop } from "./kit";
import * as agents from "./agents";
import * as threads from "./threads";
import * as code from "./code";
import * as more from "./code-more";
import * as phone from "./phone-tiles";
import { words } from "./words";

type Id = (typeof words)[number]["id"];

export interface TileDef {
  id: Id;
  category: Category;
  title: string;
  text: string;
  loop: Loop;
  Tile: (props: { s: number }) => ReactNode;
}

const demos: Record<Id, Pick<TileDef, "loop" | "Tile">> = {
  handoff: { loop: threads.handoffLoop, Tile: threads.HandoffTile },
  drive: { loop: agents.driveLoop, Tile: agents.DriveTile },
  voice: { loop: agents.voiceLoop, Tile: agents.VoiceTile },
  limit: { loop: agents.limitLoop, Tile: agents.LimitTile },
  switch: { loop: agents.switchLoop, Tile: agents.SwitchTile },
  know: { loop: agents.knowLoop, Tile: agents.KnowTile },
  btw: { loop: agents.btwLoop, Tile: agents.BtwTile },
  snooze: { loop: threads.snoozeLoop, Tile: threads.SnoozeTile },
  later: { loop: threads.laterLoop, Tile: threads.LaterTile },
  notes: { loop: threads.notesLoop, Tile: threads.NotesTile },
  rollback: { loop: code.rollbackLoop, Tile: code.RollbackTile },
  sync: { loop: code.syncLoop, Tile: code.SyncTile },
  worktree: { loop: more.worktreeLoop, Tile: more.WorktreeTile },
  draw: { loop: more.drawLoop, Tile: more.DrawTile },
  table: { loop: more.tableLoop, Tile: more.TableTile },
  banner: { loop: phone.bannerLoop, Tile: phone.BannerTile },
  hold: { loop: phone.holdLoop, Tile: phone.HoldTile },
};

export const tiles: TileDef[] = words.map((w) => ({ ...w, ...demos[w.id] }));
