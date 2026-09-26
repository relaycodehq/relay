import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import type { TurnFileChange } from "../../../../shared/projects";
import { useRemote } from "../../remote/RemoteProvider";
import { useThread } from "../../remote/useThread";
import { mainMessages } from "../../remote/chat-state";
import { Button } from "../../ui/Button";
import { Composer } from "../../ui/Composer";
import { ConnectionLine } from "../../ui/ConnectionLine";
import { MessageView, withoutMention } from "../../ui/MessageView";
import { agentNames } from "../../ui/ProviderIcon";
import { RequestCard } from "../../ui/RequestCard";
import { type, useTheme } from "../../ui/theme";

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const remote = useRemote();
  const t = useTheme();
  const { thread, error, reload, summary } = useThread(id);
  // Newest first: the list is inverted so it opens at the latest answer.
  const messages = useMemo(
    () => (thread ? mainMessages(thread.messages).reverse() : []),
    [thread],
  );
  const openFile = useCallback(
    (file: TurnFileChange, messageId: string) =>
      router.push({
        pathname: "/diff",
        params: { chat: id, message: messageId, path: file.path },
      }),
    [id],
  );
  const title = thread?.title ?? summary?.title ?? "";
  const provider = thread?.agent?.provider ?? summary?.provider;
  const running = !!(thread?.running ?? summary?.running);
  const request = thread?.requests?.[0];
  const online = remote.status === "online";

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <Stack.Screen options={{ title }} />
      <ConnectionLine />
      {!thread ? (
        <View style={styles.center}>
          {error ? (
            <>
              <Text style={[styles.note, { color: t.muted }]}>{error.message}</Text>
              <Button label="Try again" style={styles.grow0} onPress={() => void reload()} />
            </>
          ) : (
            <ActivityIndicator color={t.muted} />
          )}
        </View>
      ) : (
        <FlatList
          inverted
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageView message={item} onOpenFile={openFile} />
          )}
          ListHeaderComponent={
            thread.queue.length ? (
              <View style={styles.queue}>
                {thread.queue.map((q) => (
                  <Text
                    key={q.id}
                    numberOfLines={2}
                    style={[styles.queued, { color: t.muted, borderColor: t.border }]}
                  >
                    {thread.queuePaused ? "Paused · " : "Queued · "}
                    {withoutMention(q.body)}
                  </Text>
                ))}
              </View>
            ) : null
          }
          ListFooterComponent={
            thread.earlier ? (
              <Text style={[styles.earlier, { color: t.faint }]}>
                {thread.earlier} earlier{" "}
                {thread.earlier === 1 ? "message is" : "messages are"} on your
                computer
              </Text>
            ) : null
          }
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        />
      )}
      {request && (
        <RequestCard
          key={request.id}
          request={request}
          more={(thread?.requests?.length ?? 1) - 1}
          onRespond={async (response) => {
            await remote.call("respond", id, request.id, response);
            await reload();
          }}
        />
      )}
      <Composer
        placeholder={provider ? `Message ${agentNames[provider]}` : "Message"}
        running={running}
        disabled={!online || !thread}
        onSend={async (body) => {
          await remote.call("send", id, { id: randomUUID(), body });
          await reload();
        }}
        onStop={() => void remote.call("stop", id).catch(() => {})}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  note: { fontSize: type.small, textAlign: "center" },
  grow0: { flexGrow: 0 },
  list: { paddingVertical: 8 },
  earlier: { fontSize: type.tiny, textAlign: "center", padding: 16 },
  queue: { gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  queued: {
    fontSize: type.small,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 10,
  },
});
