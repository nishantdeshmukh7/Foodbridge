import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotificationBell from "@/components/NotificationBell";
import type { Notification, User } from "@/api";

const mockList = vi.fn();
const mockGetUnreadCount = vi.fn();
const mockMarkRead = vi.fn();
const mockMarkAllRead = vi.fn();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    notificationsApi: {
      list: (...args: unknown[]) => mockList(...args),
      getUnreadCount: (...args: unknown[]) => mockGetUnreadCount(...args),
      markRead: (...args: unknown[]) => mockMarkRead(...args),
      markAllRead: (...args: unknown[]) => mockMarkAllRead(...args),
    },
  };
});

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const donorUser: User = {
  id: "user-1",
  email: "donor@example.com",
  name: "Dana Donor",
  role: "DONOR",
  isApproved: true,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};
let mockUser: User | null = donorUser;

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
}));

function renderBell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotificationBell />
    </QueryClientProvider>
  );
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    type: "DONATION_CLAIMED",
    title: "Your donation was claimed",
    message: "An NGO claimed your Rice donation.",
    isRead: false,
    donationId: "donation-1",
    pickupRequestId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// Radix's DropdownMenuTrigger opens on pointerdown, not plain click - jsdom
// needs the pointer event sequence spelled out explicitly for the menu to
// actually flip open (a bare fireEvent.click leaves it closed).
async function openBell() {
  const trigger = screen.getByRole("button", { name: /notifications/i });
  fireEvent.pointerDown(trigger, { pointerId: 1, button: 0, ctrlKey: false });
  fireEvent.pointerUp(trigger, { pointerId: 1, button: 0 });
  fireEvent.click(trigger);
  await waitFor(() => expect(trigger).toHaveAttribute("data-state", "open"));
}

beforeEach(() => {
  mockList.mockReset();
  mockGetUnreadCount.mockReset();
  mockMarkRead.mockReset();
  mockMarkAllRead.mockReset();
  mockNavigate.mockReset();
  mockUser = donorUser;

  mockGetUnreadCount.mockResolvedValue({ count: 0 });
  mockList.mockResolvedValue([]);
  mockMarkRead.mockResolvedValue({ message: "ok" });
  mockMarkAllRead.mockResolvedValue({ message: "ok" });
});

describe("NotificationBell", () => {
  it("renders the bell button", async () => {
    renderBell();
    expect(await screen.findByRole("button", { name: /notifications/i })).toBeInTheDocument();
  });

  it("shows an unread indicator when the unread count is greater than zero", async () => {
    mockGetUnreadCount.mockResolvedValue({ count: 3 });
    renderBell();

    await waitFor(() => expect(mockGetUnreadCount).toHaveBeenCalled());
    await openBell();

    expect(await screen.findByText("Mark all read")).toBeInTheDocument();
  });

  it("does not show 'Mark all read' when there are no unread notifications", async () => {
    mockGetUnreadCount.mockResolvedValue({ count: 0 });
    renderBell();
    await waitFor(() => expect(mockGetUnreadCount).toHaveBeenCalled());
    await openBell();

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(screen.queryByText("Mark all read")).not.toBeInTheDocument();
  });

  it("does not fetch the notification list until the panel is opened", () => {
    renderBell();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("shows a loading state while the list is fetching", async () => {
    let resolveList: (value: Notification[]) => void = () => {};
    mockList.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        })
    );

    renderBell();
    await openBell();

    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
    resolveList([]);
    await waitFor(() => expect(screen.getByText("No notifications yet")).toBeInTheDocument());
  });

  it("shows an empty state when there are no notifications", async () => {
    mockList.mockResolvedValue([]);
    renderBell();
    await openBell();

    expect(await screen.findByText("No notifications yet")).toBeInTheDocument();
  });

  it("shows an error state when the list request fails", async () => {
    mockList.mockRejectedValue(new Error("network down"));
    renderBell();
    await openBell();

    expect(await screen.findByText(/Couldn't load notifications/i)).toBeInTheDocument();
  });

  it("renders notification title, message and read/unread state", async () => {
    mockList.mockResolvedValue([
      makeNotification({ id: "n1", title: "Unread one", isRead: false }),
      makeNotification({ id: "n2", title: "Read one", isRead: true }),
    ]);
    renderBell();
    await openBell();

    expect(await screen.findByText("Unread one")).toBeInTheDocument();
    expect(screen.getByText("Read one")).toBeInTheDocument();
    expect(screen.getAllByText("An NGO claimed your Rice donation.")).toHaveLength(2);
  });

  it("marks an unread notification as read when clicked", async () => {
    mockList.mockResolvedValue([makeNotification({ id: "n1", isRead: false })]);
    renderBell();
    await openBell();

    const item = await screen.findByText("Your donation was claimed");
    fireEvent.click(item);

    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith("n1"));
  });

  it("does not call markRead again for an already-read notification", async () => {
    mockList.mockResolvedValue([makeNotification({ id: "n1", isRead: true })]);
    renderBell();
    await openBell();

    const item = await screen.findByText("Your donation was claimed");
    fireEvent.click(item);

    await new Promise((r) => setTimeout(r, 0));
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it("navigates to the role-appropriate destination when a notification has one", async () => {
    mockList.mockResolvedValue([
      makeNotification({ id: "n1", type: "DONATION_CLAIMED", isRead: false }),
    ]);
    renderBell();
    await openBell();

    fireEvent.click(await screen.findByText("Your donation was claimed"));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/donor/requests"));
  });

  it("does not navigate when the notification has no meaningful destination for this role", async () => {
    mockUser = { ...donorUser, role: "ADMIN" };
    mockList.mockResolvedValue([
      makeNotification({ id: "n1", type: "PICKUP_ASSIGNED", isRead: false }),
    ]);
    renderBell();
    await openBell();

    fireEvent.click(await screen.findByText("Your donation was claimed"));
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("marks all notifications as read when 'Mark all read' is clicked, without duplicate calls", async () => {
    mockGetUnreadCount.mockResolvedValue({ count: 2 });
    mockList.mockResolvedValue([
      makeNotification({ id: "n1", isRead: false }),
      makeNotification({ id: "n2", isRead: false }),
    ]);
    renderBell();
    await waitFor(() => expect(mockGetUnreadCount).toHaveBeenCalled());
    await openBell();

    const markAllButton = await screen.findByText("Mark all read");
    fireEvent.click(markAllButton);
    fireEvent.click(markAllButton);

    await waitFor(() => expect(mockMarkAllRead).toHaveBeenCalled());
    // Button disables itself while the mutation is in flight, so a second
    // synchronous click on the same element cannot fire a second request.
    expect(mockMarkAllRead.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("polls for a fresh unread count without user interaction", async () => {
    vi.useFakeTimers();
    try {
      renderBell();
      await vi.waitFor(() => expect(mockGetUnreadCount).toHaveBeenCalledTimes(1));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await vi.waitFor(() => expect(mockGetUnreadCount.mock.calls.length).toBeGreaterThanOrEqual(2));
    } finally {
      vi.useRealTimers();
    }
  });
});
