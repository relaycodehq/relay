import { Square, Volume2 } from "lucide-react";
import { startReading, stopReading, useReading } from "./playback";
import { useReadAloudState } from "./state";
import "./read-aloud.css";

/** Reads an answer aloud, or stops it; hidden where Relay has no voice engine. */
export function ReadAloudButton({
  readingKey,
  text,
}: {
  readingKey: string;
  text: string;
}) {
  const state = useReadAloudState();
  const reading = useReading();
  if (!state?.supported || !state.engines.length) return null;
  const mine = reading?.key === readingKey ? reading : undefined;
  const going = mine && mine.status !== "failed" ? mine.status : undefined;
  const label = going
    ? going === "loading"
      ? "Getting the voice ready… Click to stop"
      : "Stop reading"
    : "Read aloud";
  return (
    <>
      {mine?.status === "failed" && (
        <span className="read-aloud-error" role="status">
          {mine.error}
        </span>
      )}
      <button
        type="button"
        className="read-aloud-button"
        data-reading={going}
        title={label}
        aria-label={label}
        onClick={() => (going ? stopReading() : startReading(readingKey, text))}
      >
        {going ? <Square size={12} /> : <Volume2 size={15} />}
      </button>
    </>
  );
}
