import { Link, useNavigate } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Clock, Mail, LogOut } from "lucide-react";

const PendingApproval = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('pendingApproval');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <div className="flex-1 flex items-center justify-center py-16">
        <div className="w-full max-w-md border border-border p-8 text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Clock className="w-8 h-8 text-primary" />
          </div>
          
          <h1 className="text-2xl font-bold uppercase tracking-wider mb-2">
            Pending Approval
          </h1>
          
          <p className="text-muted-foreground mb-6">
            Your account is currently under review by our administrators. 
            You will be notified once your account has been approved.
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
              Already approved?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Try logging in again
              </Link>
            </p>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default PendingApproval;

