import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DonorDashboard from "@/pages/DonorDashboard";
import NgoDashboard from "@/pages/NgoDashboard";
import type { Donation, User } from "@/api";

// DashboardLayout's own chrome (sidebar, notification bell) isn't what
// Phase 12 changed and isn't under test here - mocking it to a plain
// passthrough keeps these tests focused on the cancel/release behavior
// inside each page, without also having to stand up NotificationBell's
// own API surface.
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockGetMyDonations = vi.fn();
const mockGetStats = vi.fn();
const mockCancel = vi.fn();
const mockGetMyClaims = vi.fn();
const mockRelease = vi.fn();
const mockClaim = vi.fn();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    donationsApi: {
      ...actual.donationsApi,
      getMyDonations: (...args: unknown[]) => mockGetMyDonations(...args),
      getStats: (...args: unknown[]) => mockGetStats(...args),
      cancel: (...args: unknown[]) => mockCancel(...args),
      getMyClaims: (...args: unknown[]) => mockGetMyClaims(...args),
      release: (...args: unknown[]) => mockRelease(...args),
      claim: (...args: unknown[]) => mockClaim(...args),
    },
  };
});

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const ngoUser: User = {
  id: "ngo-1",
  email: "ngo@example.com",
  name: "Ahara Foundation",
  role: "NGO",
  isApproved: true,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};
let mockUser: User | null = ngoUser;

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
}));

function renderWithProviders(ui: React.ReactElement, initialEntry: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>
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
  mockGetMyDonations.mockReset();
  mockGetStats.mockReset().mockResolvedValue({ total: 0, available: 0, claimed: 0, delivered: 0, urgent: 0 });
  mockCancel.mockReset();
  mockGetMyClaims.mockReset();
  mockRelease.mockReset();
  mockClaim.mockReset();
  mockToast.mockReset();
  mockUser = ngoUser;
  vi.restoreAllMocks();
});

