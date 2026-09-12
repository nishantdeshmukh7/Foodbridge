import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";

const mockForgotPassword = vi.fn();
const mockResetPassword = vi.fn();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      forgotPassword: (...args: unknown[]) => mockForgotPassword(...args),
      resetPassword: (...args: unknown[]) => mockResetPassword(...args),
    },
  };
});

beforeEach(() => {
  mockForgotPassword.mockReset();
  mockResetPassword.mockReset();
});

describe("ForgotPassword", () => {
  it("renders the request form", () => {
    render(
      <MemoryRouter>
        <ForgotPassword />
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send reset link/i })).toBeInTheDocument();
  });

  it("shows the same generic success state on a successful request", async () => {
    mockForgotPassword.mockResolvedValue({ message: "ok" });
    render(
      <MemoryRouter>
        <ForgotPassword />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "donor@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => expect(mockForgotPassword).toHaveBeenCalledWith("donor@example.com"));
    expect(await screen.findByText(/a password reset link has been sent/i)).toBeInTheDocument();
  });

  it("shows the same generic success state even if the request errors, revealing nothing about the outcome", async () => {
    mockForgotPassword.mockRejectedValue(new Error("network down"));
    render(
      <MemoryRouter>
        <ForgotPassword />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "whoever@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(await screen.findByText(/a password reset link has been sent/i)).toBeInTheDocument();
  });

  it("does not submit twice for a rapid double-click", async () => {
    let resolveRequest: (value: { message: string }) => void = () => {};
    mockForgotPassword.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );
    render(
      <MemoryRouter>
        <ForgotPassword />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "donor@example.com" } });
    const button = screen.getByRole("button", { name: /send reset link/i });
    fireEvent.click(button);
    fireEvent.click(button);

    resolveRequest({ message: "ok" });
    await waitFor(() => expect(mockForgotPassword).toHaveBeenCalledTimes(1));
  });
});

function renderResetPassword(searchQuery: string) {
  return render(
    <MemoryRouter initialEntries={[`/reset-password${searchQuery}`]}>
      <ResetPassword />
    </MemoryRouter>
  );
}

describe("ResetPassword", () => {
  it("shows an invalid-link state when no token is present in the URL", () => {
    renderResetPassword("");
    expect(screen.getByText(/missing or malformed/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("New password")).not.toBeInTheDocument();
  });

  it("renders the reset form when a token is present", () => {
    renderResetPassword("?token=abc123");
    expect(screen.getByPlaceholderText("New password")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Confirm new password")).toBeInTheDocument();
  });

  it("shows an inline error and does not call the API when passwords don't match", async () => {
    renderResetPassword("?token=abc123");

    fireEvent.change(screen.getByPlaceholderText("New password"), { target: { value: "Password123" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm new password"), {
      target: { value: "Different123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it("shows an inline error and does not call the API when the password is too short", async () => {
    renderResetPassword("?token=abc123");

    fireEvent.change(screen.getByPlaceholderText("New password"), { target: { value: "abc" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm new password"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    expect(await screen.findByText(/at least 6 characters/i)).toBeInTheDocument();
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it("submits a valid matching password and shows a success state", async () => {
    mockResetPassword.mockResolvedValue({ message: "ok" });
    renderResetPassword("?token=abc123");

    fireEvent.change(screen.getByPlaceholderText("New password"), { target: { value: "NewPassword123" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm new password"), {
      target: { value: "NewPassword123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => expect(mockResetPassword).toHaveBeenCalledWith("abc123", "NewPassword123"));
    expect(await screen.findByText(/your password has been reset/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to sign in/i })).toBeInTheDocument();
  });

  it("shows a dead-end state with a link to request a new link when the token is invalid or expired", async () => {
    mockResetPassword.mockRejectedValue(new Error("This password reset link is invalid or has expired."));
    renderResetPassword("?token=expired-token");

    fireEvent.change(screen.getByPlaceholderText("New password"), { target: { value: "NewPassword123" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm new password"), {
      target: { value: "NewPassword123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a new reset link/i })).toBeInTheDocument();
    // The dead-end state replaces the form entirely - no password fields left to resubmit with.
    expect(screen.queryByPlaceholderText("New password")).not.toBeInTheDocument();
  });

  it("shows a retryable inline error (not a dead end) for a non-token server error, keeping the form usable", async () => {
    mockResetPassword.mockRejectedValue(new Error("Something else went wrong"));
    renderResetPassword("?token=abc123");

    fireEvent.change(screen.getByPlaceholderText("New password"), { target: { value: "NewPassword123" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm new password"), {
      target: { value: "NewPassword123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    expect(await screen.findByText("Something else went wrong")).toBeInTheDocument();
    // The form is still there to retry with.
    expect(screen.getByPlaceholderText("New password")).toBeInTheDocument();
  });

  it("does not submit twice for a rapid double-click", async () => {
    let resolveRequest: (value: { message: string }) => void = () => {};
    mockResetPassword.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );
    renderResetPassword("?token=abc123");

    fireEvent.change(screen.getByPlaceholderText("New password"), { target: { value: "NewPassword123" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm new password"), {
      target: { value: "NewPassword123" },
    });
    const button = screen.getByRole("button", { name: /reset password/i });
    fireEvent.click(button);
    fireEvent.click(button);

    resolveRequest({ message: "ok" });
    await waitFor(() => expect(mockResetPassword).toHaveBeenCalledTimes(1));
  });
});
