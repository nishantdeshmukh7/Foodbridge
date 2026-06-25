import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { pickupsApi, Donation } from "@/api";
import { Truck, MapPin, Clock, CheckCircle, Navigation, Package, Star, Loader2 } from "lucide-react";

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

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    PENDING: "secondary",
    ACCEPTED: "default",
    PICKED_UP: "outline",
    DELIVERED: "outline",
    COMPLETED: "outline",
  };
  
  return (
    <Badge variant={variants[status] || "outline"} className="text-xs uppercase">
      {status}
    </Badge>
  );
}

interface PickupWithDonation {
  id: string;
  status: string;
  scheduledAt?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  notes?: string;
  donation: Donation;
  volunteer?: {
    id: string;
    name: string;
  };
  delivery?: {
    id: string;
    status: string;
    pickupPhotoUrl?: string;
    deliveryPhotoUrl?: string;
  };
}

function Overview() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: availablePickups = [], isLoading: loadingAvailable } = useQuery({
    queryKey: ['available-pickups'],
    queryFn: () => pickupsApi.getAvailable(),
  });

  const { data: myPickups = [], isLoading: loadingMy } = useQuery({
    queryKey: ['my-pickups'],
    queryFn: () => pickupsApi.getMyPickups(),
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => pickupsApi.accept(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['available-pickups'] });
      queryClient.invalidateQueries({ queryKey: ['my-pickups'] });
      toast({ title: "Success", description: "Pickup accepted! Now mark it as picked up." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const pickupMutation = useMutation({
    mutationFn: (id: string) => pickupsApi.pickup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-pickups'] });
      toast({ title: "Success", description: "Food marked as picked up! Now confirm delivery." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, photoUrl }: { id: string; photoUrl?: string }) => pickupsApi.complete(id, photoUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-pickups'] });
      toast({ title: "Success", description: "Delivery completed! Great work!" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const isLoading = loadingAvailable || loadingMy;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const availableTasks = availablePickups as PickupWithDonation[];
  const myTasks = myPickups as PickupWithDonation[];
  const activeTasks = myTasks?.filter(t => t.status === 'ACCEPTED' || t.status === 'PICKED_UP') || [];
  const completedToday = myTasks?.filter(t => t.status === 'DELIVERED' || t.status === 'COMPLETED').length || 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Available Tasks" value={availableTasks?.length || 0} icon={Package} accent />
        <StatCard label="In Progress" value={activeTasks?.length || 0} icon={Truck} />
        <StatCard label="Completed Today" value={completedToday} icon={CheckCircle} />
        <StatCard label="Total Pickups" value={myTasks?.length || 0} icon={Star} />
      </div>

      {/* Active task */}
      {activeTasks?.map((task) => (
        <Card key={task.id} className="border-primary">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base uppercase tracking-wider">Active Pickup</CardTitle>
              <Badge className={`font-mono text-xs ${task.status === 'PICKED_UP' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                {task.status === 'PICKED_UP' ? 'PICKED UP' : task.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="ticket-card p-3 space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Pickup From</p>
                <p className="font-semibold text-sm">{task.donation.donor.name}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {task.donation.pickupLocation}
                </p>
              </div>
              <div className="ticket-card p-3 space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Deliver To</p>
                <p className="font-semibold text-sm">{task.donation.claimedBy?.name || 'NGO'}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {task.donation.pickupLocation}
                </p>
              </div>
            </div>
            <div className="p-4 bg-accent flex items-center justify-center">
              <div className="text-center space-y-1">
                <Navigation className="w-8 h-8 mx-auto text-primary" />
                <p className="text-xs text-muted-foreground">Navigate to pickup location</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <p className="font-semibold text-sm">{task.donation.foodType}</p>
              <p className="text-xs text-muted-foreground">· {task.donation.quantity}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {task.status === 'ACCEPTED' && (
                <Button 
                  variant="outline" 
                  className="text-xs uppercase tracking-wider"
                  onClick={() => pickupMutation.mutate(task.id)}
                  disabled={pickupMutation.isPending}
                >
                  {pickupMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  ) : (
                    <Package className="w-3.5 h-3.5 mr-1" />
                  )} 
                  Picked Up
                </Button>
              )}
              {task.status === 'PICKED_UP' && (
                <Button 
                  className="btn-dispatch text-xs"
                  onClick={() => completeMutation.mutate({ id: task.id })}
                  disabled={completeMutation.isPending}
                >
                  {completeMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle className="w-3.5 h-3.5 mr-1" />
                  )} 
                  Delivered
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base uppercase tracking-wider">Available Tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(!availableTasks || availableTasks.length === 0) ? (
            <div className="text-center py-8">
              <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No available pickup tasks</p>
            </div>
          ) : (
            availableTasks.map((task) => (
              <div key={task.id} className="ticket-card p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{task.donation.foodType}</span>
                    {task.donation.isUrgent && (
                      <Badge variant="destructive" className="text-xs uppercase">URGENT</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {task.donation.donor.name} → {task.donation.claimedBy?.name || 'NGO'}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3" /> {task.donation.pickupLocation}
                  </p>
                </div>
                <Button 
                  size="sm" 
                  className="bg-primary text-primary-foreground text-xs uppercase tracking-wider"
                  onClick={() => acceptMutation.mutate(task.id)}
                  disabled={acceptMutation.isPending}
                >
                  {acceptMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    "Accept"
                  )}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PickupTasks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: availablePickups = [], isLoading: loadingAvailable } = useQuery({
    queryKey: ['available-pickups'],
    queryFn: () => pickupsApi.getAvailable(),
  });

  const { data: myPickups = [], isLoading: loadingMy } = useQuery({
    queryKey: ['my-pickups'],
    queryFn: () => pickupsApi.getMyPickups(),
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => pickupsApi.accept(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['available-pickups'] });
      queryClient.invalidateQueries({ queryKey: ['my-pickups'] });
      toast({ title: "Success", description: "Pickup accepted!" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const pickupMutation = useMutation({
    mutationFn: (id: string) => pickupsApi.pickup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-pickups'] });
      toast({ title: "Success", description: "Food picked up!" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, photoUrl }: { id: string; photoUrl?: string }) => pickupsApi.complete(id, photoUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-pickups'] });
      toast({ title: "Success", description: "Delivery completed!" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const isLoading = loadingAvailable || loadingMy;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const allTasks = [
    ...(availablePickups as PickupWithDonation[]).map(p => ({ ...p, isMine: false })),
    ...(myPickups as PickupWithDonation[]).map(p => ({ ...p, isMine: true })),
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold uppercase tracking-wider">All Pickup Tasks</h2>
      <div className="space-y-3">
        {allTasks.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No pickup tasks available</p>
            </CardContent>
          </Card>
        ) : (
          allTasks.map((task) => (
            <Card key={task.id} className={task.isMine ? "border-primary" : ""}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{task.donation.foodType}</span>
                    {task.donation.isUrgent && (
                      <Badge variant="destructive" className="text-xs uppercase">URGENT</Badge>
                    )}
                  </div>
                  <StatusBadge status={task.status} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Pickup</p>
                    <p className="font-medium">{task.donation.donor.name}</p>
                    <p className="text-muted-foreground">{task.donation.pickupLocation}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Deliver to</p>
                    <p className="font-medium">{task.donation.claimedBy?.name || 'NGO'}</p>
                    <p className="text-muted-foreground">{task.donation.pickupLocation}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Quantity: {task.donation.quantity}
                  </p>
                  {!task.isMine && task.status === 'PENDING' ? (
                    <Button 
                      size="sm" 
                      className="bg-primary text-primary-foreground text-xs"
                      onClick={() => acceptMutation.mutate(task.id)}
                      disabled={acceptMutation.isPending}
                    >
                      {acceptMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Accept"}
                    </Button>
                  ) : task.isMine ? (
                    <div className="flex gap-2">
                      {task.status === 'ACCEPTED' && (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="text-xs"
                          onClick={() => pickupMutation.mutate(task.id)}
                          disabled={pickupMutation.isPending}
                        >
                          {pickupMutation.isPending ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                          ) : (
                            <Package className="w-3.5 h-3.5 mr-1" />
                          )} 
                          Picked Up
                        </Button>
                      )}
                      {task.status === 'PICKED_UP' && (
                        <Button 
                          size="sm" 
                          className="bg-primary text-primary-foreground text-xs"
                          onClick={() => completeMutation.mutate({ id: task.id })}
                          disabled={completeMutation.isPending}
                        >
                          {completeMutation.isPending ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle className="w-3.5 h-3.5 mr-1" />
                          )} 
                          Delivered
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function Completed() {
  const { data: myPickups = [], isLoading } = useQuery({
    queryKey: ['my-pickups'],
    queryFn: () => pickupsApi.getMyPickups(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const completedTasks = (myPickups as PickupWithDonation[]).filter(
    t => t.status === 'DELIVERED' || t.status === 'COMPLETED'
  );

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold uppercase tracking-wider">Completed Deliveries</h2>
      <div className="space-y-3">
        {completedTasks.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <CheckCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No completed deliveries yet</p>
            </CardContent>
          </Card>
        ) : (
          completedTasks.map((task) => (
            <Card key={task.id}>
              <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm">{task.donation.foodType}</p>
                  <p className="text-xs text-muted-foreground">
                    {task.donation.donor.name} → {task.donation.claimedBy?.name || 'NGO'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {task.deliveredAt ? new Date(task.deliveredAt).toLocaleString() : 'Completed'}
                  </p>
                </div>
                <StatusBadge status={task.status} />
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

const VolunteerDashboard = () => {
  return (
    <Routes>
      <Route path="/" element={<DashboardLayout role="volunteer" title="Overview"><Overview /></DashboardLayout>} />
      <Route path="/tasks" element={<DashboardLayout role="volunteer" title="Pickup Tasks"><PickupTasks /></DashboardLayout>} />
      <Route path="/completed" element={<DashboardLayout role="volunteer" title="Completed"><Completed /></DashboardLayout>} />
    </Routes>
  );
};

export default VolunteerDashboard;

