import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Footer from "@/components/Footer";

// Phase 16: proves the footer no longer links to About/Contact/Privacy/Terms
// (all 404'd - never registered in App.tsx) or to social accounts that
// don't exist (previously href="#"). Every link that remains must resolve
// to a real, registered route.

const REAL_ROUTES = ["/", "/how-it-works", "/login", "/register"];

function renderFooter() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Footer />
    </MemoryRouter>
  );
}

describe("Footer (Phase 16 truth pass)", () => {
  it("has no dead href=\"#\" links", () => {
    renderFooter();
    const anchors = screen.queryAllByRole("link").filter((el) => el.tagName === "A");
    for (const a of anchors) {
      expect(a.getAttribute("href")).not.toBe("#");
    }
  });

  it("does not link to About, Contact, Privacy, or Terms", () => {
    renderFooter();
    expect(screen.queryByRole("link", { name: /^about$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^contact$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /privacy policy/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^terms$/i })).not.toBeInTheDocument();
  });

  it("does not link to any social platform", () => {
    renderFooter();
    expect(screen.queryByRole("link", { name: /twitter|linkedin|instagram/i })).not.toBeInTheDocument();
  });

  it("every rendered link points to a real, registered route", () => {
    renderFooter();
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const href = link.getAttribute("href") ?? "";
      expect(REAL_ROUTES).toContain(href);
    }
  });
});