describe("Donor cancellation (DonorDashboard)", () => {
  it("shows a Cancel button for an AVAILABLE donation", async () => {
    mockGetMyDonations.mockResolvedValue([makeDonation({ status: "AVAILABLE" })]);
    renderWithProviders(<DonorDashboard />, "/listings");

    expect(await screen.findByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("does not show a Cancel button for a DELIVERED donation", async () => {
    mockGetMyDonations.mockResolvedValue([makeDonation({ status: "DELIVERED" })]);
    renderWithProviders(<DonorDashboard />, "/listings");

    await screen.findByText("Rice & Curry");
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("does not show a Cancel button for a CLAIMED donation once a volunteer has accepted", async () => {
    mockGetMyDonations.mockResolvedValue([
      makeDonation({
        status: "CLAIMED",
        pickupRequest: { id: "pr-1", status: "ACCEPTED", volunteer: { id: "v1", email: "v@e.com", name: "Vol", role: "VOLUNTEER", isApproved: true, isActive: true, createdAt: "2026-01-01T00:00:00.000Z" } },
      }),
    ]);
    renderWithProviders(<DonorDashboard />, "/listings");

    await screen.findByText("Rice & Curry");
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("asks for confirmation and does not call the API if the user declines", async () => {
    mockGetMyDonations.mockResolvedValue([makeDonation()]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(<DonorDashboard />, "/listings");

    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("cancels the donation, shows success, and refreshes the donation queries", async () => {
    mockGetMyDonations.mockResolvedValue([makeDonation()]);
    mockCancel.mockResolvedValue(makeDonation({ status: "CANCELLED" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { invalidateSpy } = renderWithProviders(<DonorDashboard />, "/listings");
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith("donation-1"));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Donation cancelled" }))
    );
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["my-donations"] }));
  });

  it("shows a conflict/error toast when the server rejects the cancellation", async () => {
    mockGetMyDonations.mockResolvedValue([makeDonation()]);
    mockCancel.mockRejectedValue(new Error("This donation already has a volunteer assigned and can no longer be cancelled."));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<DonorDashboard />, "/listings");
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
    mockGetMyDonations.mockResolvedValue([makeDonation()]);
    let resolveCancel: (value: Donation) => void = () => {};
    mockCancel.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve;
        })
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<DonorDashboard />, "/listings");
    const button = await screen.findByRole("button", { name: /cancel/i });

    fireEvent.click(button);
    fireEvent.click(button);

    resolveCancel(makeDonation({ status: "CANCELLED" }));
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
  });
});

describe("NGO claim release (NgoDashboard)", () => {
  it("shows a Release Claim button for the NGO's own CLAIMED/PENDING claim", async () => {
    mockGetMyClaims.mockResolvedValue([
      makeDonation({
        status: "CLAIMED",
        claimedBy: { id: "ngo-1", name: "Ahara Foundation", organization: "Ahara Foundation" },
        pickupRequest: { id: "pr-1", status: "PENDING", volunteerId: null },
      }),
    ]);
    renderWithProviders(<NgoDashboard />, "/requests");

    expect(await screen.findByRole("button", { name: /release claim/i })).toBeInTheDocument();
  });

  it("does not show Release Claim once a volunteer has been assigned", async () => {
    mockGetMyClaims.mockResolvedValue([
      makeDonation({
        status: "CLAIMED",
        claimedBy: { id: "ngo-1", name: "Ahara Foundation", organization: "Ahara Foundation" },
        pickupRequest: { id: "pr-1", status: "ACCEPTED", volunteerId: "vol-1" },
      }),
    ]);
    renderWithProviders(<NgoDashboard />, "/requests");

    await screen.findByText("Rice & Curry");
    expect(screen.queryByRole("button", { name: /release claim/i })).not.toBeInTheDocument();
  });

  it("does not show Release Claim for a donation claimed by a different NGO", async () => {
    mockGetMyClaims.mockResolvedValue([
      makeDonation({
        status: "CLAIMED",
        claimedBy: { id: "some-other-ngo", name: "Other NGO", organization: "Other NGO" },
        pickupRequest: { id: "pr-1", status: "PENDING", volunteerId: null },
      }),
    ]);
    renderWithProviders(<NgoDashboard />, "/requests");

    await screen.findByText("Rice & Curry");
    expect(screen.queryByRole("button", { name: /release claim/i })).not.toBeInTheDocument();
  });

  it("asks for confirmation and does not call the API if the user declines", async () => {
    mockGetMyClaims.mockResolvedValue([
      makeDonation({
        status: "CLAIMED",
        claimedBy: { id: "ngo-1", name: "Ahara Foundation", organization: "Ahara Foundation" },
        pickupRequest: { id: "pr-1", status: "PENDING", volunteerId: null },
      }),
    ]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(<NgoDashboard />, "/requests");

    fireEvent.click(await screen.findByRole("button", { name: /release claim/i }));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("releases the claim, shows success, and refreshes the claim queries", async () => {
    mockGetMyClaims.mockResolvedValue([
      makeDonation({
        id: "donation-9",
        status: "CLAIMED",
        claimedBy: { id: "ngo-1", name: "Ahara Foundation", organization: "Ahara Foundation" },
        pickupRequest: { id: "pr-1", status: "PENDING", volunteerId: null },
      }),
    ]);
    mockRelease.mockResolvedValue(makeDonation({ status: "AVAILABLE", claimedBy: undefined }));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { invalidateSpy } = renderWithProviders(<NgoDashboard />, "/requests");
    fireEvent.click(await screen.findByRole("button", { name: /release claim/i }));

    await waitFor(() => expect(mockRelease).toHaveBeenCalledWith("donation-9"));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Claim released" }))
    );
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["my-claims"] }));
  });

  it("shows a conflict/error toast when the server rejects the release", async () => {
    mockGetMyClaims.mockResolvedValue([
      makeDonation({
        status: "CLAIMED",
        claimedBy: { id: "ngo-1", name: "Ahara Foundation", organization: "Ahara Foundation" },
        pickupRequest: { id: "pr-1", status: "PENDING", volunteerId: null },
      }),
    ]);
    mockRelease.mockRejectedValue(new Error("This claim already has a volunteer assigned and can no longer be released."));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<NgoDashboard />, "/requests");
    fireEvent.click(await screen.findByRole("button", { name: /release claim/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Release failed",
          description: expect.stringContaining("already has a volunteer assigned"),
          variant: "destructive",
        })
      )
    );
  });

  it("does not call release twice for a rapid double-click on the same claim", async () => {
    mockGetMyClaims.mockResolvedValue([
      makeDonation({
        status: "CLAIMED",
        claimedBy: { id: "ngo-1", name: "Ahara Foundation", organization: "Ahara Foundation" },
        pickupRequest: { id: "pr-1", status: "PENDING", volunteerId: null },
      }),
    ]);
    let resolveRelease: (value: Donation) => void = () => {};
    mockRelease.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRelease = resolve;
        })
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<NgoDashboard />, "/requests");
    const button = await screen.findByRole("button", { name: /release claim/i });

    fireEvent.click(button);
    fireEvent.click(button);

    resolveRelease(makeDonation({ status: "AVAILABLE" }));
    await waitFor(() => expect(mockRelease).toHaveBeenCalledTimes(1));
  });
});
