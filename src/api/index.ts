const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;

  const token = localStorage.getItem('token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(response.status, error.error || 'Request failed');
  }

  return response.json();
}

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    request<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  register: (data: RegisterData) =>
    request<{ user: User; token: string }>('/auth/register', {
      method: 'POST',
      body: data,
    }),

  getProfile: () => request<User>('/auth/profile'),

  updateProfile: (data: Partial<RegisterData>) =>
    request<User>('/auth/profile', {
      method: 'PUT',
      body: data,
    }),
};

// Donations API
export const donationsApi = {
  getAll: (filters?: { status?: string; foodType?: string; location?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.foodType) params.append('foodType', filters.foodType);
    if (filters?.location) params.append('location', filters.location);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<Donation[]>(`/donations${query}`);
  },

  getById: (id: string) => request<Donation>(`/donations/${id}`),

  getMyDonations: () => request<Donation[]>('/donations/my-donations'),

  create: (data: CreateDonationData) =>
    request<Donation>('/donations', {
      method: 'POST',
      body: data,
    }),

  updateStatus: (id: string, status: string) =>
    request<Donation>(`/donations/${id}/status`, {
      method: 'PUT',
      body: { status },
    }),

  delete: (id: string) =>
    request<{ message: string }>(`/donations/${id}`, {
      method: 'DELETE',
    }),

  claim: (id: string) =>
    request<Donation>(`/donations/${id}/claim`, {
      method: 'POST',
    }),

  getStats: () => request<DonationStats>('/donations/stats'),
};

// Pickups API
export const pickupsApi = {
  getAvailable: () => request<PickupRequest[]>('/pickups/available'),

  getMyPickups: () => request<PickupRequest[]>('/pickups/my-pickups'),

  getById: (id: string) => request<PickupRequest>(`/pickups/${id}`),

  create: (donationId: string) =>
    request<PickupRequest>('/pickups', {
      method: 'POST',
      body: { donationId },
    }),

  assign: (pickupRequestId: string, volunteerId: string) =>
    request<PickupRequest>(`/pickups/${pickupRequestId}/assign`, {
      method: 'POST',
      body: { volunteerId },
    }),

  accept: (pickupRequestId: string) =>
    request<PickupRequest>(`/pickups/${pickupRequestId}/accept`, {
      method: 'POST',
    }),

  pickup: (pickupRequestId: string) =>
    request<PickupRequest>(`/pickups/${pickupRequestId}/pickup`, {
      method: 'POST',
    }),

  complete: (pickupRequestId: string, photoUrl?: string) =>
    request<PickupRequest>(`/pickups/${pickupRequestId}/complete`, {
      method: 'POST',
      body: { photoUrl },
    }),
};

// Users API (Admin)
export const usersApi = {
  getAll: (filters?: { role?: string; isApproved?: boolean; search?: string }) => {
    const params = new URLSearchParams();
    if (filters?.role) params.append('role', filters.role);
    if (filters?.isApproved !== undefined) params.append('isApproved', String(filters.isApproved));
    if (filters?.search) params.append('search', filters.search);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<User[]>(`/users${query}`);
  },

  getById: (id: string) => request<User>(`/users/${id}`),

  getStats: () => request<UserStats>('/users/stats'),

  getPending: () => request<User[]>('/users/pending'),

  approve: (id: string) => request<User>(`/users/${id}/approve`, { method: 'POST' }),

  reject: (id: string) => request<{ message: string }>(`/users/${id}/reject`, { method: 'POST' }),

  suspend: (id: string) => request<User>(`/users/${id}/suspend`, { method: 'POST' }),

  activate: (id: string) => request<User>(`/users/${id}/activate`, { method: 'POST' }),
};

// Types
export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  location?: string;
  organization?: string;
  role: 'ADMIN' | 'DONOR' | 'NGO' | 'VOLUNTEER';
  isApproved: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
  phone?: string;
  location?: string;
  organization?: string;
  role: 'ADMIN' | 'DONOR' | 'NGO' | 'VOLUNTEER';
}

export interface Donation {
  id: string;
  foodType: string;
  quantity: string;
  description?: string;
  expiryTime: string;
  pickupLocation: string;
  imageUrl?: string;
  status: 'AVAILABLE' | 'CLAIMED' | 'PICKED_UP' | 'DELIVERED' | 'EXPIRED' | 'CANCELLED';
  isUrgent: boolean;
  createdAt: string;
  updatedAt: string;
  donor: User;
  claimedBy?: User;
  pickupRequest?: PickupRequest;
}

export interface CreateDonationData {
  foodType: string;
  quantity: string;
  description?: string;
  expiryTime: string;
  pickupLocation: string;
  imageUrl?: string;
  isUrgent?: boolean;
}

export interface DonationStats {
  total: number;
  available: number;
  claimed: number;
  delivered: number;
  urgent: number;
}

export interface PickupRequest {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  scheduledAt?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  notes?: string;
  createdAt: string;
  donation: Donation;
  volunteer?: User;
  delivery?: Delivery;
}

export interface Delivery {
  id: string;
  status: 'ASSIGNED' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED' | 'COMPLETED';
  pickupPhotoUrl?: string;
  deliveryPhotoUrl?: string;
  pickupTime?: string;
  deliveryTime?: string;
}

export interface UserStats {
  total: number;
  donors: number;
  ngos: number;
  volunteers: number;
  pendingApprovals: number;
}

