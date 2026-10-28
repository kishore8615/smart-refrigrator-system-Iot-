# VisionScale

**See it. Weigh it. Know it.**

VisionScale is a real-time AI-powered item identification and weight monitoring system built on embedded IoT hardware, a YOLOv8 computer vision inference bridge, a Node.js backend, and a React dashboard.

---

## Overview

VisionScale captures a live image of any item placed on the sensing platform using an ESP32-CAM (OV3660), identifies the item using a YOLOv8 neural network model, measures its weight via an HX711 load cell amplifier, and presents the combined result in a web dashboard — all in real time.

---

## System Architecture

`
ESP32-CAM (OV3660)           HX711 Load Cell
      |                              |
      v                              v
Python Flask Sidecar          ESP32 / NodeMCU
(YOLOv8 Inference)            (Telemetry via HTTP POST)
      |                              |
      +-----------> Node.js Backend (Port 5000) <----------+
                          |
                          v
                  MongoDB Atlas (iot_detection)
                          |
                          v
                React Dashboard (Vite, Port 5173)
`

---

## Hardware Components

| Component | Role |
|-----------|------|
| ESP32-CAM (OV3660) | Captures item images over Wi-Fi |
| HX711 Load Cell Amplifier | Measures item weight in grams |
| ESP32 / NodeMCU | Transmits weight telemetry to the backend |
| Python Flask Bridge | Runs YOLOv8 object detection inference |

---

## Software Stack

| Layer | Technology |
|-------|-----------|
| AI / Vision | YOLOv8 (best.pt custom model) |
| Inference Bridge | Python 3, Flask (inference.py) |
| Backend | Node.js, Express.js |
| Database | MongoDB Atlas (iot_detection.detections) |
| Frontend | React 18, Vite 5 |
| Styling | Vanilla CSS |

---

## Getting Started

### 1. Install Node.js dependencies

npm install

### 2. Install Python dependencies

pip install -r requirements.txt

### 3. Configure environment variables

Copy .env.example to .env and fill in your credentials.

### 4. Start the Python YOLOv8 inference sidecar

python inference.py

### 5. Start the Node.js backend

node server.js

### 6. Start the React frontend

npm run dev

Dashboard available at http://localhost:5173

---

## Tagline

**VisionScale - See it. Weigh it. Know it.**
