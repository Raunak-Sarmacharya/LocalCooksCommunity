import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';
import { useState } from 'react';

export default function VerificationDebug() {
  const { user, updateUserVerification } = useFirebaseAuth();
  const [isChecking, setIsChecking] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);

  const handleManualCheck = async () => {
    setIsChecking(true);
    try {
      console.log('🔍 MANUAL VERIFICATION CHECK STARTED');
      
      // Check Firebase user status
      const firebaseUser = auth.currentUser;
      if (firebaseUser) {
        await firebaseUser.reload();
        console.log('🔥 Firebase user status:', {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          emailVerified: firebaseUser.emailVerified,
          displayName: firebaseUser.displayName
        });
      }
      
      // Check database user status
      const token = await firebaseUser?.getIdToken();
      if (token) {
        const userResponse = await fetch('/api/user/profile', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (userResponse.ok) {
          const userData = await userResponse.json();
          console.log('🗃️ Database user status:', {
            id: userData.id,
            email: userData.username,
            is_verified: userData.is_verified,
            has_seen_welcome: userData.has_seen_welcome,
            role: userData.role
          });
          
          setDebugInfo({
            firebase: {
              uid: firebaseUser?.uid,
              email: firebaseUser?.email,
              emailVerified: firebaseUser?.emailVerified,
              displayName: firebaseUser?.displayName
            },
            database: {
              id: userData.id,
              email: userData.username,
              is_verified: userData.is_verified,
              has_seen_welcome: userData.has_seen_welcome,
              role: userData.role
            }
          });
        }
      }
      
      // Force verification update
      await updateUserVerification();
      
      console.log('✅ MANUAL VERIFICATION CHECK COMPLETED');
    } catch (error) {
      console.error('❌ Manual verification check failed:', error);
    } finally {
      setIsChecking(false);
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 text-white p-4 rounded-lg max-w-md text-sm">
      <div className="font-bold mb-2">🔍 Verification Debug</div>
      
      <div className="space-y-2">
        <div>
          <strong>Firebase:</strong> {user.emailVerified ? '✅ Verified' : '❌ Not Verified'}
        </div>
        
        {debugInfo && (
          <>
            <div>
              <strong>Database:</strong> {debugInfo.database.is_verified ? '✅ Verified' : '❌ Not Verified'}
            </div>
            <div>
              <strong>Welcome:</strong> {debugInfo.database.has_seen_welcome ? '✅ Seen' : '❌ Not Seen'}
            </div>
            <div>
              <strong>Should Show Welcome:</strong> {
                debugInfo.database.is_verified && !debugInfo.database.has_seen_welcome 
                  ? '✅ YES' 
                  : '❌ NO'
              }
            </div>
          </>
        )}
        
        <button
          onClick={handleManualCheck}
          disabled={isChecking}
          className="mt-2 bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm"
        >
          {isChecking ? 'Checking...' : '🔄 Check Status'}
        </button>
      </div>
    </div>
  );
} 