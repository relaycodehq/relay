// Bundled separately for the shell and PowerShell installers. It shares the
// updater's validation, cross-process lock and rollback on a failed swap.
import { replaceInstallation } from "./install";

const [root, staged, version] = process.argv.slice(2);
if (!root || !staged || !version) {
  console.error(
    "Expected an installation path, a staged release and a version.",
  );
  process.exitCode = 1;
} else {
  replaceInstallation(root, staged, version).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
