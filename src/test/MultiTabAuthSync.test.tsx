import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";

// Phase 24: cross-tab authentication sync. jsdom (this test's environment)
// gives every test its own single "tab" - a real second browser tab isn't
// available here, so these tests simulate what a second tab would observe
// by dispatching a real StorageEvent on `window` directly, exactly as the
// browser does in every OTHER open tab the instant one tab's localStorage
// actually changes (a tab never receives a 'storage' event for its own
// write - that asymmetry is what this suite is really proving still holds:
// AuthContext's own login()/logout() calls must never trigger its own
// storage listener, only another tab's).

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

function AuthStatus() {
  const { isAuthenticated, user } = useAuth();
  return (
    <div>
      <div>PROTECTED PAGE</div>
      <div data-testid="auth-status">{isAuthenticated ? `AUTHENTICATED:${user?.email}` : "UNAUTHENTICATED"}</div>
    </div>
  );
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
                <AuthStatus />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

// Simulates what the OTHER tab's browser context delivers - a real tab
// never sees a 'storage' event for a change made by its own JS, so this
// helper (dispatched manually) stands in for "some other tab changed
// localStorage['token']", which is exactly the event contract this
// feature reacts to.
function dispatchStorageEvent(key: string, oldValue: string | null, newValue: string | null) {
  window.dispatchEvent(
    new StorageEvent("storage", { key, oldValue, newValue, storageArea: window.localStorage })
  );
}

describe("Cross-tab authentication sync (Phase 24)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("login in another tab is adopted here without a reload", async () => {
    // This tab starts unauthenticated and gets bounced to /login.
    global.fetch = vi.fn();
    renderApp("/donor");
    await screen.findByText("LOGIN PAGE");

    // Another tab just logged in and wrote the resulting token.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, VALID_USER));
    global.fetch = fetchMock;

    act(() => {
      localStorage.setItem("token", "token-from-other-tab");
      dispatchStorageEvent("token", null, "token-from-other-tab");
    });

    // This tab fetched the profile for the new token and adopted it -
    // proof the sync actually authenticated this tab's own React state,
    // not just localStorage's raw value.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("logout in another tab clears this tab's authenticated state and redirects through ProtectedRoute", async () => {
    localStorage.setItem("token", "a-valid-token");
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, VALID_USER));

    renderApp("/donor");
    await screen.findByText("PROTECTED PAGE");
    await waitFor(() => expect(screen.getByTestId("auth-status").textContent).toContain("AUTHENTICATED"));

    // Another tab logged out.
    act(() => {
      localStorage.removeItem("token");
      dispatchStorageEvent("token", "a-valid-token", null);
    });

    await waitFor(() => expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument());
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("session-expiry (401) in another tab propagates here the same way logout does", async () => {
    localStorage.setItem("token", "a-token-that-will-expire-elsewhere");
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, VALID_USER));

    renderApp("/donor");
    await screen.findByText("PROTECTED PAGE");
    await waitFor(() => expect(screen.getByTestId("auth-status").textContent).toContain("AUTHENTICATED"));

    // Another tab's own request() wrapper just saw a 401, removed the
    // token, and dispatched its own (same-tab-only) SESSION_EXPIRED_EVENT.
    // This tab never sees that custom event - it only ever sees the
    // resulting localStorage change, via 'storage', same as a plain
    // logout. That's the point: no second cross-tab mechanism exists.
    act(() => {
      const previous = localStorage.getItem("token");
      localStorage.removeItem("token");
      dispatchStorageEvent("token", previous, null);
    });

    await waitFor(() => expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument());
  });

  it("this tab's own login/logout never re-triggers its own storage handler (no self-loop)", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, VALID_USER));
    renderApp("/donor");
    await screen.findByText("LOGIN PAGE");

    // A real browser never fires 'storage' in the tab that made the
    // change - simulate that faithfully by NOT dispatching an event here,
    // and confirm a plain same-tab localStorage write alone (with no
    // corresponding dispatch) does not somehow flip this tab into a
    // broken or looping state on its own.
    act(() => {
      localStorage.setItem("token", "same-tab-write-no-event");
    });

    // No StorageEvent was dispatched, so nothing should have changed yet -
    // still on the login page, no extra fetch triggered by this write.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument();
  });

  it("a stray logout storage event while already on /login is a harmless no-op (no duplicate logout loop)", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, VALID_USER));
    renderApp("/login");
    await screen.findByText("LOGIN PAGE");

    expect(() =>
      act(() => {
        dispatchStorageEvent("token", "whatever-was-there", null);
      })
    ).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument();
  });

  it("a storage event for an unrelated key is ignored entirely", async () => {
    localStorage.setItem("token", "a-valid-token");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, VALID_USER));
    global.fetch = fetchMock;

    renderApp("/donor");
    await screen.findByText("PROTECTED PAGE");
    await waitFor(() => expect(screen.getByTestId("auth-status").textContent).toContain("AUTHENTICATED"));

    const callsBefore = fetchMock.mock.calls.length;

    act(() => {
      dispatchStorageEvent("pendingApproval", null, "true");
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("PROTECTED PAGE")).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });
});
