import type { OpenCodeAuthProvider } from "../../../shared/opencode-auth";
import { api } from "../../lib/api";
import { ErrorBox, Modal, Spinner } from "../../ui/ui";
import { useOpenCodeSignIn } from "./useOpenCodeSignIn";
import "./opencode-sign-in.css";

/** Provider credentials are entered here and saved by OpenCode, never in Relay's settings. */
export function OpenCodeSignIn({
  directory,
  onClose,
}: {
  directory?: string;
  onClose: () => void;
}) {
  const {
    catalog,
    provider,
    method,
    answers,
    setAnswers,
    key,
    setKey,
    code,
    setCode,
    busy,
    error,
    setError,
    attempt,
    connected,
    polling,
    setPolling,
    setPollVersion,
    setProviderId,
    setMethodId,
    connect,
    cancelAttempt,
    completeCode,
    refreshConnections,
  } = useOpenCodeSignIn(directory);

  return (
    <Modal
      title="Connect an OpenCode provider"
      onClose={onClose}
      className="opencode-sign-in"
    >
      <div className="opencode-sign-in-body">
        <p className="muted">
          Connect the provider serving your model. DeepSeek Free uses OpenCode
          Console.
        </p>
        {connected ? (
          <>
            <p role="status">
              Connected to {connected}. Resume the answer when you’re ready.
            </p>
            <button type="button" className="primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : attempt ? (
          <>
            <p className="opencode-sign-in-instructions">
              {attempt.instructions}
            </p>
            <button
              type="button"
              onClick={() => void api.openExternal(attempt.url).catch(setError)}
            >
              Open sign-in page
            </button>
            {attempt.mode === "code" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void completeCode();
                }}
              >
                <label>
                  Authorization code
                  <input
                    autoComplete="off"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </label>
                <button className="primary" disabled={busy || !code.trim()}>
                  Complete sign-in
                </button>
              </form>
            ) : (
              <p role="status">
                {polling
                  ? "Waiting for you to finish in your browser…"
                  : "Sign-in check paused."}
              </p>
            )}
            {!polling && attempt.mode === "auto" && (
              <button
                type="button"
                onClick={() => {
                  setError(undefined);
                  setPolling(true);
                  setPollVersion((v) => v + 1);
                }}
              >
                Check again
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void cancelAttempt()}
            >
              Cancel sign-in
            </button>
          </>
        ) : (
          <>
            {catalog.isFetching && (
              <p role="status">
                <Spinner /> Loading providers…
              </p>
            )}
            {catalog.error && (
              <ErrorBox
                error={catalog.error}
                retry={() => void catalog.refetch()}
              />
            )}
            {catalog.data && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void connect();
                }}
              >
                <label>
                  Provider
                  <select
                    value={provider?.id ?? ""}
                    disabled={busy}
                    onChange={(e) => {
                      setProviderId(e.target.value);
                      setMethodId(undefined);
                      setAnswers({});
                      setKey("");
                      setError(undefined);
                    }}
                  >
                    {catalog.data.map((p: OpenCodeAuthProvider) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.connected ? " · saved connection" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {method && (
                  <>
                    <label>
                      Sign-in method
                      <select
                        value={method.id}
                        disabled={busy}
                        onChange={(e) => {
                          setMethodId(e.target.value);
                          setAnswers({});
                          setKey("");
                          setError(undefined);
                        }}
                      >
                        {provider?.methods.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {method.unavailable ? (
                      <p>{method.unavailable}</p>
                    ) : (
                      <>
                        {method.fields
                          .filter((f) => !f.hidden)
                          .map((f) => (
                            <label key={f.key}>
                              {f.title}
                              {f.options ? (
                                <select
                                  value={answers[f.key] ?? f.default ?? ""}
                                  required={f.required}
                                  disabled={busy}
                                  onChange={(e) =>
                                    setAnswers({
                                      ...answers,
                                      [f.key]: e.target.value,
                                    })
                                  }
                                >
                                  <option value="">Choose…</option>
                                  {f.options.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  value={answers[f.key] ?? f.default ?? ""}
                                  required={f.required}
                                  disabled={busy}
                                  onChange={(e) =>
                                    setAnswers({
                                      ...answers,
                                      [f.key]: e.target.value,
                                    })
                                  }
                                />
                              )}
                              {f.description && (
                                <small className="muted">{f.description}</small>
                              )}
                            </label>
                          ))}
                        {method.type === "key" && (
                          <label>
                            API key
                            <input
                              type="password"
                              autoComplete="off"
                              value={key}
                              disabled={busy}
                              onChange={(e) => setKey(e.target.value)}
                              required
                            />
                          </label>
                        )}
                      </>
                    )}
                    <button
                      className="primary"
                      disabled={busy || !!method.unavailable}
                    >
                      {busy
                        ? "Connecting…"
                        : method.type === "oauth"
                          ? "Continue in browser"
                          : "Save connection"}
                    </button>
                  </>
                )}
                {!method && (
                  <p>No supported sign-in methods were offered by OpenCode.</p>
                )}
              </form>
            )}
            <button
              type="button"
              disabled={busy || catalog.isFetching}
              onClick={() => void refreshConnections()}
            >
              Refresh connections
            </button>
            <small className="muted">
              Already signed in elsewhere? Refresh, then close this dialog and
              resume the answer.
            </small>
          </>
        )}
        {!!error && <ErrorBox error={error} />}
      </div>
    </Modal>
  );
}
