// The desktop's AsyncQuestionCards (src/features/thread): questions an agent
// left in its answer while it kept working. They stay answerable after the
// turn ends; dismissing one hides it without telling the agent anything.
import { useContext, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { ChevronDown, ChevronRight, MessageCircleQuestion } from "lucide-react-native";
import type { AsyncAgentQuestions, ChatMessage } from "../../../shared/projects";
import { useRemote } from "../remote/RemoteProvider";
import { RevealField, RevealMessage } from "./KeyboardAware";
import { agentNames } from "./ProviderIcon";
import { Questions } from "./RequestCard";
import { type, useTheme } from "./theme";

export function AsyncQuestions({ chatId, message }: { chatId: string; message: ChatMessage }) {
  if (!message.questions?.length) return null;
  return message.questions.map((group) =>
    group.answers ? (
      <Answered key={group.id} group={group} />
    ) : (
      <Open key={group.id} chatId={chatId} message={message} group={group} />
    ),
  );
}

function Open({
  chatId,
  message,
  group,
}: {
  chatId: string;
  message: ChatMessage;
  group: AsyncAgentQuestions;
}) {
  const t = useTheme();
  const { desktop } = useRemote();
  const revealMessage = useContext(RevealMessage);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (call: () => Promise<unknown>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await call();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const many = group.questions.length > 1;
  const title = `${agentNames[message.provider]} has ${many ? "questions" : "a question"}`;
  const dismiss = (dismissed: boolean) =>
    run(() => desktop("setProjectChatQuestionDismissed", chatId, message.id, group.id, dismissed));
  return (
    <>
      {/* Hidden rather than unmounted, so a half-written answer survives a dismiss. */}
      <View
        accessibilityLabel={title}
        style={[
          styles.card,
          { borderColor: t.accent, backgroundColor: t.raised },
          group.dismissed && styles.hidden,
        ]}
      >
        <View style={styles.head}>
          <MessageCircleQuestion size={15} color={t.accent} />
          <Text style={[styles.title, { color: t.text }]}>{title}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Hides it. You can reopen it later."
            disabled={busy}
            hitSlop={10}
            onPress={() => void dismiss(true)}
          >
            <Text style={[styles.action, { color: t.muted }]}>Dismiss</Text>
          </Pressable>
        </View>
        <Text style={[styles.hint, { color: t.muted }]}>{"Answer whenever you're ready."}</Text>
        <RevealField.Provider value={() => revealMessage(message.id)}>
          <Questions
            questions={group.questions}
            busy={busy}
            deferred
            onAnswer={(answers) =>
              void run(() =>
                desktop("answerProjectChatQuestion", chatId, message.id, group.id, {
                  kind: "question",
                  answers,
                }),
              ).then((sent) => {
                // A tap, not Success: that one is the turn's end.
                if (sent) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              })
            }
          />
        </RevealField.Provider>
        {error && <Text style={[styles.hint, { color: t.danger }]}>{error}</Text>}
      </View>
      {group.dismissed && (
        <View style={styles.folded}>
          <Fold label={`Dismissed ${many ? "questions" : "question"}`}>
            {group.questions.map((q) => (
              <Text key={q.id} style={[styles.hint, { color: t.muted }]}>
                {q.question}
              </Text>
            ))}
          </Fold>
          <Pressable accessibilityRole="button" disabled={busy} hitSlop={10} onPress={() => void dismiss(false)}>
            <Text style={[styles.action, { color: t.accent }]}>Reopen</Text>
          </Pressable>
          {error && <Text style={[styles.hint, { color: t.danger }]}>{error}</Text>}
        </View>
      )}
    </>
  );
}

function Answered({ group }: { group: AsyncAgentQuestions }) {
  const t = useTheme();
  return (
    <Fold label={`Answered ${group.questions.length > 1 ? "questions" : "question"}`}>
      {group.questions.map((q) => (
        <View key={q.id} style={styles.qa}>
          <Text style={[styles.hint, { color: t.text }]}>{q.question}</Text>
          <Text selectable style={[styles.hint, { color: t.muted }]}>
            {q.isSecret ? "Hidden answer" : group.answers![q.id]?.join(", ")}
          </Text>
        </View>
      ))}
    </Fold>
  );
}

function Fold({ label, children }: { label: string; children: ReactNode }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <View style={styles.fold}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        onPress={() => setOpen(!open)}
        style={styles.foldHead}
      >
        <Chevron size={13} color={t.muted} />
        <Text style={[styles.hint, { color: t.muted }]}>{label}</Text>
      </Pressable>
      {open && <View style={[styles.foldBody, { borderColor: t.border }]}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  hidden: { display: "none" },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: type.body, fontWeight: "600" },
  action: { fontSize: type.small, fontWeight: "500" },
  hint: { fontSize: type.tiny, lineHeight: 17 },
  folded: { flexDirection: "row", alignItems: "flex-start", gap: 14, flexWrap: "wrap" },
  fold: { flexShrink: 1, gap: 6 },
  foldHead: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" },
  foldBody: { borderLeftWidth: 2, paddingLeft: 10, gap: 8 },
  qa: { gap: 1 },
});
