import { PreviewCard } from "@base-ui/react/preview-card";
import { useMemo } from "react";
import type { TurnFileChange } from "../../../shared/projects";
import {
  headlineStat,
  statsByKind,
  type DiffKind,
} from "../../../shared/diff-kinds";
import { DiffStatLabel } from "./DiffStatLabel";
import "../agents/composer-model-picker.css";

const WRITTEN: [DiffKind, string][] = [
  ["code", "Code"],
  ["tests", "Tests"],
  ["docs", "Docs"],
];
const changed = (s: { additions: number; deletions: number }) =>
  s.additions > 0 || s.deletions > 0;
const count = (n: number) => n.toLocaleString();

/**
 * A change's lines without its generated files, which a hover splits into
 * code, tests and docs. Only a change with more than one kind gets the hover.
 */
export function DiffStatBreakdown({
  files,
}: {
  files: readonly TurnFileChange[];
}) {
  const by = useMemo(() => statsByKind(files), [files]);
  const total = headlineStat(by);
  if (!changed(total)) return null;
  const kinds = Object.values(by).filter(changed).length;
  if (kinds < 2) return <DiffStatLabel stat={total} />;
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={150}
        closeDelay={100}
        render={<span className="diff-breakdown-trigger" />}
      >
        <DiffStatLabel stat={total} />
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          className="composer-popup-positioner"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
        >
          <PreviewCard.Popup className="diff-breakdown">
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
                {changed(by.generated) && (
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
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
