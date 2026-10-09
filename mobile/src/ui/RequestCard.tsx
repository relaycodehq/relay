import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Check } from "lucide-react-native";
import type {
  AgentDecision,
  AgentQuestion,
  AgentRequest,
  AgentResponse,
} from "../../../shared/agent-modes";
import { Button } from "./Button";
import { mono, type, useTheme } from "./theme";

// The desktop's wording, from src/features/thread/AgentRequestCard.tsx.
const labels: Record<AgentDecision, string> = {
  accept: "Approve",
  acceptForSession: "Always",
  decline: "Decline",
  cancel: "Cancel",
};

/** What the agent is waiting on: an approval, or questions to answer. */
export function RequestCard({
  request,
  more,
  onRespond,
}: {
  request: AgentRequest;
  /** Further requests queued behind this one. */
  more: number;
  onRespond: (response: AgentResponse) => Promise<void>;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const canRemember = request.decisions?.includes("acceptForSession");
  // Room for the thread above it; with the keyboard up the card shrinks
  // further and its body scrolls, leaving the answer field and Send in view.
  const maxHeight = useWindowDimensions().height * 0.6;
  const respond = async (response: AgentResponse) => {
    setBusy(true);
    setError(undefined);
    try {
      await onRespond(response);
      // A tap, not Success: that one is the turn's end, often a moment later.
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const head = (
    <>
      <Text style={[styles.title, { color: t.text }]}>{request.title}</Text>
      {more > 0 && (
        <Text style={[styles.hint, { color: t.muted }]}>
          {more} more waiting after this
        </Text>
      )}
      {!!request.detail && (
        <ScrollView
          style={[styles.detail, { backgroundColor: t.code, borderColor: t.border }]}
          nestedScrollEnabled
        >
          <Text selectable style={[styles.detailText, { color: t.text }]}>
            {request.detail}
          </Text>
        </ScrollView>
      )}
    </>
  );
  return (
    <View
      accessibilityLabel={request.title}
      style={[styles.card, { maxHeight, borderColor: t.accent, backgroundColor: t.raised }]}
    >
      {request.kind === "question" && request.questions?.length ? (
        <Questions
          questions={request.questions}
          head={head}
          busy={busy}
          onAnswer={(answers) => respond({ kind: "question", answers })}
        />
      ) : (
        <>
          <Body>{head}</Body>
          <View style={styles.decisions}>
            {(["decline", "acceptForSession", "accept"] as const)
              .filter((d) => request.decisions?.includes(d))
              .map((decision) => (
                <Button
                  key={decision}
                  label={
                    decision === "accept" && canRemember
                      ? "Once"
                      : labels[decision]
                  }
                  primary={decision === "accept"}
                  disabled={busy}
                  onPress={() => respond({ kind: "approval", decision })}
                />
              ))}
          </View>
        </>
      )}
      {error && <Text style={[styles.hint, { color: t.danger }]}>{error}</Text>}
    </View>
  );
}

/** The part of the card that scrolls when it doesn't fit. */
function Body({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={styles.bodyContent}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Questions({
  questions,
  head,
  busy,
  deferred,
  onAnswer,
}: {
  questions: AgentQuestion[];
  /** Scrolls with the question, above it. */
  head?: ReactNode;
  busy: boolean;
  /** The agent keeps working, so nothing goes out until Send; a tap only picks. */
  deferred?: boolean;
  onAnswer: (answers: Record<string, string[]>) => void;
}) {
  const t = useTheme();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const question = questions[index]!;
  const chosen = answers[question.id] ?? [];
  const labelsOf = new Set(question.options?.map((o) => o.label));
  const typed = chosen.filter((a) => !labelsOf.has(a)).join(", ");
  const advance = (next: Record<string, string[]>) => {
    if (index < questions.length - 1) setIndex(index + 1);
    else onAnswer(next);
  };
  const select = (label: string) => {
    if (busy) return;
    void Haptics.selectionAsync();
    const next = {
      ...answers,
      [question.id]: question.multiple
        ? chosen.includes(label)
          ? chosen.filter((v) => v !== label)
          : [...chosen, label]
        : [label],
    };
    setAnswers(next);
    clearTimeout(timer.current);
    // A single choice answers it; the short pause shows which one was picked.
    if (!question.multiple && !deferred)
      timer.current = setTimeout(() => advance(next), 200);
  };
  const answered = chosen.some((a) => a.trim());
  return (
    <>
      <Body>
        {head}
        <View style={styles.questionHead}>
          <Text style={[styles.topic, { color: t.accent }]}>
            {question.header || "Question"}
          </Text>
          {questions.length > 1 && (
            <Text style={[styles.hint, { color: t.muted }]}>
              {index + 1} of {questions.length}
            </Text>
          )}
        </View>
        <Text style={[styles.question, { color: t.text }]}>{question.question}</Text>
        {question.options?.map((option) => {
          const on = chosen.includes(option.label);
          return (
            <Pressable
              key={option.label}
              accessibilityRole={question.multiple ? "checkbox" : "radio"}
              accessibilityState={{ checked: on, disabled: busy }}
              onPress={() => select(option.label)}
              style={({ pressed }) => [
                styles.option,
                { borderColor: on ? t.accent : t.border },
                (pressed || on) && { backgroundColor: t.accentSoft },
              ]}
            >
              <View style={[styles.check, { borderColor: on ? t.accent : t.faint }]}>
                {on && <Check size={12} color={t.accent} strokeWidth={3} />}
              </View>
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, { color: t.text }]}>
                  {option.label}
                </Text>
                {!!option.description && (
                  <Text style={[styles.hint, { color: t.muted }]}>
                    {option.description}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </Body>
      <TextInput
        accessibilityLabel={question.question}
        editable={!busy}
        secureTextEntry={question.isSecret}
        placeholder={question.options?.length ? "Or write your own answer…" : "Your answer…"}
        placeholderTextColor={t.faint}
        value={typed}
        onChangeText={(text) => {
          clearTimeout(timer.current);
          setAnswers((old) => ({ ...old, [question.id]: [text] }));
        }}
        style={[styles.input, { color: t.text, borderColor: t.border }]}
      />
      {(deferred || question.multiple || !question.options?.length || typed) && (
        <Button
          label={index < questions.length - 1 ? "Next" : "Send answer"}
          primary
          disabled={busy || !answered}
          onPress={() => {
            clearTimeout(timer.current);
            advance(answers);
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 8,
    flexShrink: 1,
  },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { gap: 8 },
  title: { fontSize: type.body, fontWeight: "600" },
  hint: { fontSize: type.tiny, lineHeight: 17 },
  detail: {
    maxHeight: 160,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  detailText: { fontFamily: mono, fontSize: 12, lineHeight: 17 },
  decisions: { flexDirection: "row", gap: 8 },
  questionHead: { flexDirection: "row", justifyContent: "space-between" },
  topic: { fontSize: type.tiny, fontWeight: "600", textTransform: "uppercase" },
  question: { fontSize: type.body, lineHeight: 21 },
  option: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { fontSize: type.body },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: type.body,
  },
});
