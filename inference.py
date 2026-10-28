import os
import io
import time
import base64
import logging
from datetime import datetime, timezone
import requests
import numpy as np
from PIL import Image
from flask import Flask, request, jsonify
from flask_cors import CORS

# Configure logging without emojis
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("InferenceBridge")

# Initialize Flask Application
app = Flask(__name__)
CORS(app)

# Path to YOLOv8 weights
MODEL_PATH = os.environ.get("MODEL_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "best.pt"))
ESP32_CAM_DEFAULT_URL = os.environ.get("ESP32_CAM_URL", "http://192.168.1.7/saved-photo")

# Global model instance
model = None

def load_yolo_model():
    global model
    try:
        from ultralytics import YOLO
        if os.path.exists(MODEL_PATH):
            logger.info(f"Loading YOLOv8 model from {MODEL_PATH}")
            model = YOLO(MODEL_PATH)
            logger.info("Model loaded successfully.")
        else:
            logger.warning(f"Model file not found at {MODEL_PATH}. Attempting fallback initialization.")
            # Fallback initialization attempt if user provides weights under another path
            model = YOLO("yolov8n.pt")
            logger.info("Loaded standard YOLOv8n as fallback model.")
    except Exception as e:
        logger.error(f"Failed to load YOLO model: {str(e)}")
        model = None

def read_image_from_request():
    """
    Extracts an image array from incoming multipart request, JSON payload,
    or fetches directly from the ESP32-CAM stream/capture endpoint.
    """
    # Case 1: Uploaded file via multipart/form-data
    if 'image' in request.files:
        file = request.files['image']
        img_bytes = file.read()
        image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        return np.array(image), "FILE_UPLOAD"
    elif 'file' in request.files:
        file = request.files['file']
        img_bytes = file.read()
        image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        return np.array(image), "FILE_UPLOAD"

    # Case 2: JSON payload with base64 encoded image
    if request.is_json:
        data = request.get_json(silent=True) or {}
        if "image_base64" in data and data["image_base64"]:
            raw_base64 = data["image_base64"]
            if "," in raw_base64:
                raw_base64 = raw_base64.split(",")[1]
            img_bytes = base64.b64decode(raw_base64)
            image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            return np.array(image), "JSON_BASE64"

    # Case 3: Remote URL specified in request or default to ESP32_CAM_DEFAULT_URL
    target_url = None
    if request.is_json:
        target_url = (request.get_json(silent=True) or {}).get("cam_url")
    if not target_url:
        target_url = request.args.get("cam_url")
    if not target_url:
        target_url = ESP32_CAM_DEFAULT_URL

    if not target_url:
        raise ValueError("No image provided and no ESP32-CAM endpoint configured.")

    # Attempt fetch from target camera URL
    logger.info(f"Connecting to ESP32-CAM at: {target_url}")
    try:
        resp = requests.get(target_url, timeout=5)
        if resp.status_code == 200 and len(resp.content) > 0:
            image = Image.open(io.BytesIO(resp.content)).convert("RGB")
            return np.array(image), target_url
        elif resp.status_code == 404 and "/saved-photo" in target_url:
            # Handle endpoint difference if firmware exposes /capture instead of /saved-photo
            fallback_url = target_url.replace("/saved-photo", "/capture")
            logger.warning(f"Endpoint {target_url} returned 404. Attempting live hardware endpoint: {fallback_url}")
            fallback_resp = requests.get(fallback_url, timeout=5)
            if fallback_resp.status_code == 200 and len(fallback_resp.content) > 0:
                image = Image.open(io.BytesIO(fallback_resp.content)).convert("RGB")
                return np.array(image), fallback_url
            else:
                raise RuntimeError(f"ESP32-CAM endpoint returned HTTP {resp.status_code}")
        else:
            raise RuntimeError(f"ESP32-CAM endpoint returned HTTP {resp.status_code}")
    except requests.exceptions.RequestException as req_err:
        logger.error(f"Failed to reach ESP32-CAM at {target_url}: {str(req_err)}")
        raise RuntimeError("ESP32-CAM disconnected or unreachable")
    except Exception as img_err:
        logger.error(f"Failed to decode image from ESP32-CAM: {str(img_err)}")
        raise RuntimeError("ESP32-CAM disconnected or unreachable")

@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "ONLINE",
        "service": "Smart Refrigerator YOLOv8 Sidecar Bridge",
        "model_loaded": model is not None,
        "model_path": MODEL_PATH,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }), 200

