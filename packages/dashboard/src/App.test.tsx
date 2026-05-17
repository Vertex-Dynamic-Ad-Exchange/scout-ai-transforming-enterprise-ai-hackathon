import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";

const LT_URL = "http://localhost:8080/_lobstertrap/";

// Per-test QueryClient so React Query state never leaks across cases —
// shared `queryClient.ts` is the production singleton and a stale
// cache would couple e.g. PRP 03's empty-state test to PRP 05's
// happy-fetch test once they land.
function renderApp(): void {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 500 } },
  });
  render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>,
  );
}

describe("<App />", () => {
  beforeEach(() => {
    // import.meta.env.VITE_LOBSTERTRAP_URL drives the iframe src; stub
    // it here so the test is independent of the developer's .env file.
    vi.stubEnv("VITE_LOBSTERTRAP_URL", LT_URL);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the three-pane layout with the Lobster Trap iframe sourced from VITE_LOBSTERTRAP_URL (preserves foundation task 8 assertion)", () => {
    renderApp();
    expect(screen.getByTestId("pane-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("pane-drilldown")).toBeInTheDocument();
    expect(screen.getByTestId("pane-lobstertrap")).toBeInTheDocument();
    expect(screen.getByTitle(/lobster trap/i)).toHaveAttribute("src", LT_URL);
  });

  it("renders a loading skeleton before the iframe onLoad fires, then clears it", () => {
    renderApp();
    // Pre-load: skeleton text visible.
    expect(screen.getByText(/loading lobster trap audit ui/i)).toBeInTheDocument();
    // Simulate the browser firing iframe load. RTL has no real layout
    // engine so `onLoad` would never fire spontaneously in jsdom.
    fireEvent.load(screen.getByTitle(/lobster trap/i));
    expect(screen.queryByText(/loading lobster trap audit ui/i)).not.toBeInTheDocument();
  });

  it("swaps the iframe for an external fallback link when onError fires (D7 — no auto-retry)", () => {
    renderApp();
    fireEvent.error(screen.getByTitle(/lobster trap/i));
    const link = screen.getByRole("link", {
      name: /open lobster trap dashboard in new tab/i,
    });
    expect(link).toHaveAttribute("href", LT_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
    // The iframe must be gone — auto-retry would hide the underlying CSP /
    // availability bug (PRP 04 § Decisions D7).
    expect(screen.queryByTitle(/lobster trap/i)).not.toBeInTheDocument();
  });
});
