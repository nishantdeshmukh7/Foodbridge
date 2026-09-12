import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authApi } from "@/api";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  // Read once on mount and kept only in this component's own state - never
  // written to localStorage, AuthContext, or any other shared/persisted
  // app state. It's discarded the moment this component unmounts.
  const [token] = useState(() => searchParams.get("token") ?? "");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const inFlight = useRef(false);

  // The backend unifies "doesn't exist" / "expired" / "already used" into
  // this one exact message - matching it here (rather than adding a new,
  // separate signal) is what tells this page the link itself is a dead
  // end, as opposed to a retryable validation error on the same link.
  const isDeadEnd = serverError === "This password reset link is invalid or has expired.";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    setServerError(null);

    if (password.length < 6) {
      setFieldError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setFieldError("Passwords do not match.");
      return;
    }

    if (inFlight.current) return;
    inFlight.current = true;
    setIsLoading(true);

    try {
      await authApi.resetPassword(token, password);
      setSuccess(true);
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "Failed to reset password. Please try again."
      );
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  };

  let body: JSX.Element;

  if (!token) {
    body = (
      <div className="p-6 space-y-4 text-center">
        <p className="text-sm">This password reset link is missing or malformed.</p>
        <Link to="/forgot-password" className="text-primary text-sm font-semibold hover:underline inline-block">
          Request a new reset link
        </Link>
      </div>
    );
  } else if (success) {
    body = (
      <div className="p-6 space-y-4 text-center">
        <p className="text-sm">Your password has been reset.</p>
        <p className="text-xs text-muted-foreground">You can now sign in with your new password.</p>
        <Link to="/login" className="text-primary text-sm font-semibold hover:underline inline-block mt-2">
          Go to Sign In
        </Link>
      </div>
    );
  } else if (isDeadEnd) {
    body = (
      <div className="p-6 space-y-4 text-center">
        <p className="text-sm">{serverError}</p>
        <Link to="/forgot-password" className="text-primary text-sm font-semibold hover:underline inline-block">
          Request a new reset link
        </Link>
      </div>
    );
  } else {
    body = (
      <form className="p-6 space-y-4" onSubmit={handleSubmit}>
        <p className="text-xs text-muted-foreground">Choose a new password for your account.</p>

        {serverError && (
          <p className="text-xs text-destructive border border-destructive/40 bg-destructive/5 px-3 py-2">
            {serverError}
          </p>
        )}

        <div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password"
            className="w-full border px-3 py-2"
            required
            disabled={isLoading}
            aria-invalid={!!fieldError}
          />
        </div>

        <div>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            className="w-full border px-3 py-2"
            required
            disabled={isLoading}
            aria-invalid={!!fieldError}
          />
        </div>

        {fieldError && <p className="text-xs text-destructive">{fieldError}</p>}

        <button type="submit" className="btn-dispatch w-full" disabled={isLoading}>
          {isLoading ? "Resetting..." : "Reset Password"}
        </button>
      </form>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <div className="flex-1 flex items-center justify-center py-16">
        <div className="w-full max-w-md border border-border">
          <div className="border-b border-border px-6 py-4">
            <h1 className="text-xl font-black uppercase tracking-wider">Reset Password</h1>
            <p className="text-xs text-muted-foreground font-mono mt-1">CHOOSE A NEW PASSWORD</p>
          </div>

          {body}
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default ResetPassword;
