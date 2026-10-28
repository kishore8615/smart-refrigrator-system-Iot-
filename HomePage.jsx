import React from 'react';
import { useNavigate } from 'react-router-dom';

const FEATURES = [
  {
    tag: 'Computer Vision',
    title: 'YOLOv8 Item Detection',
    description:
      'A custom-trained YOLOv8 neural network model identifies food items and objects in real time from live ESP32-CAM frames with per-class confidence scoring.',
  },
  {
    tag: 'Precision Weighing',
    title: 'HX711 Load Cell Measurement',
    description:
      'An HX711 24-bit ADC amplifies load cell signals to deliver calibrated weight readings with 0.1 g precision. Telemetry is transmitted over Wi-Fi via ESP32/NodeMCU.',
  },
  {
    tag: 'Embedded Hardware',
    title: 'ESP32-CAM OV3660',
    description:
      'The OV3660 camera module on the ESP32-CAM captures snapshot images on demand over the local Wi-Fi network and streams them to the Python inference bridge.',
  },
  {
    tag: 'Live Monitoring',
    title: 'Real-Time Dashboard',
    description:
      'The React dashboard polls the Node.js backend every 2.5 seconds, displaying live detection results, weight telemetry, and the persistent cloud detection ledger.',
  },
];

const PIPELINE_STEPS = [
  { step: '01', label: 'Capture', detail: 'ESP32-CAM (OV3660) captures a snapshot image of the item.' },
  { step: '02', label: 'Identify', detail: 'Python Flask sidecar runs YOLOv8 inference on the frame.' },
  { step: '03', label: 'Weigh', detail: 'HX711 load cell transmits gram-accurate weight via ESP32.' },
  { step: '04', label: 'Record', detail: 'Node.js backend logs the result to MongoDB Atlas and a local ledger.' },
  { step: '05', label: 'Display', detail: 'React dashboard renders detection and weight data in real time.' },
];

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="home-page">

      {/* Hero */}
      <section className="hero-section">
        <div className="hero-inner">
          <span className="hero-tag">AI-Powered IoT System</span>
          <h1 className="hero-title">VisionScale</h1>
          <p className="hero-tagline">See it. Weigh it. Know it.</p>
          <p className="hero-description">
            VisionScale combines an ESP32-CAM, a YOLOv8 neural network inference bridge,
            and a precision HX711 load cell to automatically identify items and measure
            their weight in real time. Detection results and telemetry are stored in
            MongoDB Atlas and displayed on a live engineering dashboard.
          </p>
          <div className="hero-actions">
            <button
              className="btn btn-primary btn-lg"
              onClick={() => navigate('/dashboard')}
              id="hero-open-dashboard-btn"
            >
              Open Dashboard
            </button>
            <a
              href="#how-it-works"
              className="btn btn-secondary btn-lg"
              id="hero-how-it-works-link"
            >
              How It Works
            </a>
          </div>
          <div className="hero-stack-row">
            {['ESP32-CAM', 'YOLOv8', 'HX711', 'Node.js', 'MongoDB Atlas', 'React'].map((t) => (
              <span key={t} className="stack-tag">{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="home-section" id="how-it-works">
        <div className="section-inner">
          <div className="section-heading">
            <span className="section-tag">System Pipeline</span>
            <h2 className="section-title">How VisionScale Works</h2>
            <p className="section-subtitle">
              Five sequential stages convert a physical item into a timestamped, cloud-stored detection record.
            </p>
          </div>
          <ol className="pipeline-list" aria-label="System pipeline steps">
            {PIPELINE_STEPS.map((s) => (
              <li key={s.step} className="pipeline-step">
                <span className="pipeline-number" aria-hidden="true">{s.step}</span>
                <div className="pipeline-content">
                  <span className="pipeline-label">{s.label}</span>
                  <p className="pipeline-detail">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section className="home-section home-section-alt" id="features">
        <div className="section-inner">
          <div className="section-heading">
            <span className="section-tag">Core Capabilities</span>
            <h2 className="section-title">System Features</h2>
            <p className="section-subtitle">
              Each component is purpose-built, hardware-verified, and integrated into a single monitoring platform.
            </p>
          </div>
          <div className="feature-grid">
            {FEATURES.map((f) => (
              <article key={f.title} className="feature-card">
                <span className="feature-tag">{f.tag}</span>
                <h3 className="feature-title">{f.title}</h3>
                <p className="feature-desc">{f.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture */}
      <section className="home-section" id="architecture">
        <div className="section-inner">
          <div className="section-heading">
            <span className="section-tag">Technical Architecture</span>
            <h2 className="section-title">System Stack</h2>
          </div>
          <div className="arch-grid">
            <div className="arch-layer">
              <span className="arch-layer-tag">Hardware Layer</span>
              <ul className="arch-list">
                <li>ESP32-CAM with OV3660 image sensor</li>
                <li>HX711 24-bit ADC + load cell transducer</li>
                <li>ESP32 / NodeMCU microcontroller</li>
              </ul>
            </div>
            <div className="arch-layer">
              <span className="arch-layer-tag">Inference Layer</span>
              <ul className="arch-list">
                <li>Python 3 Flask sidecar server (Port 5001)</li>
                <li>YOLOv8 model — custom trained (best.pt)</li>
                <li>Confidence-filtered detection results</li>
              </ul>
            </div>
            <div className="arch-layer">
              <span className="arch-layer-tag">Backend Layer</span>
              <ul className="arch-list">
                <li>Node.js + Express REST API (Port 5000)</li>
                <li>MongoDB Atlas — iot_detection.detections</li>
                <li>Local fallback — cloud_ledger.json</li>
              </ul>
            </div>
            <div className="arch-layer">
              <span className="arch-layer-tag">Frontend Layer</span>
              <ul className="arch-list">
                <li>React 18 + Vite 5 (Port 5173)</li>
                <li>Real-time polling — 2.5 s interval</li>
                <li>Responsive engineering dashboard</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <div className="section-inner cta-inner">
          <h2 className="cta-title">Ready to monitor your system?</h2>
          <p className="cta-desc">
            Open the live dashboard to view real hardware telemetry, YOLOv8 detection
            results, load cell weight readings, and the full detection history ledger.
          </p>
          <button
            className="btn btn-primary btn-lg"
            onClick={() => navigate('/dashboard')}
            id="cta-open-dashboard-btn"
          >
            Open Dashboard
          </button>
        </div>
      </section>

      {/* Home Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <span>VisionScale | Node.js (5000) &bull; Flask/YOLOv8 Sidecar (5001) &bull; React Dashboard (5173)</span>
          <span>Camera: ESP32-CAM OV3660 (192.168.1.7) &bull; Scale: HX711 Load Cell &bull; AI: YOLOv8</span>
        </div>
      </footer>
    </div>
  );
}
