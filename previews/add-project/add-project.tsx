// Adding a project, built: the real palette over the app, on sample folders
// and GitHub repositories. Clones and creates are simulated.
// Open http://127.0.0.1:5177/previews/add-project/
import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FolderSymlink } from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../_shared/chrome.css";
import "../../src/features/settings/settings.css";
import "../../src/features/agents/composer-model-picker.css";
import { initAppearance } from "../../src/lib/appearance";
import { AddProjectPalette } from "../../src/features/add-project/AddProjectPalette";
import { ThreadIntroduction } from "../../src/features/thread/ThreadScope";
import { ComposerToolbar } from "../../src/features/composer/ComposerToolbar";
import { useSampleControls } from "../../src/features/composer/ComposerToolbarSample";
import { defaultToolbar } from "../../src/features/composer/composer-toolbar";
import { SendButton } from "../../src/features/composer/ComposerSendButtons";
import { linkName, type Project } from "../../shared/projects";
import { AppFrame, stubSidebar } from "../_shared/app-frame";
import { chats, projects } from "./add-project-data";
import { addingBridge } from "./bridge";

Object.assign(window.relay, addingBridge);
initAppearance();
stubSidebar(chats);

function EmptyThread({
  project,
  onSwitch,
  onAdd,
}: {
  project: Project;
  onSwitch: (project: Project) => void;
  onAdd: () => void;
}) {
  const controls = useSampleControls({
    agent: "claude",
    name: "Opus 5.5",
    effort: "High",
    window: 200_000,
  });
  const linked = project.settings?.links ?? [];
  return (
    <section className="project-chat" aria-label="Thread">
      <div className="thread-start">
        <ThreadIntroduction
          project={project}
          projects={projects}
          scope={{ kind: "project" }}
          onSwitchProject={onSwitch}
          onAddProject={onAdd}
        />
        <div className="thread-compose-wrap">
          {!!linked.length && (
            <div className="thread-context-controls">
              <span
                className="composer-branch-trigger static"
                title={linked.map((l) => linkName(l.path)).join(", ")}
              >
                <FolderSymlink size={13} />
                <span>{linked.length}</span>
              </span>
            </div>
          )}
          <form className="project-composer" onSubmit={(e) => e.preventDefault()}>
            <textarea
              className="composer-prompt-input"
              rows={2}
              aria-label="Message"
              placeholder={`Ask anything about ${project.name}…`}
            />
            <div className="composer-tools">
              <ComposerToolbar layout={defaultToolbar} controls={controls} />
              <SendButton disabled running={false} sendKey="enter" runningAction="queue" onSendLater={() => {}} />
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

function Preview() {
  const [showing, setShowing] = useState(projects[0]);
  const [adding, setAdding] = useState(true);
  return (
    <div className="preview-app">
      <div className="preview-bar">
        <strong>Add a project</strong>
        <span>Sample data. The sidebar's + and the project name in the headline open it again.</span>
      </div>
      <AppFrame
        title={<strong>{showing.name}</strong>}
        projects={projects}
        showing={{ projectId: showing.id }}
        onAdd={() => setAdding(true)}
      >
        <EmptyThread key={showing.id} project={showing} onSwitch={setShowing} onAdd={() => setAdding(true)} />
        {adding && (
          <AddProjectPalette
            projects={[...projects]}
            onClose={() => setAdding(false)}
            onDone={(p) => {
              setShowing(p);
              setAdding(false);
            }}
          />
        )}
      </AppFrame>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
