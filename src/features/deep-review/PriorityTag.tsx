import { priorityMeaning, type Finding } from "../../../shared/deep-review";

export const findingRowId = (chatId: string, id: string) =>
  `finding-${chatId}-${id}`;
const findingRow = (chatId: string, id: string) =>
  document.getElementById(findingRowId(chatId, id));

/** A finding's priority; in the lead's summary it points at the finding's row. */
export function PriorityTag({
  finding,
  chatId,
  linked,
}: {
  finding: Finding;
  chatId: string;
  linked?: boolean;
}) {
  if (!linked)
    return (
      <span
        className="deep-review-priority"
        data-priority={finding.priority}
        title={priorityMeaning[finding.priority]}
      >
        {finding.priority}
      </span>
    );
  return (
    <button
      type="button"
      className="deep-review-priority"
      data-priority={finding.priority}
      title={`${finding.title} · ${priorityMeaning[finding.priority]}`}
      onMouseEnter={() =>
        findingRow(chatId, finding.id)?.setAttribute("data-hover", "")
      }
      onMouseLeave={() =>
        findingRow(chatId, finding.id)?.removeAttribute("data-hover")
      }
      onClick={() =>
        findingRow(chatId, finding.id)?.scrollIntoView({
          block: "nearest",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        })
      }
    >
      {finding.priority}
    </button>
  );
}

/** Shows `F1` in the lead's summary as that finding's priority. */
export function findingCode(chatId: string, findings: Finding[]) {
  return (value: string) => {
    const finding = findings.find((f) => f.id === value);
    return finding ? (
      <PriorityTag finding={finding} chatId={chatId} linked />
    ) : undefined;
  };
}
