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
from typing import Dict, List, Optional, Union
from ultralytics import YOLO

# aiortc imports for WebRTC
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from aiortc.contrib.media import MediaBlackhole, MediaPlayer, MediaRecorder, MediaRelay
from av import VideoFrame
import fractions

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="YOLO WebRTC Object Detection")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Update with your frontend URL in production
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

client_detections = {}

@app.websocket("/ws/detections")
async def websocket_detections(websocket: WebSocket):
    await websocket.accept()
    
    # Generate unique client ID
    client_id = str(uuid.uuid4())
    client_detections[client_id] = {"active": True, "detections": []}
    
    try:
        # Send client ID to the frontend
        await websocket.send_json({"type": "client_id", "client_id": client_id})
        
        # Keep connection alive and send detection updates
        while client_detections[client_id]["active"]:
            if client_id in client_detections:
                # Find the corresponding track (if any)
                track = None
                for pc in pcs:
                    for sender in pc.getSenders():
                        if sender.track and isinstance(sender.track, YOLOVideoStreamTrack):
                            # This is a simplification - in a real app, you'd need a proper
                            # way to associate client IDs with specific tracks
                            track = sender.track
                            break
                    if track:
                        break
                
                if track:
                    # Send the latest detection results
                    await websocket.send_json({
                        "type": "detections",
                        "data": track.detection_results
                    })
                
            # Wait a bit before sending the next update
            await asyncio.sleep(0.1)  # 10 updates per second
            
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        # Clean up when client disconnects
        if client_id in client_detections:
            client_detections[client_id]["active"] = False
            del client_detections[client_id]

# Modify YOLOVideoStreamTrack to NOT draw bounding boxes
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
                if results and len(results) > 0:
                    detections = results[0].boxes.data.cpu().numpy()
                    img_height, img_width = img.shape[:2]
                    
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
                logger.error(f"Error in YOLO detection: {e}")
        
        # Convert frame back to VideoFrame without drawing boxes
        new_frame = VideoFrame.from_ndarray(img, format="bgr24")
        new_frame.pts = frame.pts
        new_frame.time_base = frame.time_base
        
        return new_frame

# Add a new offer endpoint for client-side drawing
@app.post("/client-drawing-offer")
async def client_drawing_offer(request: Request):
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])
    client_id = params.get("client_id")
    
    pc = RTCPeerConnection()
    pcs.add(pc)
    
    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info(f"Connection state is {pc.connectionState}")
        if pc.connectionState == "failed" or pc.connectionState == "closed":
            await pc_cleanup(pc)
    
    relay = MediaRelay()
    
    @pc.on("track")
    def on_track(track):
        logger.info(f"Track {track.kind} received")
        
        if track.kind == "video":
            # Process incoming video with YOLO but don't draw
            yolo_track = ClientDrawingYOLOVideoStreamTrack(relay.subscribe(track), client_id)
            pc.addTrack(yolo_track)
        
        @track.on("ended")
        async def on_ended():
            logger.info(f"Track {track.kind} ended")
    
    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    
    return {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)