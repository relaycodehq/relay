// What an answer leaves for the user besides its text: why it failed, a
// login to renew, pages it showed that only the computer can draw.
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppWindow, CircleAlert, LogIn } from "lucide-react-native";
import { agentError } from "../../../shared/agent-error";
import type { AgentProvider } from "../../../shared/agents";
import type { HtmlRender } from "../../../shared/html-render";
import { useRemote } from "../remote/RemoteProvider";
import { agentNames } from "./ProviderIcon";
import { mono, type, useTheme } from "./theme";

/** The desktop's AgentError: the provider's message out of its envelope, the envelope on request. */
export function AgentErrorNote({ error }: { error: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const { message, hint, details } = agentError(error);
  return (
    <View style={styles.row}>
      <CircleAlert size={15} color={t.danger} style={styles.icon} />
      <View style={styles.text}>
        <Text selectable style={[styles.message, { color: t.text }]}>
          {message}
        </Text>
        {hint && <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text>}
        {details && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            hitSlop={8}
            onPress={() => setOpen(!open)}
          >
            <Text style={[styles.hint, { color: t.muted }]}>
              {open ? "Hide technical details" : "Technical details"}
            </Text>
          </Pressable>
        )}
        {open && details && (
          <Text selectable style={[styles.details, { color: t.muted, backgroundColor: t.code }]}>
            {details.slice(0, 4000)}
          </Text>
        )}
      </View>
    </View>
  );
}

/** The desktop offers to sign in again; that needs its terminal or browser, so the phone only says so. */
export function SignInNote({ provider }: { provider: AgentProvider }) {
  const t = useTheme();
  const { name } = useRemote();
  const agent = agentNames[provider];
  return (
    <View
      accessibilityRole="text"
      style={[styles.row, styles.box, { borderColor: t.border, backgroundColor: t.raised }]}
    >
      <LogIn size={15} color={t.accent} style={styles.icon} />
      <View style={styles.text}>
        <Text style={[styles.message, styles.strong, { color: t.text }]}>
          {agent} is signed out
        </Text>
        <Text style={[styles.hint, { color: t.muted }]}>
          Open this thread on {name} to sign in again, then resume the answer.
        </Text>
      </View>
    </View>
  );
}

/** Pages the agent showed with show_html, which the phone can't draw yet; the answer may refer to them. */
export function RenderNotes({ renders }: { renders: HtmlRender[] }) {
  const t = useTheme();
  const { name } = useRemote();
  return renders.map((render) => {
    const variants = render.pages.flatMap((p) => (p.label ? [p.label] : []));
    return (
      <View
        key={render.id}
        accessibilityLabel={`${render.title}, shown on ${name}`}
        style={[styles.row, styles.box, { borderColor: t.border, backgroundColor: t.raised }]}
      >
        <AppWindow size={15} color={t.muted} style={styles.icon} />
        <View style={styles.text}>
          <Text numberOfLines={2} style={[styles.message, styles.strong, { color: t.text }]}>
            {render.title}
          </Text>
          <Text style={[styles.hint, { color: t.muted }]}>
            {variants.length > 1 ? `${variants.length} versions: ${variants.join(", ")}. ` : ""}
            Open this thread on {name} to see {variants.length > 1 ? "them" : "it"}.
          </Text>
        </View>
      </View>
    );
  });
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  box: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  icon: { marginTop: 2 },
  text: { flex: 1, gap: 3 },
  message: { fontSize: type.small, lineHeight: 19 },
  strong: { fontWeight: "600" },
  hint: { fontSize: type.tiny, lineHeight: 17 },
  details: {
    marginTop: 4,
    padding: 8,
    borderRadius: 6,
    overflow: "hidden",
    fontFamily: mono,
    fontSize: 11,
    lineHeight: 15,
  },
});