@app.route("/api/analyze", methods=["GET", "POST"])
def analyze():
    """
    Runs YOLOv8 inference on incoming image frame or directly captured
    ESP32-CAM frame, and returns structured unique detected items.
    """
    request_timestamp = datetime.now(timezone.utc).isoformat()
    
    if model is None:
        logger.error("Inference request received but YOLO model is not initialized.")
        return jsonify({
            "success": False,
            "error": "Model initialization failed or weights file is missing.",
            "timestamp": request_timestamp,
            "items": []
        }), 503

    try:
        image_array, source_info = read_image_from_request()
    except Exception as read_err:
        err_msg = str(read_err)
        if "ESP32-CAM" not in err_msg:
            err_msg = "ESP32-CAM disconnected or unreachable"
        logger.error(f"Image acquisition failed: {err_msg}")
        return jsonify({
            "success": False,
            "error": err_msg,
            "item": None,
            "confidence": 0,
            "source": "ESP32-CAM",
            "timestamp": request_timestamp,
            "items": []
        }), 503

    try:
        # Run inference using Ultralytics YOLOv8
        # conf threshold set to 0.25 to capture valid items while filtering noise
        results = model.predict(source=image_array, conf=0.25, verbose=False)
        
        # Track unique food item classes with highest confidence
        unique_items_map = {}
        total_detections = 0
        detected_boxes = []

        for r in results:
            boxes = r.boxes
            if boxes is None:
                continue

            for box in boxes:
                total_detections += 1
                cls_id = int(box.cls[0].item())
                confidence = float(box.conf[0].item())
                
                # Retrieve class label from model dictionary
                class_name = model.names.get(cls_id, f"item_{cls_id}").strip().lower()

                # Extract bounding box coordinates [x1, y1, x2, y2]
                xyxy = [round(float(coord), 1) for coord in box.xyxy[0].tolist()] if hasattr(box, "xyxy") else []
                detected_boxes.append({
                    "class": class_name,
                    "confidence": round(confidence, 4),
                    "box": xyxy
                })

                # Filter or update highest confidence per unique food item
                if class_name not in unique_items_map or confidence > unique_items_map[class_name]["confidence"]:
                    unique_items_map[class_name] = {
                        "class": class_name,
                        "confidence": round(confidence, 4),
                        "timestamp": request_timestamp,
                        "count": unique_items_map.get(class_name, {}).get("count", 0) + 1
                    }
                else:
                    unique_items_map[class_name]["count"] += 1

        # Format output as a structured JSON array
        output_items = list(unique_items_map.values())
        
        # Determine top detected item
        if len(output_items) > 0:
            top_item = max(output_items, key=lambda x: x["confidence"])
            detected_item_name = top_item["class"]
            detected_confidence = top_item["confidence"]
        else:
            detected_item_name = None
            detected_confidence = 0

        logger.info(f"Inference completed. Source: {source_info}, Top Item: {detected_item_name}, Confidence: {detected_confidence}")

        return jsonify({
            "success": True,
            "item": detected_item_name,
            "confidence": detected_confidence,
            "source": "ESP32-CAM",
            "camera_source": str(source_info),
            "timestamp": request_timestamp,
            "total_detections": total_detections,
            "unique_count": len(output_items),
            "items": output_items,
            "boxes": detected_boxes
        }), 200

    except Exception as inf_err:
        logger.error(f"Inference processing failed: {str(inf_err)}")
        return jsonify({
            "success": False,
            "error": f"Inference execution failed: {str(inf_err)}",
            "item": None,
            "confidence": 0,
            "source": "ESP32-CAM",
            "timestamp": request_timestamp,
            "items": []
        }), 500

if __name__ == "__main__":
    load_yolo_model()
    port = int(os.environ.get("PORT", 5001))
    logger.info(f"Starting Python Sidecar Bridge on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
