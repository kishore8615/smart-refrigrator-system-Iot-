import React, { useState, useEffect, useCallback } from 'react';

// API configuration — unchanged from original
const API_BASE_URL = 'http://localhost:5000';
const POLLING_INTERVAL_MS = 2500;

export default function DashboardPage() {
  const [data, setData] = useState({
    camera: {
      connected: false,
      ip: '10.146.71.45',
      endpoint: 'http://10.146.71.45/capture',
      statusText: 'Camera disconnected'
    },
    weight: {
      value: null,
      unit: 'g',
      connected: false,
      statusText: 'Weight sensor disconnected',
      precision: 1
    },
    detection: {
      item: null,
      confidence: 0,
      statusText: 'Camera disconnected',
      source: 'ESP32-CAM'
    },
    database: {
      connected: false,
      statusText: 'Not initialized',
      cluster: 'cluster0.wpgqr4c.mongodb.net',
      collection: 'cloud_ledger',
      hasCredentials: false
    },
    weightGrams: null,
    unit: 'g',
    isLowStock: false,
    lowStockThreshold: 50.0,
    inventoryStatus: 'Inventory Status: Weight sensor disconnected',
    sidecarConnected: false,
    activeCamUrl: 'http://10.146.71.45/capture',
    detectedItems: [],
    cloudLedger: [],
    lastTelemetryAt: null,
    systemTimestamp: null,
  });

  const [backendOnline, setBackendOnline] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState(null);
  const [camUrlInput, setCamUrlInput] = useState('');
  const [showConfig, setShowConfig] = useState(false);

  // Fetch unified hardware and fridge status from Node.js backend
  const fetchFridgeStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/status`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (response.ok) {
        const json = await response.json();
        setData(json);
        setBackendOnline(true);
        setLastFetchTime(new Date().toLocaleTimeString());
      } else {
        setBackendOnline(false);
      }
    } catch (err) {
      setBackendOnline(false);
    }
  }, []);

  // Real-time polling cycle
  useEffect(() => {
    fetchFridgeStatus();
    const interval = setInterval(fetchFridgeStatus, POLLING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchFridgeStatus]);

  // Handler to trigger immediate hardware camera scan
  const handleManualScan = async () => {
    try {
      setIsScanning(true);
      const resp = await fetch(`${API_BASE_URL}/api/scan`, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
      });
      if (resp.ok) {
        await fetchFridgeStatus();
      }
    } catch (err) {
      console.error('Scan request failed:', err);
    } finally {
      setIsScanning(false);
    }
  };

  // Handler to update camera configuration
  const handleSaveCamUrl = async (e) => {
    e.preventDefault();
    try {
      await fetch(`${API_BASE_URL}/api/config/camera`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cam_url: camUrlInput }),
      });
      fetchFridgeStatus();
    } catch (e) {
      console.error('Camera URL update error:', e);
    }
  };

  // Format timestamp helper
  const formatTimestamp = (isoString) => {
    if (!isoString) return 'Pending Signal';
    try {
      const d = new Date(isoString);
      return d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch {
      return isoString;
    }
  };

  const isWeightSensorConnected = data.weight && data.weight.connected;
  const isCameraConnected = data.camera && data.camera.connected;
  const currentWeightVal = isWeightSensorConnected && data.weight.value !== null ? data.weight.value : null;

  return (
    <div className="app-canvas">
      {/* Top Application Header */}
      <header className="app-header">
        <div className="header-container">
          <div className="header-brand">
            <span className="brand-badge">REAL-TIME HARDWARE INTEGRATION</span>
            <h1 className="app-title">VisionScale</h1>
            <p className="app-subtitle">
              See it. Weigh it. Know it. &mdash; ESP32-CAM OV3660 vision, HX711 load cell telemetry, YOLOv8 inference bridge, and cloud ledger.
            </p>
          </div>

          <div className="header-meta">
            <div className="system-pill-group">
              <div className={`status-pill ${backendOnline ? 'pill-online' : 'pill-offline'}`}>
                <span className="status-indicator"></span>
                <span>Backend: {backendOnline ? 'Port 5000 Active' : 'Offline'}</span>
              </div>
              <div className={`status-pill ${
                data.database && data.database.connected
                  ? 'pill-online'
                  : data.database && !data.database.hasCredentials
                  ? 'pill-warning'
                  : 'pill-offline'
              }`}>
                <span className="status-indicator"></span>
                <span>
                  MongoDB: {
                    data.database && data.database.connected
                      ? 'Atlas Connected'
                      : data.database && !data.database.hasCredentials
                      ? 'Credentials Needed (.env)'
                      : 'Atlas Disconnected'
                  }
                </span>
              </div>
              <div className={`status-pill ${isCameraConnected ? 'pill-online' : 'pill-offline'}`}>
                <span className="status-indicator"></span>
                <span>Camera: {isCameraConnected ? 'Connected (10.146.71.45)' : 'Camera disconnected'}</span>
              </div>
              <div className={`status-pill ${isWeightSensorConnected ? 'pill-online' : 'pill-warning'}`}>
                <span className="status-indicator"></span>
                <span>Scale: {isWeightSensorConnected ? 'Connected' : 'Weight sensor disconnected'}</span>
              </div>
            </div>
            {lastFetchTime && (
              <span className="last-sync-label">Last Polled: {lastFetchTime}</span>
            )}
          </div>
        </div>
      </header>

      {/* Main Grid Content */}
      <main className="dashboard-grid">
        
        {/* ROW 1: PRIMARY METRICS & INVENTORY STATUS */}
        <section className="metric-row">
          {/* Active Load Cell Scale Weight Card */}
          <div className="metric-card weight-metric-card">
            <div className="metric-header">
              <span className="metric-tag">ACTIVE LOAD CELL</span>
              <span className="metric-aux">
                {isWeightSensorConnected ? 'HX711 Telemetry Active' : 'Sensor Offline'}
              </span>
            </div>
            <div className="metric-body">
              {isWeightSensorConnected ? (
                <div className="weight-display">
                  <span className="weight-value">{Number(currentWeightVal).toFixed(1)}</span>
                  <span className="weight-unit">grams</span>
                </div>
              ) : (
                <div className="sensor-disconnected-box">
                  <span className="sensor-disconnected-title">Weight sensor disconnected</span>
                  <p className="sensor-disconnected-caption">
                    Waiting for real telemetry from ESP32/NodeMCU load cell.
                  </p>
                </div>
              )}
              <p className="metric-caption">
                {isWeightSensorConnected
                  ? `Sensor calibration: Single decimal precision. Threshold limit: ${data.lowStockThreshold} g.`
                  : 'Transmit HTTP POST to /api/telemetry or /api/weight with {"weight": <grams>}.'}
              </p>
            </div>
            <div className="metric-footer">
              <span className="telemetry-stamp">
                Last Reading: {formatTimestamp(data.lastTelemetryAt)}
              </span>
            </div>
          </div>

          {/* Dedicated Inventory Status Panel */}
          <div className={`status-panel ${
            !isWeightSensorConnected 
              ? 'status-panel-neutral' 
              : data.isLowStock 
              ? 'status-panel-critical' 
              : 'status-panel-optimal'
          }`}>
            <div className="panel-header">
              <span className="panel-tag">SUPERVISORY STATE</span>
              <span className="panel-flag">
                {!isWeightSensorConnected
                  ? 'AWAITING HARDWARE'
                  : data.isLowStock
                  ? 'CRITICAL ACTION REQUIRED'
                  : 'NORMAL CONDITIONS'}
              </span>
            </div>
            <div className="panel-body">
              <div className="status-statement">
                {data.inventoryStatus}
              </div>
              <p className="status-description">
                {!isWeightSensorConnected
                  ? 'Hardware Notice: The load cell weight transmitter is disconnected or offline. Physical readings will display once microcontroller signal resumes.'
                  : data.isLowStock
                  ? 'System Alert: Current weight reading has dropped below the 50.0 g safety reserve threshold. Restock recommended.'
                  : 'System Status: Continuous mass exceeds reserve bounds. Stock density is within normal operating limits.'}
              </p>
            </div>
            <div className="panel-footer">
              <div className="threshold-meter">
                <div className="meter-label">
                  <span>Current: {isWeightSensorConnected ? `${Number(currentWeightVal).toFixed(1)} g` : 'No Signal'}</span>
                  <span>Trip Point: {data.lowStockThreshold} g</span>
                </div>
                <div className="meter-track">
                  <div
                    className={`meter-fill ${
                      !isWeightSensorConnected
                        ? 'fill-neutral'
                        : data.isLowStock
                        ? 'fill-critical'
                        : 'fill-optimal'
                    }`}
                    style={{
                      width: isWeightSensorConnected
                        ? `${Math.min(100, Math.max(5, (currentWeightVal / 500) * 100))}%`
                        : '0%'
                    }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ROW 2: CURRENT INVENTORY IDENTIFICATION & CONTROL MODULE */}
        <section className="dashboard-columns">
          
          {/* Left Column: Live Identified Items */}
          <div className="card-container inventory-card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Identified Food Inventory</h2>
                <p className="card-subtitle">
                  Live detection via ESP32-CAM (OV3660) at {data.activeCamUrl}
                </p>
              </div>
              <span className="counter-pill">
                {isCameraConnected ? `${data.detectedItems.length} Identified` : 'Camera Offline'}
              </span>
            </div>

            <div className="card-body">
              {/* Primary Detection Banner */}
              <div className="primary-detection-banner">
                <span className="banner-tag">CURRENT PRIMARY OBJECT</span>
                <div className="banner-result">
                  <span className="banner-item-name">
                    {!isCameraConnected
                      ? 'Camera disconnected'
                      : data.detection && data.detection.item
                      ? data.detection.item
                      : 'No item detected'}
                  </span>
                  {isCameraConnected && data.detection && data.detection.item && (
                    <span className="confidence-pill">
                      {(data.detection.confidence * 100).toFixed(1)}% Confidence
                    </span>
                  )}
                </div>
              </div>

              {/* Unique Detected Items List */}
              {data.detectedItems.length === 0 ? (
                <div className="empty-state-box">
                  <p className="empty-title">
                    {!isCameraConnected ? 'Camera disconnected' : 'No item detected'}
                  </p>
                  <p className="empty-desc">
                    {!isCameraConnected
                      ? 'Ensure ESP32-CAM is powered on at 192.168.1.7 and connected to local Wi-Fi.'
                      : 'The camera frame contains no recognized food items with confidence above 0.25.'}
                  </p>
                </div>
              ) : (
                <div className="item-list">
                  {data.detectedItems.map((item, idx) => (
                    <div key={`${item.rawClass}-${idx}`} className="inventory-row">
                      <div className="item-main">
                        <div className="item-name">{item.class}</div>
                        <div className="item-meta">
                          Class ID: {item.rawClass} | Multiplicity: {item.count}
                        </div>
                      </div>
                      <div className="item-stats">
                        <span className="confidence-pill">
                          {(item.confidence * 100).toFixed(1)}% Match
                        </span>
                        <span className="timestamp-pill">
                          {formatTimestamp(item.timestamp)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card-footer actions-bar">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleManualScan}
                disabled={isScanning}
                id="manual-scan-btn"
              >
                {isScanning ? 'Capturing Frame...' : 'Capture & Scan Now'}
              </button>
              <button
                type="button"
                className="btn btn-tertiary"
                onClick={() => setShowConfig(!showConfig)}
                id="toggle-camera-settings-btn"
              >
                {showConfig ? 'Hide Settings' : 'Camera Settings'}
              </button>
            </div>

            {/* Hardware Configuration Subpanel */}
            {showConfig && (
              <div className="subpanel-config">
                <h3 className="subpanel-title">ESP32-CAM Network Configuration</h3>
                <form onSubmit={handleSaveCamUrl} className="config-form-group">
                  <label className="config-label">
                    Camera Snapshot URL (default: http://192.168.1.7/saved-photo):
                  </label>
                  <div className="input-action-row">
                    <input
                      type="text"
                      className="form-input"
                      placeholder="http://192.168.1.7/saved-photo"
                      value={camUrlInput}
                      onChange={(e) => setCamUrlInput(e.target.value)}
                      id="cam-url-input"
                    />
                    <button type="submit" className="btn btn-primary" id="update-cam-url-btn">
                      Update URL
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* Right Column: Historical Cloud Ledger */}
          <div className="card-container ledger-card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Historical Cloud Ledger</h2>
                <p className="card-subtitle">
                  {data.database && data.database.connected
                    ? 'Real-time synchronization with MongoDB Atlas (iot_detection.detections).'
                    : 'Persistent ledger stored in local storage cache (cloud_ledger.json).'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span className={`status-pill ${data.database && data.database.connected ? 'pill-online' : 'pill-warning'}`}>
                  <span className="status-indicator"></span>
                  <span>{data.database && data.database.connected ? 'Atlas Synced' : 'Local Backup'}</span>
                </span>
                <span className="counter-pill">{data.cloudLedger.length} Records</span>
              </div>
            </div>

            <div className="card-body ledger-table-wrapper">
              {data.cloudLedger.length === 0 ? (
                <div className="empty-state-box">
                  <p className="empty-title">Cloud Ledger Empty</p>
                  <p className="empty-desc">
                    Measurements will automatically log when a valid food item is detected on the scale.
                  </p>
                </div>
              ) : (
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th scope="col">Object / Item</th>
                      <th scope="col">Arrival Timestamp</th>
                      <th scope="col">Scale Weight</th>
                      <th scope="col">Log Entry Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cloudLedger.map((record) => (
                      <tr key={record.id}>
                        <td className="cell-item-name">
                          <span className="item-bullet"></span>
                          {record.object || record.itemName}
                        </td>
                        <td className="cell-timestamp">
                          {formatTimestamp(record.timestamp)}
                        </td>
                        <td className="cell-weight">
                          {record.weight !== null && record.weight !== undefined
                            ? `${Number(record.weight).toFixed(1)} g`
                            : 'Sensor Disconnected'}
                        </td>
                        <td className="cell-status">
                          <span className="badge badge-recorded">
                            {record.status || 'RECORDED'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card-footer table-footer">
              <span className="table-caption">
                Storage: {data.database && data.database.connected ? 'MongoDB Atlas (iot_detection.detections)' : 'cloud_ledger.json (Local Backup)'} | Camera: ESP32-CAM-01
              </span>
            </div>
          </div>

        </section>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <span>VisionScale | Node.js (5000) &bull; Flask/YOLOv8 Sidecar (5001) &bull; React Dashboard (5173)</span>
          <span>Camera: ESP32-CAM OV3660 (192.168.1.7) &bull; Scale: HX711 Load Cell &bull; AI: YOLOv8</span>
        </div>
      </footer>
    </div>
  );
}
