import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { donationsApi } from "@/api";

// Phase 20: integration-level proof that AuthContext + ProtectedRoute react
// correctly, together, to a real 401 from the real request() wrapper - not
// a mocked stand-in for either. Only global.fetch is mocked; @/api,
// AuthContext, and ProtectedRoute are all the genuine implementations.

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const VALID_USER = {
  id: "user-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  isApproved: true,
};

function LoginSentinel() {
  return <div>LOGIN PAGE</div>;
}

// Mimics a real dashboard page: fetches its own data on mount, through the
// real API layer, same as every actual dashboard page in this app does.
function ProtectedPage() {
  useEffect(() => {
    donationsApi.getMyDonations().catch(() => {
      // Real pages show a toast here - irrelevant to what this test
      // proves, which is what happens to the session/route as a result.
    });
  }, []);
  return <div>PROTECTED PAGE</div>;
}

function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginSentinel />} />
          <Route
            path="/donor"
            element={
              <ProtectedRoute allowedRoles={["DONOR"]}>
                <ProtectedPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("Global 401 / session-expiry handling (Phase 20)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("authenticated request -> 401 -> session is cleared and the app redirects to /login", async () => {
    localStorage.setItem("token", "a-token-that-will-expire");

    const fetchMock = vi
      .fn()
      // AuthContext's initAuth() profile check on mount
      .mockResolvedValueOnce(jsonResponse(200, VALID_USER))
      // ProtectedPage's own data fetch, which the "expired" token fails
      .mockResolvedValueOnce(jsonResponse(401, { error: "Invalid or expired token" }));
    global.fetch = fetchMock;

    renderApp("/donor");

    // Confirms the initial authenticated render actually happened - this
    // test is proving what happens *after* a valid session goes stale, not
    // just that an unauthenticated visitor gets bounced.
    await screen.findByText("PROTECTED PAGE");

    await waitFor(() => expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument());
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("403 on a protected page does not log the user out or redirect", async () => {
    localStorage.setItem("token", "a-valid-token");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, VALID_USER))
      .mockResolvedValueOnce(jsonResponse(403, { error: "Not authorized" }));
    global.fetch = fetchMock;

    renderApp("/donor");

    await screen.findByText("PROTECTED PAGE");
    // Give the rejected fetch a tick to resolve and any (incorrect) redirect
    // a chance to happen before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getByText("PROTECTED PAGE")).toBeInTheDocument();
    expect(screen.queryByText("LOGIN PAGE")).not.toBeInTheDocument();
    expect(localStorage.getItem("token")).toBe("a-valid-token");
  });

  it("500 on a protected page does not log the user out or redirect", async () => {
    localStorage.setItem("token", "a-valid-token");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, VALID_USER))
      .mockResolvedValueOnce(jsonResponse(500, { error: "Internal server error" }));
    global.fetch = fetchMock;

    renderApp("/donor");

    await screen.findByText("PROTECTED PAGE");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getByText("PROTECTED PAGE")).toBeInTheDocument();
    expect(screen.queryByText("LOGIN PAGE")).not.toBeInTheDocument();
    expect(localStorage.getItem("token")).toBe("a-valid-token");
  });

  it("no redirect loop: the session-expired event on a page with no ProtectedRoute (e.g. already on /login) is a harmless no-op", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, VALID_USER));
    global.fetch = fetchMock;

    renderApp("/login");

    await screen.findByText("LOGIN PAGE");

    // Dispatched directly, simulating a stray/late 401 arriving while the
    // user is already on the login page - there is no navigate() call
    // anywhere in this implementation (see AuthContext.tsx's comment), so
    // this can only ever clear state, never loop or throw.
    const { SESSION_EXPIRED_EVENT } = await import("@/api");
    expect(() => act(() => window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)))).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument();
  });
});
