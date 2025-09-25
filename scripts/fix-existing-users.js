import mongoose from 'mongoose';
import User from '../models/User.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Migration script to fix existing users who were registered before the payment verification system
 * This script will update users who should have access but are stuck with 'pending_payment' status
 */

async function fixExistingUsers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find all users who need to be updated
    // These are users who:
    // 1. Have registrationStatus of 'pending_payment' (default for old users)
    // 2. Have subscriptionStatus of 'active' (they were paying customers)
    // 3. Have subscriptionTier of 'premium' or 'enterprise' (they had paid subscriptions)
    // 4. Were created before the payment verification system was implemented
    
    const usersToUpdate = await User.find({
      $and: [
        {
          $or: [
            { registrationStatus: 'pending_payment' },
            { registrationStatus: { $exists: false } }
          ]
        },
        {
          $or: [
            { subscriptionStatus: 'active' },
            { subscriptionTier: { $in: ['premium', 'enterprise'] } }
          ]
        }
      ]
    });

    console.log(`Found ${usersToUpdate.length} users that need to be updated`);

    if (usersToUpdate.length === 0) {
      console.log('No users need to be updated');
      return;
    }

    // Display users that will be updated
    console.log('\nUsers to be updated:');
    usersToUpdate.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email} - ${user.fullName}`);
      console.log(`   Current: registrationStatus=${user.registrationStatus}, paymentStatus=${user.paymentStatus}`);
      console.log(`   Subscription: ${user.subscriptionTier}/${user.subscriptionStatus}`);
      console.log(`   Created: ${user.createdAt}`);
      console.log('');
    });

    // Ask for confirmation (in production, you might want to remove this)
    console.log('This script will update these users to:');
    console.log('- registrationStatus: "approved"');
    console.log('- paymentStatus: "verified"');
    console.log('- paymentVerificationDate: current date');
    console.log('');

    // Update all users
    const updateResult = await User.updateMany(
      {
        $and: [
          {
            $or: [
              { registrationStatus: 'pending_payment' },
              { registrationStatus: { $exists: false } }
            ]
          },
          {
            $or: [
              { subscriptionStatus: 'active' },
              { subscriptionTier: { $in: ['premium', 'enterprise'] } }
            ]
          }
        ]
      },
      {
        $set: {
          registrationStatus: 'approved',
          paymentStatus: 'verified',
          paymentVerificationDate: new Date(),
          adminNotes: 'Auto-approved: Existing user with active subscription (migrated on ' + new Date().toISOString() + ')'
        }
      }
    );

    console.log(`✅ Successfully updated ${updateResult.modifiedCount} users`);

    // Verify the updates
    const verifyUsers = await User.find({
      registrationStatus: 'approved',
      paymentStatus: 'verified',
      adminNotes: { $regex: 'Auto-approved: Existing user' }
    });

    console.log(`\n✅ Verification: ${verifyUsers.length} users now have approved status`);

    // Show updated users
    console.log('\nUpdated users:');
    verifyUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email} - ${user.fullName}`);
      console.log(`   Status: registrationStatus=${user.registrationStatus}, paymentStatus=${user.paymentStatus}`);
      console.log(`   Verified: ${user.paymentVerificationDate}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error fixing existing users:', error);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Alternative function to update ALL users (more aggressive approach)
async function fixAllUsers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find ALL users who don't have approved status
    const usersToUpdate = await User.find({
      registrationStatus: { $ne: 'approved' }
    });

    console.log(`Found ${usersToUpdate.length} users that need to be updated`);

    if (usersToUpdate.length === 0) {
      console.log('No users need to be updated');
      return;
    }

    // Update ALL users to approved status
    const updateResult = await User.updateMany(
      {
        registrationStatus: { $ne: 'approved' }
      },
      {
        $set: {
          registrationStatus: 'approved',
          paymentStatus: 'verified',
          paymentVerificationDate: new Date(),
          adminNotes: 'Auto-approved: Mass migration for existing users (migrated on ' + new Date().toISOString() + ')'
        }
      }
    );

    console.log(`✅ Successfully updated ${updateResult.modifiedCount} users`);

  } catch (error) {
    console.error('❌ Error fixing all users:', error);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run the script
const args = process.argv.slice(2);
if (args.includes('--all')) {
  console.log('🚀 Running aggressive migration (ALL users)...');
  fixAllUsers();
} else {
  console.log('🚀 Running selective migration (active subscription users only)...');
  fixExistingUsers();
}
