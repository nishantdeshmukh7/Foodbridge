import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Index from "@/pages/Index";
import HowItWorks from "@/pages/HowItWorks";

// Phase 16: the public landing and How It Works pages must not fetch donor
// email/phone, private locations, NGO-only info, or admin analytics just to
// populate marketing content - none of that exists on these pages, and this
// proves it by asserting the pages never call the network at all while
// unauthenticated.

describe("Public pages make no API requests (Phase 16)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("landing page makes zero fetch calls", () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() => {
      throw new Error("Landing page should not call fetch");
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Index />
      </MemoryRouter>
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("How It Works page makes zero fetch calls", () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() => {
      throw new Error("How It Works page should not call fetch");
    });

    render(
      <MemoryRouter initialEntries={["/how-it-works"]}>
        <HowItWorks />
      </MemoryRouter>
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
