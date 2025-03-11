import json
import uuid
import time
import base64
import numpy as np
import cv2
from fastapi import APIRouter, WebSocket

from core.model import get_model
from models.detection import client_detections, last_logged_predictions
from utils.logger import setup_logger
from config import SETTINGS

logger = setup_logger()

router = APIRouter()


@router.websocket("/localonly/ws/detections")
async def localonly_websocket_detections(websocket: WebSocket):
    """
    WebSocket endpoint for local-only processing using client-sent frames.
    """
    await websocket.accept()
    logger.info("LocalOnly WebSocket connection ACCEPTED")

    # Generate unique client ID
    client_id = str(uuid.uuid4())
    client_detections[client_id] = {"active": True, "detections": []}

    logger.info(f"LocalOnly: Assigned client_id: {client_id}")

    # Send client ID to the frontend
    await websocket.send_json({"type": "client_id", "client_id": client_id})

    try:
        while True:
            message = await websocket.receive_text()

            try:
                data = json.loads(message)

                if data.get("type") == "video_frame":
                    frame_data_url = data.get("frame")
                    header, encoded = frame_data_url.split(",", 1)
                    binary = base64.b64decode(encoded)
                    nparr = np.frombuffer(binary, np.uint8)
                    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                    if img is not None:
                        img_height, img_width = img.shape[:2]

                        model = get_model()
                        results = model.predict(
                            source=img,
                            conf=SETTINGS["detection_confidence"],
                            verbose=False,
                        )

                        detections = []
                        current_classes = set()

                        if results and len(results) > 0:
                            boxes = results[0].boxes.data.cpu().numpy()

                            should_log = False
                            current_time = time.time()

                            detected_classes = {}

                            for box in boxes:
                                x1, y1, x2, y2, conf, class_id = box
                                class_name = model.names[int(class_id)]
                                detected_classes[class_name] = conf
                                current_classes.add(class_name)

                                detections.append(
                                    {
                                        "x1": float(x1),
                                        "y1": float(y1),
                                        "x2": float(x2),
                                        "y2": float(y2),
                                        "confidence": float(conf),
                                        "class_id": int(class_id),
                                        "class_name": class_name,
                                        "image_width": img_width,
                                        "image_height": img_height,
                                    }
                                )

                            client_last_logged = last_logged_predictions.setdefault(
                                client_id, {}
                            )

                            previous_classes = set(client_last_logged.keys())
                            if current_classes != previous_classes:
                                should_log = True

                            for class_name in current_classes:
                                if (
                                    class_name not in client_last_logged
                                    or (current_time - client_last_logged[class_name])
                                    > SETTINGS["log_interval"]
                                ):
                                    should_log = True
                                    break

                            # Log if needed
                            if should_log and len(detected_classes) > 0:
                                if len(detected_classes) > 0:
                                    logger.info(
                                        f"LocalOnly Client {client_id}: Found {len(detections)} detections: {', '.join([f'{c} ({v:.2f})' for c, v in detected_classes.items()])}"
                                    )

                                for class_name in current_classes:
                                    client_last_logged[class_name] = current_time

                            # Clear out classes that are no longer detected
                            for class_name in list(client_last_logged.keys()):
                                if class_name not in current_classes:
                                    del client_last_logged[class_name]

                        # Store latest detections for this client
                        client_detections[client_id]["detections"] = detections

                        await websocket.send_json(
                            {"type": "detections", "data": detections}
                        )
                    else:
                        logger.warning(
                            f"LocalOnly: Failed to decode image for client {client_id}"
                        )

                        await websocket.send_json({"type": "detections", "data": []})
            except json.JSONDecodeError:
                logger.error(
                    f"LocalOnly: Failed to parse message from client {client_id}"
                )
            except Exception as e:
                logger.error(
                    f"LocalOnly: Error processing frame from client {client_id}: {str(e)}"
                )

                await websocket.send_json({"type": "detections", "data": []})

    except Exception as e:
        logger.error(f"LocalOnly WebSocket error for client {client_id}: {e}")
    finally:
        logger.info(f"LocalOnly WebSocket connection closed for client {client_id}")
        if client_id in client_detections:
            client_detections[client_id]["active"] = False
            del client_detections[client_id]
        if client_id in last_logged_predictions:
            del last_logged_predictions[client_id]
