import {
  createContext,
  useContext,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

/** What a plugin's settings call after a save, so its card can say so. */
export const PluginSavedContext = createContext<() => void>(() => {});
export const usePluginSaved = () => useContext(PluginSavedContext);

/** A muted status line in a plugin card's header; `attention` while it needs setting up. */
export function PluginStatus({
  children,
  attention,
}: {
  children: ReactNode;
  attention?: boolean;
}) {
  return (
    <small className={attention ? "plugin-attention" : ""}>{children}</small>
  );
}

/** A text field that saves when you leave it or press Enter; Esc puts the saved value back. */
export function CommitInput({
  value,
  onCommit,
  ...props
}: {
  value: string;
  onCommit: (value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState<string>();
  return (
    <input
      {...props}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== undefined && draft.trim() !== value)
          onCommit(draft.trim());
        setDraft(undefined);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape" && draft !== undefined) {
          // Esc would otherwise close Settings too.
          e.stopPropagation();
          setDraft(undefined);
        }
      }}
    />
  );
}

/**
 * A key or token: pasted and connected, then only replaced or forgotten.
 * `onConnect` resolves true once it's saved, which clears the field.
 */
export function SecretField({
  label,
  saved,
  placeholder,
  onConnect,
  onForget,
}: {
  label: string;
  saved: boolean;
  placeholder: string;
  onConnect: (secret: string) => Promise<boolean>;
  onForget: () => void;
}) {
  const [value, setValue] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // Keyed so the clicked Connect never turns into a focused Forget.
  if (saved && !replacing)
    return (
      <>
        <button key="replace" onClick={() => setReplacing(true)}>
          Replace
        </button>
        <button key="forget" className="text-button" onClick={onForget}>
          Forget
        </button>
      </>
    );
  const connect = async () => {
    setConnecting(true);
    const ok = await onConnect(value.trim());
    setConnecting(false);
    if (!ok) return;
    setValue("");
    setReplacing(false);
  };
  return (
    <>
      <input
        type="password"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) void connect();
        }}
      />
      <button
        key="connect"
        className="primary"
        disabled={connecting || !value.trim()}
        onClick={() => void connect()}
      >
        {connecting ? "Connecting…" : "Connect"}
      </button>
      {replacing && (
        <button
          className="text-button"
          onClick={() => {
            setReplacing(false);
            setValue("");
          }}
        >
          Cancel
        </button>
      )}
    </>
  );
}
