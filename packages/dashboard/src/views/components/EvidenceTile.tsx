import { useEffect, useState } from "react";
import type { EvidenceRef } from "@scout/shared";
import { base64url } from "./util/base64url.js";

/**
 * One evidence tile (PRP 06 Task 3). Branches on `EvidenceRef.kind`:
 * `screenshot` and `video_frame` render `<img loading="lazy">` against
 * the backend proxy URL; `dom_snippet` renders a `<pre>` with the text
 * fetched from the same proxy.
 *
 * Security pins (PRP 06 § Security guardrails):
 *   - The original `uri` (which may be `s3://internal-bucket/...` or a
 *     signed URL) NEVER appears in the DOM. Only `/api/evidence/<b64>`
 *     is rendered.
 *   - `dom_snippet` text is rendered as a `<pre>` child. React escapes
 *     text children, so `</pre><script>alert(1)</script>` cannot
 *     construct a `<script>` element. Do NOT switch to
 *     `dangerouslySetInnerHTML` — the no-script pin in the test suite
 *     catches that regression.
 *   - The disclosure trigger is a `<button>`, not an `<a>` — right
 *     click / view-source on an anchor leaks the URI even when the
 *     click handler blocks navigation.
 */

const PROXY_BASE = "/api/evidence";

export interface EvidenceTileProps {
  evidence: EvidenceRef;
}

interface SnippetState {
  text: string | null;
  error: boolean;
  loading: boolean;
}

function useEvidenceSnippet(src: string): SnippetState {
  const [state, setState] = useState<SnippetState>({
    text: null,
    error: false,
    loading: true,
  });
  useEffect(() => {
    let cancelled = false;
    setState({ text: null, error: false, loading: true });
    (async (): Promise<void> => {
      try {
        const res = await fetch(src, { credentials: "same-origin" });
        if (!res.ok) {
          if (!cancelled) setState({ text: null, error: true, loading: false });
          return;
        }
        const text = await res.text();
        if (!cancelled) setState({ text, error: false, loading: false });
      } catch {
        if (!cancelled) setState({ text: null, error: true, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);
  return state;
}

const tileButtonStyle = {
  display: "inline-block",
  padding: 0,
  border: "1px solid #e5e5e5",
  background: "white",
  cursor: "pointer",
} as const;

const thumbImgStyle = {
  width: 96,
  height: 72,
  objectFit: "cover" as const,
  display: "block",
};

const expandedImgStyle = {
  maxWidth: "100%",
  maxHeight: 480,
  display: "block",
};

export function EvidenceTile({ evidence }: EvidenceTileProps): JSX.Element {
  const encoded = base64url(evidence.uri);
  const src = `${PROXY_BASE}/${encoded}`;
  const [expanded, setExpanded] = useState(false);

  if (evidence.kind === "dom_snippet") {
    return <DomSnippetTile src={src} expanded={expanded} setExpanded={setExpanded} />;
  }

  const altText = evidence.kind === "video_frame" ? "video frame" : "screenshot";
  return (
    <button
      type="button"
      data-testid="evidence-tile"
      data-evidence-kind={evidence.kind}
      aria-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
      style={tileButtonStyle}
    >
      <img
        loading="lazy"
        src={src}
        alt={altText}
        style={expanded ? expandedImgStyle : thumbImgStyle}
        data-expanded={expanded}
      />
    </button>
  );
}

interface DomSnippetTileProps {
  src: string;
  expanded: boolean;
  setExpanded: (fn: (v: boolean) => boolean) => void;
}

function DomSnippetTile({
  src,
  expanded,
  setExpanded,
}: DomSnippetTileProps): JSX.Element {
  const { text, error } = useEvidenceSnippet(src);
  return (
    <button
      type="button"
      data-testid="evidence-tile"
      data-evidence-kind="dom_snippet"
      aria-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
      style={tileButtonStyle}
    >
      <pre
        data-testid="evidence-snippet"
        data-expanded={expanded}
        style={{
          margin: 0,
          padding: "4px 6px",
          maxWidth: expanded ? "100%" : 200,
          maxHeight: expanded ? 320 : 60,
          overflow: "hidden",
          fontSize: 11,
          textAlign: "left",
          whiteSpace: "pre-wrap",
        }}
      >
        {error ? "[unavailable]" : (text ?? "")}
      </pre>
    </button>
  );
}
