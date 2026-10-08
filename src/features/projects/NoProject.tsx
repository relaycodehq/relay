import { FolderGit2, FolderPlus } from "lucide-react";
import "./projects.css";

/** The main area before any project is added. */
export function NoProject({
  hidden,
  onAdd,
  onScratch,
}: {
  hidden: boolean;
  onAdd: () => void;
  onScratch: () => void;
}) {
  return (
    <main className="project-empty" hidden={hidden}>
      <FolderGit2 size={40} />
      <h1>Your project. Your conversation.</h1>
      <p>
        Open a project folder to edit, review changes and pull requests, and
        chat with your agent.
      </p>
      <button className="primary" onClick={onAdd}>
        <FolderPlus size={16} />
        Add project folder
      </button>
      <button className="text-button" onClick={onScratch}>
        Or just chat in Scratchpad
      </button>
    </main>
  );
}
