// Debug Firebase User Script
// Run this to check if an email exists in Firebase and optionally clean it up

const emailToCheck = 'your-test-email@example.com'; // Replace with the email you're trying to register

async function checkFirebaseUser(email) {
  try {
    console.log(`🔍 Checking if ${email} exists in Firebase...`);
    
    const response = await fetch('/api/debug/check-firebase-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();
    
    if (data.exists) {
      console.log('❌ User EXISTS in Firebase:');
      console.log('- UID:', data.user.uid);
      console.log('- Email Verified:', data.user.emailVerified);
      console.log('- Disabled:', data.user.disabled);
      console.log('- Created:', data.user.metadata.creationTime);
      console.log('- Last Sign In:', data.user.metadata.lastSignInTime);
      console.log('\n' + data.suggestion);
      
      const shouldDelete = confirm('Do you want to delete this user from Firebase? (This cannot be undone)');
      
      if (shouldDelete) {
        await deleteFirebaseUser(email);
      }
    } else {
      console.log('✅ User does NOT exist in Firebase');
      console.log('- Email should be available for registration');
    }
  } catch (error) {
    console.error('Error checking user:', error);
  }
}

async function deleteFirebaseUser(email) {
  try {
    console.log(`🗑️ Deleting ${email} from Firebase...`);
    
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
      console.log('✅ User deleted successfully!');
      console.log('- Message:', data.message);
      if (data.deletedUid) {
        console.log('- Deleted UID:', data.deletedUid);
      }
      console.log('\nYou can now try registering with this email again.');
    } else {
      console.error('❌ Failed to delete user:', data.error);
    }
  } catch (error) {
    console.error('Error deleting user:', error);
  }
}

// Instructions for use:
console.log('='.repeat(60));
console.log('Firebase User Debug Script');
console.log('='.repeat(60));
console.log('1. Deploy this code to your Vercel project');
console.log('2. Update the emailToCheck variable above');
console.log('3. Open browser console on your website');
console.log('4. Run: checkFirebaseUser("your-email@example.com")');
console.log('='.repeat(60));

// Auto-run if email is set
if (emailToCheck !== 'your-test-email@example.com') {
  checkFirebaseUser(emailToCheck);
} 