import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "@/api";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import { useToast } from "@/hooks/use-toast";

const roles = [
  { id: "DONOR", label: "Food Donor", desc: "Restaurant, hotel, event organizer" },
  { id: "NGO", label: "NGO / Receiver", desc: "Community organization, shelter" },
  { id: "VOLUNTEER", label: "Volunteer", desc: "Pick up and deliver surplus food" },
];

const Register = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { toast } = useToast();
  
  const [selectedRole, setSelectedRole] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    organization: "",
    email: "",
    phone: "",
    location: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);

  const update = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedRole) {
      toast({
        title: "Please select a role",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      // Register user
      const response = await authApi.register({
        ...formData,
        role: selectedRole as "DONOR" | "NGO" | "VOLUNTEER",
      });

      // Store token for NGO since they need approval
      if (selectedRole === 'NGO') {
        localStorage.setItem('token', response.token);
        localStorage.setItem('pendingApproval', 'true');
        toast({
          title: "Registration successful",
          description: "Your account is pending approval by admin.",
        });
        navigate('/login');
        return;
      }

      // Auto-login after registration for DONOR and VOLUNTEER
      await login(formData.email, formData.password);

      toast({
        title: "Registration successful",
        description: "Welcome to FoodBridge!",
      });

      navigate(`/${selectedRole.toLowerCase()}`);
    } catch (error) {
      toast({
        title: "Registration failed",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 flex items-center justify-center py-16">
        <div className="w-full max-w-lg border border-border">
          <div className="border-b border-border px-6 py-4">
            <h1 className="text-xl font-black uppercase tracking-wider">Register</h1>
            <p className="text-xs text-muted-foreground font-mono mt-1">JOIN THE FOOD RESCUE NETWORK</p>
          </div>

          {/* Role Selection */}
          <div className="border-b border-border p-6">
            <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground block mb-3">Select Your Role</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 border border-border">
              {roles.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRole(r.id)}
                  className={`p-3 border-r border-b border-border last:border-r-0 text-left transition-colors ${
                    selectedRole === r.id
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-card"
                  }`}
                >
                  <p className="text-sm font-bold">{r.label}</p>
                  <p className={`text-xs mt-0.5 ${selectedRole === r.id ? "opacity-80" : "text-muted-foreground"}`}>
                    {r.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <form className="p-6 space-y-4" onSubmit={handleSubmit}>
            {[
              { key: "name", label: "Full Name", type: "text", placeholder: "John Doe" },
              { key: "organization", label: "Organization", type: "text", placeholder: "Org name (if applicable)" },
              { key: "email", label: "Email", type: "email", placeholder: "you@example.com" },
              { key: "phone", label: "Phone", type: "tel", placeholder: "+91 98765 43210" },
              { key: "location", label: "Location", type: "text", placeholder: "City, Area" },
              { key: "password", label: "Password", type: "password", placeholder: "••••••••" },
            ].map((f) => (
              <div key={f.key}>
                <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground block mb-1.5">
                  {f.label}
                </label>
                <input
                  type={f.type}
                  value={formData[f.key as keyof typeof formData]}
                  onChange={(e) => update(f.key, e.target.value)}
                  className="w-full border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors"
                  placeholder={f.placeholder}
                  required
                  disabled={isLoading}
                />
              </div>
            ))}

            <button 
              type="submit" 
              className="btn-dispatch mt-2" 
              disabled={!selectedRole || isLoading}
            >
              {isLoading ? "Creating Account..." : "Create Account"}
            </button>

            <p className="text-xs text-center text-muted-foreground">
              Already registered?{" "}
              <Link to="/login" className="text-primary font-semibold hover:underline">Sign In</Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Register;

