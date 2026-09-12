import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminDashboard from "@/pages/AdminDashboard";
import type { Donation } from "@/api";

// DashboardLayout's own chrome (sidebar, notification bell) isn't what
// Phase 14 changed - mocking it to a plain passthrough keeps these tests
// focused on the Donations moderation view itself, matching the same
// approach used for DonationReversibility.test.tsx.
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockGetAll = vi.fn();
const mockCancel = vi.fn();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    donationsApi: {
      ...actual.donationsApi,
      getAll: (...args: unknown[]) => mockGetAll(...args),
      cancel: (...args: unknown[]) => mockCancel(...args),
    },
  };
});

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

function renderAdminDonations() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/donations"]}>
        <AdminDashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { invalidateSpy };
}

function makeDonation(overrides: Partial<Donation> = {}): Donation {
  return {
    id: "donation-1",
    foodType: "Rice & Curry",
    quantity: "10 servings",
    expiryTime: new Date(Date.now() + 3600_000).toISOString(),
    pickupLocation: "Test Kitchen",
    status: "AVAILABLE",
    isUrgent: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    donor: {
      id: "donor-1",
      email: "donor@example.com",
      name: "Rajesh Kumar",
      role: "DONOR",
      isApproved: true,
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockGetAll.mockReset();
  mockCancel.mockReset();
  mockToast.mockReset();
});

describe("Admin donation moderation", () => {
  it("shows a Cancel action for an AVAILABLE donation", async () => {
    mockGetAll.mockResolvedValue([makeDonation({ status: "AVAILABLE" })]);
    renderAdminDonations();

    expect(await screen.findByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("shows a Cancel action for a CLAIMED donation with no volunteer accepted yet", async () => {
    mockGetAll.mockResolvedValue([
      makeDonation({
        status: "CLAIMED",
        claimedBy: { id: "ngo-1", name: "Ahara Foundation", organization: "Ahara Foundation" },
        pickupRequest: { id: "pr-1", status: "PENDING", volunteerId: null },
      }),
    ]);
    renderAdminDonations();

    expect(await screen.findByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("does not show Cancel once a volunteer has accepted the pickup", async () => {
    mockGetAll.mockResolvedValue([
      makeDonation({
        status: "CLAIMED",
        claimedBy: { id: "ngo-1", name: "Ahara Foundation", organization: "Ahara Foundation" },
        pickupRequest: { id: "pr-1", status: "ACCEPTED", volunteerId: "vol-1" },
      }),
    ]);
    renderAdminDonations();

    await screen.findByText("Rice & Curry");
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("does not show Cancel for a PICKED_UP donation", async () => {
    mockGetAll.mockResolvedValue([makeDonation({ status: "PICKED_UP" })]);
    renderAdminDonations();

    await screen.findByText("Rice & Curry");
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("does not show Cancel for a DELIVERED donation", async () => {
    mockGetAll.mockResolvedValue([makeDonation({ status: "DELIVERED" })]);
    renderAdminDonations();

    await screen.findByText("Rice & Curry");
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("does not show Cancel for an already-CANCELLED donation", async () => {
    mockGetAll.mockResolvedValue([makeDonation({ status: "CANCELLED" })]);
    renderAdminDonations();

    await screen.findByText("Rice & Curry");
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("asks for confirmation and does not call the API if the admin declines", async () => {
    mockGetAll.mockResolvedValue([makeDonation()]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderAdminDonations();

    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("cancels the donation, shows success, and refreshes the donation list", async () => {
    mockGetAll.mockResolvedValue([makeDonation()]);
    mockCancel.mockResolvedValue(makeDonation({ status: "CANCELLED" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { invalidateSpy } = renderAdminDonations();
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith("donation-1"));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Donation cancelled" }))
    );
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["admin-donations"] }));
  });

  it("shows a conflict/error toast when the server rejects the cancellation", async () => {
    mockGetAll.mockResolvedValue([makeDonation()]);
    mockCancel.mockRejectedValue(new Error("This donation already has a volunteer assigned and can no longer be cancelled."));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderAdminDonations();
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Cancellation failed",
          description: expect.stringContaining("already has a volunteer assigned"),
          variant: "destructive",
        })
      )
    );
  });

  it("does not call cancel twice for a rapid double-click on the same donation", async () => {
    mockGetAll.mockResolvedValue([makeDonation()]);
    let resolveCancel: (value: Donation) => void = () => {};
    mockCancel.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve;
        })
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderAdminDonations();
    const button = await screen.findByRole("button", { name: /cancel/i });

    fireEvent.click(button);
    fireEvent.click(button);

    resolveCancel(makeDonation({ status: "CANCELLED" }));
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
  });
});
