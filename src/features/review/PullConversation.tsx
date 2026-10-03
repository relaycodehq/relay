import { useEffect, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { Pull, Review, ReviewComment } from "../../../shared/types";
import { api } from "../../lib/api";
import {
  conversationTimeline,
  reviewStateLabel,
} from "./conversation-timeline";
import { Avatar, ErrorBox, Loading, RichText, timeAgo } from "../../ui/ui";

/** The PR's description, reviews and comments in order, and a box to add one. */
export function PullConversation({
  pull,
  reviews,
  comments,
  onError,
  onSelectFile,
}: {
  pull: Pull;
  reviews: Review[];
  comments: ReviewComment[];
  onError: (e: unknown) => void;
  onSelectFile: (s: string) => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState(""),
    [busy, setBusy] = useState(false);
  const discussion = useInfiniteQuery({
    queryKey: ["discussion", pull.owner, pull.name, pull.number],
    queryFn: ({ pageParam }) => api.discussion(pull, pageParam),
    initialPageParam: 1,
    getNextPageParam: (p) => p.nextPage ?? undefined,
  });
  // Pages come oldest first; load them all so reviews interleave in order.
  useEffect(() => {
    if (discussion.hasNextPage && !discussion.isFetchingNextPage)
      void discussion.fetchNextPage();
  }, [discussion.hasNextPage, discussion.isFetchingNextPage, discussion.data]);
  const timeline = conversationTimeline(
    reviews,
    comments,
    discussion.data?.pages.flatMap((p) => p.items) ?? [],
  );
  return (
    <div className="conversation">
      <article className="discussion-card description">
        <div>
          <Avatar name={pull.user.login} />
          <strong>{pull.user.login}</strong>
          <span className="muted">opened this pull request</span>
        </div>
        <RichText text={pull.body || "No description provided."} />
      </article>
      {timeline.map((entry) =>
        entry.kind === "review" ? (
          <article
            className="discussion-card"
            key={`r${entry.review.id}`}
            data-review-state={entry.review.state}
          >
            <div>
              <Avatar name={entry.review.user?.login ?? "Team"} />
              <strong>{entry.review.user?.login ?? "Review team"}</strong>
              <span className="review-state">
                {reviewStateLabel(entry.review.state)}
                {entry.review.dismissed && ", dismissed"}
              </span>
              {entry.review.submitted_at && (
                <time>{timeAgo(entry.review.submitted_at)}</time>
              )}
            </div>
            {entry.review.body?.trim() && <RichText text={entry.review.body} />}
            {entry.comments.map((c) => (
              <section className="review-line-comment" key={`c${c.id}`}>
                <header>
                  <button
                    className="text-button"
                    onClick={() => onSelectFile(c.path)}
                  >
                    {c.path}:{c.position || c.original_position}
                  </button>
                  {c.commit_id !== pull.head.sha && (
                    <span className="muted">earlier revision</span>
                  )}
                  {c.resolver && <span className="muted">resolved</span>}
                  {c.user.login !== entry.review.user?.login && (
                    <strong>{c.user.login}</strong>
                  )}
                </header>
                <RichText text={c.body} />
              </section>
            ))}
          </article>
        ) : (
          <article className="discussion-card" key={`d${entry.comment.id}`}>
            <div>
              <Avatar name={entry.comment.user.login} />
              <strong>{entry.comment.user.login}</strong>
              <time>{timeAgo(entry.comment.created_at)}</time>
            </div>
            <RichText text={entry.comment.body} />
          </article>
        ),
      )}
      {discussion.isPending && <Loading />}
      {discussion.error && (
        <ErrorBox
          error={discussion.error}
          retry={() => void discussion.refetch()}
        />
      )}
      <form
        className="discussion-composer"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.comment(pull, body);
            setBody("");
            await qc.invalidateQueries({ queryKey: ["discussion"] });
          } catch (e) {
            onError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Add to the conversation
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Leave a comment…"
            rows={4}
          />
        </label>
        <button className="primary" disabled={!body.trim() || busy}>
          {busy ? "Posting…" : "Post comment"}
        </button>
      </form>
    </div>
  );
}
