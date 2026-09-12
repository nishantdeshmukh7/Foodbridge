/* eslint-disable react-refresh/only-export-components -- destinationFor is exported (Phase 21) purely for direct testing; same pattern as AuthContext.tsx */
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { notificationsApi, Notification, NotificationType } from "@/api";
import { useAuth } from "@/context/AuthContext";

// A user who leaves a dashboard tab open should eventually see a new
// notification without refreshing the page. This is the only freshness
// mechanism in Phase 11 - no websockets/SSE - so 30s is a deliberate
// middle ground: frequent enough to feel "live" for a small team app,
// infrequent enough not to hammer the backend with a per-tab poll.
const POLL_INTERVAL_MS = 30_000;

// Where clicking a notification should take the current user, based on
// their own role - not the recipient role baked into the notification
// itself (there isn't one). Returns null when there's no dashboard screen
// that adds anything beyond what the toast-like panel already said.
// Exported (Phase 21) so the redirect-safety audit can assert directly,
// without rendering the component, that this only ever produces a plain
// internal path for the app's own closed set of role values - the one
// caller (handleNotificationClick, below) only ever passes user.role from
// the authenticated session, never anything externally supplied.
export function destinationFor(type: NotificationType, role: string): string | null {
  const r = role.toLowerCase();
  switch (type) {
    case "DONATION_CLAIMED":
      return r === "donor" ? "/donor/requests" : null;
    case "DONATION_CANCELLED":
      if (r === "donor") return "/donor/listings";
      if (r === "ngo") return "/ngo/requests";
      return null;
    case "PICKUP_ASSIGNED":
      return r === "volunteer" ? "/volunteer/tasks" : null;
    case "PICKUP_ACCEPTED":
      return r === "ngo" ? "/ngo/tracking" : null;
    case "PICKUP_STARTED":
    case "DELIVERY_COMPLETED":
      if (r === "donor") return "/donor/requests";
      if (r === "ngo") return "/ngo/tracking";
      return null;
    case "USER_APPROVED":
    case "USER_REJECTED":
    case "USER_SUSPENDED":
    case "USER_REACTIVATED":
      return `/${r}/profile`;
    default:
      return null;
  }
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: () => notificationsApi.getUnreadCount().then((r) => r.count),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const {
    data: notifications = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["notifications-list"],
    queryFn: () => notificationsApi.list(20),
    enabled: open,
    refetchInterval: open ? POLL_INTERVAL_MS : false,
  });

  const invalidateNotifications = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
    queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
  };

  // Mutation.isPending updates on its own async schedule, one tick behind
  // a rapid second click - it's not reliable as the *only* guard against a
  // duplicate request fired before the first render reflecting "pending"
  // has happened. A ref is written synchronously the instant a click is
  // handled, so it can never miss a same-tick repeat the way state can.
  const markReadInFlight = useRef<Set<string>>(new Set());
  const markAllReadInFlight = useRef(false);

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSettled: (_data, _error, id) => {
      markReadInFlight.current.delete(id);
    },
    onSuccess: invalidateNotifications,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSettled: () => {
      markAllReadInFlight.current = false;
    },
    onSuccess: invalidateNotifications,
  });

  const handleMarkAllRead = () => {
    if (markAllReadInFlight.current) return;
    markAllReadInFlight.current = true;
    markAllReadMutation.mutate();
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead && !markReadInFlight.current.has(notification.id)) {
      markReadInFlight.current.add(notification.id);
      markReadMutation.mutate(notification.id);
    }

    const destination = user ? destinationFor(notification.type, user.role) : null;
    if (destination) {
      setOpen(false);
      navigate(destination);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button className="relative p-2 hover:bg-accent transition-colors" aria-label="Notifications">
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Notifications
          </span>
          {unreadCount > 0 && (
            <button
              className="text-xs text-primary hover:underline disabled:opacity-50 disabled:no-underline"
              onClick={handleMarkAllRead}
              disabled={markAllReadMutation.isPending}
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive text-center py-10 px-4">
              Couldn't load notifications. Try again shortly.
            </p>
          ) : notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10 px-4">
              No notifications yet
            </p>
          ) : (
            notifications.map((notification) => (
              <button
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className={`w-full text-left px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-accent transition-colors ${
                  notification.isRead ? "" : "bg-primary/5"
                }`}
              >
                <div className="flex items-start gap-2">
                  {!notification.isRead && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                  )}
                  <div className={notification.isRead ? "pl-3.5" : ""}>
                    <p className="text-sm font-semibold leading-snug">{notification.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      {notification.message}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1 font-mono uppercase tracking-wider">
                      {formatRelativeTime(notification.createdAt)}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
