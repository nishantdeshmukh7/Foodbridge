import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NgoDashboard from "@/pages/NgoDashboard";
import type { Donation } from "@/api";

// Phase 15: the "Within X km" distance filter on this page never actually
// reached the API (Phase 9 audit) and was removed rather than faked - see
// the Phase 15 report for why genuine distance filtering isn't
// implementable with the current data model. These tests prove both
// halves of that fix: the misleading control is gone, and the one filter
// that IS real (food-type search) genuinely reaches donationsApi.getAll.

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockGetAll = vi.fn();
const mockClaim = vi.fn();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    donationsApi: {
      ...actual.donationsApi,
      getAll: (...args: unknown[]) => mockGetAll(...args),
      claim: (...args: unknown[]) => mockClaim(...args),
    },
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function renderBrowseFood() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/browse"]}>
        <NgoDashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
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
  mockClaim.mockReset();
});

describe("NGO Browse Food (Phase 15)", () => {
  it("does not render any distance/radius filter control", async () => {
    mockGetAll.mockResolvedValue([makeDonation()]);
    renderBrowseFood();

    await screen.findByText("Rice & Curry");
    expect(screen.queryByText(/within \d+ km/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/km/i)).not.toBeInTheDocument();
  });

  it("renders the food-type search input", async () => {
    mockGetAll.mockResolvedValue([]);
    renderBrowseFood();
    expect(await screen.findByPlaceholderText("Search by food type...")).toBeInTheDocument();
  });

  it("fetches with no foodType filter on initial load", async () => {
    mockGetAll.mockResolvedValue([]);
    renderBrowseFood();

    await waitFor(() => expect(mockGetAll).toHaveBeenCalled());
    expect(mockGetAll).toHaveBeenCalledWith(
      expect.objectContaining({ status: "AVAILABLE", foodType: undefined })
    );
  });

  it("typing in the search box sends that exact value to donationsApi.getAll as foodType", async () => {
    mockGetAll.mockResolvedValue([]);
    renderBrowseFood();

    const input = await screen.findByPlaceholderText("Search by food type...");
    fireEvent.change(input, { target: { value: "biryani" } });

    await waitFor(() =>
      expect(mockGetAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: "AVAILABLE", foodType: "biryani" })
      )
    );
  });

  it("renders returned (filtered) results", async () => {
    mockGetAll.mockResolvedValue([makeDonation({ foodType: "Chicken Biryani" })]);
    renderBrowseFood();

    expect(await screen.findByText("Chicken Biryani")).toBeInTheDocument();
  });

  it("renders an empty state when the filtered search returns nothing", async () => {
    mockGetAll.mockResolvedValue([]);
    renderBrowseFood();

    expect(await screen.findByText("No donations found")).toBeInTheDocument();
  });

  it("shows a loading state before results arrive", async () => {
    let resolveGetAll: (value: Donation[]) => void = () => {};
    mockGetAll.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGetAll = resolve;
        })
    );
    renderBrowseFood();

    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
    resolveGetAll([]);
    await screen.findByText("No donations found");
  });
});
