import { useState, useEffect, useRef } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/DashboardLayout";
import Profile from "@/pages/Profile";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { donationsApi, Donation, CreateDonationData } from "@/api";
import { Package, Clock, CheckCircle, XCircle, AlertTriangle, Plus, Ban, Loader2 } from "lucide-react";

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
    AVAILABLE: "default",
    CLAIMED: "secondary",
    PICKED_UP: "outline",
    DELIVERED: "outline",
    EXPIRED: "destructive",
    CANCELLED: "destructive",
  };
  
  return (
    <Badge variant={variants[status] || "outline"} className="text-xs uppercase">
      {status}
    </Badge>
  );
}

// Client-side hint only - mirrors donationService.cancel()'s server-side
// rule (a UI display decision, not an authorization decision: the server
// re-checks this exact condition atomically and is what actually enforces
// it, so a stale hint here just means a clear conflict toast instead of a
// silent wrong button).
function canCancelDonation(donation: Donation): boolean {
  if (donation.status === 'AVAILABLE') return true;
  return donation.status === 'CLAIMED' && !donation.pickupRequest?.volunteer;
}

function useCancelDonation() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // A native confirm() dialog blocks the whole page until dismissed, which
  // already rules out a same-row double-click while it's open. This ref
  // covers the remaining window - after confirming, before the mutation's
  // own isPending has propagated to a re-render - so a second confirm+click
  // on the same row can't fire a second request.
  const inFlight = useRef<Set<string>>(new Set());

  const mutation = useMutation({
    mutationFn: (id: string) => donationsApi.cancel(id),
    onSettled: (_data, _error, id) => {
      inFlight.current.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-donations'] });
      queryClient.invalidateQueries({ queryKey: ['donation-stats'] });
      toast({ title: "Donation cancelled", description: "Your donation has been cancelled." });
    },
    onError: (error: Error) => {
      toast({ title: "Cancellation failed", description: error.message, variant: "destructive" });
    },
  });

  const cancelDonation = (donation: Donation) => {
    if (inFlight.current.has(donation.id)) return;
    if (!confirm(`Cancel "${donation.foodType}"? This cannot be undone.`)) return;
    inFlight.current.add(donation.id);
    mutation.mutate(donation.id);
  };

  return { cancelDonation, isPending: (id: string) => mutation.isPending && mutation.variables === id };
}

