import { PreviewCard } from "@base-ui/react/preview-card";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PullRef } from "../../../shared/types";
import {
  headlineStat,
  statsByKind,
  type DiffKind,
} from "../../../shared/diff-kinds";
import { api } from "../../lib/api";
import { DiffStatLabel } from "./DiffStatLabel";
import type { DiffStat } from "./turn-diff-tree";
import "../agents/composer-model-picker.css";

type FileStat = DiffStat & { path: string };
type ByKind = ReturnType<typeof statsByKind>;

const WRITTEN: [DiffKind, string][] = [
  ["code", "Code"],
  ["tests", "Tests"],
  ["fixtures", "Fixtures"],
  ["docs", "Docs"],
];
const changed = (s: DiffStat) => s.additions > 0 || s.deletions > 0;
const count = (n: number) => n.toLocaleString();
// 50 files a page on GitHub: past this the hover would take too long to be worth it.
const MAX_PAGES = 20;

/**
 * A change's lines without its generated files, which a hover splits into
 * code, tests, fixtures and docs. Only a change with more than one kind gets
 * the hover.
 */
export function DiffStatBreakdown({ files }: { files: readonly FileStat[] }) {
  const by = useMemo(() => statsByKind(files), [files]);
  const total = headlineStat(by);
  if (!changed(total)) return null;
  const kinds = Object.values(by).filter(changed).length;
  if (kinds < 2) return <DiffStatLabel stat={total} />;
  return (
    <BreakdownCard label={<DiffStatLabel stat={total} />}>
      <BreakdownTable by={by} />
    </BreakdownCard>
  );
}

/**
 * A PR's lines as its host counts them; its files load on the first hover,
 * every page of them, to split the lines by kind.
 */
export function PullStatBreakdown({
  pull,
  stat,
  align = "start",
}: {
  pull: PullRef;
  stat: DiffStat;
  align?: "start" | "end";
}) {
  const [asked, setAsked] = useState(false);
  const files = useQuery({
    queryKey: [
      "pullFileKinds",
      pull.server,
      pull.owner,
      pull.name,
      pull.number,
    ],
    queryFn: () => allFiles(pull),
    enabled: asked,
    staleTime: 60_000,
  });
  const by = useMemo(() => files.data && statsByKind(files.data), [files.data]);
  if (!changed(stat)) return null;
  return (
    <BreakdownCard
      label={<DiffStatLabel stat={stat} />}
      align={align}
      onOpen={() => setAsked(true)}
    >
      {by ? (
        <BreakdownTable by={by} />
      ) : (
        <p className="diff-breakdown-note">
          {files.isError
            ? "Couldn't load the files"
            : files.data === null
              ? "Too many files to split"
              : "Loading files…"}
        </p>
      )}
    </BreakdownCard>
  );
}

async function allFiles(pull: PullRef): Promise<FileStat[] | null> {
  const out: FileStat[] = [];
  for (let page: number | null = 1; page;) {
    if (page > MAX_PAGES) return null;
    const found = await api.files(pull, page);
    for (const f of found.items)
      out.push({
        path: f.filename,
        additions: f.additions,
        deletions: f.deletions,
      });
    page = found.nextPage;
  }
  return out;
}

function BreakdownCard({
  label,
  align = "start",
  onOpen,
  children,
}: {
  label: ReactNode;
  align?: "start" | "end";
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <PreviewCard.Root onOpenChange={(open) => open && onOpen?.()}>
      <PreviewCard.Trigger
        delay={150}
        closeDelay={100}
        render={<span className="diff-breakdown-trigger" />}
      >
        {label}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          className="composer-popup-positioner"
          side="bottom"
          align={align}
          sideOffset={6}
          collisionPadding={8}
        >
          <PreviewCard.Popup className="diff-breakdown">
            {children}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

function BreakdownTable({ by }: { by: ByKind }) {
  const total = headlineStat(by);
  // Only generated files changed, so they are the total, not an aside.
  const aside = changed(by.generated) && total !== by.generated;
  return (
    <table>
      <tbody>
        {WRITTEN.filter(([k]) => changed(by[k])).map(([k, label]) => (
          <tr key={k}>
            <th scope="row">{label}</th>
            <td className="diff-stat-add">+{count(by[k].additions)}</td>
            <td className="diff-stat-del">−{count(by[k].deletions)}</td>
          </tr>
        ))}
        <tr className="diff-breakdown-total">
          <th scope="row">Total</th>
          <td className="diff-stat-add">+{count(total.additions)}</td>
          <td className="diff-stat-del">−{count(total.deletions)}</td>
        </tr>
        {aside && (
          <tr
            className="diff-breakdown-aside"
            title="Lockfiles and generated files"
          >
            <th scope="row">Not counted</th>
            <td>+{count(by.generated.additions)}</td>
            <td>−{count(by.generated.deletions)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
