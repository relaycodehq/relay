import { shortAge } from "../../../shared/chat-activity";
import {
  localTwin,
  type BranchCounts,
  type BranchList,
} from "../../../shared/branches";
import type { SearchOption } from "../../ui/SearchSelect";

const age = (date: number, now: number) => {
  const a = shortAge(date, now);
  return a === "now" ? "just now" : `${a.replace(/m$/, "min")} ago`;
};

/** How a SearchSelect of branches lays out: room for long names, the check up front. */
export const branchSelect = {
  className: "search-select-wide",
  checkStart: true,
  foldNoun: "merged branches",
} as const;

/**
 * A SearchSelect's options for `names`, read out of `list` and `counts`: the bases first,
 * then what's checked out in a worktree, then the rest, newest first, each with
 * its age and what it has over the base. What the base already has folds
 * away, worktrees too, and a remote branch at the same commit as its local one is left out.
 * Until both have loaded they're plain names.
 */
export function branchOptions(
  names: string[],
  list: BranchList | undefined,
  counts: BranchCounts | undefined,
  now = Date.now(),
  // Where the remote one does something the local doesn't, like being fetched first.
  { keepRemotes = false }: { keepRemotes?: boolean } = {},
): SearchOption[] {
  const byName = new Map(
    list?.branches.flatMap((b) => {
      const count = counts?.branches[b.name];
      return count ? [[b.name, { ...b, ...count }] as const] : [];
    }),
  );
  const isBase = (name: string) =>
    !!list?.bases.some((b) => name === b || name === `origin/${b}`);
  const twinOf = (name: string) => {
    if (keepRemotes) return undefined;
    const b = byName.get(name);
    const twin =
      b && list && byName.get(localTwin(list.branches, b)?.name ?? "");
    return twin && twin.sha === b.sha && names.includes(twin.name)
      ? twin
      : undefined;
  };
  const sameRemote = new Map(
    names.flatMap((n) => {
      const twin = twinOf(n);
      return twin ? [[twin.name, n] as const] : [];
    }),
  );
  const options = names
    .filter((n) => !twinOf(n))
    .map((name) => {
      const slash = name.lastIndexOf("/");
      const option: SearchOption = {
        value: name,
        prefix: slash > 0 ? name.slice(0, slash + 1) : undefined,
        label: name.slice(slash + 1),
      };
      const b = byName.get(name);
      if (!b) return { option, date: 0 };
      const remoteTwin = sameRemote.get(name);
      if (isBase(name))
        return {
          option: {
            ...option,
            group: "Base",
            note: remoteTwin ? `same as ${remoteTwin}` : age(b.date, now),
          },
          date: b.date,
        };
      if (b.noCommits)
        return {
          option: { ...option, group: "Worktrees", note: "no commits yet" },
          date: b.date,
        };
      const note = age(b.date, now) + (b.ahead ? ` · ${b.ahead} ahead` : "");
      // A worktree whose work landed is as done as a plain branch; the
      // checkout's own branch stays in sight.
      if (b.ahead === 0 && counts?.compared.length && !b.current)
        return {
          option: {
            ...option,
            group: `Merged into ${counts.compared.join(" or ")}`,
            note,
            folded: true,
          },
          date: b.date,
        };
      if (b.worktree)
        return {
          option: { ...option, group: "Worktrees", note },
          date: b.date,
        };
      return {
        option: { ...option, group: "Other branches", note },
        date: b.date,
      };
    });
  const baseRank = (name: string) =>
    (list?.bases.indexOf(name.replace(/^origin\//, "")) ?? 0) * 2 +
    Number(name.startsWith("origin/"));
  const order = ["Base", "Worktrees", "Other branches"];
  const rank = (o: SearchOption) =>
    o.group === undefined
      ? -1
      : o.folded
        ? order.length
        : order.indexOf(o.group);
  return options
    .sort(
      (a, b) =>
        rank(a.option) - rank(b.option) ||
        // The bases go most likely first, local before origin; the rest newest first.
        (a.option.group === "Base"
          ? baseRank(a.option.value) - baseRank(b.option.value)
          : b.date - a.date),
    )
    .map((o) => o.option);
}
