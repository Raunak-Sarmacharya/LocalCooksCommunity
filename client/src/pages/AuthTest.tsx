import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";

export default function AuthTest() {
  const firebaseAuth = useFirebaseAuth();
  
  // Manual session check
  const sessionCheck = useQuery({
    queryKey: ["/api/user"],
    queryFn: async () => {
      const response = await fetch("/api/user", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    }
  });

  const logout = async () => {
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
      await firebaseAuth.logout();
      window.location.reload();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Authentication Test Page</h1>
      
      {/* Firebase Auth Status (Primary) */}
      <Card>
        <CardHeader>
          <CardTitle>Firebase Authentication Status</CardTitle>
          <CardDescription>Primary authentication system</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant={firebaseAuth.loading ? "secondary" : "default"}>
              {firebaseAuth.loading ? "Loading" : "Ready"}
            </Badge>
            {firebaseAuth.user && (
              <Badge variant={firebaseAuth.user.role === 'admin' ? "destructive" : "outline"}>
                {firebaseAuth.user.role === 'admin' ? "Admin" : "User"}
              </Badge>
            )}
          </div>
          
          {firebaseAuth.user ? (
            <div className="bg-green-50 p-3 rounded-lg">
              <h4 className="font-medium text-green-800">Authenticated Firebase User:</h4>
              <pre className="text-sm text-green-700 mt-1">
                {JSON.stringify(firebaseAuth.user, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="bg-red-50 p-3 rounded-lg">
              <p className="text-red-800">No authenticated user</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Firebase Auth Status */}
      <Card>
        <CardHeader>
          <CardTitle>Firebase Authentication Status</CardTitle>
          <CardDescription>Firebase-only authentication state</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant={firebaseAuth.loading ? "secondary" : "default"}>
              {firebaseAuth.loading ? "Loading" : "Ready"}
            </Badge>
            {firebaseAuth.user && (
              <Badge variant={firebaseAuth.user.role === 'admin' ? "destructive" : "outline"}>
                {firebaseAuth.user.role || "No Role"}
              </Badge>
            )}
          </div>
          
          {firebaseAuth.user ? (
            <div className="bg-blue-50 p-3 rounded-lg">
              <h4 className="font-medium text-blue-800">Firebase User:</h4>
              <pre className="text-sm text-blue-700 mt-1">
                {JSON.stringify(firebaseAuth.user, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="bg-gray-50 p-3 rounded-lg">
              <p className="text-gray-800">No Firebase user</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Session Auth Status */}
      <Card>
        <CardHeader>
          <CardTitle>Session Authentication Status</CardTitle>
          <CardDescription>Direct session API check</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant={sessionCheck.isLoading ? "secondary" : "default"}>
              {sessionCheck.isLoading ? "Loading" : "Ready"}
            </Badge>
            {sessionCheck.data && (
              <Badge variant={sessionCheck.data.role === 'admin' ? "destructive" : "outline"}>
                {sessionCheck.data.role || "No Role"}
              </Badge>
            )}
          </div>
          
          {sessionCheck.data ? (
            <div className="bg-purple-50 p-3 rounded-lg">
              <h4 className="font-medium text-purple-800">Session User:</h4>
              <pre className="text-sm text-purple-700 mt-1">
                {JSON.stringify(sessionCheck.data, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="bg-gray-50 p-3 rounded-lg">
              <p className="text-gray-800">No session user</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <Button onClick={() => window.location.href = '/admin/login'}>
              Admin Login
            </Button>
            <Button onClick={() => window.location.href = '/auth'}>
              User Auth
            </Button>
            <Button onClick={() => window.location.href = '/admin'}>
              Admin Panel
            </Button>
            <Button variant="destructive" onClick={logout}>
              Logout
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 