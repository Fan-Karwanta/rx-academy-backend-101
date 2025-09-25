import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Debug script to check database connection and collections
 */

async function debugDatabase() {
  try {
    console.log('🔍 Debugging database connection...');
    console.log('📍 MongoDB URI:', process.env.MONGODB_URI ? 'Set' : 'Not set');
    console.log('📍 DB Name:', process.env.DB_NAME || 'Not specified');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB successfully');

    // Get database name
    const dbName = mongoose.connection.db.databaseName;
    console.log('📊 Connected to database:', dbName);

    // List all collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`\n📋 Collections in database (${collections.length} total):`);
    
    if (collections.length === 0) {
      console.log('❌ No collections found in database');
    } else {
      for (const collection of collections) {
        console.log(`   📁 ${collection.name}`);
        
        // Get document count for each collection
        try {
          const count = await mongoose.connection.db.collection(collection.name).countDocuments();
          console.log(`      📊 Documents: ${count}`);
          
          // If it's the users collection, show some sample data
          if (collection.name === 'users' && count > 0) {
            const sampleUsers = await mongoose.connection.db.collection('users').find({}).limit(3).toArray();
            console.log('      📋 Sample users:');
            sampleUsers.forEach((user, index) => {
              console.log(`         ${index + 1}. ${user.email || 'No email'} - ${user.fullName || 'No name'}`);
              console.log(`            Registration: ${user.registrationStatus || 'undefined'}`);
              console.log(`            Payment: ${user.paymentStatus || 'undefined'}`);
            });
          }
        } catch (err) {
          console.log(`      ❌ Error counting documents: ${err.message}`);
        }
        console.log('');
      }
    }

    // Try to find users using different possible collection names
    const possibleUserCollections = ['users', 'user', 'User', 'Users'];
    console.log('\n🔍 Checking for users in different collection names:');
    
    for (const collectionName of possibleUserCollections) {
      try {
        const count = await mongoose.connection.db.collection(collectionName).countDocuments();
        console.log(`   📁 ${collectionName}: ${count} documents`);
        
        if (count > 0) {
          const sample = await mongoose.connection.db.collection(collectionName).findOne();
          console.log(`      📋 Sample document structure:`, Object.keys(sample));
        }
      } catch (err) {
        console.log(`   📁 ${collectionName}: Collection doesn't exist`);
      }
    }

  } catch (error) {
    console.error('❌ Error debugging database:', error);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    console.log('\n🔒 Database connection closed');
  }
}

// Run the debug
debugDatabase();
