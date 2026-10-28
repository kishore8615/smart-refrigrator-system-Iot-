require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
const DB_NAME = 'iot_detection';
const COLLECTION_NAME = 'detections';

if (!uri) {
  console.error('[ERROR] MONGODB_URI is not defined in .env');
  process.exit(1);
}

// Check for unreplaced template placeholders
if (uri.includes('<PASSWORD>') || uri.includes('YOUR_NEW_PASSWORD') || uri.includes('<db_username>') || uri.includes('<db_password>')) {
  console.warn('[NOTICE] MONGODB_URI contains placeholder text (YOUR_NEW_PASSWORD / <PASSWORD>).');
  console.warn('Please open .env and replace YOUR_NEW_PASSWORD with your actual database password.');
  process.exit(1);
}

// Ensure database name is present in URI or explicitly passed to options
mongoose.connect(uri, {
  serverSelectionTimeoutMS: 6000,
  dbName: DB_NAME
})
.then(async () => {
  console.log('\nMongoDB connected successfully');
  console.log(`[SUCCESS] Connected to database: "${DB_NAME}"`);
  console.log(`[SUCCESS] Collection: "${COLLECTION_NAME}"`);

  // Count existing documents in detections collection
  const count = await mongoose.connection.db.collection(COLLECTION_NAME).countDocuments();
  console.log(`[SUCCESS] Current records in "${COLLECTION_NAME}": ${count}\n`);

  await mongoose.disconnect();
  process.exit(0);
})
.catch((err) => {
  console.error('\nMongoDB connection failed');
  console.error(`Safe Error: ${err.message}`);

  if (err.message.includes('bad auth') || err.message.includes('Authentication failed') || err.message.includes('authentication failed')) {
    console.error('Diagnosis: Authentication failure.');
    console.error('  - In MongoDB Atlas under "Security" -> "Database Access", verify user "iotadmin" exists.');
    console.error('  - Verify the password in .env matches the password set in Atlas.');
    console.error('  - Tip: Using alphanumeric characters (letters and numbers only) avoids any URL-encoding issues.');
  } else if (err.message.includes('querySrv') || err.message.includes('ENOTFOUND')) {
    console.error('Diagnosis: DNS issue or cluster hostname cannot be resolved.');
  } else if (err.message.includes('timed out') || err.message.includes('ETIMEDOUT') || err.message.includes('ECONNREFUSED')) {
    console.error('Diagnosis: Network/IP access issue. Ensure 0.0.0.0/0 is whitelisted in Atlas under "Security" -> "Network Access".');
  } else {
    console.error('Diagnosis: Cluster unavailable or invalid connection string format.');
  }
  console.log('');
  process.exit(1);
});
