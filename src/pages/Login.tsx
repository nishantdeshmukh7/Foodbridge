import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Check for pending approval flag from registration
  useEffect(() => {
    if (localStorage.getItem('pendingApproval') === 'true') {
      localStorage.removeItem('pendingApproval');
      toast({
        title: "Account pending approval",
        description: "Your account is still waiting for admin approval.",
        variant: "default",
      });
    }
  }, [toast]);

  // Phase 21: post-login redirect always goes to the role's own dashboard
  // (below), never to an arbitrary "return to where you were" location.
  // ProtectedRoute does pass `state={{ from: location }}` when it bounces
  // an unauthenticated visitor here, but this page deliberately never
  // reads it back out to navigate() with - doing so from an
  // attacker-influenceable value would be exactly the open-redirect shape
  // audited for this phase (see src/test/RedirectSafety.test.tsx). If a
  // "return to where you were" feature is ever added, it must validate the
  // target is an internal path (e.g. starts with a single "/", never "//"
  // or a scheme) before passing it to navigate().
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const user = await login(email, password);

      toast({
        title: "Login successful",
        description: "Welcome back!",
      });

      // Redirect based on user role
      const roleDashboard = `/${user.role.toLowerCase()}`;
      navigate(roleDashboard, { replace: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Invalid email or password";

      // Check if account is pending approval, or was reviewed and rejected -
      // these are distinct backend states/messages (see authService.login).
      if (errorMessage.includes('pending approval')) {
        navigate('/pending-approval');
      } else if (errorMessage.includes('not approved')) {
        navigate('/registration-rejected');
      } else {
        toast({
          title: "Login failed",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <div className="flex-1 flex items-center justify-center py-16">
        <div className="w-full max-w-md border border-border">

          <div className="border-b border-border px-6 py-4">
            <h1 className="text-xl font-black uppercase tracking-wider">
              Sign In
            </h1>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              ACCESS YOUR DASHBOARD
            </p>
          </div>

          <form className="p-6 space-y-4" onSubmit={handleLogin}>

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

            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full border px-3 py-2"
                required
                disabled={isLoading}
              />
            </div>

            <button
              type="submit"
              className="btn-dispatch w-full"
              disabled={isLoading}
            >
              {isLoading ? "Signing in..." : "Sign In"}
            </button>

            <p className="text-xs text-center">
              <Link to="/forgot-password" className="text-primary hover:underline">
                Forgot password?
              </Link>
            </p>

            <p className="text-xs text-center text-muted-foreground">
              No account?{" "}
              <Link to="/register" className="text-primary hover:underline">
                Register
              </Link>
            </p>

          </form>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default Login;

