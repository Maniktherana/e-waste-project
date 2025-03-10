from fastapi import FastAPI, Request, WebSocket
import asyncio
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from starlette.staticfiles import StaticFiles
import logging
import asyncio
import cv2
import numpy as np
import uuid
import os
import json
import uvicorn
import time
import base64
from typing import Dict, List, Optional, Union
from ultralytics import YOLO

# aiortc imports for WebRTC
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from aiortc.contrib.media import MediaBlackhole, MediaPlayer, MediaRecorder, MediaRelay
from av import VideoFrame
import fractions
from collections import defaultdict
import time

# Add this near the top of your file with other global variables
last_logged_predictions = defaultdict(dict)  # client_id -> { class_name -> timestamp }

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="YOLO WebRTC Object Detection")
# disable access logs
app.middleware_stack = None

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load YOLO model
try:
    model_path = os.path.join(os.getcwd(), "best.pt")
    model = YOLO(model_path)
    logger.info(f"YOLO model loaded from {model_path}")
except Exception as e:
    logger.error(f"Failed to load YOLO model: {e}")
    raise

# Dictionary to store peer connections
pcs = set()

# Store client detection data
client_detections = {}

class YOLOVideoStreamTrack(VideoStreamTrack):
    """
    A video track that performs YOLO object detection on incoming frames
    and returns frames with bounding boxes.
    """
    def __init__(self, track):
        super().__init__()
        self.track = track
        self.detection_results = []
        self._last_detection_time = 0
        self._frame_count = 0
        self._detection_interval = 5  # Process every 5 frames for performance

    async def recv(self):
        # Get frame from the source track
        frame = await self.track.recv()
        self._frame_count += 1
        
        # Convert frame to OpenCV format for YOLO processing
        img = frame.to_ndarray(format="bgr24")
        
        # Process detection on a subset of frames to maintain performance
        if self._frame_count % self._detection_interval == 0:
            try:
                # Run YOLO detection
                results = model.predict(source=img, conf=0.25, verbose=False)
                self._last_detection_time = time.time()
                
                # Extract detection results
                self.detection_results = []
                if results and len(results) > 0:
                    detections = results[0].boxes.data.cpu().numpy()
                    for detection in detections:
                        x1, y1, x2, y2, conf, class_id = detection
                        class_name = model.names[int(class_id)]
                        
                        # Log the detection
                        logger.info(
                            f"Detected: {class_name} (Confidence: {conf:.2f}), "
                            f"Coordinates: ({x1:.2f}, {y1:.2f}), ({x2:.2f}, {y2:.2f})"
                        )

                        # Draw bounding box and label
                        cv2.rectangle(
                            img, 
                            (int(x1), int(y1)), 
                            (int(x2), int(y2)), 
                            (0, 255, 0), 
                            2
                        )
                        label = f"{class_name} {conf:.2f}"
                        cv2.putText(
                            img, 
                            label, 
                            (int(x1), int(y1) - 10), 
                            cv2.FONT_HERSHEY_SIMPLEX, 
                            0.5, 
                            (0, 255, 0), 
                            2
                        )
                        
                        # Store detection for potential use by the client
                        self.detection_results.append({
                            "x1": float(x1),
                            "y1": float(y1),
                            "x2": float(x2),
                            "y2": float(y2),
                            "confidence": float(conf),
                            "class_id": int(class_id),
                            "class_name": class_name
                        })
            except Exception as e:
                logger.error(f"Error in YOLO detection: {e}")
        
        # Convert processed image back to VideoFrame
        new_frame = VideoFrame.from_ndarray(img, format="bgr24")
        new_frame.pts = frame.pts
        new_frame.time_base = frame.time_base
        
        return new_frame


@app.get("/")
async def index():
    return {"message": "YOLO WebRTC API is running"}


@app.post("/offer")
async def offer(request: Request):
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])
    
    pc = RTCPeerConnection()
    pcs.add(pc)
    
    # Define callback when peer connection is closed
    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info(f"Connection state is {pc.connectionState}")
        if pc.connectionState == "failed" or pc.connectionState == "closed":
            await pc_cleanup(pc)
    
    # Create media sink for incoming tracks
    relay = MediaRelay()
    
    @pc.on("track")
    def on_track(track):
        logger.info(f"Track {track.kind} received")
        
        if track.kind == "video":
            # Process incoming video with YOLO
            yolo_track = YOLOVideoStreamTrack(relay.subscribe(track))
            pc.addTrack(yolo_track)
        
        @track.on("ended")
        async def on_ended():
            logger.info(f"Track {track.kind} ended")
    
    # Handle the WebRTC offer and create answer
    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    
    return {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}

