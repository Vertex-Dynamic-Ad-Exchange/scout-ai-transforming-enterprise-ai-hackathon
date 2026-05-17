import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { EvidenceTile } from "./EvidenceTile.js";
import { base64url } from "./util/base64url.js";

function mockFetchTextOnce(text: string, ok = true): void {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok,
    text: async () => text,
  }) as unknown as typeof fetch;
}

function mockFetchNetworkFailure(): void {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: false,
    text: async () => "",
  }) as unknown as typeof fetch;
}

describe("EvidenceTile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("kind=screenshot renders <img loading='lazy'> against the proxy URL (happy)", () => {
    render(
      <EvidenceTile
        evidence={{ kind: "screenshot", uri: "s3://internal-bucket/path/secret.png" }}
      />,
    );
    const tile = screen.getByTestId("evidence-tile");
    const img = tile.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img!.getAttribute("src")).toMatch(/^\/api\/evidence\//);
  });

  it("kind=video_frame uses the same proxied <img> shape (edge — another binary kind)", () => {
    render(
      <EvidenceTile evidence={{ kind: "video_frame", uri: "s3://x/y.mp4#t=12" }} />,
    );
    const img = screen.getByTestId("evidence-tile").querySelector("img");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("never renders the original URI — only the /api/evidence/<b64url> path", () => {
    const uri = "s3://internal-bucket/path/secret.png";
    render(<EvidenceTile evidence={{ kind: "screenshot", uri }} />);
    expect(document.body.innerHTML).not.toMatch(/s3:\/\//);
    expect(document.body.innerHTML).not.toMatch(/internal-bucket/);
  });

  it("encodes the proxy URL path with base64url (no +, /, = in path segment)", () => {
    const uri = "file:///tmp/x.png?foo=bar+baz/qux";
    const expected = base64url(uri);
    render(<EvidenceTile evidence={{ kind: "screenshot", uri }} />);
    const src = screen.getByTestId("evidence-tile").querySelector("img")!.getAttribute("src")!;
    const pathSegment = src.slice("/api/evidence/".length);
    expect(pathSegment).toBe(expected);
    expect(pathSegment).not.toMatch(/[+/=]/);
  });

  it("kind=dom_snippet fetches text via the proxy and renders inside <pre> (happy)", async () => {
    mockFetchTextOnce("<div>hello</div>");
    render(
      <EvidenceTile evidence={{ kind: "dom_snippet", uri: "s3://bucket/snip.html" }} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("evidence-snippet")).toHaveTextContent("<div>hello</div>");
    });
    expect(screen.getByTestId("evidence-snippet").tagName.toLowerCase()).toBe("pre");
  });

  it("XSS pin: dom_snippet containing a <script> tag renders as text, never as a DOM <script> element", async () => {
    mockFetchTextOnce("</pre><script>window.__xss=1</script>");
    render(
      <EvidenceTile evidence={{ kind: "dom_snippet", uri: "s3://bucket/snip.html" }} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("evidence-snippet").textContent).toContain("<script>");
    });
    // The literal text contains <script>, but NO <script> element was
    // actually created — the no-XSS contract.
    const tile = screen.getByTestId("evidence-tile");
    expect(tile.querySelector("script")).toBeNull();
    expect((globalThis as { __xss?: number }).__xss).toBeUndefined();
  });

  it("kind=dom_snippet renders '[unavailable]' when the proxy responds non-OK (failure)", async () => {
    mockFetchNetworkFailure();
    render(
      <EvidenceTile evidence={{ kind: "dom_snippet", uri: "s3://bucket/snip.html" }} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("evidence-snippet")).toHaveTextContent(
        "[unavailable]",
      );
    });
    // Also pins: error text must not be the raw URI.
    expect(screen.getByTestId("evidence-snippet").textContent).not.toMatch(/s3:\/\//);
  });

  it("the disclosure trigger is a <button>, never <a href> (raw-URI leak guard)", () => {
    render(<EvidenceTile evidence={{ kind: "screenshot", uri: "s3://x/y.png" }} />);
    const tile = screen.getByTestId("evidence-tile");
    expect(tile.tagName.toLowerCase()).toBe("button");
    expect(tile.querySelector("a")).toBeNull();
  });
});

describe("base64url util", () => {
  it("round-trips file:///tmp/x.png to a path-safe alphabet", () => {
    const encoded = base64url("file:///tmp/x.png");
    expect(encoded).not.toMatch(/[+/=]/);
    // Decoding manually: base64url → base64
    const pad = "=".repeat((4 - (encoded.length % 4)) % 4);
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/") + pad;
    expect(atob(b64)).toBe("file:///tmp/x.png");
  });
});
