import { useState, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { Routes, Route } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/DashboardLayout";
import Profile from "@/pages/Profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { donationsApi, pickupsApi, Donation } from "@/api";
import { MapPin, Clock, Package, Truck, CheckCircle, Phone, Navigation, Search, Loader2, Undo2 } from "lucide-react";

function StatCard({ label, value, icon: Icon, accent = false }: { label: string; value: string | number; icon: React.ElementType; accent?: boolean }) {
  return (
    <Card className={accent ? "border-primary" : ""}>
      <CardContent className="p-4 flex items-center gap-4">
        <div className={`w-10 h-10 flex items-center justify-center ${accent ? "bg-primary text-primary-foreground" : "bg-accent"}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-2xl font-bold font-mono">{value}</p>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ExpiryBadge({ time }: { time: string }) {
  const now = new Date();
  const expiry = new Date(time);
  const diff = expiry.getTime() - now.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (diff < 0) return <Badge variant="destructive" className="font-mono text-xs">EXPIRED</Badge>;

  const isUrgent = hours < 2;
  const timeDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  return (
    <Badge variant={isUrgent ? "destructive" : "secondary"} className="font-mono text-xs">
      <Clock className="w-3 h-3 mr-1" />
      {timeDisplay}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    PENDING: "secondary",
    ACCEPTED: "default",
    REJECTED: "destructive",
    PICKED_UP: "outline",
    DELIVERED: "outline",
  };

  return (
    <Badge variant={variants[status] || "outline"} className="text-xs uppercase">
      {status}
    </Badge>
  );
}

// Client-side hint only, mirroring donationService.releaseClaim()'s server
// rule - the server re-checks all of this atomically. The claimedBy.id
// check is now redundant with the server-side scoping in getMyClaims()
// (Phase 12.5 - every donation this page fetches already belongs to the
// caller), but is kept as cheap defense in depth against this data ever
// being shown via a differently-scoped query in the future.
function canReleaseClaim(donation: Donation, currentUserId: string | undefined): boolean {
  if (!currentUserId || donation.status !== 'CLAIMED') return false;
  if (donation.claimedBy?.id !== currentUserId) return false;
  return !donation.pickupRequest?.volunteerId;
}

function useReleaseClaim() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Same synchronous double-submit guard used for donor cancellation
  // (Phase 12) - covers the gap between confirm() resolving and the
  // mutation's own isPending reaching a re-render.
  const inFlight = useRef<Set<string>>(new Set());

  const mutation = useMutation({
    mutationFn: (id: string) => donationsApi.release(id),
    onSettled: (_data, _error, id) => {
      inFlight.current.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['available-donations'] });
      queryClient.invalidateQueries({ queryKey: ['my-claims'] });
      toast({ title: "Claim released", description: "The donation is available for other NGOs to claim." });
    },
    onError: (error: Error) => {
      toast({ title: "Release failed", description: error.message, variant: "destructive" });
    },
  });

  const releaseClaim = (donation: Donation) => {
    if (inFlight.current.has(donation.id)) return;
    if (!confirm(`Release your claim on "${donation.foodType}"? Another NGO will be able to claim it.`)) return;
    inFlight.current.add(donation.id);
    mutation.mutate(donation.id);
  };

  return { releaseClaim, isPending: (id: string) => mutation.isPending && mutation.variables === id };
}

function Overview() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { releaseClaim, isPending } = useReleaseClaim();

  const { data: availableDonations = [], isLoading: loadingAvailable } = useQuery({
    queryKey: ['available-donations'],
    queryFn: () => donationsApi.getAll({ status: 'AVAILABLE' }),
  });

  const { data: myClaims = [], isLoading: loadingClaims } = useQuery({
    queryKey: ['my-claims'],
    queryFn: () => donationsApi.getMyClaims({ status: 'CLAIMED' }),
  });

  const claimMutation = useMutation({
    mutationFn: (id: string) => donationsApi.claim(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['available-donations'] });
      queryClient.invalidateQueries({ queryKey: ['my-claims'] });
      toast({ title: "Success", description: "Donation claimed successfully!" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const isLoading = loadingAvailable || loadingClaims;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const activeClaims = myClaims.filter(d => d.status === 'CLAIMED' || d.status === 'PICKED_UP');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Nearby Listings" value={availableDonations.length} icon={MapPin} accent />
        <StatCard label="Active Claims" value={activeClaims.length} icon={Clock} />
        <StatCard label="Meals Received" value={myClaims.filter(d => d.status === 'DELIVERED').length} icon={Package} />
        <StatCard label="Total Claims" value={myClaims.length} icon={Truck} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base uppercase tracking-wider">Available Food</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {availableDonations.length === 0 ? (
            <div className="text-center py-8">
              <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No available donations at the moment</p>
            </div>
          ) : (
            availableDonations.slice(0, 5).map((donation) => (
              <div key={donation.id} className="ticket-card p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{donation.foodType}</span>
                    <ExpiryBadge time={donation.expiryTime} />
                    {donation.isUrgent && (
                      <Badge variant="destructive" className="text-xs">URGENT</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {donation.donor.name} · {donation.quantity} · {donation.pickupLocation}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="bg-primary text-primary-foreground text-xs uppercase tracking-wider"
                  onClick={() => claimMutation.mutate(donation.id)}
                  disabled={claimMutation.isPending}
                >
                  {claimMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Claim"}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {activeClaims.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base uppercase tracking-wider">Active Tracking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeClaims.map((donation) => (
              <div key={donation.id} className="ticket-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm">{donation.foodType}</span>
                  <Badge className="font-mono text-xs uppercase bg-primary text-primary-foreground">
                    {donation.status === "PICKED_UP" ? "In Transit" : "Claimed"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>From: {donation.donor.name}</span>
                    {donation.pickupRequest?.volunteer && (
                      <span>Volunteer: {donation.pickupRequest.volunteer.name}</span>
                    )}
                  </div>
                  {canReleaseClaim(donation, user?.id) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs uppercase tracking-wider flex-shrink-0"
                      disabled={isPending(donation.id)}
                      onClick={() => releaseClaim(donation)}
                    >
                      {isPending(donation.id) ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                      ) : (
                        <Undo2 className="w-3.5 h-3.5 mr-1" />
                      )}
                      Release Claim
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BrowseFood() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");

  const { data: donations = [], isLoading } = useQuery({
    queryKey: ['available-donations', searchTerm],
    queryFn: () => donationsApi.getAll({
      status: 'AVAILABLE',
      foodType: searchTerm || undefined,
    }),
  });

  const claimMutation = useMutation({
    mutationFn: (id: string) => donationsApi.claim(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['available-donations'] });
      toast({ title: "Success", description: "Donation claimed successfully!" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
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
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by food type..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>
      {/* Phase 15: the "Within X km" distance filter that used to be here
          was removed rather than fixed. It never actually filtered
          results (Phase 9 audit), and genuine distance filtering isn't
          implementable with the current data model - User.location and
          Donation.pickupLocation are free-text addresses with no
          coordinates anywhere in the schema, and no geocoding provider
          exists in this project. See the Phase 15 report for the
          architectural blocker and what a real implementation would
          require. A non-functional control that claimed to filter by
          kilometers was worse than no control at all. */}

      <div className="space-y-3">
        {donations.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No donations found</p>
            </CardContent>
          </Card>
        ) : (
          donations.map((donation) => (
            <Card key={donation.id}>
              <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Package className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{donation.foodType}</span>
                    <ExpiryBadge time={donation.expiryTime} />
                    {donation.isUrgent && (
                      <Badge variant="destructive" className="text-xs">URGENT</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {donation.donor.name} · {donation.quantity}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3" /> {donation.pickupLocation}
                  </p>
                  {donation.donor.phone && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3" /> {donation.donor.phone}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {donation.donor.phone && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-8"
                      onClick={() => window.open(`tel:${donation.donor.phone}`, '_self')}
                    >
                      <Phone className="w-3.5 h-3.5 mr-1" /> Contact
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="bg-primary text-primary-foreground text-xs h-8"
                    onClick={() => claimMutation.mutate(donation.id)}
                    disabled={claimMutation.isPending}
                  >
                    {claimMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Claim"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function MyRequests() {
  const { user } = useAuth();
  const { releaseClaim, isPending } = useReleaseClaim();

  const { data: claimedDonations = [], isLoading } = useQuery({
    queryKey: ['my-claims'],
    queryFn: () => donationsApi.getMyClaims({ status: 'CLAIMED' }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    CLAIMED: "bg-primary/10 text-primary",
    PICKED_UP: "bg-primary text-primary-foreground",
    DELIVERED: "bg-foreground text-background",
  };

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold uppercase tracking-wider">My Requests</h2>
      <div className="space-y-3">
        {claimedDonations.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No claimed donations yet</p>
            </CardContent>
          </Card>
        ) : (
          claimedDonations.map((donation) => (
            <Card key={donation.id}>
              <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1">
                  <p className="font-semibold text-sm">{donation.foodType}</p>
                  <p className="text-xs text-muted-foreground">From: {donation.donor.name}</p>
                  <p className="text-xs text-muted-foreground">Quantity: {donation.quantity}</p>
                  {donation.pickupRequest?.volunteer && (
                    <p className="text-xs text-muted-foreground">Volunteer: {donation.pickupRequest.volunteer.name}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`text-xs uppercase ${statusColors[donation.status] || ''}`}>
                    {donation.status.replace("_", " ")}
                  </Badge>
                  {canReleaseClaim(donation, user?.id) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs uppercase tracking-wider"
                      disabled={isPending(donation.id)}
                      onClick={() => releaseClaim(donation)}
                    >
                      {isPending(donation.id) ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                      ) : (
                        <Undo2 className="w-3.5 h-3.5 mr-1" />
                      )}
                      Release Claim
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function Tracking() {
  const { data: claimedDonations = [], isLoading } = useQuery({
    queryKey: ['my-claims'],
    queryFn: () => donationsApi.getMyClaims({ status: 'CLAIMED' }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const transitItems = claimedDonations.filter(d => d.status === 'CLAIMED' || d.status === 'PICKED_UP');

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold uppercase tracking-wider">Live Tracking</h2>
      {transitItems.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            <Truck className="w-12 h-12 mx-auto mb-4" />
            No active deliveries to track
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {transitItems.map((donation) => (
            <Card key={donation.id} className="border-primary">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{donation.foodType}</span>
                  <Badge className="bg-primary text-primary-foreground font-mono text-xs">
                    {donation.status === "PICKED_UP" ? "IN TRANSIT" : "CLAIMED"}
                  </Badge>
                </div>
                <div className="h-48 bg-accent flex items-center justify-center">
                  <div className="text-center space-y-1">
                    <Navigation className="w-8 h-8 mx-auto text-primary" />
                    <p className="text-xs text-muted-foreground">Live map tracking</p>
                    <p className="text-xs text-muted-foreground">{donation.pickupLocation}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <p className="text-muted-foreground">Donor</p>
                    <p className="font-semibold">{donation.donor.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Quantity</p>
                    <p className="font-mono font-bold text-primary text-lg">{donation.quantity}</p>
                  </div>
                </div>
                {donation.donor.phone && (
                  <Button
                    variant="outline"
                    className="w-full text-xs uppercase tracking-wider"
                    onClick={() => window.open(`tel:${donation.donor.phone}`, '_self')}
                  >
                    <Phone className="w-3.5 h-3.5 mr-1" /> Contact Donor
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const NgoDashboard = () => {
  return (
    <Routes>
      <Route path="/" element={<DashboardLayout role="ngo" title="Overview"><Overview /></DashboardLayout>} />
      <Route path="/browse" element={<DashboardLayout role="ngo" title="Browse Food"><BrowseFood /></DashboardLayout>} />
      <Route path="/requests" element={<DashboardLayout role="ngo" title="My Requests"><MyRequests /></DashboardLayout>} />
      <Route path="/tracking" element={<DashboardLayout role="ngo" title="Tracking"><Tracking /></DashboardLayout>} />
      <Route path="/profile" element={<DashboardLayout role="ngo" title="Profile"><Profile /></DashboardLayout>} />
    </Routes>
  );
};

export default NgoDashboard;

