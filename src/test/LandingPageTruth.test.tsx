import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Index from "@/pages/Index";
import HowItWorks from "@/pages/HowItWorks";

// Phase 16: proves the public landing page and How It Works page no longer
// make the fabricated claims the Phase 9 audit found - a fake "live"
// dispatch feed, invented impact numbers, fictional named testimonials,
// and How It Works claims about capabilities (5km radius alerts, automated
// matching, photo/signature capture, guaranteed pickup times, volunteer
// reimbursements) that don't exist in this codebase. Also proves the real,
// working navigation survived the cleanup.

function renderIndex() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Index />
    </MemoryRouter>
  );
}

function renderHowItWorks() {
  render(
    <MemoryRouter initialEntries={["/how-it-works"]}>
      <HowItWorks />
    </MemoryRouter>
  );
}

describe("Landing page (Phase 16 truth pass)", () => {
  it("does not render a fake live activity feed", () => {
    renderIndex();
    expect(screen.queryByText(/active dispatch/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/hotel saravana/i)).not.toBeInTheDocument();
    expect(document.querySelector(".animate-pulse")).not.toBeInTheDocument();
  });

  it("does not render fabricated numeric impact stats", () => {
    renderIndex();
    expect(screen.queryByText("124,580")).not.toBeInTheDocument();
    expect(screen.queryByText("48,200")).not.toBeInTheDocument();
    expect(screen.queryByText(/meals saved/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ngos connected/i)).not.toBeInTheDocument();
  });

  it("does not render fictional named testimonials", () => {
    renderIndex();
    expect(screen.queryByText(/priya sharma/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/amit desai/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rahul nair/i)).not.toBeInTheDocument();
  });

  it("does not claim an automated/distance-based matching engine", () => {
    renderIndex();
    expect(screen.queryByText(/automated allocation engine/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/5 ?km/i)).not.toBeInTheDocument();
  });

  it("keeps working navigation to Login and Register", () => {
    renderIndex();
    const loginLinks = screen.getAllByRole("link", { name: /login|sign in/i });
    expect(loginLinks.some((l) => l.getAttribute("href") === "/login")).toBe(true);
    const registerLinks = screen.getAllByRole("link", { name: /register|create account|get started/i });
    expect(registerLinks.some((l) => l.getAttribute("href") === "/register")).toBe(true);
  });
});

describe("How It Works page (Phase 16 truth pass)", () => {
  it("does not claim a 5km radius, automated matching, or navigation/real-time tracking", () => {
    renderHowItWorks();
    expect(screen.queryByText(/5 ?km/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/automated volunteer matching/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/real-time tracking/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/navigation to (pickup|delivery) location/i)).not.toBeInTheDocument();
  });

  it("does not claim photo documentation or digital/recipient signature capture", () => {
    renderHowItWorks();
    expect(screen.queryByText(/photo documentation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/photo proof of delivery/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/digital signature/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/recipient signature/i)).not.toBeInTheDocument();
  });

  it("does not claim a guaranteed pickup-time SLA or volunteer reimbursements", () => {
    renderHowItWorks();
    expect(screen.queryByText(/30-45 minutes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reimbursement/i)).not.toBeInTheDocument();
  });

  it("does not render a fabricated contact email or phone number", () => {
    renderHowItWorks();
    expect(screen.queryByText("support@foodbridge.com")).not.toBeInTheDocument();
    expect(screen.queryByText(/\+91 98765 43210/)).not.toBeInTheDocument();
  });

  it("attributes the safety checklist to the donor, matching the real listing-time checklist", () => {
    renderHowItWorks();
    expect(screen.getByText("Food prepared in hygienic conditions")).toBeInTheDocument();
    expect(screen.getByText("Stored at proper temperature")).toBeInTheDocument();
    expect(screen.getByText("No signs of spoilage")).toBeInTheDocument();
    expect(screen.getByText("Packed in clean containers")).toBeInTheDocument();
  });
});
