// Debug User Existence Check Script
// Run this to test the email-based user existence check system

const emailToCheck = 'test@example.com'; // Replace with the email you want to test

async function checkUserExists(email) {
  try {
    console.log(`🔍 Checking user existence for: ${email}`);
    
    const response = await fetch('/api/check-user-exists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();
    
    console.log('='.repeat(60));
    console.log(`📧 Email: ${data.email}`);
    console.log(`✅ Can Register: ${data.canRegister}`);
    console.log(`📊 Status: ${data.status}`);
    console.log(`💬 Message: ${data.message}`);
    console.log('');
    
    console.log('🔥 Firebase:');
    console.log(`   - Exists: ${data.firebase.exists}`);
    if (data.firebase.user) {
      console.log(`   - UID: ${data.firebase.user.uid}`);
      console.log(`   - Email Verified: ${data.firebase.user.emailVerified}`);
      console.log(`   - Disabled: ${data.firebase.user.disabled}`);
    }
    console.log('');
    
    console.log('🗃️  NeonDB:');
    console.log(`   - Exists: ${data.neon.exists}`);
    if (data.neon.user) {
      console.log(`   - ID: ${data.neon.user.id}`);
      console.log(`   - Username: ${data.neon.user.username}`);
      console.log(`   - Role: ${data.neon.user.role}`);
      console.log(`   - Firebase UID: ${data.neon.user.firebase_uid || 'None'}`);
    }
    console.log('='.repeat(60));
    
    // Provide suggestions based on status
    if (data.status === 'available') {
      console.log('✅ This email can be used for registration!');
    } else if (data.status === 'exists_firebase') {
      console.log('⚠️  User exists in Firebase but not NeonDB - they need to complete sync');
    } else if (data.status === 'exists_neon') {
      console.log('⚠️  User exists in NeonDB but not Firebase - legacy account');
    } else if (data.status === 'exists_both') {
      console.log('❌ User exists in both systems - should login instead');
    }
    
    return data;
  } catch (error) {
    console.error('❌ Error checking user existence:', error);
    return null;
  }
}

// Function to clean up Firebase user if needed
async function cleanupFirebaseUser(email) {
  try {
    console.log(`🗑️ Attempting to delete Firebase user: ${email}`);
    
    const response = await fetch('/api/debug/delete-firebase-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        email, 
        confirmDelete: true 
      }),
    });

    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Firebase user deleted successfully!');
      console.log(`   - Message: ${data.message}`);
      if (data.deletedUid) {
        console.log(`   - Deleted UID: ${data.deletedUid}`);
      }
    } else {
      console.error('❌ Failed to delete Firebase user:', data.error);
    }
    
    return data;
  } catch (error) {
    console.error('❌ Error deleting Firebase user:', error);
    return null;
  }
}

// Function to test registration process
async function testRegistrationFlow(email) {
  console.log(`🧪 Testing registration flow for: ${email}`);
  
  // Step 1: Check existence
  const existsData = await checkUserExists(email);
  
  if (!existsData) {
    console.log('❌ Failed to check user existence');
    return;
  }
  
  if (existsData.canRegister) {
    console.log('✅ Email is available for registration');
    console.log('   → Registration should succeed');
  } else {
    console.log('❌ Email is not available for registration');
    console.log('   → Registration will fail with EMAIL_EXISTS');
    
    if (existsData.status === 'exists_firebase') {
      console.log('   → Suggestion: Delete Firebase user or use different email');
      
      const shouldCleanup = confirm('Do you want to delete the Firebase user to allow registration?');
      if (shouldCleanup) {
        await cleanupFirebaseUser(email);
        console.log('   → Checking again after cleanup...');
        await checkUserExists(email);
      }
    }
  }
}

// Instructions
console.log('='.repeat(60));
console.log('🧪 User Existence Debug Tools');
console.log('='.repeat(60));
console.log('Available functions:');
console.log('- checkUserExists("email@example.com")');
console.log('- cleanupFirebaseUser("email@example.com")');
console.log('- testRegistrationFlow("email@example.com")');
console.log('='.repeat(60));

// Auto-run if email is set
if (emailToCheck !== 'test@example.com') {
  testRegistrationFlow(emailToCheck);
} 