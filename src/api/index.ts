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

// Phase 20: fired by request() below, exactly once per 401 caused by a
// token we actually sent - see the comment inline for why that's the only
// case this covers. AuthContext.tsx is the one place that listens for
// this and clears the stale session; ProtectedRoute's existing
// isAuthenticated check then handles the actual redirect to /login on its
// own next render, so nothing here needs router access or a navigate()
// call of its own.
export const SESSION_EXPIRED_EVENT = 'foodbridge:session-expired';

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

    // Only when a token was actually attached to this specific request AND
    // the server rejected it with 401. This deliberately excludes:
    //   - a failed login attempt (wrong email/password also returns 401,
    //     but carries no Authorization header - there's no session to
    //     have expired)
    //   - 403 (authorization failure - a valid session, just not allowed
    //     to do this) and 400/500 (ordinary validation/server errors) -
    //     none of these mean the token itself is invalid
    //   - optionalAuth-gated routes, which never return 401 for a bad
    //     token in the first place (the backend silently continues
    //     unauthenticated instead - see middleware/auth.ts) - so this
    //     never misfires there either
    // A 401 under these conditions can only mean one thing: an
    // authenticate()-required route rejected a token this app believed
    // was still valid (expired, malformed, or invalidated by a password
    // reset - see isStaleAfterPasswordReset() server-side).
    if (token && response.status === 401) {
      localStorage.removeItem('token');
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }

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

  // Phase 13: always resolves with the same generic message, whether or
  // not the email belongs to an account - the backend guarantees this,
  // not this client wrapper.
  forgotPassword: (email: string) =>
    request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
    }),

  resetPassword: (token: string, password: string) =>
    request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: { token, password },
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

  // Phase 12.5: NGO-only, server-scoped to the caller's own claims - never
  // returns another NGO's claimed donations (unlike getAll, which has no
  // ownership concept).
  getMyClaims: (filters?: { status?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<Donation[]>(`/donations/my-claims${query}`);
  },

  create: (data: CreateDonationData) =>
    request<Donation>('/donations', {
      method: 'POST',
      body: data,
    }),

  claim: (id: string) =>
    request<Donation>(`/donations/${id}/claim`, {
      method: 'POST',
    }),

  // Phase 12: explicit semantic endpoints (not a generic status mutation) -
  // the server alone decides whether either is legal from the donation's
  // current state.
  cancel: (id: string) =>
    request<Donation>(`/donations/${id}/cancel`, {
      method: 'POST',
    }),

  // NGO-only: release a claim back onto the market.
  release: (id: string) =>
    request<Donation>(`/donations/${id}/release`, {
      method: 'POST',
    }),

  getStats: () => request<DonationStats>('/donations/stats'),
};

// Pickups API
export const pickupsApi = {
  getAvailable: () => request<PickupRequest[]>('/pickups/available'),

  getMyPickups: () => request<PickupRequest[]>('/pickups/my-pickups'),

  getById: (id: string) => request<PickupRequest>(`/pickups/${id}`),

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

  // Returns the updated user (consistent with approve/suspend/activate below) -
  // previously returned {message: string}; no caller depended on that shape.
  reject: (id: string) => request<User>(`/users/${id}/reject`, { method: 'POST' }),

  suspend: (id: string) => request<User>(`/users/${id}/suspend`, { method: 'POST' }),

  activate: (id: string) => request<User>(`/users/${id}/activate`, { method: 'POST' }),
};

// Admin analytics API - aggregate-only, ADMIN-only. Every field is a real
// Prisma count/groupBy result (see backend/src/services/admin.service.ts);
// nothing here is estimated or hardcoded.
export const adminApi = {
  getAnalytics: () => request<AdminAnalytics>('/admin/analytics'),
  getActivity: () => request<AdminActivityEntry[]>('/admin/activity'),
};

// GET /health is mounted at the server root, not under /api, so it can't
// go through request() above (which always prefixes API_BASE_URL, e.g.
// ".../api"). This derives the root origin from that same base URL rather
// than needing a second configured value.
const API_ROOT = API_BASE_URL.replace(/\/api\/?$/, '');

export const healthApi = {
  check: (): Promise<HealthStatus> => fetch(`${API_ROOT}/health`).then((res) => res.json()),
};

// Notifications API - every call is implicitly scoped to the authenticated
// caller server-side (see backend/src/controllers/notification.controller.ts);
// there is no recipientId parameter here because the client never gets to
// choose whose inbox it's reading.
export const notificationsApi = {
  list: (limit?: number) =>
    request<Notification[]>(`/notifications${limit ? `?limit=${limit}` : ''}`),

  getUnreadCount: () => request<{ count: number }>('/notifications/unread-count'),

  markRead: (id: string) =>
    request<{ message: string }>(`/notifications/${id}/read`, { method: 'POST' }),

  markAllRead: () =>
    request<{ message: string }>('/notifications/read-all', { method: 'POST' }),
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
  createdAt?: string;
  donation?: Donation;
  volunteerId?: string | null;
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

// Mirrors backend/src/services/admin.service.ts's getAnalytics() shape exactly.
export interface AdminAnalytics {
  users: {
    total: number;
    donors: number;
    ngos: number;
    volunteers: number;
    admins: number;
    activeAccounts: number;
    pendingApprovals: number;
    rejectedAccounts: number;
    suspendedAccounts: number;
  };
  donations: {
    total: number;
    available: number;
    claimed: number;
    pickedUp: number;
    delivered: number;
    expired: number;
    cancelled: number;
    urgentAvailable: number;
  };
  pickups: {
    total: number;
    pending: number;
    accepted: number;
    pickedUp: number;
    completed: number;
    rejected: number;
    cancelled: number;
  };
}

export interface AdminActivityEntry {
  id: string;
  action: string;
  details: string | null;
  level: string;
  createdAt: string;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  uptimeSeconds: number;
}

// Mirrors backend/prisma/schema.prisma's NotificationType enum exactly.
export type NotificationType =
  | 'DONATION_CLAIMED'
  | 'DONATION_CANCELLED'
  | 'PICKUP_ASSIGNED'
  | 'PICKUP_ACCEPTED'
  | 'PICKUP_STARTED'
  | 'DELIVERY_COMPLETED'
  | 'USER_APPROVED'
  | 'USER_REJECTED'
  | 'USER_SUSPENDED'
  | 'USER_REACTIVATED';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  donationId?: string | null;
  pickupRequestId?: string | null;
  createdAt: string;
}

