import { useEffect, useRef, useState } from "react";
import type { LocalFile, Pull } from "../../../../shared/types";
import { api } from "../../../lib/api";
import { useHoldNavigation } from "../../../lib/navigation-lock";

/** `plain`: a folder without Git, so no HEAD to compare with or blame. */
export type LocalProject = { id: string; head: string; plain?: boolean };

/**
 * A file in a project's folder or a PR's linked checkout, open for editing:
 * reading it, the edited text, saving it over the version it was read at, and
 * asking before closing or reloading drops unsaved edits. Holds navigation and
 * the window while edits are unsaved or saving.
 *
 * Looks at the disk again when the window gains focus or `stamp` changes (the
 * working tree's revision): a clean buffer takes the new text quietly, an
 * edited one is marked `changedOnDisk`.
 */
export function useLocalFile(
  project: LocalProject | undefined,
  pull: Pull | undefined,
  path: string,
  onClose: () => void,
  stamp?: string,
) {
  const [source, setSource] = useState<LocalFile>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [needsFolder, setNeedsFolder] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmation, setConfirmation] = useState<"close" | "reload" | null>(
    null,
  );
  // The text as React state, for checks and blame; `text` has it without a render.
  const [buffer, setBuffer] = useState<string>();
  const [changedOnDisk, setChangedOnDisk] = useState(false);
  // The source came from a look at the disk, not from opening or Reload.
  const [quiet, setQuiet] = useState(false);
  const revision = pull?.head.sha ?? source?.head ?? project!.head;
  useHoldNavigation(dirty || saving);
  const text = useRef("");
  const baseline = useRef("");
  const version = useRef("");
  const savingRef = useRef(false);
  const live = useRef(true);
  const loadGeneration = useRef(0);
  const isDirty = () => text.current !== baseline.current;
  const read = () =>
    project
      ? api.projectFile(project.id, path)
      : api.readLocalFile(pull!, revision, path);
  const take = (file: LocalFile, fromDisk = false) => {
    text.current = baseline.current = file.contents;
    setBuffer(file.contents);
    version.current = file.version;
    setDirty(false);
    setSaved(false);
    setChangedOnDisk(false);
    setQuiet(fromDisk);
    setSource(file);
  };

  const load = async (link = false) => {
    const generation = ++loadGeneration.current;
    const isCurrent = () =>
      live.current && generation === loadGeneration.current;
    setLoading(true);
    setError(undefined);
    try {
      const folder =
        project ||
        (link ? await api.linkFolder(pull!) : await api.folder(pull!));
      if (!isCurrent()) return;
      if (!folder) {
        setNeedsFolder(true);
        return;
      }
      setNeedsFolder(false);
      const file = await read();
      if (!isCurrent()) return;
      take(file);
    } catch (error) {
      if (isCurrent()) setError(error);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
      loadGeneration.current++;
    };
  }, []);

  const checking = useRef(false);
  const check = async () => {
    if (!source || loading || savingRef.current || checking.current) return;
    checking.current = true;
    const generation = loadGeneration.current;
    try {
      const file = await read();
      if (
        !live.current ||
        generation !== loadGeneration.current ||
        savingRef.current
      )
        return;
      if (file.version === version.current) setChangedOnDisk(false);
      else if (isDirty()) setChangedOnDisk(true);
      else take(file, true);
    } catch {
      // Gone or unreadable: saving says so, with the edits still here.
    } finally {
      checking.current = false;
    }
  };
  const checkRef = useRef(check);
  checkRef.current = check;
  useEffect(() => {
    if (stamp) void checkRef.current();
  }, [stamp]);
  useEffect(() => {
    const focus = () => void checkRef.current();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);

  const save = async (close = false) => {
    if (!source || !isDirty() || savingRef.current || loading) return;
    savingRef.current = true;
    setSaving(true);
    setError(undefined);
    const contents = text.current;
    try {
      const result = await (project
        ? api.saveProjectFile(
            project.id,
            path,
            source.head,
            version.current,
            contents,
          )
        : api.saveLocalFile(pull!, revision, path, version.current, contents));
      if (!live.current) return;
      version.current = result.version;
      baseline.current = contents;
      setDirty(isDirty());
      setChangedOnDisk(false);
      setSaved(true);
      setConfirmation(null);
      if (close && !isDirty()) onClose();
    } catch (error) {
      if (live.current) setError(error);
    } finally {
      savingRef.current = false;
      if (live.current) setSaving(false);
    }
  };
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty() && !savingRef.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  return {
    source,
    error,
    setError,
    loading,
    needsFolder,
    dirty,
    saving,
    saved,
    buffer,
    changedOnDisk,
    quiet,
    revision,
    confirmation,
    load,
    save,
    edit: (contents: string) => {
      text.current = contents;
      setBuffer(contents);
      setDirty(isDirty());
      setSaved(false);
    },
    requestClose: () => {
      if (savingRef.current) return;
      if (isDirty()) setConfirmation("close");
      else onClose();
    },
    requestReload: () => (isDirty() ? setConfirmation("reload") : void load()),
    keepEditing: () => setConfirmation(null),
    discard: () => {
      setConfirmation(null);
      if (confirmation === "close") onClose();
      else void load();
    },
  };
}

export type LocalFileSession = ReturnType<typeof useLocalFile>;
