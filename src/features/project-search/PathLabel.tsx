import { FileEntryIcon } from "../../ui/FileEntryIcon";
import { Highlight, rangesOf } from "./Highlight";

/** A file's icon, name and, muted, the folder it is in; `indices` marks what a fuzzy query matched. */
export function PathLabel({
  path,
  indices = [],
  showDir = true,
}: {
  path: string;
  indices?: readonly number[];
  showDir?: boolean;
}) {
  const slash = path.lastIndexOf("/") + 1;
  return (
    <>
      <FileEntryIcon path={path} directory={false} />
      <span className="ps-name">
        <Highlight text={path.slice(slash)} ranges={rangesOf(indices, slash)} />
      </span>
      {showDir && slash > 0 && (
        <span className="ps-dir">
          <Highlight
            text={path.slice(0, slash - 1)}
            ranges={rangesOf(indices.filter((i) => i < slash - 1))}
          />
        </span>
      )}
    </>
  );
}