@app.get("/detections/{client_id}")
async def get_detections(client_id: str):
    """
    Optional endpoint to retrieve the latest detection results.
    This can be used if you want to handle drawing boxes on the client side.
    """
    # This would require mapping client_ids to specific YOLOVideoStreamTrack instances
    # For now, returning a placeholder
    return {"error": "Detection retrieval by client ID not implemented yet"}

async def pc_cleanup(pc):
    logger.info("Cleaning up peer connection")
    pcs.discard(pc)
    
    # Close peer connection
    await pc.close()

@app.on_event("shutdown")
async def on_shutdown():
    # Close all peer connections
    coros = [pc_cleanup(pc) for pc in pcs]
    await asyncio.gather(*coros)
    pcs.clear()

@app.websocket("/ws/detections")
async def websocket_detections(websocket: WebSocket):
    await websocket.accept()
    logger.info(f"WebSocket connection ACCEPTED")
    
    # Generate unique client ID
    client_id = str(uuid.uuid4())
    client_detections[client_id] = {"active": True, "detections": []}
    
    logger.info(f"Assigned client_id: {client_id}")
    
    # Send client ID to the frontend
    await websocket.send_json({"type": "client_id", "client_id": client_id})
    
    try:
        # Tracking variables for debounced logging
        last_logged_time = 0
        last_logged_classes = set()
        
        while True:
            # Look for tracks associated with this client
            track = None
            for pc in pcs:
                for sender in pc.getSenders():
                    if sender.track and isinstance(sender.track, ClientDrawingYOLOVideoStreamTrack):
                        if not sender.track.client_id:
                            # Assign this client_id if track has none
                            sender.track.client_id = client_id
                            track = sender.track
                            break
                        elif sender.track.client_id == client_id:
                            track = sender.track
                            break
                if track:
                    break
            
            # If we found a track with detections, process them
            current_time = time.time()
            if track and track.detection_results:
                # Extract class information for logging
                current_classes = {}
                for detection in track.detection_results:
                    class_name = detection["class_name"]
                    confidence = detection["confidence"]
                    if class_name not in current_classes or confidence > current_classes[class_name]:
                        current_classes[class_name] = confidence
                
                # Determine if we should log based on new detections or time
                current_class_set = set(current_classes.keys())
                should_log = False
                
                # Log if classes changed or it's been more than 1 second since last log
                if current_class_set != last_logged_classes or (current_time - last_logged_time) > 1.0:
                    should_log = True
                
                # Log detection information (debounced)
                if should_log and current_classes:
                    class_info = ", ".join([f"{c} ({v:.2f})" for c, v in current_classes.items()])
                    logger.info(f"Client {client_id}: Detected {len(current_classes)} classes: {class_info}")
                    
                    # Update tracking variables
                    last_logged_time = current_time
                    last_logged_classes = current_class_set
                
                # Always send the latest detections to the client
                await websocket.send_json({
                    "type": "detections",
                    "data": track.detection_results
                })
            else:
                # Always send data updates, even if empty
                await websocket.send_json({
                    "type": "detections",
                    "data": []
                })
            
            # Short sleep to avoid tight loop
            await asyncio.sleep(0.1)
            
    except Exception as e:
        logger.error(f"WebSocket error for client {client_id}: {e}")
    finally:
        logger.info(f"WebSocket connection closed for client {client_id}")
        if client_id in client_detections:
            client_detections[client_id]["active"] = False
            del client_detections[client_id]

