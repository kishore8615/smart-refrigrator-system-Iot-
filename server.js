require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const mongoose = require('mongoose');

// Server configuration
const PORT = process.env.PORT || 5000;
const PYTHON_SIDECAR_URL = process.env.PYTHON_SIDECAR_URL || 'http://127.0.0.1:5001/api/analyze';
let MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://iotadmin:<PASSWORD>@cluster0.wpgqr4c.mongodb.net/iot_detection?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = 'iot_detection';
const COLLECTION_NAME = 'detections';
const DEFAULT_CAMERA_ID = 'ESP32-CAM-01';
const LEDGER_FILE_PATH = path.join(__dirname, 'cloud_ledger.json');
const LOW_STOCK_THRESHOLD_GRAMS = 50.0;
const WEIGHT_SENSOR_TIMEOUT_MS = 20000; // 20 seconds without telemetry marks sensor disconnected

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory hardware telemetry state (No fake data)
let currentWeightGrams = null;
let lastTelemetryReceivedAt = null;
let lastKnownDetectedItems = [];
let lastKnownTopItem = null;
let lastKnownConfidence = 0;
let lastCameraConnected = false;
let activeCamUrl = process.env.ESP32_CAM_URL || 'http://192.168.1.7/saved-photo';

// Rate limiting / caching for camera queries to avoid overwhelming ESP32-CAM single-socket server
let sidecarQueryPromise = null;
let lastSidecarQueryTime = 0;
const SIDECAR_CACHE_DURATION_MS = 4000;

