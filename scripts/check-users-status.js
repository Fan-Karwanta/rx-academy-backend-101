import mongoose from 'mongoose';
import User from '../models/User.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Script to check the current status of all users in the database
 */

async function checkUsersStatus() {
  try {
    console.log('🔍 Checking current user status in database...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get all users
    const allUsers = await User.find({}).select('email fullName registrationStatus paymentStatus subscriptionStatus subscriptionTier createdAt lastLogin');
    
    console.log(`\n📊 Total users in database: ${allUsers.length}`);

    if (allUsers.length === 0) {
      console.log('❌ No users found in database');
      return;
    }

    // Group users by registration status
    const statusGroups = {};
    allUsers.forEach(user => {
      const status = user.registrationStatus || 'undefined';
      if (!statusGroups[status]) {
        statusGroups[status] = [];
      }
      statusGroups[status].push(user);
    });

    console.log('\n📋 Users grouped by registration status:');
    Object.keys(statusGroups).forEach(status => {
      console.log(`\n🏷️  ${status.toUpperCase()}: ${statusGroups[status].length} users`);
      statusGroups[status].forEach((user, index) => {
        console.log(`   ${index + 1}. ${user.email} - ${user.fullName}`);
        console.log(`      Payment: ${user.paymentStatus || 'undefined'}`);
        console.log(`      Subscription: ${user.subscriptionTier}/${user.subscriptionStatus}`);
        console.log(`      Created: ${user.createdAt}`);
        console.log(`      Last Login: ${user.lastLogin || 'Never'}`);
        console.log('');
      });
    });

    // Check for users who might have login issues
    const problematicUsers = allUsers.filter(user => 
      user.registrationStatus !== 'approved'
    );

    if (problematicUsers.length > 0) {
      console.log(`\n⚠️  ${problematicUsers.length} users cannot login due to registration status:`);
      problematicUsers.forEach((user, index) => {
        console.log(`   ${index + 1}. ${user.email} - Status: ${user.registrationStatus}`);
      });
    } else {
      console.log('\n✅ All users have approved registration status and can login!');
    }

  } catch (error) {
    console.error('❌ Error checking user status:', error);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    console.log('\n🔒 Database connection closed');
  }
}

// Run the check
checkUsersStatus();
