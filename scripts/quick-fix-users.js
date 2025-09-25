import mongoose from 'mongoose';
import User from '../models/User.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Quick fix script to approve ALL existing users
 * This will allow all registered users to login immediately
 */

async function quickFixAllUsers() {
  try {
    console.log('🚀 Starting quick fix for all users...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get count of users that need fixing
    const usersNeedingFix = await User.countDocuments({
      registrationStatus: { $ne: 'approved' }
    });

    console.log(`📊 Found ${usersNeedingFix} users that need to be approved`);

    if (usersNeedingFix === 0) {
      console.log('✅ All users are already approved!');
      return;
    }

    // Update ALL users who are not approved to approved status
    const updateResult = await User.updateMany(
      {
        registrationStatus: { $ne: 'approved' }
      },
      {
        $set: {
          registrationStatus: 'approved',
          paymentStatus: 'verified',
          paymentVerificationDate: new Date(),
          adminNotes: 'Auto-approved: Emergency fix for existing users (' + new Date().toISOString() + ')'
        }
      }
    );

    console.log(`✅ Successfully updated ${updateResult.modifiedCount} users!`);
    console.log('🎉 All users can now login successfully!');

    // Show some sample updated users for verification
    const sampleUsers = await User.find({
      adminNotes: { $regex: 'Auto-approved: Emergency fix' }
    }).limit(5);

    console.log('\n📋 Sample of updated users:');
    sampleUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email} - ${user.fullName}`);
      console.log(`   ✅ Status: ${user.registrationStatus} | Payment: ${user.paymentStatus}`);
    });

    if (sampleUsers.length < updateResult.modifiedCount) {
      console.log(`   ... and ${updateResult.modifiedCount - sampleUsers.length} more users`);
    }

  } catch (error) {
    console.error('❌ Error during quick fix:', error);
    process.exit(1);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    console.log('\n🔒 Database connection closed');
    console.log('✅ Quick fix completed successfully!');
  }
}

// Run the quick fix
quickFixAllUsers();
