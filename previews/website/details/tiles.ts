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
  limit: { loop: agents.limitLoop, Tile: agents.LimitTile },
  switch: { loop: agents.switchLoop, Tile: agents.SwitchTile },
  fan: { loop: agents.fanLoop, Tile: agents.FanTile },
  steer: { loop: agents.steerLoop, Tile: agents.SteerTile },
  ask: { loop: agents.askLoop, Tile: agents.AskTile },
  know: { loop: agents.knowLoop, Tile: agents.KnowTile },
  btw: { loop: agents.btwLoop, Tile: agents.BtwTile },
  snooze: { loop: threads.snoozeLoop, Tile: threads.SnoozeTile },
  later: { loop: threads.laterLoop, Tile: threads.LaterTile },
  settle: { loop: threads.settleLoop, Tile: threads.SettleTile },
  notes: { loop: threads.notesLoop, Tile: threads.NotesTile },
  queue: { loop: threads.queueLoop, Tile: threads.QueueTile },
  quote: { loop: threads.quoteLoop, Tile: threads.QuoteTile },
  split: { loop: code.splitLoop, Tile: code.SplitTile },
  message: { loop: code.messageLoop, Tile: code.MessageTile },
  rollback: { loop: code.rollbackLoop, Tile: code.RollbackTile },
  refresh: { loop: code.refreshLoop, Tile: code.RefreshTile },
  image: { loop: code.imageLoop, Tile: code.ImageTile },
  sync: { loop: code.syncLoop, Tile: code.SyncTile },
  grey: { loop: more.greyLoop, Tile: more.GreyTile },
  worktree: { loop: more.worktreeLoop, Tile: more.WorktreeTile },
  draw: { loop: more.drawLoop, Tile: more.DrawTile },
  table: { loop: more.tableLoop, Tile: more.TableTile },
  pop: { loop: more.popLoop, Tile: more.PopTile },
  swipe: { loop: phone.swipeLoop, Tile: phone.SwipeTile },
  banner: { loop: phone.bannerLoop, Tile: phone.BannerTile },
  hold: { loop: phone.holdLoop, Tile: phone.HoldTile },
  clip: { loop: more.clipLoop, Tile: more.ClipTile },
};

export const tiles: TileDef[] = words.map((w) => ({ ...w, ...demos[w.id] }));
