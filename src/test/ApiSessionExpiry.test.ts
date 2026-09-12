import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Phase 20: unit-level coverage of request()'s session-expiry dispatch
// condition in src/api/index.ts, isolated from React/routing entirely.
// See AuthSessionExpiry.test.tsx for the integration-level test proving
// AuthContext + ProtectedRoute react to this correctly end to end.

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("api request() session-expiry dispatch (Phase 20)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("token present + 401 -> dispatches session-expired and clears the token", async () => {
    localStorage.setItem("token", "some-token");
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(401, { error: "Invalid or expired token" }));

    const { SESSION_EXPIRED_EVENT, donationsApi } = await import("@/api");
    const listener = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    await expect(donationsApi.getMyDonations()).rejects.toThrow();

    expect(listener).toHaveBeenCalledOnce();
    expect(localStorage.getItem("token")).toBeNull();

    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it("no token + 401 (e.g. a failed login attempt) -> does NOT dispatch session-expired", async () => {
    // No token in localStorage - matches a login attempt with wrong
    // credentials, which returns 401 but was never carrying a session.
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(401, { error: "Invalid email or password" }));

    const { SESSION_EXPIRED_EVENT, authApi } = await import("@/api");
    const listener = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    await expect(authApi.login("wrong@example.com", "wrongpass")).rejects.toThrow();

    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it("token present + 403 -> does NOT dispatch session-expired (authorization failure, not expiry)", async () => {
    localStorage.setItem("token", "some-token");
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(403, { error: "Not authorized" }));

    const { SESSION_EXPIRED_EVENT, donationsApi } = await import("@/api");
    const listener = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    await expect(donationsApi.getMyDonations()).rejects.toThrow();

    expect(listener).not.toHaveBeenCalled();
    expect(localStorage.getItem("token")).toBe("some-token");

    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it("token present + 500 -> does NOT dispatch session-expired (server error, not token invalidity)", async () => {
    localStorage.setItem("token", "some-token");
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(500, { error: "Internal server error" }));

    const { SESSION_EXPIRED_EVENT, donationsApi } = await import("@/api");
    const listener = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    await expect(donationsApi.getMyDonations()).rejects.toThrow();

    expect(listener).not.toHaveBeenCalled();
    expect(localStorage.getItem("token")).toBe("some-token");

    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it("token present + 400 -> does NOT dispatch session-expired (ordinary validation error)", async () => {
    localStorage.setItem("token", "some-token");
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(400, { error: "Missing required fields" }));

    const { SESSION_EXPIRED_EVENT, donationsApi } = await import("@/api");
    const listener = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    await expect(donationsApi.getMyDonations()).rejects.toThrow();

    expect(listener).not.toHaveBeenCalled();
    expect(localStorage.getItem("token")).toBe("some-token");

    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });
});
