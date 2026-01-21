import { useState } from "react";

export default function AdminLoginTest() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("localcooks");
  const [response, setResponse] = useState<any>(null);
  const [sessionData, setSessionData] = useState<any>(null);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [syncStatus, setSyncStatus] = useState<any>(null);

  const testLogin = async () => {
    try {
      console.log('Testing admin login...');
      const loginResponse = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
        credentials: 'include',
      });

      const loginData = await loginResponse.json();
      setResponse({
        status: loginResponse.status,
        data: loginData,
        headers: Object.fromEntries(loginResponse.headers.entries())
      });

      if (loginResponse.ok) {
        // Test session immediately after login
        await testSession();
        await testUser();
      }
    } catch (error) {
      setResponse({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  const testSession = async () => {
    try {
      const sessionResponse = await fetch('/api/debug-session', {
        credentials: 'include',
      });
      const sessionData = await sessionResponse.json();
      setSessionData({
        status: sessionResponse.status,
        data: sessionData
      });
    } catch (error) {
      setSessionData({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  const testUser = async () => {
    try {
      const userResponse = await fetch('/api/user', {
        credentials: 'include',
      });
      const userData = await userResponse.json();
      setUserInfo({
        status: userResponse.status,
        data: userData
      });
    } catch (error) {
      setUserInfo({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  const testSync = async () => {
    try {
      const testUid = 'test-firebase-uid-123'; // You can replace this with a real UID
      const syncResponse = await fetch(`/api/debug/user-sync/${testUid}`, {
        credentials: 'include',
      });
      const syncData = await syncResponse.json();
      setSyncStatus({
        status: syncResponse.status,
        data: syncData
      });
    } catch (error) {
      setSyncStatus({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Admin Login Test</h1>

      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-1">Username:</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="border rounded px-3 py-2 w-full max-w-xs"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Password:</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border rounded px-3 py-2 w-full max-w-xs"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={testLogin}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Test Login
          </button>
          <button
            onClick={testSession}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
          >
            Test Session
          </button>
          <button
            onClick={testUser}
            className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600"
          >
            Test User API
          </button>
          <button
            onClick={testSync}
            className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600"
          >
            Test User Sync
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <h2 className="text-lg font-semibold mb-2">Login Response</h2>
          <pre className="bg-gray-100 p-4 rounded text-xs overflow-auto h-64">
            {JSON.stringify(response, null, 2)}
          </pre>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">Session Data</h2>
          <pre className="bg-gray-100 p-4 rounded text-xs overflow-auto h-64">
            {JSON.stringify(sessionData, null, 2)}
          </pre>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">User Info</h2>
          <pre className="bg-gray-100 p-4 rounded text-xs overflow-auto h-64">
            {JSON.stringify(userInfo, null, 2)}
          </pre>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">Sync Status</h2>
          <pre className="bg-gray-100 p-4 rounded text-xs overflow-auto h-64">
            {JSON.stringify(syncStatus, null, 2)}
          </pre>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-lg font-semibold mb-2">Browser Info</h2>
        <pre className="bg-gray-100 p-4 rounded text-xs">
          Document cookies: {document.cookie || 'No cookies'}
          {'\n'}Location: {window.location.href}
          {'\n'}User Agent: {navigator.userAgent}
        </pre>
      </div>
    </div>
  );
} 