class ClientDrawingYOLOVideoStreamTrack(VideoStreamTrack):
    """
    A video track that performs YOLO object detection on incoming frames
    but doesn't draw bounding boxes (client will do that)
    """
    def __init__(self, track, client_id=None):
        super().__init__()
        self.track = track
        self.detection_results = []
        self._last_detection_time = 0
        self._frame_count = 0
        self._detection_interval = 5  # Process every 5 frames for performance
        self.client_id = client_id
        logger.info(f"Initialized ClientDrawingYOLOVideoStreamTrack with client_id: {client_id}")

    async def recv(self):
        # Get frame from the source track
        frame = await self.track.recv()
        self._frame_count += 1
        
        # Convert frame to OpenCV format for YOLO processing
        img = frame.to_ndarray(format="bgr24")
        
        # Process detection on a subset of frames to maintain performance
        if self._frame_count % self._detection_interval == 0:
            try:
                # Run YOLO detection
                results = model.predict(source=img, conf=0.25, verbose=False)
                self._last_detection_time = time.time()
                
                # Extract detection results without drawing
                self.detection_results = []
                current_classes = set()
                
                if results and len(results) > 0:
                    detections = results[0].boxes.data.cpu().numpy()
                    img_height, img_width = img.shape[:2]
                    
                    # Check if we should log based on new/changed detections
                    should_log = False
                    current_time = time.time()
                    
                    # Gather all detected class names
                    detected_classes = {}
                    for detection in detections:
                        x1, y1, x2, y2, conf, class_id = detection
                        class_name = model.names[int(class_id)]
                        detected_classes[class_name] = conf
                        current_classes.add(class_name)
                    
                    # Check if any detected class is new or recent one is missing
                    client_last_logged = last_logged_predictions[self.client_id]
                    
                    # Check for new classes or classes that disappeared
                    previous_classes = set(client_last_logged.keys())
                    if current_classes != previous_classes:
                        should_log = True
                    
                    # Check for classes whose last log was more than 1 second ago
                    for class_name in current_classes:
                        if class_name not in client_last_logged or (current_time - client_last_logged[class_name]) > 1.0:
                            should_log = True
                            break
                    
                    # Log if needed
                    if should_log and len(detected_classes) > 0:
                        logger.info(f"[Client-Drawing] Client {self.client_id}: Found {len(detections)} detections: {', '.join([f'{c} ({v:.2f})' for c, v in detected_classes.items()])}")
                        
                        # Update last logged timestamps for all current classes
                        for class_name in current_classes:
                            client_last_logged[class_name] = current_time
                    
                    # Clear out classes that are no longer detected
                    for class_name in list(client_last_logged.keys()):
                        if class_name not in current_classes:
                            del client_last_logged[class_name]
                                                
                    # Process detections normally
                    for detection in detections:
                        x1, y1, x2, y2, conf, class_id = detection
                        class_name = model.names[int(class_id)]
                        
                        # Store detection for client-side drawing
                        self.detection_results.append({
                            "x1": float(x1),
                            "y1": float(y1),
                            "x2": float(x2),
                            "y2": float(y2),
                            "confidence": float(conf),
                            "class_id": int(class_id),
                            "class_name": class_name,
                            "image_width": img_width,
                            "image_height": img_height
                        })
                        
            except Exception as e:
                logger.error(f"[Client-Drawing] Error in YOLO detection: {e}")
        
        # Convert frame back to VideoFrame without drawing boxes
        new_frame = VideoFrame.from_ndarray(img, format="bgr24")
        new_frame.pts = frame.pts
        new_frame.time_base = frame.time_base
        
        return new_frame

@app.post("/client-drawing-offer")
async def client_drawing_offer(request: Request):
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])
    client_id = params.get("client_id")
    
    logger.info(f"Received client-drawing-offer with client_id: {client_id}")
    
    pc = RTCPeerConnection()
    pcs.add(pc)
    
    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info(f"Client {client_id}: Connection state is {pc.connectionState}")
        if pc.connectionState == "failed" or pc.connectionState == "closed":
            await pc_cleanup(pc)
    
    relay = MediaRelay()
    
    @pc.on("track")
    def on_track(track):
        logger.info(f"Client {client_id}: Track {track.kind} received")
        
        if track.kind == "video":
            # Process incoming video with YOLO but don't draw
            logger.info(f"Creating ClientDrawingYOLOVideoStreamTrack for client {client_id}")
            yolo_track = ClientDrawingYOLOVideoStreamTrack(relay.subscribe(track), client_id)
            pc.addTrack(yolo_track)
            logger.info(f"Track added to peer connection for client {client_id}")
        
        @track.on("ended")
        async def on_ended():
            logger.info(f"Client {client_id}: Track {track.kind} ended")
    
    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    
    logger.info(f"Sending answer to client {client_id}")
    return {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}

# NEW LOCAL-ONLY ENDPOINTS

