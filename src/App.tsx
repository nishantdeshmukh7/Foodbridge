import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index.tsx";
import HowItWorks from "./pages/HowItWorks.tsx";
import Login from "./pages/Login.tsx";
import Register from "./pages/Register.tsx";
import NotFound from "./pages/NotFound.tsx";
import PendingApproval from "./pages/PendingApproval.tsx";
import DonorDashboard from "./pages/DonorDashboard.tsx";
import NgoDashboard from "./pages/NgoDashboard.tsx";
import VolunteerDashboard from "./pages/VolunteerDashboard.tsx";
import AdminDashboard from "./pages/AdminDashboard.tsx";

const queryClient = new QueryClient();

// Component to handle role-based redirects after login
function AuthRedirect() {
  const { user, isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return null;
  }
  
  if (isAuthenticated && user) {
    return <Navigate to={`/${user.role.toLowerCase()}`} replace />;
  }
  
  return null;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/how-it-works" element={<HowItWorks />} />
      <Route path="/login" element={<><AuthRedirect /><Login /></>} />
      <Route path="/register" element={<><AuthRedirect /><Register /></>} />
      <Route path="/pending-approval" element={<PendingApproval />} />
      
      {/* Protected Dashboard Routes */}
      <Route
        path="/donor/*"
        element={
          <ProtectedRoute allowedRoles={["DONOR"]}>
            <DonorDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ngo/*"
        element={
          <ProtectedRoute allowedRoles={["NGO"]}>
            <NgoDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/volunteer/*"
        element={
          <ProtectedRoute allowedRoles={["VOLUNTEER"]}>
            <VolunteerDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/*"
        element={
          <ProtectedRoute allowedRoles={["ADMIN"]}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