function Overview() {
  const navigate = useNavigate();
  const { cancelDonation, isPending } = useCancelDonation();

  const { data: donations = [], isLoading } = useQuery({
    queryKey: ['my-donations'],
    queryFn: () => donationsApi.getMyDonations(),
  });

  const { data: stats } = useQuery({
    queryKey: ['donation-stats'],
    queryFn: () => donationsApi.getStats(),
  });

  const activeDonations = donations.filter(d => d.status === 'AVAILABLE');
  const pendingClaims = donations.filter(d => d.status === 'CLAIMED');
  const deliveredCount = donations.filter(d => d.status === 'DELIVERED').length;

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
        <StatCard label="Active Listings" value={activeDonations.length} icon={Package} accent />
        <StatCard label="Pending Claims" value={pendingClaims.length} icon={Clock} />
        <StatCard label="Meals Donated" value={deliveredCount} icon={CheckCircle} />
        <StatCard label="Total Listings" value={donations.length} icon={AlertTriangle} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base uppercase tracking-wider">My Listings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {donations.length === 0 ? (
            <div className="text-center py-8">
              <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-4">No donations yet</p>
              <Button onClick={() => navigate('/donor/create')}>
                <Plus className="w-4 h-4 mr-2" />
                Create First Listing
              </Button>
            </div>
          ) : (
            donations.map((donation) => (
              <div key={donation.id} className="ticket-card p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{donation.foodType}</span>
                    <ExpiryBadge time={donation.expiryTime} />
                    <StatusBadge status={donation.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {donation.quantity} · {donation.pickupLocation}
                  </p>
                  {donation.claimedBy && (
                    <p className="text-xs text-primary mt-1">
                      Claimed by: {donation.claimedBy.name} ({donation.claimedBy.organization})
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {canCancelDonation(donation) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs uppercase tracking-wider text-destructive border-destructive/40 hover:bg-destructive/10"
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
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateListing() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    foodType: "",
    quantity: "",
    description: "",
    expiryTime: "",
    pickupLocation: "",
    isUrgent: false,
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateDonationData) => donationsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-donations'] });
      toast({ title: "Success", description: "Donation created successfully!" });
      navigate('/donor');
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setIsLoading(false);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    const expiryDate = new Date();
    const hours = parseInt(formData.expiryTime) || 4;
    expiryDate.setHours(expiryDate.getHours() + hours);
    
    createMutation.mutate({
      foodType: formData.foodType,
      quantity: formData.quantity,
      description: formData.description,
      expiryTime: expiryDate.toISOString(),
      pickupLocation: formData.pickupLocation,
      isUrgent: formData.isUrgent,
    });
  };

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base uppercase tracking-wider">New Food Listing</CardTitle>
          <CardDescription>Create a new surplus food listing for pickup</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider">Food Type *</Label>
                <Select 
                  value={formData.foodType} 
                  onValueChange={(value) => setFormData({ ...formData, foodType: value })}
                  required
                >
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cooked">Cooked Food</SelectItem>
                    <SelectItem value="raw">Raw Ingredients</SelectItem>
                    <SelectItem value="packaged">Packaged Food</SelectItem>
                    <SelectItem value="fruits">Fruits & Vegetables</SelectItem>
                    <SelectItem value="bakery">Bakery Items</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider">Quantity *</Label>
                <Input 
                  placeholder="e.g., 50 servings or 20 kg"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider">Description</Label>
              <Textarea 
                placeholder="Describe the food items, preparation details..."
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider">Expiry Time *</Label>
                <Select 
                  value={formData.expiryTime}
                  onValueChange={(value) => setFormData({ ...formData, expiryTime: value })}
                  required
                >
                  <SelectTrigger><SelectValue placeholder="Select window" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 Hour</SelectItem>
                    <SelectItem value="2">2 Hours</SelectItem>
                    <SelectItem value="4">4 Hours</SelectItem>
                    <SelectItem value="6">6 Hours</SelectItem>
                    <SelectItem value="12">12 Hours</SelectItem>
                    <SelectItem value="24">24 Hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider">Pickup Location *</Label>
                <Input 
                  placeholder="Address or landmark"
                  value={formData.pickupLocation}
                  onChange={(e) => setFormData({ ...formData, pickupLocation: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isUrgent"
                checked={formData.isUrgent}
                onChange={(e) => setFormData({ ...formData, isUrgent: e.target.checked })}
                className="accent-primary"
              />
              <Label htmlFor="isUrgent" className="text-sm cursor-pointer">Mark as Urgent</Label>
            </div>

            <Card className="bg-accent">
              <CardContent className="p-4 space-y-3">
                <p className="text-xs uppercase tracking-wider font-semibold">Food Safety Checklist</p>
                {["Food prepared in hygienic conditions", "Stored at proper temperature", "No signs of spoilage", "Packed in clean containers"].map((item) => (
                  <label key={item} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="accent-primary" required />
                    {item}
                  </label>
                ))}
              </CardContent>
            </Card>

            <Button type="submit" className="btn-dispatch" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Package className="w-4 h-4 mr-2" />
              )}
              Publish Listing
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Listings() {
  const { cancelDonation, isPending } = useCancelDonation();

  const { data: donations = [], isLoading } = useQuery({
    queryKey: ['my-donations'],
    queryFn: () => donationsApi.getMyDonations(),
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
        <h2 className="text-base font-semibold uppercase tracking-wider">My Listings</h2>
      </div>
      <div className="space-y-3">
        {donations.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No donations yet</p>
            </CardContent>
          </Card>
        ) : (
          donations.map((donation) => (
            <Card key={donation.id}>
              <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{donation.foodType}</span>
                    <ExpiryBadge time={donation.expiryTime} />
                    <StatusBadge status={donation.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {donation.quantity} · {donation.pickupLocation}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {canCancelDonation(donation) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs uppercase tracking-wider text-destructive border-destructive/40 hover:bg-destructive/10"
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

function Requests() {
  const { cancelDonation, isPending } = useCancelDonation();

  const { data: donations = [], isLoading } = useQuery({
    queryKey: ['my-donations'],
    queryFn: () => donationsApi.getMyDonations(),
  });

  const claimedDonations = donations.filter(d => d.status === 'CLAIMED' || d.status === 'PICKED_UP' || d.status === 'DELIVERED');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold uppercase tracking-wider">Pickup Requests</h2>
      <div className="space-y-3">
        {claimedDonations.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No claimed donations yet</p>
            </CardContent>
          </Card>
        ) : (
          claimedDonations.map((donation) => (
            <Card key={donation.id}>
              <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1">
                  <p className="font-semibold text-sm">{donation.claimedBy?.name || 'Unknown NGO'}</p>
                  <p className="text-xs text-muted-foreground">
                    {donation.foodType} · {donation.quantity}
                  </p>
                  {donation.pickupRequest?.volunteer && (
                    <p className="text-xs text-primary mt-1">
                      Volunteer: {donation.pickupRequest.volunteer.name}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={donation.status} />
                  {canCancelDonation(donation) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs uppercase tracking-wider text-destructive border-destructive/40 hover:bg-destructive/10"
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

const DonorDashboard = () => {
  return (
    <Routes>
      <Route path="/" element={<DashboardLayout role="donor" title="Overview"><Overview /></DashboardLayout>} />
      <Route path="/create" element={<DashboardLayout role="donor" title="Create Listing"><CreateListing /></DashboardLayout>} />
      <Route path="/listings" element={<DashboardLayout role="donor" title="My Listings"><Listings /></DashboardLayout>} />
      <Route path="/requests" element={<DashboardLayout role="donor" title="Requests"><Requests /></DashboardLayout>} />
      <Route path="/profile" element={<DashboardLayout role="donor" title="Profile"><Profile /></DashboardLayout>} />
    </Routes>
  );
};

export default DonorDashboard;

