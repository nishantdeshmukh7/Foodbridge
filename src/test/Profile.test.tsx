import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Profile from "@/pages/Profile";
import type { User } from "@/api";

const mockUpdateProfile = vi.fn();
vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
    },
  };
});

const mockUpdateUser = vi.fn();
const mockToast = vi.fn();

const baseUser: User = {
  id: "user-1",
  email: "donor@example.com",
  name: "Dana Donor",
  phone: "9876543210",
  location: "Pune",
  organization: "",
  role: "DONOR",
  isApproved: true,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};
let mockUser: User | null = baseUser;

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, updateUser: mockUpdateUser }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

beforeEach(() => {
  mockUpdateProfile.mockReset();
  mockUpdateUser.mockReset();
  mockToast.mockReset();
  mockUser = { ...baseUser };
});

describe("Profile", () => {
  it("renders the signed-in user's current profile information", () => {
    render(<Profile />);

    expect(screen.getByDisplayValue("Dana Donor")).toBeInTheDocument();
    expect(screen.getByDisplayValue("9876543210")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pune")).toBeInTheDocument();
    expect(screen.getByText("donor@example.com")).toBeInTheDocument();
    expect(screen.getByText("Donor")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("keeps Save disabled until an editable field actually changes", () => {
    render(<Profile />);

    const saveButton = screen.getByRole("button", { name: /save changes/i });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: "91234" } });
    expect(saveButton).toBeEnabled();
  });

  it("shows an inline validation error and does not call the API when name is cleared", async () => {
    render(<Profile />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it("submits only the backend-supported fields and shows success feedback", async () => {
    mockUpdateProfile.mockResolvedValueOnce({
      id: "user-1",
      email: "donor@example.com",
      name: "Dana D. Donor",
      phone: "9876543210",
      location: "Pune",
      organization: "",
      role: "DONOR",
    });

    render(<Profile />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Dana D. Donor" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile).toHaveBeenCalledWith({
      name: "Dana D. Donor",
      phone: "9876543210",
      location: "Pune",
      organization: "",
    });

    // The updated user is merged onto the existing context user so fields
    // PUT /auth/profile doesn't return (isApproved/isActive) survive.
    await waitFor(() =>
      expect(mockUpdateUser).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Dana D. Donor", isApproved: true, isActive: true })
      )
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Profile updated" })
    );
  });

  it("shows a server error and leaves auth state untouched when the update fails", async () => {
    mockUpdateProfile.mockRejectedValueOnce(new Error("Something went wrong"));

    render(<Profile />);

    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: "Mumbai" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Update failed", variant: "destructive" })
      )
    );
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("disables the save button while a request is in flight to prevent duplicate submits", async () => {
    let resolveRequest: (value: unknown) => void = () => {};
    mockUpdateProfile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );

    render(<Profile />);

    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: "Mumbai" } });
    const saveButton = screen.getByRole("button", { name: /save changes/i });

    fireEvent.click(saveButton);
    expect(saveButton).toBeDisabled();

    resolveRequest({
      id: "user-1",
      email: "donor@example.com",
      name: "Dana Donor",
      phone: "9876543210",
      location: "Mumbai",
      organization: "",
      role: "DONOR",
    });

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
  });
});
