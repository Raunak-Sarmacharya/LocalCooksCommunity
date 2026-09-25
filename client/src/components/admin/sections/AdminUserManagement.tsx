import { useState, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { logger } from "@/lib/logger";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, UserMinus } from "lucide-react";
import { auth } from "@/lib/firebase";

/** One line of "what will be removed" in the delete confirmation. */
type DeleteImpactCategory = {
  /** Key in the `counts` object returned by `GET /api/admin/users/:id/delete-impact`. */
  key: string;
  label: string;
};

/**
 * The rows the cascade will delete, in the order an admin cares about them:
 * money and relationships first, housekeeping last.
 *
 * `managed_locations` is NOT here — those rows are not deleted, their owner is
 * simply cleared. It gets its own warning line below.
 */
const DELETE_IMPACT_CATEGORIES: DeleteImpactCategory[] = [
  { key: "bookings", label: "Kitchen bookings" },
  { key: "storage_bookings", label: "Storage bookings" },
  { key: "equipment_bookings", label: "Equipment bookings" },
  { key: "damage_claims", label: "Damage claims" },
  { key: "kitchen_applications", label: "Kitchen applications" },
  { key: "applications", label: "Portal applications" },
  { key: "viewings", label: "Viewings" },
  { key: "kitchen_access_grants", label: "Kitchen access grants" },
  { key: "location_access_grants", label: "Location access grants" },
  { key: "chef_notifications", label: "Chef notifications" },
  { key: "manager_notifications", label: "Manager notifications" },
  { key: "microlearning_completions", label: "Training completions" },
  { key: "video_progress", label: "Video progress records" },
  { key: "password_reset_tokens", label: "Password reset links" },
];

export function AdminUserManagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingUser, setDeletingUser] = useState<any | null>(null);
  const [impact, setImpact] = useState<any | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);

  const getAuthHeaders = async (): Promise<HeadersInit> => {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };
    const currentFirebaseUser = auth.currentUser;
    if (currentFirebaseUser) {
      try {
        const token = await currentFirebaseUser.getIdToken();
        headers["Authorization"] = `Bearer ${token}`;
      } catch (error) {
        logger.error("Error getting Firebase token:", error);
      }
    }
    return headers;
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/users", {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to load users");
      }

      const data = await response.json();
      setUsers(data.users || []);
    } catch (error: any) {
      logger.error("Error loading users:", error);
      toast.error("Error", {
        description: error.message || "Failed to load users",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  /**
   * Fetch what the delete will remove as soon as the dialog opens, so the admin
   * reads the blast radius BEFORE confirming rather than after.
   *
   * A failure here must not block the delete: the impact is informational, and
   * the dialog falls back to the generic warning.
   */
  useEffect(() => {
    if (!deletingUser) {
      setImpact(null);
      return;
    }

    let cancelled = false;
    setImpactLoading(true);

    (async () => {
      try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/admin/users/${deletingUser.id}/delete-impact`, {
          credentials: "include",
          headers,
        });
        if (!response.ok) throw new Error("Failed to load delete impact");
        const data = await response.json();
        if (!cancelled) setImpact(data);
      } catch (error: any) {
        logger.error("Error loading delete impact:", error);
        if (!cancelled) setImpact(null);
      } finally {
        if (!cancelled) setImpactLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deletingUser]);

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/users/${deletingUser.id}/complete`, {
        method: "DELETE",
        credentials: "include",
        headers,
      });
      if (response.ok) {
        toast.success("Success", {
          description: "User completely deleted across all systems.",
        });
        setDeletingUser(null);
        loadUsers();
      } else {
        const error = await response.json();
        toast.error("Error", {
          description: error.error || "Failed to completely delete user",
        });
      }
    } catch (error: any) {
      logger.error("Error deleting user:", error);
      toast.error("Error", {
        description: error.message || "Failed to completely delete user",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">User Management</h2>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Username/Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Firebase UID</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.id}</TableCell>
                <TableCell className="font-medium">{user.username}</TableCell>
                <TableCell className="capitalize">{user.role}</TableCell>
                <TableCell className="text-muted-foreground text-xs font-mono">
                  {user.firebaseUid || "N/A"}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeletingUser(user)}
                    disabled={user.role === "admin"}
                  >
                    <UserMinus className="h-4 w-4 mr-1" />
                    Complete Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            )}
            {loading && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={deletingUser !== null}
        onOpenChange={(open) => !open && setDeletingUser(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Completely Delete User?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>{deletingUser?.username}</strong> and every
              record attached to the account, then removes their identity from Firebase Auth
              and Firestore.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {impactLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking what will be removed…
            </div>
          )}

          {impact && (
            <div className="space-y-3 py-1">
              <div className="max-h-64 overflow-y-auto rounded-md border">
                <Table>
                  <TableBody>
                    {DELETE_IMPACT_CATEGORIES.filter(
                      (c) => (impact.counts?.[c.key] ?? 0) > 0,
                    ).map((c) => (
                      <TableRow key={c.key}>
                        <TableCell className="py-2 text-sm">{c.label}</TableCell>
                        <TableCell className="py-2 text-sm text-right font-mono tabular-nums">
                          {impact.counts[c.key]}
                        </TableCell>
                      </TableRow>
                    ))}
                    {DELETE_IMPACT_CATEGORIES.every(
                      (c) => (impact.counts?.[c.key] ?? 0) === 0,
                    ) && (
                      <TableRow>
                        <TableCell className="py-3 text-sm text-muted-foreground">
                          No attached records — only the account itself will be removed.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Not a deletion, which is exactly why it needs calling out:
                  the kitchen keeps its bookings and outlives the manager. */}
              {(impact.counts?.managed_locations ?? 0) > 0 && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                  <strong>{impact.counts.managed_locations}</strong> location
                  {impact.counts.managed_locations === 1 ? "" : "s"} will be left with no
                  manager and must be reassigned.
                </p>
              )}

              {impact.obligations?.hasObligations && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                  This user has unresolved obligations:{" "}
                  {impact.obligations.overstayPenalties} overstay penalty(ies) and{" "}
                  {impact.obligations.damageClaims} damage claim(s), totaling{" "}
                  <strong>${(impact.obligations.totalOwedCents / 100).toFixed(2)}</strong>.
                  The claims are kept, but the account that owes them is removed.
                </p>
              )}
            </div>
          )}

          <p className="text-sm">
            <strong className="text-destructive">This action is irreversible.</strong>
          </p>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                // Keep the dialog mounted while the request is in flight;
                // closing it on confirm would unmount the spinner and leave the
                // admin with no feedback on a delete that can take a while.
                e.preventDefault();
                handleDeleteUser();
              }}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Permanently
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
