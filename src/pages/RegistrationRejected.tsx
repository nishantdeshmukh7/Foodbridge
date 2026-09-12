import { Link, useNavigate } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { XCircle, Mail, LogOut } from "lucide-react";

// Shown when login fails because the account was reviewed and declined
// (isApproved=false, isActive=false), distinct from PendingApproval.tsx
// (isApproved=false, isActive=true - never reviewed yet). No rejection
// reason is stored anywhere in the backend, so none is invented here.
const RegistrationRejected = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <div className="flex-1 flex items-center justify-center py-16">
        <div className="w-full max-w-md border border-border p-8 text-center">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <XCircle className="w-8 h-8 text-destructive" />
          </div>

          <h1 className="text-2xl font-bold uppercase tracking-wider mb-2">
            Registration Not Approved
          </h1>

          <p className="text-muted-foreground mb-6">
            Your organization registration was not approved. If you believe
            this is a mistake, please reach out to our team.
          </p>

          <div className="bg-accent p-4 rounded-md mb-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <Mail className="w-4 h-4" />
              <span>Need help? Contact us at</span>
            </div>
            <p className="font-semibold">support@foodbridge.org</p>
          </div>

          <div className="space-y-3">
            <Button
              onClick={handleLogout}
              variant="outline"
              className="w-full"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>

            <p className="text-xs text-muted-foreground">
              <Link to="/login" className="text-primary hover:underline">
                Back to sign in
              </Link>
            </p>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default RegistrationRejected;
