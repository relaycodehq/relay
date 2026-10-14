import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

/** A video an answer embeds, playable where the text puts it; nothing at all if it won't load. */
export function AnswerVideo({
  chatId,
  messageId,
  path,
  alt,
}: {
  chatId: string;
  messageId: string;
  path: string;
  alt: string;
}) {
  const { data: src } = useQuery({
    queryKey: ["answer-video", chatId, messageId, path],
    queryFn: () => api.projectChatVideo(chatId, messageId, path),
    staleTime: Infinity,
    retry: false,
  });
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return (
    <video
      className="answer-video"
      src={src}
      controls
      preload="metadata"
      aria-label={alt || path.split("/").pop()}
      title={path}
      onError={() => setBroken(true)}
    />
  );
}
