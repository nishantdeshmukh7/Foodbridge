import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import Login from "@/pages/Login";
import { destinationFor } from "@/components/NotificationBell";

// Phase 21: audited every navigate()/<Navigate> call site in this app
// (App.tsx, ProtectedRoute.tsx, Login.tsx, Register.tsx, NotificationBell.tsx,
// DashboardLayout.tsx, RegistrationRejected.tsx, PendingApproval.tsx) -
// every single one passes either a hardcoded literal path, or a string
// derived from a closed enum (user.role, one of ADMIN/DONOR/NGO/VOLUNTEER;
// notification.type, a fixed switch/lookup). None reads a free-text,
// attacker-influenceable value (a query param, location.state, a URL
// fragment) into a navigation target anywhere in the codebase. This is
// what actually matters for exploitability of the react-router-dom
// open-redirect advisories (GHSA-jjmj-jmhj-qwj2, fixed by upgrading to
// 6.30.6; GHSA-wrjc-x8rr-h8h6, a bypass affecting the whole 6.x/7.x line,
// tracked as a remaining risk pending a major-version upgrade) - a library
// bug in how <Link>/useNavigate handle a hostile string is only reachable
// if the application ever hands one to them, and this app never does.

const VALID_USER = {
  id: "user-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  isApproved: true,
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function DonorDashboardSentinel() {
  return <div>DONOR DASHBOARD</div>;
}

describe("Redirect safety (Phase 21)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("a malicious location.state.from is never used as the post-login redirect target - login always goes to the real role dashboard", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { user: VALID_USER, token: "a-real-token" }));
    global.fetch = fetchMock;

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/login",
            // Simulates the shape ProtectedRoute's own redirect sets, but
            // with an attacker-hostile value in the one field a "return to
            // where you were" feature would plausibly read - proves it
            // has no effect regardless of what it contains.
            state: { from: { pathname: "https://evil.example.com/steal-session" } },
          },
        ]}
      >
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/donor" element={<DonorDashboardSentinel />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "donor@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(screen.getByText("DONOR DASHBOARD")).toBeInTheDocument());

    // The test would already have failed above had it navigated off-app;
    // this is the explicit, named assertion of that.
    expect(window.location.href).not.toContain("evil.example.com");
  });

  it("NotificationBell's destinationFor() produces only plain internal paths for every role/type this app's authenticated sessions can actually have", () => {
    const roles = ["donor", "ngo", "volunteer", "admin", "DONOR", "NGO", "VOLUNTEER", "ADMIN"];
    const types = [
      "DONATION_CLAIMED",
      "DONATION_CANCELLED",
      "DONATION_RELEASED",
      "PICKUP_ASSIGNED",
      "PICKUP_ACCEPTED",
      "PICKUP_STARTED",
      "DELIVERY_COMPLETED",
      "USER_APPROVED",
      "USER_REJECTED",
      "USER_SUSPENDED",
      "USER_REACTIVATED",
      "PASSWORD_RESET",
    ] as const;

    for (const role of roles) {
      for (const type of types) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const destination = destinationFor(type as any, role);
        if (destination === null) continue;

        expect(destination.startsWith("/")).toBe(true);
        expect(destination.startsWith("//")).toBe(false);
        expect(destination).not.toMatch(/^\/\\/);
        expect(destination).not.toContain("://");
        expect(destination).not.toContain("\\");
      }
    }
  });
});
