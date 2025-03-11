import asyncio
import uuid
import time
from fastapi import APIRouter, WebSocket

from tracks.client_track import ClientDrawingYOLOVideoStreamTrack
from models.detection import client_detections
from utils.webrtc_utils import peer_connections
from utils.logger import setup_logger

logger = setup_logger()

router = APIRouter()


@router.websocket("/ws/detections")
async def websocket_detections(websocket: WebSocket):
    """
    WebSocket endpoint for real-time detection updates.
    """
    await websocket.accept()
    logger.info("WebSocket connection ACCEPTED")

    # Generate unique client ID
    client_id = str(uuid.uuid4())
    client_detections[client_id] = {"active": True, "detections": []}

    logger.info(f"Assigned client_id: {client_id}")

    # Send client ID to the frontend
    await websocket.send_json({"type": "client_id", "client_id": client_id})

    try:
        last_logged_time = 0
        last_logged_classes = set()

        while True:
            track = None
            for pc in peer_connections:
                for sender in pc.getSenders():
                    if sender.track and isinstance(
                        sender.track, ClientDrawingYOLOVideoStreamTrack
                    ):
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
                current_classes = {}
                for detection in track.detection_results:
                    class_name = detection["class_name"]
                    confidence = detection["confidence"]
                    if (
                        class_name not in current_classes
                        or confidence > current_classes[class_name]
                    ):
                        current_classes[class_name] = confidence

                current_class_set = set(current_classes.keys())
                should_log = False

                if (
                    current_class_set != last_logged_classes
                    or (current_time - last_logged_time) > 1.0
                ):
                    should_log = True

                if should_log and current_classes:
                    class_info = ", ".join(
                        [f"{c} ({v:.2f})" for c, v in current_classes.items()]
                    )
                    logger.info(
                        f"Client {client_id}: Detected {len(current_classes)} classes: {class_info}"
                    )

                    last_logged_time = current_time
                    last_logged_classes = current_class_set

                # Always send the latest detections to the client
                await websocket.send_json(
                    {"type": "detections", "data": track.detection_results}
                )
            else:
                # Always send data updates, even if empty
                await websocket.send_json({"type": "detections", "data": []})

            # Short sleep to avoid tight loop
            await asyncio.sleep(0.1)

    except Exception as e:
        logger.error(f"WebSocket error for client {client_id}: {e}")
    finally:
        logger.info(f"WebSocket connection closed for client {client_id}")
        if client_id in client_detections:
            client_detections[client_id]["active"] = False
            del client_detections[client_id]
