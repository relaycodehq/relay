import { BackToMainButton } from "../features/editor-windows/EditorWindowButtons";

/** The popped-out editor's title bar: the project, its checkout, and the way back to the main window. */
export function EditorWindowTitlebar({
  projectName,
  detail,
  where,
  onError,
}: {
  projectName: string;
  /** The checkout's label, when the folder is known. */
  detail?: string;
  where: string;
  onError: (error: unknown) => void;
}) {
  return (
    <header className="titlebar project-titlebar sidebar-collapsed">
      <div className="project-titlebar-brand">
        <span className="traffic-space" />
      </div>
      <div className="project-titlebar-main">
        <div className="project-window-title">
          <span className="project-window-name">{projectName}</span>
          {detail && (
            <>
              <span className="breadcrumb-slash">/</span>
              <strong>{detail}</strong>
            </>
          )}
        </div>
        <span className="spacer" />
        <div className="header-strip">
          <BackToMainButton where={where} onError={onError} />
        </div>
      </div>
    </header>
  );
}