@app.websocket("/localonly/ws/detections")
async def localonly_websocket_detections(websocket: WebSocket):
    await websocket.accept()
    logger.info(f"LocalOnly WebSocket connection ACCEPTED")
    
    # Generate unique client ID
    client_id = str(uuid.uuid4())
    client_detections[client_id] = {"active": True, "detections": []}
    
    logger.info(f"LocalOnly: Assigned client_id: {client_id}")
    
    # Send client ID to the frontend
    await websocket.send_json({"type": "client_id", "client_id": client_id})
    
    try:
        # Tracking variables for debounced logging
        last_logged_time = 0
        last_logged_classes = set()
        
        while True:
            # Wait for message from client
            message = await websocket.receive_text()
            
            try:
                data = json.loads(message)
                
                # Process video frame if received
                if data.get("type") == "video_frame":
                    # Extract frame data
                    frame_data_url = data.get("frame")
                    
                    # Skip header of data URL
                    header, encoded = frame_data_url.split(",", 1)
                    
                    # Decode base64 image
                    binary = base64.b64decode(encoded)
                    
                    # Convert to numpy array
                    nparr = np.frombuffer(binary, np.uint8)
                    
                    # Decode image
                    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    
                    if img is not None:
                        # Get image dimensions
                        img_height, img_width = img.shape[:2]
                        
                        # Run YOLO detection
                        results = model.predict(source=img, conf=0.25, verbose=False)
                        
                        # Process results
                        detections = []
                        current_classes = set()
                        
                        if results and len(results) > 0:
                            boxes = results[0].boxes.data.cpu().numpy()
                            
                            # Check if we should log based on new/changed detections
                            should_log = False
                            current_time = time.time()
                            
                            # Gather all detected class names
                            detected_classes = {}
                            
                            for box in boxes:
                                x1, y1, x2, y2, conf, class_id = box
                                class_name = model.names[int(class_id)]
                                detected_classes[class_name] = conf
                                current_classes.add(class_name)
                                
                                # Add detection to results
                                detections.append({
                                    "x1": float(x1),
                                    "y1": float(y1),
                                    "x2": float(x2),
                                    "y2": float(y2),
                                    "confidence": float(conf),
                                    "class_id": int(class_id),
                                    "class_name": class_name,
                                    "image_width": img_width,
                                    "image_height": img_height
                                })
                            
                            # Check if any detected class is new or recent one is missing
                            client_last_logged = last_logged_predictions[client_id]
                            
                            # Check for new classes or classes that disappeared
                            previous_classes = set(client_last_logged.keys())
                            if current_classes != previous_classes:
                                should_log = True
                            
                            # Check for classes whose last log was more than 1 second ago
                            for class_name in current_classes:
                                if class_name not in client_last_logged or (current_time - client_last_logged[class_name]) > 1.0:
                                    should_log = True
                                    break
                            
                            # Log if needed
                            if should_log and len(detected_classes) > 0:
                                if len(detected_classes) > 0:
                                    logger.info(f"LocalOnly Client {client_id}: Found {len(detections)} detections: {', '.join([f'{c} ({v:.2f})' for c, v in detected_classes.items()])}")
                                
                                # Update last logged timestamps for all current classes
                                for class_name in current_classes:
                                    client_last_logged[class_name] = current_time
                            
                            # Clear out classes that are no longer detected
                            for class_name in list(client_last_logged.keys()):
                                if class_name not in current_classes:
                                    del client_last_logged[class_name]
                        
                        # Store latest detections for this client
                        client_detections[client_id]["detections"] = detections
                        
                        # Send detections back to client
                        await websocket.send_json({
                            "type": "detections",
                            "data": detections
                        })
                    else:
                        logger.warning(f"LocalOnly: Failed to decode image for client {client_id}")
                        
                        # Send empty detections to client
                        await websocket.send_json({
                            "type": "detections",
                            "data": []
                        })
            except json.JSONDecodeError:
                logger.error(f"LocalOnly: Failed to parse message from client {client_id}")
            except Exception as e:
                logger.error(f"LocalOnly: Error processing frame from client {client_id}: {str(e)}")
                
                # Send empty detections to client
                await websocket.send_json({
                    "type": "detections",
                    "data": []
                })
            
    except Exception as e:
        logger.error(f"LocalOnly WebSocket error for client {client_id}: {e}")
    finally:
        logger.info(f"LocalOnly WebSocket connection closed for client {client_id}")
        if client_id in client_detections:
            client_detections[client_id]["active"] = False
            del client_detections[client_id]
        if client_id in last_logged_predictions:
            del last_logged_predictions[client_id]

if __name__ == "__main__":
    logger.info("Starting server...")
    uvicorn.run("app:app", host="0.0.0.0", port=5005, reload=True, log_level="warning")

