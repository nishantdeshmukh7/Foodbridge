import { Link, useNavigate } from "react-router-dom";
import {
  Package, Plus, List, Bell, Settings, BarChart3, Users, Truck,
  MapPin, ClipboardCheck, CheckCircle, LogOut, Home, Heart, UserCircle
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { NavLink } from "@/components/NavLink";
import NotificationBell from "@/components/NotificationBell";
import { useAuth } from "@/context/AuthContext";

const donorNav = [
  { title: "Overview", url: "/donor", icon: BarChart3 },
  { title: "Create Listing", url: "/donor/create", icon: Plus },
  { title: "My Listings", url: "/donor/listings", icon: List },
  { title: "Requests", url: "/donor/requests", icon: Bell },
  { title: "Profile", url: "/donor/profile", icon: UserCircle },
];

const ngoNav = [
  { title: "Overview", url: "/ngo", icon: BarChart3 },
  { title: "Browse Food", url: "/ngo/browse", icon: MapPin },
  { title: "My Requests", url: "/ngo/requests", icon: ClipboardCheck },
  { title: "Tracking", url: "/ngo/tracking", icon: Truck },
  { title: "Profile", url: "/ngo/profile", icon: UserCircle },
];

const volunteerNav = [
  { title: "Overview", url: "/volunteer", icon: BarChart3 },
  { title: "Pickup Tasks", url: "/volunteer/tasks", icon: Truck },
  { title: "Completed", url: "/volunteer/completed", icon: CheckCircle },
  { title: "Profile", url: "/volunteer/profile", icon: UserCircle },
];

const adminNav = [
  { title: "Overview", url: "/admin", icon: BarChart3 },
  { title: "Users", url: "/admin/users", icon: Users },
  { title: "Donations", url: "/admin/donations", icon: Package },
  { title: "Assignments", url: "/admin/assignments", icon: Truck },
  { title: "Analytics", url: "/admin/analytics", icon: BarChart3 },
  { title: "Monitoring", url: "/admin/monitoring", icon: Settings },
  { title: "Profile", url: "/admin/profile", icon: UserCircle },
];

const roleConfig: Record<string, { label: string; nav: typeof donorNav; icon: React.ElementType }> = {
  donor: { label: "Donor", nav: donorNav, icon: Heart },
  ngo: { label: "NGO", nav: ngoNav, icon: Users },
  volunteer: { label: "Volunteer", nav: volunteerNav, icon: Truck },
  admin: { label: "Admin", nav: adminNav, icon: Settings },
};

function AppSidebar({ role, onLogout }: { role: string; onLogout?: () => void }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const config = roleConfig[role];

  const handleLogoutClick = (e: React.MouseEvent) => {
    if (onLogout) {
      e.preventDefault();
      onLogout();
    }
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            <Link to="/" className="flex items-center gap-2">
              <Package className="w-4 h-4 text-primary" />
              {!collapsed && <span className="font-bold text-xs uppercase tracking-wider">FoodBridge</span>}
            </Link>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {config.nav.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className="hover:bg-accent"
                      activeClassName="bg-primary/10 text-primary font-semibold"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span className="text-sm">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/" className="hover:bg-accent">
                    <Home className="mr-2 h-4 w-4" />
                    {!collapsed && <span className="text-sm">Back to Home</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a 
                    href="#" 
                    onClick={handleLogoutClick}
                    className="hover:bg-destructive/10 text-destructive"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    {!collapsed && <span className="text-sm">Logout</span>}
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

interface DashboardLayoutProps {
  role: string;
  title: string;
  children: React.ReactNode;
}

const DashboardLayout = ({ role, title, children }: DashboardLayoutProps) => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  
  const handleLogout = () => {
    logout();
    navigate('/login');
  };
  
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar role={role} onLogout={handleLogout} />
        <div className="flex-1 flex flex-col">
          <header className="h-14 flex items-center border-b border-border px-4 gap-3 bg-background sticky top-0 z-40">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{roleConfig[role]?.label}</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-sm font-semibold">{title}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <NotificationBell />
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default DashboardLayout;
