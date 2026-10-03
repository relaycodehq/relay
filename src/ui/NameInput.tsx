import { useRef, useState } from "react";
import { projectNameSchema, threadTitleSchema } from "../../shared/projects";
import { projectGroupNameSchema } from "../../shared/project-folders";

/** Inline name field for naming a group, or renaming a project or thread, in place. */
export function NameInput({
  label,
  initial = "",
  schema = projectGroupNameSchema,
  placeholder = "Group name",
  className = "sb-group-input",
  onSubmit,
  onCancel,
}: {
  label: string;
  initial?: string;
  schema?:
    | typeof projectGroupNameSchema
    | typeof projectNameSchema
    | typeof threadTitleSchema;
  placeholder?: string;
  className?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const parsed = schema.safeParse(value);
  const invalid = !!value.trim() && !parsed.success;
  const finish = (commit: boolean) => {
    if (done.current) return;
    if (commit && parsed.success && parsed.data !== initial) {
      done.current = true;
      onSubmit(parsed.data);
    } else if (!commit || !invalid) {
      done.current = true;
      onCancel();
    }
  };
  return (
    <div className={className}>
      <input
        autoFocus
        aria-label={label}
        placeholder={placeholder}
        maxLength={
          schema === threadTitleSchema
            ? 120
            : schema === projectNameSchema
              ? 80
              : 60
        }
        value={value}
        aria-invalid={invalid}
        title={invalid ? parsed.error?.issues[0].message : undefined}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        }}
        onBlur={() => {
          if (!invalid) return finish(true);
          done.current = true;
          onCancel();
        }}
      />
    </div>
  );
}
