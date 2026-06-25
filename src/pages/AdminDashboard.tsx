import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { usersApi, donationsApi, User, UserStats, DonationStats } from "@/api";
import { Users, Package, Truck, TrendingUp, Search, CheckCircle, XCircle, Shield, Activity, AlertTriangle, Loader2 } from "lucide-react";

const chartConfig = {
  meals: { label: "Meals Saved", color: "hsl(27, 97%, 54%)" },
  pickups: { label: "Pickups", color: "hsl(0, 0%, 20%)" },
};

function StatCard({ label, value, icon: Icon, accent = false, trend }: { label: string; value: string | number; icon: React.ElementType; accent?: boolean; trend?: string }) {
  return (
    <Card className={accent ? "border-primary" : ""}>
      <CardContent className="p-4 flex items-center gap-4">
        <div className={`w-10 h-10 flex items-center justify-center ${accent ? "bg-primary text-primary-foreground" : "bg-accent"}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-2xl font-bold font-mono">{value}</p>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
            {trend && <span className="text-xs text-primary font-mono">↑{trend}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Overview() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: userStats, isLoading: loadingUsers } = useQuery({
    queryKey: ['admin-user-stats'],
    queryFn: () => usersApi.getStats(),
  });

  const { data: donationStats, isLoading: loadingDonations } = useQuery({
    queryKey: ['admin-donation-stats'],
    queryFn: () => donationsApi.getStats(),
  });

  const { data: pendingUsers = [], isLoading: loadingPending } = useQuery({
    queryKey: ['pending-users'],
    queryFn: () => usersApi.getPending(),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => usersApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-user-stats'] });
      toast({ title: "Success", description: "User approved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => usersApi.reject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-users'] });
      toast({ title: "Success", description: "User rejected" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const isLoading = loadingUsers || loadingDonations || loadingPending;
  const stats = userStats as UserStats | undefined;
  const dStats = donationStats as DonationStats | undefined;
  const pending = pendingUsers as User[];

  // Mock chart data (in production, this would come from API)
  const monthlyData = [
    { month: "Jan", meals: 240, pickups: 18 },
    { month: "Feb", meals: 310, pickups: 22 },
    { month: "Mar", meals: 280, pickups: 19 },
    { month: "Apr", meals: 420, pickups: 31 },
    { month: "May", meals: 380, pickups: 28 },
    { month: "Jun", meals: 510, pickups: 39 },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={stats?.total || 0} icon={Users} accent trend="12%" />
        <StatCard label="Total Donations" value={dStats?.total || 0} icon={Package} trend="8%" />
        <StatCard label="Delivered" value={dStats?.delivered || 0} icon={Truck} />
        <StatCard label="Pending Approval" value={stats?.pendingApprovals || pending?.length || 0} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider">Donations — Monthly</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" className="text-xs" />
                <YAxis className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="meals" fill="hsl(27, 97%, 54%)" />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider">Pickups — Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" className="text-xs" />
                <YAxis className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="pickups" stroke="hsl(0, 0%, 20%)" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider">Pending Approvals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!pending || pending.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No pending approvals</p>
          ) : (
            pending.slice(0, 5).map((user) => (
              <div key={user.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <p className="font-medium text-sm">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email} · {user.role}</p>
                </div>
                <div className="flex gap-1">
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="h-7 text-xs"
                    onClick={() => approveMutation.mutate(user.id)}
                    disabled={approveMutation.isPending}
                  >
                    <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
                  </Button>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="h-7 text-xs text-destructive"
                    onClick={() => rejectMutation.mutate(user.id)}
                    disabled={rejectMutation.isPending}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UserManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [roleFilter, setRoleFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['all-users', roleFilter, searchTerm],
    queryFn: () => usersApi.getAll({ 
      role: roleFilter === 'all' ? undefined : roleFilter,
      search: searchTerm || undefined,
    }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => usersApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
      queryClient.invalidateQueries({ queryKey: ['pending-users'] });
      toast({ title: "Success", description: "User approved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => usersApi.reject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
      toast({ title: "Success", description: "User rejected" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const suspendMutation = useMutation({
    mutationFn: (id: string) => usersApi.suspend(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
      toast({ title: "Success", description: "User suspended" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const allUsers = users as User[];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search users..." 
            className="pl-9" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="DONOR">Donors</SelectItem>
            <SelectItem value="NGO">NGOs</SelectItem>
            <SelectItem value="VOLUNTEER">Volunteers</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase">Name</TableHead>
                <TableHead className="text-xs uppercase">Email</TableHead>
                <TableHead className="text-xs uppercase">Role</TableHead>
                <TableHead className="text-xs uppercase">Status</TableHead>
                <TableHead className="text-xs uppercase">Joined</TableHead>
                <TableHead className="text-xs uppercase">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium text-sm">{user.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs uppercase">{user.role}</Badge></TableCell>
                  <TableCell>
                    <Badge className={`text-xs uppercase ${
                      !user.isApproved ? "bg-primary text-primary-foreground" : 
                      user.isActive ? "bg-foreground text-background" : 
                      "bg-destructive text-destructive-foreground"
                    }`}>
                      {!user.isApproved ? "pending" : user.isActive ? "active" : "suspended"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {!user.isApproved && (
                        <>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-7 text-xs"
                            onClick={() => approveMutation.mutate(user.id)}
                            disabled={approveMutation.isPending}
                          >
                            <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
                          </Button>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-7 text-xs text-destructive"
                            onClick={() => rejectMutation.mutate(user.id)}
                            disabled={rejectMutation.isPending}
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                      {user.isApproved && user.isActive && (
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-7 text-xs text-destructive"
                          onClick={() => suspendMutation.mutate(user.id)}
                          disabled={suspendMutation.isPending}
                        >
                          Suspend
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Analytics() {
  const { data: userStats, isLoading: loadingUsers } = useQuery({
    queryKey: ['admin-user-stats'],
    queryFn: () => usersApi.getStats(),
  });

  const { data: donationStats, isLoading: loadingDonations } = useQuery({
    queryKey: ['admin-donation-stats'],
    queryFn: () => donationsApi.getStats(),
  });

  const stats = userStats as UserStats | undefined;
  const dStats = donationStats as DonationStats | undefined;

  const roleDistribution = [
    { name: "Donors", value: stats?.donors || 0, fill: "hsl(27, 97%, 54%)" },
    { name: "NGOs", value: stats?.ngos || 0, fill: "hsl(0, 0%, 20%)" },
    { name: "Volunteers", value: stats?.volunteers || 0, fill: "hsl(0, 0%, 60%)" },
  ];

  const monthlyData = [
    { month: "Jan", meals: 240, pickups: 18 },
    { month: "Feb", meals: 310, pickups: 22 },
    { month: "Mar", meals: 280, pickups: 19 },
    { month: "Apr", meals: 420, pickups: 31 },
    { month: "May", meals: 380, pickups: 28 },
    { month: "Jun", meals: 510, pickups: 39 },
  ];

  if (loadingUsers || loadingDonations) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Donations" value={dStats?.total || 0} icon={Package} accent />
        <StatCard label="Delivered" value={dStats?.delivered || 0} icon={Truck} />
        <StatCard label="Available" value={dStats?.available || 0} icon={Users} />
        <StatCard label="Urgent" value={dStats?.urgent || 0} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider">Monthly Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="meals" fill="hsl(27, 97%, 54%)" name="Meals" />
                <Bar dataKey="pickups" fill="hsl(0, 0%, 20%)" name="Pickups" />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider">User Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <PieChart>
                <Pie data={roleDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                  {roleDistribution.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent />} />
              </PieChart>
            </ChartContainer>
            <div className="flex flex-col gap-2 mt-2">
              {roleDistribution.map((r) => (
                <div key={r.name} className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3" style={{ backgroundColor: r.fill }} />
                  <span>{r.name}</span>
                  <span className="font-mono ml-auto">{r.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Monitoring() {
  // In a real app, this would come from a monitoring API
  const systemLogs = [
    { time: new Date().toLocaleTimeString(), event: "System Running", details: "All services operational", level: "success" },
    { time: new Date(Date.now() - 60000).toLocaleTimeString(), event: "API Request", details: "Health check passed", level: "info" },
    { time: new Date(Date.now() - 120000).toLocaleTimeString(), event: "Database", details: "Connection stable", level: "info" },
    { time: new Date(Date.now() - 180000).toLocaleTimeString(), event: "Authentication", details: "JWT tokens validated", level: "info" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Uptime" value="99.9%" icon={Activity} accent />
        <StatCard label="Response" value="120ms" icon={TrendingUp} />
        <StatCard label="Active Users" value="24" icon={Users} />
        <StatCard label="Pending" value="3" icon={AlertTriangle} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider">System Logs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {systemLogs.map((log, i) => (
            <div key={i} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
              <span className="font-mono text-xs text-muted-foreground w-20 flex-shrink-0">{log.time}</span>
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${log.level === "error" ? "bg-destructive" : log.level === "warning" ? "bg-primary" : log.level === "success" ? "bg-foreground" : "bg-muted-foreground"}`} />
              <Badge variant="outline" className={`text-[10px] uppercase w-16 justify-center flex-shrink-0 ${log.level === "error" ? "border-destructive text-destructive" : ""}`}>{log.level}</Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{log.event}</p>
                <p className="text-xs text-muted-foreground truncate">{log.details}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider">Quick Actions</CardTitle>
        </CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Button 
            variant="outline" 
            className="text-xs uppercase tracking-wider h-12"
            onClick={() => alert('Security settings panel would open here')}
          >
            <Shield className="w-4 h-4 mr-1" /> Security
          </Button>
          <Button 
            variant="outline" 
            className="text-xs uppercase tracking-wider h-12"
            onClick={() => alert('Health check would run here')}
          >
            <Activity className="w-4 h-4 mr-1" /> Health
          </Button>
          <Button 
            variant="outline" 
            className="text-xs uppercase tracking-wider h-12"
            onClick={() => alert('Role management would open here')}
          >
            <Users className="w-4 h-4 mr-1" /> Roles
          </Button>
          <Button 
            variant="outline" 
            className="text-xs uppercase tracking-wider h-12 text-destructive border-destructive"
            onClick={() => alert('System alerts would be shown here')}
          >
            <AlertTriangle className="w-4 h-4 mr-1" /> Alerts
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

const AdminDashboard = () => {
  return (
    <Routes>
      <Route path="/" element={<DashboardLayout role="admin" title="Overview"><Overview /></DashboardLayout>} />
      <Route path="/users" element={<DashboardLayout role="admin" title="User Management"><UserManagement /></DashboardLayout>} />
      <Route path="/analytics" element={<DashboardLayout role="admin" title="Analytics"><Analytics /></DashboardLayout>} />
      <Route path="/monitoring" element={<DashboardLayout role="admin" title="Monitoring"><Monitoring /></DashboardLayout>} />
    </Routes>
  );
};

export default AdminDashboard;

