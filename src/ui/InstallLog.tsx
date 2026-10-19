import { Popover } from "@base-ui/react/popover";
import "./install-log.css";

/** Colours and cursor moves left in a CLI's output; progress lines keep their last state. */
const plain = (output: string) =>
  output
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .split("\n")
    .map((line) => line.split("\r").filter(Boolean).at(-1) ?? "")
    .join("\n")
    .trim();

/** What an install printed, shown on hover: its end, following along as it grows. */
export function InstallLog({ output }: { output: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger openOnHover delay={150} closeDelay={250}>
        Log
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <Popover.Popup className="install-log" aria-label="Install log">
            {/* A new ref each render: as the output grows, its end stays in view. */}
            <pre
              ref={(log) => {
                if (log) log.scrollTop = log.scrollHeight;
              }}
            >
              {plain(output)}
            </pre>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
