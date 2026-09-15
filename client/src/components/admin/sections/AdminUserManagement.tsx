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

export function AdminUserManagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingUser, setDeletingUser] = useState<any | null>(null);

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
              Are you absolutely sure? This will delete the user account from the PostgreSQL database (including all bookings, applications, and settings), as well as remove their identity from Firebase Auth and Firestore.
              <br /><br />
              <strong className="text-destructive">This action is irreversible.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteUser}
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
