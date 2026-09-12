import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { authApi, User } from "@/api";
import { Loader2, Save } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  DONOR: "Donor",
  NGO: "NGO",
  VOLUNTEER: "Volunteer",
  ADMIN: "Admin",
};

interface ProfileFormState {
  name: string;
  phone: string;
  location: string;
  organization: string;
}

function toFormState(user: Pick<User, "name" | "phone" | "location" | "organization">): ProfileFormState {
  return {
    name: user.name ?? "",
    phone: user.phone ?? "",
    location: user.location ?? "",
    organization: user.organization ?? "",
  };
}

// isApproved/isActive mirror the same 2-tuple lifecycle used across the
// rest of the app (see AdminDashboard's UserManagement) - PENDING/REJECTED
// can't actually reach this screen (ProtectedRoute redirects them before
// any dashboard route renders), but ACTIVE/SUSPENDED both can if an admin
// suspends the account mid-session, so all four are handled here.
function AccountStatusBadge({ isApproved, isActive }: { isApproved: boolean; isActive: boolean }) {
  if (!isActive && !isApproved) {
    return <Badge variant="destructive" className="text-xs uppercase">Rejected</Badge>;
  }
  if (!isActive) {
    return <Badge variant="destructive" className="text-xs uppercase">Suspended</Badge>;
  }
  if (!isApproved) {
    return <Badge variant="secondary" className="text-xs uppercase">Pending Approval</Badge>;
  }
  return <Badge variant="outline" className="text-xs uppercase">Active</Badge>;
}

export default function Profile() {
  const { user, updateUser } = useAuth();
  const { toast } = useToast();

  const [formData, setFormData] = useState<ProfileFormState>(() =>
    user ? toFormState(user) : { name: "", phone: "", location: "", organization: "" }
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Every route that mounts this component is wrapped in ProtectedRoute,
  // which already guarantees an authenticated user by the time it renders.
  if (!user) {
    return null;
  }

  const isDirty =
    formData.name !== (user.name ?? "") ||
    formData.phone !== (user.phone ?? "") ||
    formData.location !== (user.location ?? "") ||
    formData.organization !== (user.organization ?? "");

  const handleChange =
    (field: keyof ProfileFormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));
      if (field === "name" && nameError) setNameError(null);
    };

  const handleReset = () => {
    setFormData(toFormState(user));
    setNameError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      setNameError("Name is required");
      return;
    }

    if (isSaving) return;
    setIsSaving(true);

    try {
      const updated = await authApi.updateProfile({
        name: trimmedName,
        phone: formData.phone.trim(),
        location: formData.location.trim(),
        organization: formData.organization.trim(),
      });

      // PUT /auth/profile only returns the editable fields (see
      // backend/src/services/auth.service.ts#updateProfile) - merge onto
      // the existing user rather than replacing it, so isApproved/
      // isActive/createdAt (not part of that response) survive.
      const merged = { ...user, ...updated };
      updateUser(merged);
      setFormData(toFormState(merged));

      toast({ title: "Profile updated", description: "Your changes have been saved." });
    } catch (error) {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base uppercase tracking-wider">Account</CardTitle>
          <CardDescription>Tied to your account. Contact an administrator to change these.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Email</p>
            <p className="text-sm font-medium">{user.email}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Role</p>
            <p className="text-sm font-medium">{ROLE_LABELS[user.role] ?? user.role}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Status</p>
            <AccountStatusBadge isApproved={user.isApproved} isActive={user.isActive} />
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Member Since</p>
            <p className="text-sm font-medium">
              {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base uppercase tracking-wider">Edit Profile</CardTitle>
          <CardDescription>Update the details other people on FoodBridge see about you.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="profile-name" className="text-xs uppercase tracking-wider">
                Full Name *
              </Label>
              <Input
                id="profile-name"
                value={formData.name}
                onChange={handleChange("name")}
                disabled={isSaving}
                aria-invalid={!!nameError}
                aria-describedby={nameError ? "profile-name-error" : undefined}
              />
              {nameError && (
                <p id="profile-name-error" className="text-xs text-destructive">
                  {nameError}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="profile-phone" className="text-xs uppercase tracking-wider">
                  Phone
                </Label>
                <Input
                  id="profile-phone"
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={formData.phone}
                  onChange={handleChange("phone")}
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-location" className="text-xs uppercase tracking-wider">
                  Location
                </Label>
                <Input
                  id="profile-location"
                  placeholder="City, Area"
                  value={formData.location}
                  onChange={handleChange("location")}
                  disabled={isSaving}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-organization" className="text-xs uppercase tracking-wider">
                Organization
              </Label>
              <Input
                id="profile-organization"
                placeholder="Org name (if applicable)"
                value={formData.organization}
                onChange={handleChange("organization")}
                disabled={isSaving}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" className="btn-dispatch" disabled={isSaving || !isDirty}>
                {isSaving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Save Changes
              </Button>
              <Button type="button" variant="outline" onClick={handleReset} disabled={isSaving || !isDirty}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
