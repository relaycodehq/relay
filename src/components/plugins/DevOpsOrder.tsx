import { useState } from "react";
import { X } from "lucide-react";
import {
  currentSprintField,
  type DevOpsSettings,
  type FieldFilter,
  type SortKey,
  type WorkItemField,
} from "../../../shared/devops";
import { SettingsCard, SettingsRow } from "../SettingsCard";
import { IconButton } from "../ui";
import { CommitInput } from "./plugin-ui";

type Save = (patch: Partial<DevOpsSettings>) => Promise<boolean>;

interface Props {
  settings: DevOpsSettings;
  save: Save;
  /** The organization's fields, once they've loaded. */
  fields: WorkItemField[] | undefined;
}

const fieldsList = "devops-fields";
const currentSprint = "Current sprint";
const list = (text: string) => [
  ...new Set(
    text
      .split(/[,;\n]/)
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];

/** The field suggestions every field input here offers. */
export function FieldSuggestions({ fields }: { fields?: WorkItemField[] }) {
  return (
    <datalist id={fieldsList}>
      <option value={currentSprint}>In an iteration running today</option>
      {fields?.map((f) => (
        <option key={f.referenceName} value={f.name}>
          {f.referenceName}
        </option>
      ))}
    </datalist>
  );
}

/**
 * A field name, by display or reference name. One the organization doesn't
 * have says so and isn't saved; before the fields load, anything goes.
 */
function FieldInput({
  label,
  value,
  fields,
  sprint,
  onCommit,
}: {
  label: string;
  value: string;
  fields: WorkItemField[] | undefined;
  /** Whether the current sprint counts, as it does for sorting. */
  sprint?: boolean;
  onCommit: (field: string) => void;
}) {
  const [unknown, setUnknown] = useState<string>();
  const lower = value.toLowerCase();
  // A saved reference name reads as its display name once the fields load.
  const shown =
    value === currentSprintField
      ? currentSprint
      : (fields?.find((f) => f.referenceName.toLowerCase() === lower)?.name ??
        value);
  return (
    <>
      {unknown && (
        <small className="plugin-invalid" role="alert">
          No field “{unknown}”
        </small>
      )}
      <CommitInput
        className="plugin-field"
        aria-label={label}
        aria-invalid={!!unknown || undefined}
        placeholder="Field, e.g. Priority"
        list={fieldsList}
        spellCheck={false}
        value={shown}
        onCommit={(field) => {
          const lower = field.toLowerCase();
          if (
            sprint &&
            (lower === currentSprint.toLowerCase() ||
              lower === currentSprintField.toLowerCase())
          ) {
            setUnknown(undefined);
            return onCommit(currentSprintField);
          }
          const known =
            !field ||
            !fields ||
            fields.some(
              (f) =>
                f.name.toLowerCase() === lower ||
                f.referenceName.toLowerCase() === lower,
            );
          setUnknown(known ? undefined : field);
          if (known) onCommit(field);
        }}
      />
    </>
  );
}

/**
 * The order your items and the team's come in: up to three fields, the
 * current sprint among them if the team works in sprints.
 */
export function SortSection({ settings, save, fields }: Props) {
  const { sort } = settings;
  // The new row's field; it stays, typed in, until its save goes through.
  const [adding, setAdding] = useState<string>();
  const setFields = (next: SortKey[]) =>
    void save({ sort: { ...sort, fields: next } });
  const label = (i: number) => (i ? "Then by" : "Sort by");
  // The sprint's items lead or trail; descending puts them first.
  const directions = (field: string) =>
    field === currentSprintField
      ? { desc: "First", asc: "Last" }
      : { asc: "Ascending", desc: "Descending" };
  return (
    <div className="plugin-section">
      <h4 className="settings-card-title">Order</h4>
      <SettingsCard>
        {!sort.fields.length && adding === undefined && (
          <SettingsRow
            label="Most recently changed first"
            hint="Add a field, or the current sprint, to sort by it instead."
          />
        )}
        {sort.fields.map((k, i) => (
          <SettingsRow key={`${i}:${k.field}`} label={label(i)}>
            <FieldInput
              label={`Sort field ${i + 1}`}
              value={k.field}
              fields={fields}
              sprint
              onCommit={(field) =>
                setFields(
                  field
                    ? sort.fields.map((o, j) =>
                        j === i
                          ? {
                              field,
                              direction:
                                field === currentSprintField
                                  ? "desc"
                                  : o.direction,
                            }
                          : o,
                      )
                    : sort.fields.filter((_, j) => j !== i),
                )
              }
            />
            <select
              className="plugin-select plugin-direction"
              aria-label={`Sort direction ${i + 1}`}
              value={k.direction}
              onChange={(e) =>
                setFields(
                  sort.fields.map((o, j) =>
                    j === i
                      ? {
                          ...o,
                          direction: e.target.value as SortKey["direction"],
                        }
                      : o,
                  ),
                )
              }
            >
              {Object.entries(directions(k.field)).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
            <IconButton
              label={`Remove sort field ${i + 1}`}
              onClick={() => setFields(sort.fields.filter((_, j) => j !== i))}
            >
              <X size={13} />
            </IconButton>
          </SettingsRow>
        ))}
        {adding !== undefined && (
          <SettingsRow label={label(sort.fields.length)}>
            <FieldInput
              label={`Sort field ${sort.fields.length + 1}`}
              value={adding}
              fields={fields}
              sprint
              onCommit={(field) => {
                setAdding(field);
                if (!field) return;
                const direction = field === currentSprintField ? "desc" : "asc";
                void save({
                  sort: {
                    ...sort,
                    fields: [...sort.fields, { field, direction }],
                  },
                }).then((ok) => ok && setAdding(undefined));
              }}
            />
            <IconButton
              label={`Remove sort field ${sort.fields.length + 1}`}
              onClick={() => setAdding(undefined)}
            >
              <X size={13} />
            </IconButton>
          </SettingsRow>
        )}
      </SettingsCard>
      <div className="plugin-section-foot">
        {adding === undefined && sort.fields.length < 3 && (
          <button className="text-button" onClick={() => setAdding("")}>
            Add a field
          </button>
        )}
        <p className="plugin-note">
          “Current sprint” is in the list too. Items without a field go last;
          ties keep the most recently changed first. The team's items use the
          same order.
        </p>
      </div>
    </div>
  );
}

/** Whose items the Team view shows, and which of theirs. */
export function TeamSection({ settings, save, fields }: Props) {
  const { team } = settings;
  const [draft, setDraft] = useState<{ field: string; values: string[] }>();
  const setFilters = (filters: FieldFilter[]) =>
    void save({ team: { ...team, filters } });
  // Like a new sort row, a new filter stays as typed until it's saved.
  const addDraft = (next: { field: string; values: string[] }) => {
    setDraft(next);
    if (next.field && next.values.length)
      void save({ team: { ...team, filters: [...team.filters, next] } }).then(
        (ok) => ok && setDraft(undefined),
      );
  };
  const filterRow = (
    f: { field: string; values: string[] },
    i: number,
    onField: (field: string) => void,
    onValues: (values: string[]) => void,
    onRemove: () => void,
  ) => (
    <SettingsRow key={i} label="Only where">
      <FieldInput
        label={`Team filter field ${i + 1}`}
        value={f.field}
        fields={fields}
        onCommit={onField}
      />
      <CommitInput
        className="plugin-values"
        aria-label={`Team filter values ${i + 1}`}
        placeholder="is one of, e.g. Review, Testing"
        value={f.values.join(", ")}
        onCommit={(text) => onValues(list(text))}
      />
      <IconButton label={`Remove team filter ${i + 1}`} onClick={onRemove}>
        <X size={13} />
      </IconButton>
    </SettingsRow>
  );
  return (
    <div className="plugin-section">
      <h4 className="settings-card-title">Team</h4>
      <SettingsCard>
        <SettingsRow
          label="Members"
          hint="Their emails, separated by commas. With anyone here, your items get a Team view beside them."
        >
          <CommitInput
            aria-label="Team members"
            placeholder="ann@example.com, bob@example.com"
            spellCheck={false}
            value={team.members.join(", ")}
            onCommit={(text) =>
              void save({ team: { ...team, members: list(text) } })
            }
          />
        </SettingsRow>
        {team.filters.map((f, i) =>
          filterRow(
            f,
            i,
            (field) =>
              setFilters(
                field
                  ? team.filters.map((o, j) => (j === i ? { ...o, field } : o))
                  : team.filters.filter((_, j) => j !== i),
              ),
            (values) =>
              setFilters(
                values.length
                  ? team.filters.map((o, j) => (j === i ? { ...o, values } : o))
                  : team.filters.filter((_, j) => j !== i),
              ),
            () => setFilters(team.filters.filter((_, j) => j !== i)),
          ),
        )}
        {draft &&
          filterRow(
            draft,
            team.filters.length,
            (field) => addDraft({ ...draft, field }),
            (values) => addDraft({ ...draft, values }),
            () => setDraft(undefined),
          )}
      </SettingsCard>
      <div className="plugin-section-foot">
        {!draft && team.filters.length < 3 && (
          <button
            className="text-button"
            onClick={() => setDraft({ field: "", values: [] })}
          >
            Add a filter
          </button>
        )}
        <p className="plugin-note">
          Without a filter on State, closed items stay out.
        </p>
      </div>
    </div>
  );
}
