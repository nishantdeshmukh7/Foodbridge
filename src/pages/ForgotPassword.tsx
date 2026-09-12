import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { authApi } from "@/api";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Guards against a rapid double-click firing two requests before
  // isLoading's first render lands - same pattern used elsewhere in this
  // app (e.g. NotificationBell, DonorDashboard's cancel action).
  const inFlight = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setIsLoading(true);

    try {
      // The backend returns the same generic response whether or not this
      // email belongs to an account - this page never asks it to say
      // otherwise, and always shows the same success state on any
      // non-network-error outcome.
      await authApi.forgotPassword(email);
    } catch {
      // A network/server error still shouldn't reveal anything about the
      // email's account status - show the same generic confirmation
      // either way, matching the backend's own behavior.
    } finally {
      inFlight.current = false;
      setIsLoading(false);
      setSubmitted(true);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <div className="flex-1 flex items-center justify-center py-16">
        <div className="w-full max-w-md border border-border">
          <div className="border-b border-border px-6 py-4">
            <h1 className="text-xl font-black uppercase tracking-wider">Forgot Password</h1>
            <p className="text-xs text-muted-foreground font-mono mt-1">RESET YOUR ACCESS</p>
          </div>

          {submitted ? (
            <div className="p-6 space-y-4 text-center">
              <p className="text-sm">
                If an account exists for <span className="font-semibold">{email}</span>, a password
                reset link has been sent.
              </p>
              <p className="text-xs text-muted-foreground">
                Check your inbox and follow the link to choose a new password. The link expires
                shortly, so use it soon.
              </p>
              <Link to="/login" className="text-primary text-sm font-semibold hover:underline inline-block mt-2">
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form className="p-6 space-y-4" onSubmit={handleSubmit}>
              <p className="text-xs text-muted-foreground">
                Enter the email address on your account and we'll send you a link to reset your
                password.
              </p>

              <div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="w-full border px-3 py-2"
                  required
                  disabled={isLoading}
                />
              </div>

              <button type="submit" className="btn-dispatch w-full" disabled={isLoading}>
                {isLoading ? "Sending..." : "Send Reset Link"}
              </button>

              <p className="text-xs text-center text-muted-foreground">
                Remembered your password?{" "}
                <Link to="/login" className="text-primary hover:underline">
                  Sign In
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default ForgotPassword;
