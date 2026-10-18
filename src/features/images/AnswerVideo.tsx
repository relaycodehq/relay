import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import "./answer-video.css";

/** Automatic reloads before offering a manual retry. */
const RELOADS = 2;

/** A video an answer embeds, with a way to recover if playback fails. */
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
    // Main may not have the saved answer yet when the turn has just ended.
    retry: 2,
    retryDelay: 500,
  });
  const [failures, setFailures] = useState(0);
  const [size, setSize] = useState<{ width: number; height: number }>();
  // Where a failed player was, for the one that replaces it to carry on from.
  const resume = useRef<{ at: number; playing: boolean }>(undefined);
  if (!src) return null;
  const broken = failures > RELOADS;
  // Missing files stay out of the answer, but a player that loaded keeps its place.
  if (broken && !size) return null;
  return (
    <span className="answer-video-frame">
      <video
        // A new element asks main for the file again; a failed one stays failed.
        key={Math.min(failures, RELOADS)}
        className="answer-video"
        src={src}
        controls
        preload="metadata"
        aria-label={alt || path.split("/").pop()}
        title={path}
        width={size?.width}
        height={size?.height}
        onLoadedMetadata={(e) => {
          setSize({
            width: e.currentTarget.videoWidth,
            height: e.currentTarget.videoHeight,
          });
          const was = resume.current;
          resume.current = undefined;
          if (!was) return;
          e.currentTarget.currentTime = was.at;
          if (was.playing) e.currentTarget.play().catch(() => {});
        }}
        onError={(e) => {
          const video = e.currentTarget;
          // Reaches main.log, so a video that keeps vanishing says why.
          console.error(
            `Answer video failed (code ${video.error?.code}: ${video.error?.message}) at ${video.currentTime.toFixed(1)}s, attempt ${failures + 1}: ${path}`,
          );
          if (broken) return;
          resume.current = { at: video.currentTime, playing: !video.paused };
          setFailures((count) => count + 1);
        }}
      />
      {broken && (
        <span className="answer-video-error" role="status">
          <span>This video stopped loading.</span>
          <button type="button" onClick={() => setFailures(0)}>
            Retry video
          </button>
        </span>
      )}
    </span>
  );
}