// Initialize persistent Cloud Ledger fallback
function loadCloudLedger() {
  try {
    if (fs.existsSync(LEDGER_FILE_PATH)) {
      const data = fs.readFileSync(LEDGER_FILE_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error(`[Storage] Failed to read cloud ledger backup: ${err.message}`);
  }
  return [];
}

function saveCloudLedger(records) {
  try {
    fs.writeFileSync(LEDGER_FILE_PATH, JSON.stringify(records, null, 2), 'utf8');
  } catch (err) {
    console.error(`[Storage] Failed to write cloud ledger backup: ${err.message}`);
  }
}

// In-memory reference to ledger records
let cloudLedger = loadCloudLedger();

// -------------------------------------------------------------
// MONGODB ATLAS CLUSTER CONNECTION & SCHEMAS
// -------------------------------------------------------------
let isMongoConnected = false;
let mongoStatusText = 'Not initialized';

/**
 * MongoDB Schema for 'detections' collection in database 'iot_detection'.
 * Fields preserve both strict specification (object, confidence, weight, cameraId, timestamp)
 * and backward-compatible fields (id, itemName, status, unit) for React frontend.
 */
const detectionSchema = new mongoose.Schema({
  object: { type: String, required: true },
  confidence: { type: Number, required: true },
  weight: { type: Number, default: null },
  cameraId: { type: String, default: DEFAULT_CAMERA_ID },
  timestamp: { type: Date, default: Date.now, index: true },
  // Backward compatibility fields for existing UI & ledger table:
  id: { type: String, default: () => `DET-${Date.now()}-${Math.floor(Math.random() * 1000)}` },
  itemName: { type: String },
  unit: { type: String, default: 'g' },
  cameraStatus: { type: String, default: 'Connected' },
  sensorStatus: { type: String, default: 'Connected' },
  status: { type: String, default: 'RECORDED' }
}, { collection: COLLECTION_NAME, timestamps: true });

// Ensure itemName and object stay in sync
detectionSchema.pre('save', function(next) {
  if (!this.itemName && this.object) this.itemName = this.object;
  if (!this.object && this.itemName) this.object = this.itemName;
  next();
});

const Detection = mongoose.model('Detection', detectionSchema);

/**
 * Syncs the in-memory ledger and local cloud_ledger.json with MongoDB Atlas.
 */
async function syncLedgerFromDb() {
  if (!isMongoConnected) return;
  try {
    const dbRecords = await Detection.find().sort({ timestamp: -1 }).limit(200).lean();
    if (dbRecords && dbRecords.length > 0) {
      cloudLedger = dbRecords.map((r) => ({
        id: r.id || (r._id ? r._id.toString() : `DET-${Date.now()}`),
        object: r.object || r.itemName,
        itemName: r.itemName || r.object,
        confidence: r.confidence || 0,
        weight: r.weight,
        cameraId: r.cameraId || DEFAULT_CAMERA_ID,
        timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : new Date(r.timestamp).toISOString(),
        unit: r.unit || 'g',
        cameraStatus: r.cameraStatus || 'Connected',
        sensorStatus: r.sensorStatus || 'Connected',
        status: r.status || 'RECORDED'
      }));
      saveCloudLedger(cloudLedger);
      console.log(`[MongoDB] Synchronized ${cloudLedger.length} detections from MongoDB Atlas.`);
    } else if (cloudLedger && cloudLedger.length > 0) {
      console.log(`[MongoDB] Seeding ${cloudLedger.length} existing local records to MongoDB Atlas 'detections' collection...`);
      for (const item of cloudLedger) {
        const objName = item.object || item.itemName;
        await Detection.findOneAndUpdate(
          { id: item.id },
          {
            id: item.id,
            object: objName,
            itemName: objName,
            confidence: item.confidence || 0,
            weight: item.weight !== undefined ? item.weight : null,
            cameraId: item.cameraId || DEFAULT_CAMERA_ID,
            timestamp: new Date(item.timestamp),
            unit: item.unit || 'g',
            cameraStatus: item.cameraStatus || 'Connected',
            sensorStatus: item.sensorStatus || 'Connected',
            status: item.status || 'RECORDED'
          },
          { upsert: true }
        );
      }
      console.log(`[MongoDB] Initial seed complete.`);
    }
  } catch (err) {
    console.error(`[MongoDB] Error synchronizing with database: ${err.message}`);
  }
}

/**
 * Attempts connection to MongoDB Atlas.
 * Falls back safely if credentials contain placeholders.
 */
async function connectToMongoDB(customUri = null) {
  const targetUri = customUri || MONGODB_URI;
  if (!targetUri || targetUri.includes('<PASSWORD>') || targetUri.includes('<db_username>') || targetUri.includes('<db_password>')) {
    isMongoConnected = false;
    mongoStatusText = 'MongoDB password required in .env (<PASSWORD>)';
    console.log(`[MongoDB] ${mongoStatusText}. Operating in resilient local fallback mode.`);
    return false;
  }

  try {
    mongoStatusText = 'Connecting to MongoDB Atlas...';
    await mongoose.connect(targetUri, {
      serverSelectionTimeoutMS: 6000,
      dbName: DB_NAME
    });
    isMongoConnected = true;
    mongoStatusText = 'MongoDB connected successfully';
    console.log('MongoDB connected successfully');
    console.log(`[MongoDB] Connected to database: "${DB_NAME}", collection: "${COLLECTION_NAME}"`);
    await syncLedgerFromDb();
    return true;
  } catch (err) {
    isMongoConnected = false;
    mongoStatusText = `Connection failed: ${err.message}`;
    console.error(`[MongoDB] Connection error: ${err.message}`);
    return false;
  }
}

mongoose.connection.on('disconnected', () => {
  isMongoConnected = false;
  mongoStatusText = 'Disconnected from Atlas';
  console.log('[MongoDB] Connection dropped. Resuming local fallback.');
});

mongoose.connection.on('reconnected', () => {
  isMongoConnected = true;
  mongoStatusText = 'MongoDB connected successfully';
  console.log('MongoDB connected successfully');
});

/**
 * Capitalizes the first letter of each word in a string.
 */
function capitalizeItemName(name) {
  if (!name) return '';
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/**
 * Pushes newly detected items with real hardware telemetry into MongoDB Atlas.
 * Prevents redundant identical logging within a 30-minute cooldown window.
 * Persists to MongoDB Atlas 'detections' collection and updates local backup.
 */
function syncMeasurementToCloud(itemName, confidence, weightVal, isWeightConnected) {
  if (!itemName) return;

  const formattedName = capitalizeItemName(itemName);
  const now = new Date();
  const thirtyMinutesAgo = now.getTime() - 30 * 60 * 1000;

  const recentEntry = cloudLedger.find((entry) => {
    const entryTime = new Date(entry.timestamp).getTime();
    const entryName = entry.object || entry.itemName || '';
    return entryName.toLowerCase() === formattedName.toLowerCase() && entryTime > thirtyMinutesAgo;
  });

  if (!recentEntry) {
    const newRecord = {
      id: `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: now.toISOString(),
      object: formattedName,
      itemName: formattedName,
      confidence: confidence || 0.0,
      weight: isWeightConnected ? weightVal : null,
      cameraId: DEFAULT_CAMERA_ID,
      unit: 'g',
      cameraStatus: 'Connected',
      sensorStatus: isWeightConnected ? 'Connected' : 'Weight sensor disconnected',
      status: 'RECORDED'
    };

    cloudLedger.unshift(newRecord);
    if (cloudLedger.length > 200) {
      cloudLedger = cloudLedger.slice(0, 200);
    }
    saveCloudLedger(cloudLedger);
    console.log(`[Detection] Logged: ${newRecord.object} (Confidence: ${(newRecord.confidence * 100).toFixed(1)}%, Weight: ${newRecord.weight !== null ? newRecord.weight + 'g' : 'Disconnected'}, Camera: ${newRecord.cameraId})`);

    // Asynchronously persist to MongoDB Atlas collection 'detections'
    if (isMongoConnected) {
      Detection.create({
        object: newRecord.object,
        itemName: newRecord.itemName,
        confidence: newRecord.confidence,
        weight: newRecord.weight,
        cameraId: newRecord.cameraId,
        timestamp: now,
        id: newRecord.id,
        unit: newRecord.unit,
        cameraStatus: newRecord.cameraStatus,
        sensorStatus: newRecord.sensorStatus,
        status: newRecord.status
      })
      .then((doc) => {
        console.log(`[MongoDB] Detection saved to Atlas (id: ${doc._id}, object: ${doc.object})`);
      })
      .catch((err) => {
        console.error(`[MongoDB] Database insert failure: ${err.message}`);
      });
    }
  }
}

/**
 * Helper to fetch detected food items from the Python YOLOv8 sidecar.
 * Incorporates request caching to protect ESP32-CAM Wi-Fi buffers.
 */
async function queryPythonSidecar(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && (now - lastSidecarQueryTime < SIDECAR_CACHE_DURATION_MS)) {
    return {
      success: lastCameraConnected,
      item: lastKnownTopItem,
      confidence: lastKnownConfidence,
      items: lastKnownDetectedItems,
      cached: true
    };
  }

  if (sidecarQueryPromise) {
    return sidecarQueryPromise;
  }

  sidecarQueryPromise = new Promise((resolve) => {
    const urlObj = new URL(PYTHON_SIDECAR_URL);
    const postData = JSON.stringify({
      cam_url: activeCamUrl
    });

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 6000
    };

    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        sidecarQueryPromise = null;
        lastSidecarQueryTime = Date.now();
        try {
          const parsed = JSON.parse(rawData);
          if (res.statusCode === 200 && parsed && parsed.success) {
            lastCameraConnected = true;
            lastKnownTopItem = parsed.item || null;
            lastKnownConfidence = parsed.confidence || 0;
            lastKnownDetectedItems = Array.isArray(parsed.items) ? parsed.items : [];
            resolve({
              success: true,
              item: lastKnownTopItem,
              confidence: lastKnownConfidence,
              items: lastKnownDetectedItems
            });
          } else {
            lastCameraConnected = false;
            lastKnownTopItem = null;
            lastKnownConfidence = 0;
            lastKnownDetectedItems = [];
            resolve({
              success: false,
              error: parsed.error || 'ESP32-CAM disconnected or unreachable',
              item: null,
              confidence: 0,
              items: []
            });
          }
        } catch (e) {
          lastCameraConnected = false;
          lastKnownTopItem = null;
          lastKnownConfidence = 0;
          resolve({ success: false, error: e.message, item: null, confidence: 0, items: [] });
        }
      });
    });

    req.on('error', (err) => {
      sidecarQueryPromise = null;
      lastSidecarQueryTime = Date.now();
      lastCameraConnected = false;
      lastKnownTopItem = null;
      lastKnownConfidence = 0;
      resolve({ success: false, error: 'ESP32-CAM disconnected or unreachable', item: null, confidence: 0, items: [] });
    });

    req.on('timeout', () => {
      req.destroy();
      sidecarQueryPromise = null;
      lastSidecarQueryTime = Date.now();
      lastCameraConnected = false;
      lastKnownTopItem = null;
      lastKnownConfidence = 0;
      resolve({ success: false, error: 'ESP32-CAM connection timed out', item: null, confidence: 0, items: [] });
    });

    req.write(postData);
    req.end();
  });

  return sidecarQueryPromise;
}

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

/**
 * Health check endpoint.
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ONLINE',
    service: 'VisionScale Backend',
    tagline: 'See it. Weigh it. Know it.',
    timestamp: new Date().toISOString()
  });
});

/**
 * Load cell weight telemetry intake handler.
 * Supports both POST /api/telemetry and POST /api/weight.
 */
function handleWeightTelemetry(req, res) {
  const { weight, weight_grams, raw_value } = req.body;

  let parsedWeight = null;
  if (weight !== undefined) {
    parsedWeight = parseFloat(weight);
  } else if (weight_grams !== undefined) {
    parsedWeight = parseFloat(weight_grams);
  } else if (raw_value !== undefined) {
    parsedWeight = parseFloat(raw_value);
  }

  if (parsedWeight === null || isNaN(parsedWeight)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid weight reading provided. Expecting numeric weight in grams.'
    });
  }

  // Record calibrated weight with 1 decimal precision
  currentWeightGrams = Math.max(0.0, Math.round(parsedWeight * 10) / 10);
  lastTelemetryReceivedAt = new Date().toISOString();

  console.log(`[Weight Sensor] Telemetry received from load cell: ${currentWeightGrams.toFixed(1)} g`);

  return res.status(200).json({
    success: true,
    weight: currentWeightGrams,
    unit: 'g',
    timestamp: lastTelemetryReceivedAt
  });
}

app.post('/api/telemetry', handleWeightTelemetry);
app.post('/api/weight', handleWeightTelemetry);

/**
 * Unified Status endpoint (GET /api/status and GET /api/fridge-status):
 * Returns real hardware state for camera, load-cell, and YOLOv8 detection.
 */
async function handleStatus(req, res) {
  const now = Date.now();
  const isWeightConnected = lastTelemetryReceivedAt !== null &&
    (now - new Date(lastTelemetryReceivedAt).getTime() < WEIGHT_SENSOR_TIMEOUT_MS);

  const weightValue = isWeightConnected ? currentWeightGrams : null;
  const weightStatusText = isWeightConnected ? 'Connected' : 'Weight sensor disconnected';

  // Query Python sidecar for live YOLOv8 detection
  const sidecarResult = await queryPythonSidecar();
  const cameraConnected = sidecarResult.success;
  const cameraStatusText = cameraConnected ? 'Connected' : 'Camera disconnected';

  let detectedItemName = null;
  let detectedConfidence = 0;
  let detectionStatusText = 'Camera disconnected';

  if (cameraConnected) {
    if (sidecarResult.item) {
      detectedItemName = capitalizeItemName(sidecarResult.item);
      detectedConfidence = sidecarResult.confidence || 0;
      detectionStatusText = 'Detected';
      // Sync real detection to Cloud Ledger
      syncMeasurementToCloud(detectedItemName, detectedConfidence, weightValue, isWeightConnected);
    } else {
      detectionStatusText = 'No item detected';
    }
  }

  // Supervisory state logic
  let isLowStock = false;
  let inventoryStatusText = 'Inventory Status: Optimal';

  if (!isWeightConnected) {
    inventoryStatusText = 'Inventory Status: Weight sensor disconnected';
  } else if (weightValue < LOW_STOCK_THRESHOLD_GRAMS) {
    isLowStock = true;
    inventoryStatusText = 'Inventory Alert: Critical Low Stock';
  } else {
    inventoryStatusText = 'Inventory Status: Optimal';
  }

  // Format IP from camera URL
  let cameraIp = '192.168.1.7';
  try {
    const urlObj = new URL(activeCamUrl);
    cameraIp = urlObj.hostname;
  } catch {}

  const responsePayload = {
    camera: {
      connected: cameraConnected,
      ip: cameraIp,
      endpoint: activeCamUrl,
      statusText: cameraStatusText
    },
    weight: {
      value: weightValue,
      unit: 'g',
      connected: isWeightConnected,
      statusText: weightStatusText,
      precision: 1
    },
    detection: {
      item: detectedItemName,
      confidence: detectedConfidence,
      statusText: detectionStatusText,
      source: 'ESP32-CAM'
    },
    weightGrams: weightValue,
    unit: 'g',
    isLowStock: isLowStock,
    lowStockThreshold: LOW_STOCK_THRESHOLD_GRAMS,
    inventoryStatus: inventoryStatusText,
    sidecarConnected: cameraConnected,
    activeCamUrl: activeCamUrl,
    detectedItems: (sidecarResult.items || []).map((it) => ({
      class: capitalizeItemName(it.class),
      rawClass: it.class,
      confidence: it.confidence,
      timestamp: it.timestamp,
      count: it.count || 1
    })),
    cloudLedger: cloudLedger,
    database: {
      connected: isMongoConnected,
      statusText: mongoStatusText,
      cluster: 'cluster0.wpgqr4c.mongodb.net',
      database: DB_NAME,
      collection: COLLECTION_NAME,
      hasCredentials: !MONGODB_URI.includes('<PASSWORD>') && !MONGODB_URI.includes('<db_username>') && !MONGODB_URI.includes('<db_password>')
    },
    lastTelemetryAt: lastTelemetryReceivedAt,
    systemTimestamp: new Date().toISOString()
  };

  return res.status(200).json(responsePayload);
}

app.get('/api/status', handleStatus);
app.get('/api/fridge-status', handleStatus);

/**
 * Dedicated database status endpoint (GET /api/db-status):
 * Returns whether MongoDB is connected, without exposing credentials.
 */
app.get('/api/db-status', (req, res) => {
  return res.status(200).json({
    connected: isMongoConnected,
    database: DB_NAME,
    collection: COLLECTION_NAME,
    status: mongoStatusText,
    cluster: 'cluster0.wpgqr4c.mongodb.net',
    timestamp: new Date().toISOString()
  });
});

/**
 * Trigger manual scan endpoint.
 */
app.post('/api/scan', async (req, res) => {
  const result = await queryPythonSidecar(true);
  return res.status(200).json({ success: true, result });
});

/**
 * Direct Test Detection Endpoint (POST /api/test-detection):
 * Injects a test detection into MongoDB Atlas 'detections' collection and ledger.
 */
app.post('/api/test-detection', async (req, res) => {
  try {
    const { object, confidence, weight, cameraId } = req.body || {};
    const itemObj = object || 'bottle';
    const itemConf = typeof confidence === 'number' ? confidence : 0.94;
    const itemWeight = weight !== undefined ? parseFloat(weight) : (currentWeightGrams !== null ? currentWeightGrams : 350.0);
    const camId = cameraId || DEFAULT_CAMERA_ID;

    syncMeasurementToCloud(itemObj, itemConf, itemWeight, true);

    return res.status(200).json({
      success: true,
      message: 'Test detection recorded successfully',
      record: {
        object: capitalizeItemName(itemObj),
        confidence: itemConf,
        weight: itemWeight,
        cameraId: camId,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Cloud Ledger endpoint.
 * Retrieves detection records from MongoDB Atlas sorted newest first,
 * falling back to local ledger cache if MongoDB is offline.
 */
app.get('/api/ledger', async (req, res) => {
  if (isMongoConnected) {
    try {
      const records = await Detection.find().sort({ timestamp: -1 }).limit(200).lean();
      return res.status(200).json({
        success: true,
        source: 'MongoDB Atlas',
        database: DB_NAME,
        collection: COLLECTION_NAME,
        connected: true,
        totalRecords: records.length,
        records: records.map((r) => ({
          id: r.id || (r._id ? r._id.toString() : `DET-${Date.now()}`),
          object: r.object || r.itemName,
          itemName: r.itemName || r.object,
          confidence: r.confidence || 0,
          weight: r.weight,
          cameraId: r.cameraId || DEFAULT_CAMERA_ID,
          timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : new Date(r.timestamp).toISOString(),
          unit: r.unit || 'g',
          cameraStatus: r.cameraStatus || 'Connected',
          sensorStatus: r.sensorStatus || 'Connected',
          status: r.status || 'RECORDED'
        }))
      });
    } catch (err) {
      console.error(`[MongoDB] Database read failure: ${err.message}`);
    }
  }

  return res.status(200).json({
    success: true,
    source: 'Local Ledger Backup (cloud_ledger.json)',
    database: DB_NAME,
    collection: COLLECTION_NAME,
    connected: false,
    totalRecords: cloudLedger.length,
    records: cloudLedger
  });
});

/**
 * Configuration endpoint:
 * Updates the active ESP32-CAM address.
 */
app.post('/api/config/camera', (req, res) => {
  const { cam_url } = req.body;
  if (typeof cam_url === 'string' && cam_url.trim()) {
    activeCamUrl = cam_url.trim();
    lastSidecarQueryTime = 0; // Invalidate cache
    console.log(`[Configuration] Active ESP32-CAM URL updated to: ${activeCamUrl}`);
    return res.status(200).json({ success: true, activeCamUrl });
  }
  return res.status(400).json({ success: false, error: 'Invalid cam_url provided.' });
});

/**
 * Database configuration & test endpoint:
 * Allows dynamic connection testing or updating credentials without restarting the server.
 */
app.post('/api/config/database', async (req, res) => {
  const { uri, username, password, dbName } = req.body;
  let targetUri = uri;
  if (!targetUri && username && password) {
    targetUri = `mongodb+srv://${encodeURIComponent(username)}:${encodeURIComponent(password)}@cluster0.wpgqr4c.mongodb.net/${encodeURIComponent(dbName || DB_NAME)}?retryWrites=true&w=majority&appName=Cluster0`;
  }

  if (targetUri) {
    MONGODB_URI = targetUri;
    if (mongoose.connection.readyState !== 0) {
      try { await mongoose.disconnect(); } catch {}
    }
    const success = await connectToMongoDB(targetUri);
    if (success) {
      return res.status(200).json({
        success: true,
        message: 'MongoDB connected successfully',
        database: mongoose.connection.name,
        collection: COLLECTION_NAME,
        host: mongoose.connection.host
      });
    } else {
      return res.status(400).json({ success: false, error: mongoStatusText });
    }
  }
  return res.status(400).json({ success: false, error: 'Provide either full "uri" or "username" and "password".' });
});

// Start Express Server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[VisionScale] Backend server listening on port ${PORT}`);
  console.log(`[VisionScale] Weight telemetry intake: POST /api/telemetry and POST /api/weight`);
  console.log(`[VisionScale] Unified status endpoints: GET /api/status and GET /api/fridge-status`);
  console.log(`[VisionScale] Database health endpoint: GET /api/db-status`);
  console.log(`[VisionScale] Python/YOLOv8 sidecar bridge: ${PYTHON_SIDECAR_URL}`);
  
  // Initiate MongoDB Atlas connection asynchronously
  await connectToMongoDB();
});
