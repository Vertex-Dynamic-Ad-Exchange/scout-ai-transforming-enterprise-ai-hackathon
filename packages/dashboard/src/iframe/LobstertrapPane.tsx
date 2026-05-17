import { useEffect, useRef, useState } from "react";

/**
 * Embeds the operator-run Lobster Trap dashboard
 * (`./lobstertrap/serve.sh` → `http://localhost:8080/_lobstertrap/`) in
 * an iframe sandboxed to its own origin (D6, feature spec line 128).
 *
 * The sandbox tokens are EXACTLY two: `allow-same-origin allow-scripts`.
 * Do NOT add `allow-top-navigation`, `allow-popups`, or
 * `allow-popups-to-escape-sandbox` — a compromised Lobster Trap UI must
 * not redirect or escape the parent (PRP 04 anti-patterns).
 *
 * `error` is handled via a native `addEventListener` on the iframe
 * (not React's `onError` prop) because React's synthetic event system
 * does not dispatch `error` for HTMLIFrameElement — the prop silently
 * never fires, even in production browsers. The native handler swaps
 * the iframe for a fallback link rather than retrying (D7); auto-retry
 * would hide the underlying CSP / availability bug. The fallback opens
 * in a new tab with `rel="noopener noreferrer"` to prevent opener
 * leak (PRP 04 § Security guardrails).
 *
 * `onLoad` clears a skeleton placeholder (feature spec gotcha 172):
 * the iframe takes ~500ms to load on a cold demo machine and the
 * "pop-in" reads as broken to a judge.
 */
export function LobstertrapPane(): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLIFrameElement | null>(null);
  const url = import.meta.env.VITE_LOBSTERTRAP_URL;

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onError = (): void => setError(true);
    el.addEventListener("error", onError);
    return () => el.removeEventListener("error", onError);
  }, []);

  if (error) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="lobstertrap-fallback-link"
      >
        Open Lobster Trap dashboard in new tab
      </a>
    );
  }

  return (
    <>
      {!loaded && <p data-testid="lobstertrap-skeleton">Loading Lobster Trap audit UI…</p>}
      <iframe
        ref={ref}
        title="Lobster Trap audit"
        src={url}
        sandbox="allow-same-origin allow-scripts"
        onLoad={() => setLoaded(true)}
        style={{
          width: "100%",
          height: "100%",
          border: 0,
          display: loaded ? "block" : "none",
        }}
      />
    </>
  );
}
