import { useRef, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/DashboardLayout";
import Profile from "@/pages/Profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { useToast } from "@/hooks/use-toast";
import {
  usersApi,
  pickupsApi,
  adminApi,
  healthApi,
  donationsApi,
  User,
  PickupRequest,
  Donation,
  AdminAnalytics,
  AdminActivityEntry,
} from "@/api";
import { Users, Package, Truck, TrendingUp, Search, CheckCircle, XCircle, Activity, AlertTriangle, Loader2, UserCheck, Clock, ServerCog, Ban } from "lucide-react";

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

  const { data: analyticsData, isLoading: loadingAnalytics, isError: analyticsError } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () => adminApi.getAnalytics(),
  });

  const { data: pendingUsers = [], isLoading: loadingPending, isError: pendingError } = useQuery({
    queryKey: ['pending-users'],
    queryFn: () => usersApi.getPending(),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => usersApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-analytics'] });
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
      queryClient.invalidateQueries({ queryKey: ['admin-analytics'] });
      toast({ title: "Success", description: "User rejected" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const isLoading = loadingAnalytics || loadingPending;
  const analytics = analyticsData as AdminAnalytics | undefined;
  const pending = pendingUsers as User[];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  // Never fall through to a zero-filled dashboard on failure - that would
  // be indistinguishable from a genuinely empty database.
  if (analyticsError || pendingError || !analytics) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-8 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-destructive" />
          <p className="font-medium">Failed to load analytics</p>
          <p className="text-sm text-muted-foreground mt-1">
            The admin analytics service did not respond. Try refreshing the page.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Every bar reflects a real donation count from the database, including
  // statuses currently at zero (e.g. EXPIRED has no writer yet) - a real
  // zero is still real data, not a placeholder.
  const donationStatusData = [
    { status: "Available", count: analytics.donations.available },
    { status: "Claimed", count: analytics.donations.claimed },
    { status: "Picked Up", count: analytics.donations.pickedUp },
    { status: "Delivered", count: analytics.donations.delivered },
    { status: "Expired", count: analytics.donations.expired },
    { status: "Cancelled", count: analytics.donations.cancelled },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={analytics.users.total} icon={Users} accent />
        <StatCard label="Total Donations" value={analytics.donations.total} icon={Package} />
        <StatCard label="Delivered" value={analytics.donations.delivered} icon={Truck} />
        <StatCard label="Pending Approval" value={analytics.users.pendingApprovals} icon={TrendingUp} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider">Donations by Status</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[250px] w-full">
            <BarChart data={donationStatusData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="status" className="text-xs" />
              <YAxis className="text-xs" allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill="hsl(27, 97%, 54%)" />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

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

// The authoritative user lifecycle, derived entirely from the existing
// (isApproved, isActive) pair - see backend/src/services/user.service.ts for
// the matching backend definition. Kept in one place so the badge and the
// available actions can never disagree with each other.
type LifecycleStatus = "pending" | "rejected" | "active" | "suspended";

function lifecycleStatus(user: User): LifecycleStatus {
  if (!user.isApproved) return user.isActive ? "pending" : "rejected";
  return user.isActive ? "active" : "suspended";
}

const lifecycleBadgeClass: Record<LifecycleStatus, string> = {
  pending: "bg-primary text-primary-foreground",
  rejected: "bg-destructive text-destructive-foreground",
  active: "bg-foreground text-background",
  suspended: "bg-muted text-muted-foreground border border-border",
};

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
      queryClient.invalidateQueries({ queryKey: ['pending-users'] });
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

  // Reactivating a REJECTED account (isApproved=false) returns it to
  // PENDING for re-review, not straight to ACTIVE - see
  // userService.activateUser. wasRejected travels with the mutation
  // variables so onSuccess can phrase the toast correctly without a stale
  // read of the pre-mutation user list.
  const reactivateMutation = useMutation({
    mutationFn: ({ id }: { id: string; wasRejected: boolean }) => usersApi.activate(id),
    onSuccess: (_data, { wasRejected }) => {
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
      queryClient.invalidateQueries({ queryKey: ['pending-users'] });
      toast({
        title: "Success",
        description: wasRejected
          ? "User reactivated - back in the pending approval queue"
          : "User reactivated",
      });
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
                    {(() => {
                      const status = lifecycleStatus(user);
                      return (
                        <Badge className={`text-xs uppercase ${lifecycleBadgeClass[status]}`}>
                          {status}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
                  </TableCell>
                  <TableCell>
                    {user.role === 'ADMIN' ? (
                      <span className="text-xs text-muted-foreground">&mdash;</span>
                    ) : (
                      <div className="flex gap-1">
                        {lifecycleStatus(user) === "pending" && (
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
                              <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                            </Button>
                          </>
                        )}
                        {lifecycleStatus(user) === "active" && (
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
                        {(lifecycleStatus(user) === "suspended" || lifecycleStatus(user) === "rejected") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() =>
                              reactivateMutation.mutate({
                                id: user.id,
                                wasRejected: lifecycleStatus(user) === "rejected",
                              })
                            }
                            disabled={reactivateMutation.isPending}
                          >
                            <UserCheck className="w-3.5 h-3.5 mr-1" /> Reactivate
                          </Button>
                        )}
                      </div>
                    )}
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
  const { data: analyticsData, isLoading, isError } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () => adminApi.getAnalytics(),
  });

  const analytics = analyticsData as AdminAnalytics | undefined;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (isError || !analytics) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-8 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-destructive" />
          <p className="font-medium">Failed to load analytics</p>
          <p className="text-sm text-muted-foreground mt-1">
            The admin analytics service did not respond. Try refreshing the page.
          </p>
        </CardContent>
      </Card>
    );
  }

  const roleDistribution = [
    { name: "Donors", value: analytics.users.donors, fill: "hsl(27, 97%, 54%)" },
    { name: "NGOs", value: analytics.users.ngos, fill: "hsl(0, 0%, 20%)" },
    { name: "Volunteers", value: analytics.users.volunteers, fill: "hsl(0, 0%, 60%)" },
  ];

  // Every bar is a real PickupRequest.status count. REJECTED/CANCELLED are
  // included even though no current code path ever sets them - that is a
  // truthful zero, not a gap in the query.
  const pickupStatusData = [
    { status: "Pending", count: analytics.pickups.pending },
    { status: "Accepted", count: analytics.pickups.accepted },
    { status: "Picked Up", count: analytics.pickups.pickedUp },
    { status: "Completed", count: analytics.pickups.completed },
    { status: "Rejected", count: analytics.pickups.rejected },
    { status: "Cancelled", count: analytics.pickups.cancelled },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Donations" value={analytics.donations.total} icon={Package} accent />
        <StatCard label="Delivered" value={analytics.donations.delivered} icon={Truck} />
        <StatCard label="Available" value={analytics.donations.available} icon={Users} />
        <StatCard label="Urgent (Available)" value={analytics.donations.urgentAvailable} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider">Pickups by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
              <BarChart data={pickupStatusData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="status" />
                <YAxis allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="hsl(0, 0%, 20%)" name="Pickups" />
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

function formatUptime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function activityLevelClass(level: string): string {
  if (level === "error") return "bg-destructive";
  if (level === "warning") return "bg-primary";
  if (level === "success") return "bg-foreground";
  return "bg-muted-foreground";
}

// "Monitoring" here means a truthful operational snapshot, not APM/infra
// telemetry the app doesn't actually export. Prometheus/cAdvisor (see
// docker-compose.yml) only ever scrape container-level infra metrics, not
// this application - nothing here claims otherwise. Every value is either
// a real backend fact (process uptime and reachability via GET /health,
// which this page also calls rather than inventing its own numbers) or a
// real database aggregate reused from /api/admin/analytics.
function Monitoring() {
  const { toast } = useToast();

  const { data: analyticsData, isLoading: loadingAnalytics, isError: analyticsError } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () => adminApi.getAnalytics(),
  });

  const { data: activityData, isLoading: loadingActivity, isError: activityError } = useQuery({
    queryKey: ['admin-activity'],
    queryFn: () => adminApi.getActivity(),
  });

  const {
    data: health,
    isLoading: loadingHealth,
    isError: healthError,
    refetch: refetchHealth,
    isFetching: checkingHealth,
  } = useQuery({
    queryKey: ['api-health'],
    queryFn: () => healthApi.check(),
  });

  const analytics = analyticsData as AdminAnalytics | undefined;
  const activity = (activityData ?? []) as AdminActivityEntry[];

  const handleHealthCheck = async () => {
    const result = await refetchHealth();
    if (result.data) {
      toast({
        title: "API is reachable",
        description: `Status: ${result.data.status} · Uptime: ${formatUptime(result.data.uptimeSeconds)}`,
      });
    } else {
      toast({ title: "Health check failed", description: "No response from the API.", variant: "destructive" });
    }
  };

  const isLoading = loadingAnalytics || loadingActivity || loadingHealth;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="API Status"
          value={healthError ? "Unreachable" : health?.status === "ok" ? "Operational" : "Unknown"}
          icon={ServerCog}
          accent={!healthError}
        />
        <StatCard label="Process Uptime" value={health ? formatUptime(health.uptimeSeconds) : "—"} icon={Clock} />
        <StatCard
          label="Pending Approvals"
          value={analyticsError || !analytics ? "—" : analytics.users.pendingApprovals}
          icon={AlertTriangle}
        />
        <StatCard
          label="Unassigned Pickups"
          value={analyticsError || !analytics ? "—" : analytics.pickups.pending}
          icon={Package}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {activityError ? (
            <p className="text-center text-destructive py-4 text-sm">Failed to load recent activity.</p>
          ) : activity.length === 0 ? (
            <p className="text-center text-muted-foreground py-4 text-sm">No admin activity recorded yet.</p>
          ) : (
            activity.map((log) => (
              <div key={log.id} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
                <span className="font-mono text-xs text-muted-foreground w-16 flex-shrink-0">
                  {new Date(log.createdAt).toLocaleTimeString()}
                </span>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${activityLevelClass(log.level)}`} />
                <Badge
                  variant="outline"
                  className={`text-[10px] uppercase w-16 justify-center flex-shrink-0 ${log.level === "error" ? "border-destructive text-destructive" : ""}`}
                >
                  {log.level}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{log.action}</p>
                  {log.details && <p className="text-xs text-muted-foreground truncate">{log.details}</p>}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="text-xs uppercase tracking-wider h-12 w-full sm:w-auto"
            onClick={handleHealthCheck}
            disabled={checkingHealth}
          >
            {checkingHealth ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Activity className="w-4 h-4 mr-1" />
            )}
            Run Health Check
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// Canonical admin volunteer assignment. Lists PickupRequests an NGO claim
// has already created (PENDING, unclaimed - the same list volunteers
// self-serve from) and lets an admin pick an eligible volunteer for one.
// This goes through the exact same PENDING -> ACCEPTED transition a
// volunteer's own "Accept" does (see backend pickupService.assignVolunteer)
// - it's a second entry point into one state machine, not a separate one.
function Assignments() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedVolunteer, setSelectedVolunteer] = useState<Record<string, string>>({});

  const { data: pendingPickups = [], isLoading: loadingPickups } = useQuery({
    queryKey: ['admin-pending-pickups'],
    queryFn: () => pickupsApi.getAvailable(),
  });

  const { data: volunteers = [], isLoading: loadingVolunteers } = useQuery({
    queryKey: ['admin-volunteers'],
    queryFn: () => usersApi.getAll({ role: 'VOLUNTEER' }),
  });

  const eligibleVolunteers = (volunteers as User[]).filter((v) => v.isActive);

  const assignMutation = useMutation({
    mutationFn: ({ pickupRequestId, volunteerId }: { pickupRequestId: string; volunteerId: string }) =>
      pickupsApi.assign(pickupRequestId, volunteerId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-pending-pickups'] });
      setSelectedVolunteer((prev) => {
        const next = { ...prev };
        delete next[variables.pickupRequestId];
        return next;
      });
      toast({ title: "Success", description: "Volunteer assigned to pickup" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const isLoading = loadingPickups || loadingVolunteers;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const pickups = pendingPickups as PickupRequest[];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold uppercase tracking-wider">Assign Volunteers</h2>
        <Badge variant="outline" className="text-xs uppercase">{pickups.length} pending</Badge>
      </div>

      {pickups.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <UserCheck className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No pickups need assignment right now</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pickups.map((pickup) => (
            <Card key={pickup.id}>
              <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{pickup.donation.foodType}</span>
                    {pickup.donation.isUrgent && (
                      <Badge variant="destructive" className="text-xs uppercase">URGENT</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {pickup.donation.donor.name} &rarr; {pickup.donation.claimedBy?.name || 'NGO'}
                  </p>
                  <p className="text-xs text-muted-foreground">{pickup.donation.pickupLocation}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedVolunteer[pickup.id] || ""}
                    onValueChange={(value) =>
                      setSelectedVolunteer((prev) => ({ ...prev, [pickup.id]: value }))
                    }
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Select volunteer" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleVolunteers.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">No active volunteers</div>
                      ) : (
                        eligibleVolunteers.map((v) => (
                          <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="text-xs uppercase tracking-wider"
                    disabled={!selectedVolunteer[pickup.id] || assignMutation.isPending}
                    onClick={() =>
                      assignMutation.mutate({
                        pickupRequestId: pickup.id,
                        volunteerId: selectedVolunteer[pickup.id],
                      })
                    }
                  >
                    {assignMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      "Assign"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const donationStatusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  AVAILABLE: "default",
  CLAIMED: "secondary",
  PICKED_UP: "outline",
  DELIVERED: "outline",
  EXPIRED: "destructive",
  CANCELLED: "destructive",
};

// Client-side hint only, mirroring donationService.cancel()'s server-side
// rule exactly (same helper as DonorDashboard's canCancelDonation - the
// server independently re-checks this atomically, so a stale hint here
// just means a clear conflict toast instead of a silently-wrong button).
// Phase 12.5 made this identical for DONOR and ADMIN: AVAILABLE, or
// CLAIMED with no volunteer accepted yet.
function canAdminCancelDonation(donation: Donation): boolean {
  if (donation.status === 'AVAILABLE') return true;
  return donation.status === 'CLAIMED' && !donation.pickupRequest?.volunteerId;
}

function useAdminCancelDonation() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Same synchronous double-submit guard used for donor cancellation and
  // NGO claim release (Phase 12) - a native confirm() blocks same-row
  // re-clicks while open; this ref covers the gap between confirming and
  // the mutation's own isPending reaching a re-render.
  const inFlight = useRef<Set<string>>(new Set());

  const mutation = useMutation({
    mutationFn: (id: string) => donationsApi.cancel(id),
    onSettled: (_data, _error, id) => {
      inFlight.current.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-donations'] });
      toast({ title: "Donation cancelled", description: "The donation has been cancelled." });
    },
    onError: (error: Error) => {
      toast({ title: "Cancellation failed", description: error.message, variant: "destructive" });
    },
  });

  const cancelDonation = (donation: Donation) => {
    if (inFlight.current.has(donation.id)) return;
    if (!confirm(`Cancel "${donation.foodType}" (from ${donation.donor.name})? This cannot be undone.`)) return;
    inFlight.current.add(donation.id);
    mutation.mutate(donation.id);
  };

  return { cancelDonation, isPending: (id: string) => mutation.isPending && mutation.variables === id };
}

// Phase 14: the smallest practical surface to exercise real moderation -
// every donation, newest first, with Cancel offered only where the
// backend actually allows it (see canAdminCancelDonation). Not a general
// donation-editing or detail view; that's out of this phase's scope.
function Donations() {
  const { cancelDonation, isPending } = useAdminCancelDonation();

  const { data: donations = [], isLoading } = useQuery({
    queryKey: ['admin-donations'],
    queryFn: () => donationsApi.getAll(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold uppercase tracking-wider">Donations</h2>
        <Badge variant="outline" className="text-xs uppercase">{donations.length} total</Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase">Food Type</TableHead>
                <TableHead className="text-xs uppercase">Donor</TableHead>
                <TableHead className="text-xs uppercase">Status</TableHead>
                <TableHead className="text-xs uppercase">Claimed By</TableHead>
                <TableHead className="text-xs uppercase">Posted</TableHead>
                <TableHead className="text-xs uppercase">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {donations.map((donation) => (
                <TableRow key={donation.id}>
                  <TableCell className="font-medium text-sm">
                    {donation.foodType}
                    {donation.isUrgent && (
                      <Badge variant="destructive" className="text-xs uppercase ml-2">Urgent</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{donation.donor.name}</TableCell>
                  <TableCell>
                    <Badge variant={donationStatusVariant[donation.status] || "outline"} className="text-xs uppercase">
                      {donation.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {donation.claimedBy?.name || <span>&mdash;</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">
                    {new Date(donation.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {canAdminCancelDonation(donation) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive"
                        disabled={isPending(donation.id)}
                        onClick={() => cancelDonation(donation)}
                      >
                        {isPending(donation.id) ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                        ) : (
                          <Ban className="w-3.5 h-3.5 mr-1" />
                        )}
                        Cancel
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">&mdash;</span>
                    )}
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

const AdminDashboard = () => {
  return (
    <Routes>
      <Route path="/" element={<DashboardLayout role="admin" title="Overview"><Overview /></DashboardLayout>} />
      <Route path="/users" element={<DashboardLayout role="admin" title="User Management"><UserManagement /></DashboardLayout>} />
      <Route path="/donations" element={<DashboardLayout role="admin" title="Donations"><Donations /></DashboardLayout>} />
      <Route path="/assignments" element={<DashboardLayout role="admin" title="Assign Volunteers"><Assignments /></DashboardLayout>} />
      <Route path="/analytics" element={<DashboardLayout role="admin" title="Analytics"><Analytics /></DashboardLayout>} />
      <Route path="/monitoring" element={<DashboardLayout role="admin" title="Monitoring"><Monitoring /></DashboardLayout>} />
      <Route path="/profile" element={<DashboardLayout role="admin" title="Profile"><Profile /></DashboardLayout>} />
    </Routes>
  );
};

export default AdminDashboard;

