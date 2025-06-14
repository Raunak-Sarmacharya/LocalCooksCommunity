import { useFirebaseAuth } from "@/hooks/use-auth";
import { useState } from "react";

export default function EmailVerificationTest() {
  const { user, resendFirebaseVerification } = useFirebaseAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleResendVerification = async () => {
    setLoading(true);
    setMessage("");
    
    try {
      await resendFirebaseVerification();
      setMessage("✅ Firebase verification email sent successfully! Check your inbox.");
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h3>Email Verification Test</h3>
        <p>Please log in to test email verification</p>
      </div>
    );
  }

  return (
    <div style={{ 
      padding: '20px', 
      fontFamily: 'monospace',
      backgroundColor: '#f5f5f5',
      borderRadius: '8px',
      margin: '20px',
      maxWidth: '600px'
    }}>
      <h3>🧪 Email Verification Test</h3>
      
      <div style={{ marginBottom: '20px' }}>
        <h4>Current User Status:</h4>
        <p><strong>Email:</strong> {user.email}</p>
        <p><strong>Email Verified (Firebase):</strong> {user.emailVerified ? '✅ Yes' : '❌ No'}</p>
        <p><strong>Display Name:</strong> {user.displayName || 'Not set'}</p>
        <p><strong>UID:</strong> {user.uid}</p>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={handleResendVerification}
          disabled={loading || user.emailVerified}
          style={{ 
            padding: '10px 20px', 
            backgroundColor: user.emailVerified ? '#6c757d' : '#007bff', 
            color: 'white', 
            border: 'none', 
            borderRadius: '5px',
            cursor: user.emailVerified ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? 'Sending...' : user.emailVerified ? 'Already Verified' : 'Resend Firebase Verification Email'}
        </button>
      </div>

      {message && (
        <div style={{ 
          padding: '10px', 
          backgroundColor: message.includes('✅') ? '#d4edda' : '#f8d7da',
          color: message.includes('✅') ? '#155724' : '#721c24',
          borderRadius: '4px',
          marginTop: '10px'
        }}>
          {message}
        </div>
      )}

      <div style={{ 
        marginTop: '20px', 
        fontSize: '12px', 
        color: '#6c757d' 
      }}>
        <h4>Debug Info:</h4>
        <p>• If you don't receive Firebase emails, check your Firebase console email settings</p>
        <p>• Make sure your Firebase project has email verification enabled</p>
        <p>• Check if your email provider is blocking Firebase emails</p>
        <p>• Try a different email address to test</p>
      </div>
    </div>
  );
} 