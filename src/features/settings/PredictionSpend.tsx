import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { share, usd } from "./WatchSpend";

/** What the guesses spent this past week, and how often one was what got sent. */
export function PredictionSpendLine() {
  const { data } = useQuery({
    queryKey: ["prediction-spend"],
    queryFn: () => api.predictionSpend(),
  });
  if (!data?.asked)
    return (
      <p className="prediction-cost">
        Nothing asked this past week · one question per turn that did some work,
        mostly read from the thread&apos;s prompt cache
      </p>
    );
  const part = share(data.usd, data.threadUsd);
  const measured = data.asked - data.unmeasured;
  return (
    <p
      className="prediction-cost"
      title="Dollars and the share are at API list prices. On a subscription the guesses come out of your plan's usage instead; the share is only an estimate of how much of it."
    >
      Last {data.days} days · {data.offered} of {data.asked} asked came back as
      a guess · {data.taken} of {data.sentAfter} messages sent were the guess as
      is
      {measured > 0 && ` · ${usd(data.usd)} at API prices`}
      {measured > 0 && part && ` · ${part} of what those threads used`}
      {data.backingOff &&
        " · Guessing less: the last 20 weren't used. Send one to bring them back."}
    </p>
  );
}
