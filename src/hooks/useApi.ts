import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  donationsApi, 
  pickupsApi, 
  usersApi, 
  authApi,
  Donation,
  CreateDonationData,
  PickupRequest,
  User,
  UserStats,
  DonationStats
} from '@/api';

// Query keys
export const queryKeys = {
  donations: {
    all: ['donations'] as const,
    lists: () => [...queryKeys.donations.all, 'list'] as const,
    list: (filters: Record<string, string>) => [...queryKeys.donations.lists(), filters] as const,
    details: () => [...queryKeys.donations.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.donations.details(), id] as const,
    myDonations: () => [...queryKeys.donations.all, 'my'] as const,
    stats: () => [...queryKeys.donations.all, 'stats'] as const,
  },
  pickups: {
    all: ['pickups'] as const,
    available: () => [...queryKeys.pickups.all, 'available'] as const,
    myPickups: () => [...queryKeys.pickups.all, 'my'] as const,
    detail: (id: string) => [...queryKeys.pickups.all, id] as const,
  },
  users: {
    all: ['users'] as const,
    lists: () => [...queryKeys.users.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.users.all, id] as const,
    stats: () => [...queryKeys.users.all, 'stats'] as const,
    pending: () => [...queryKeys.users.all, 'pending'] as const,
  },
  auth: {
    profile: ['auth', 'profile'] as const,
  },
};

// Auth hooks
export function useProfile() {
  return useQuery({
    queryKey: queryKeys.auth.profile,
    queryFn: authApi.getProfile,
    enabled: false, // Only fetch on demand
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: Parameters<typeof authApi.updateProfile>[0]) => authApi.updateProfile(data),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.auth.profile, data);
    },
  });
}

// Donation hooks
export function useDonations(filters?: { status?: string; foodType?: string; location?: string }) {
  return useQuery({
    queryKey: queryKeys.donations.list(filters || {}),
    queryFn: () => donationsApi.getAll(filters),
  });
}

export function useDonation(id: string) {
  return useQuery({
    queryKey: queryKeys.donations.detail(id),
    queryFn: () => donationsApi.getById(id),
    enabled: !!id,
  });
}

export function useMyDonations() {
  return useQuery({
    queryKey: queryKeys.donations.myDonations(),
    queryFn: donationsApi.getMyDonations,
  });
}

export function useDonationStats() {
  return useQuery({
    queryKey: queryKeys.donations.stats(),
    queryFn: donationsApi.getStats,
  });
}

export function useCreateDonation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateDonationData) => donationsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.donations.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.donations.myDonations() });
    },
  });
}

export function useClaimDonation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => donationsApi.claim(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.donations.all });
    },
  });
}

export function useDeleteDonation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => donationsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.donations.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.donations.myDonations() });
    },
  });
}

// Pickup hooks
export function useAvailablePickups() {
  return useQuery({
    queryKey: queryKeys.pickups.available(),
    queryFn: pickupsApi.getAvailable,
  });
}

export function useMyPickups() {
  return useQuery({
    queryKey: queryKeys.pickups.myPickups(),
    queryFn: pickupsApi.getMyPickups,
  });
}

export function usePickup(id: string) {
  return useQuery({
    queryKey: queryKeys.pickups.detail(id),
    queryFn: () => pickupsApi.getById(id),
    enabled: !!id,
  });
}

export function useAcceptPickup() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (pickupRequestId: string) => pickupsApi.accept(pickupRequestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pickups.all });
    },
  });
}

export function useCompletePickup() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ pickupRequestId, photoUrl }: { pickupRequestId: string; photoUrl?: string }) => 
      pickupsApi.complete(pickupRequestId, photoUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pickups.all });
    },
  });
}

export function useAssignVolunteer() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ pickupRequestId, volunteerId }: { pickupRequestId: string; volunteerId: string }) =>
      pickupsApi.assign(pickupRequestId, volunteerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pickups.all });
    },
  });
}

// User hooks (Admin)
export function useUsers(filters?: { role?: string; isApproved?: boolean; search?: string }) {
  return useQuery({
    queryKey: [...queryKeys.users.lists(), filters],
    queryFn: () => usersApi.getAll(filters),
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: queryKeys.users.detail(id),
    queryFn: () => usersApi.getById(id),
    enabled: !!id,
  });
}

export function useUserStats() {
  return useQuery({
    queryKey: queryKeys.users.stats(),
    queryFn: usersApi.getStats,
  });
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: queryKeys.users.pending(),
    queryFn: usersApi.getPending,
  });
}

export function useApproveUser() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => usersApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.users.pending() });
    },
  });
}

export function useRejectUser() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => usersApi.reject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.users.pending() });
    },
  });
}

export function useSuspendUser() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => usersApi.suspend(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
  });
}

