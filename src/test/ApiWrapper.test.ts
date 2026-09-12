import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Phase 21: exercises the real request() implementation in src/api/index.ts
// through its actual exported API functions - only global.fetch is mocked
// (the network boundary), never the wrapper itself. Phase 20 already added
// dedicated coverage of the session-expiry dispatch condition
// (ApiSessionExpiry.test.ts); this file covers the rest of the wrapper's
// contract: success parsing, the full error-status matrix, header
// attachment, credential-leak safety, and error-body parsing robustness.

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function nonJsonResponse(status: number, text: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError(`Unexpected token in JSON: ${text}`);
    },
  } as Response;
}

describe("api request() wrapper - real implementation (Phase 21)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("success path", () => {
    it("parses and returns a JSON response body", async () => {
      const { authApi } = await import("@/api");
      const profile = {
        id: "u1",
        email: "donor@example.com",
        name: "Test Donor",
        role: "DONOR",
        isApproved: true,
      };
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, profile));
      localStorage.setItem("token", "valid-token");

      const result = await authApi.getProfile();

      expect(result).toEqual(profile);
    });

    it("parses an array JSON response correctly (e.g. a donations list)", async () => {
      const { donationsApi } = await import("@/api");
      const donations = [{ id: "d1", foodType: "Rice" }, { id: "d2", foodType: "Bread" }];
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, donations));

      const result = await donationsApi.getAll();

      expect(result).toEqual(donations);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("error status matrix", () => {
    const cases: Array<{ status: number; error: string }> = [
      { status: 400, error: "Missing required fields" },
      { status: 401, error: "Invalid or expired token" },
      { status: 403, error: "Not authorized" },
      { status: 404, error: "Donation not found" },
      { status: 500, error: "Internal server error" },
    ];

    for (const { status, error } of cases) {
      it(`status ${status}: throws with the server's error message and that exact status`, async () => {
        const { donationsApi } = await import("@/api");
        global.fetch = vi.fn().mockResolvedValue(jsonResponse(status, { error }));

        await expect(donationsApi.getAll()).rejects.toMatchObject({
          status,
          message: error,
        });
      });
    }
  });

  describe("error body parsing", () => {
    it("a malformed/non-JSON error response falls back to a sensible generic message instead of throwing an unrelated parse error", async () => {
      const { donationsApi } = await import("@/api");
      global.fetch = vi.fn().mockResolvedValue(nonJsonResponse(500, "<html>502 Bad Gateway</html>"));

      await expect(donationsApi.getAll()).rejects.toMatchObject({
        status: 500,
        message: "Request failed",
      });
    });

    it("a JSON error body missing the expected `error` field still falls back to a sensible message", async () => {
      const { donationsApi } = await import("@/api");
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(400, { unexpected: "shape" }));

      await expect(donationsApi.getAll()).rejects.toMatchObject({
        status: 400,
        message: "Request failed",
      });
    });
  });

  describe("Authorization header", () => {
    it("attaches Authorization: Bearer <token> when a token is present in localStorage", async () => {
      const { authApi } = await import("@/api");
      localStorage.setItem("token", "my-real-session-token");
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse(200, { id: "u1", email: "x@example.com", name: "X", role: "DONOR", isApproved: true })
      );
      global.fetch = fetchMock;

      await authApi.getProfile();

      const [, init] = fetchMock.mock.calls[0];
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: "Bearer my-real-session-token",
      });
    });

    it("attaches no Authorization header at all when unauthenticated", async () => {
      const { donationsApi } = await import("@/api");
      // No token set in localStorage.
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
      global.fetch = fetchMock;

      await donationsApi.getAll();

      const [, init] = fetchMock.mock.calls[0];
      expect((init as RequestInit).headers).not.toHaveProperty("Authorization");
    });
  });

  describe("credential safety", () => {
    it("the token never appears in a thrown error's message, even on failure", async () => {
      const { donationsApi } = await import("@/api");
      const secretToken = "super-secret-session-token-xyz";
      localStorage.setItem("token", secretToken);
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(403, { error: "Not authorized" }));

      try {
        await donationsApi.getAll();
        expect.fail("expected donationsApi.getAll() to throw");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(secretToken);
      }
    });

    it("the token is sent only in the Authorization header, never in the request body or URL", async () => {
      const { donationsApi } = await import("@/api");
      const secretToken = "super-secret-session-token-xyz";
      localStorage.setItem("token", secretToken);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
      global.fetch = fetchMock;

      await donationsApi.getAll({ status: "AVAILABLE" });

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).not.toContain(secretToken);
      expect((init as RequestInit).body ?? "").not.toContain(secretToken);
    });
  });

  describe("session expiry (cross-check - see ApiSessionExpiry.test.ts for the full matrix)", () => {
    it("an authenticated 401 clears the stored token as part of the same request", async () => {
      const { donationsApi } = await import("@/api");
      localStorage.setItem("token", "a-now-expired-token");
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(401, { error: "Invalid or expired token" }));

      await expect(donationsApi.getAll()).rejects.toThrow();

      expect(localStorage.getItem("token")).toBeNull();
    });
  });
});
