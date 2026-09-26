// The desktop's MergeSheet for a thread's worktree: its branch into the one it
// came from, pushed along if that has a remote. Merging happens in a folder of
// its own, so a conflict changes nothing; the phone then hands it to the agent,
// as resolving conflicts means editing files.
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Check } from "lucide-react-native";
import type { MergePlan, MergeResult } from "../../../shared/branch-merge";
import { useRemote } from "../remote/RemoteProvider";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { mono, type, useTheme } from "./theme";

/** Commits listed before "and N more". */
const listed = 8;

export function MergeSheet({
  where,
  open,
  onClose,
  onMerged,
  onAskAgent,
}: {
  /** The thread's worktree, as a workspace id. */
  where: string;
  open: boolean;
  onClose: () => void;
  onMerged: () => void;
  /** Sends the thread's agent a message; resolving conflicts is its job here. */
  onAskAgent: (text: string) => Promise<void>;
}) {
  const t = useTheme();
  const { desktop } = useRemote();
  const [base, setBase] = useState<string>();
  const [plan, setPlan] = useState<MergePlan>();
  const [push, setPush] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<MergeResult>();
  const load = useCallback(() => {
    desktop("projectMergePlan", where, base)
      .then(setPlan)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [desktop, where, base]);
  useEffect(() => {
    if (open) load();
  }, [open, load]);
  const close = () => {
    if (busy) return;
    setResult(undefined);
    setError(undefined);
    setPlan(undefined);
    setBase(undefined);
    onClose();
  };
  const step = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const merge = () =>
    step(async () => {
      if (!plan) return;
      const done = await desktop("projectMergeBranch", where, {
        branch: plan.branch,
        head: plan.head,
        base: plan.base,
        baseHead: plan.baseHead,
        push: push && !!plan.pushTarget,
      });
      setResult(done);
      if (done.merged) onMerged();
    });
  const commits = plan?.commits.length ?? 0;
  const pushing = push && !!plan?.pushTarget;
  const note = [styles.note, { color: t.muted }];

  return (
    <Sheet
      open={open}
      title={result?.merged ? `Merged into ${result.base}` : "Merge branch"}
      onClose={close}
    >
      <View style={styles.body}>
        {result?.merged && plan ? (
          <>
            <Text style={[styles.text, { color: t.text }]}>
              <Text style={styles.code}>{plan.branch}</Text> is in{" "}
              <Text style={styles.code}>{result.base}</Text>
              {result.fastForward ? " (fast-forward)" : " as a merge commit"}
              {result.pushedTo ? (
                <>
                  {" "}
                  and pushed to{" "}
                  <Text style={styles.code}>{result.pushedTo}</Text>.
                </>
              ) : (
                "."
              )}
            </Text>
            <Button label="Done" primary onPress={close} />
          </>
        ) : !plan ? (
          error ? (
            <>
              <Text style={note}>{error}</Text>
              <Button
                label="Try again"
                onPress={() => {
                  setError(undefined);
                  load();
                }}
              />
            </>
          ) : (
            <ActivityIndicator color={t.muted} style={styles.loading} />
          )
        ) : (
          <>
            <Text style={[styles.text, { color: t.text }]}>
              <Text style={styles.code}>{plan.branch}</Text> into{" "}
              <Text style={styles.code}>{plan.base}</Text>
            </Text>
            {plan.bases.length > 1 && (
              <View style={styles.bases}>
                {plan.bases.slice(0, 5).map((name) => (
                  <Pressable
                    key={name}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: name === plan.base }}
                    disabled={busy}
                    onPress={() => {
                      setResult(undefined);
                      setPlan(undefined);
                      setBase(name);
                    }}
                    style={styles.base}
                  >
                    <View style={styles.checkBox}>
                      {name === plan.base && (
                        <Check size={16} color={t.accent} />
                      )}
                    </View>
                    <Text style={[styles.code, { color: t.text }]}>{name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {commits ? (
              <View style={styles.commits}>
                <Text style={note}>
                  {commits === 50 ? "Latest 50" : commits}{" "}
                  {commits === 1 ? "commit" : "commits"} ·{" "}
                  {plan.fastForward ? "fast-forward" : "creates a merge commit"}
                </Text>
                {plan.commits.slice(0, listed).map((c) => (
                  <Text
                    key={c.sha}
                    numberOfLines={1}
                    style={[styles.commit, { color: t.text }]}
                  >
                    <Text style={[styles.code, { color: t.muted }]}>
                      {c.sha.slice(0, 7)}
                    </Text>{" "}
                    {c.subject}
                  </Text>
                ))}
                {commits > listed && (
                  <Text style={note}>and {commits - listed} more</Text>
                )}
              </View>
            ) : (
              <Text style={note}>
                {plan.base} already has everything on {plan.branch}.
              </Text>
            )}
            {plan.pushTarget && (
              <View style={styles.pushRow}>
                <Text style={[styles.text, styles.grow, { color: t.text }]}>
                  Push {plan.base} to{" "}
                  <Text style={styles.code}>{plan.pushTarget}</Text>
                </Text>
                <Switch
                  value={push}
                  onValueChange={setPush}
                  disabled={busy}
                  accessibilityLabel={`Push ${plan.base}`}
                />
              </View>
            )}
            {!!plan.uncommitted && (
              <Text style={note}>
                {plan.uncommitted} uncommitted{" "}
                {plan.uncommitted === 1 ? "file stays" : "files stay"} in the
                worktree and {plan.uncommitted === 1 ? "isn’t" : "aren’t"}{" "}
                merged.
              </Text>
            )}
            {plan.checkedOutAt && (
              <Text style={note}>
                Also moves {plan.base} where it’s checked out, in{" "}
                {plan.checkedOutAt.split("/").pop()}. Uncommitted edits there
                stay; if one touches a file this merge changes, nothing happens.
              </Text>
            )}
            {!!plan.snapshots && (
              <Text style={note}>
                Includes{" "}
                {plan.snapshots === 1
                  ? "a commit"
                  : `${plan.snapshots} commits`}{" "}
                Relay made of the checkout’s uncommitted edits when this
                worktree started; merging lands those edits too.
              </Text>
            )}
            {result && !result.merged && (
              <View style={[styles.conflicts, { borderColor: t.danger }]}>
                <Text style={[styles.text, { color: t.text }]}>
                  These files conflict, so nothing was merged:
                </Text>
                {result.conflicts.map((path) => (
                  <Text
                    key={path}
                    numberOfLines={1}
                    style={[styles.code, { color: t.text }]}
                  >
                    {path}
                  </Text>
                ))}
                <Button
                  label="Ask the agent to resolve them"
                  disabled={busy}
                  onPress={() =>
                    void step(async () => {
                      await onAskAgent(
                        `Merge ${plan.base} into ${plan.branch} and resolve the conflicts in ${result.conflicts.join(", ")}. Then commit, so the branch can merge into ${plan.base} cleanly.`,
                      );
                      close();
                    })
                  }
                />
              </View>
            )}
            {!!error && (
              <Text style={[styles.note, { color: t.danger }]}>{error}</Text>
            )}
            <Button
              label={
                busy
                  ? "Merging…"
                  : pushing
                    ? `Merge & push ${plan.base}`
                    : `Merge into ${plan.base}`
              }
              primary
              disabled={busy || !commits || (!!result && !result.merged)}
              onPress={() => void merge()}
            />
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 8, gap: 12 },
  loading: { paddingVertical: 24 },
  text: { fontSize: type.body, lineHeight: 22 },
  grow: { flex: 1 },
  note: { fontSize: type.small, lineHeight: 19 },
  code: { fontFamily: mono, fontSize: 13 },
  bases: { gap: 2 },
  base: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40 },
  checkBox: { width: 18, alignItems: "center" },
  commits: { gap: 4 },
  commit: { fontSize: type.small },
  pushRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  conflicts: { gap: 6, borderLeftWidth: 2, paddingLeft: 12 },
});
