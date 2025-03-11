import time
from av import VideoFrame

from tracks.base import BaseVideoStreamTrack
from core.model import get_model
from models.detection import last_logged_predictions
from utils.logger import setup_logger
from config import SETTINGS

logger = setup_logger()


class ClientDrawingYOLOVideoStreamTrack(BaseVideoStreamTrack):
    """
    A video track that performs YOLO object detection on incoming frames
    but doesn't draw bounding boxes (client will do that)
    """

    def __init__(self, track, client_id=None):
        super().__init__(track)
        self.client_id = client_id
        logger.info(
            f"Initialized ClientDrawingYOLOVideoStreamTrack with client_id: {client_id}"
        )

    async def recv(self):
        frame = await self.track.recv()

        img = frame.to_ndarray(format="bgr24")

        # Process detection on specified frames
        if self.should_process_frame():
            try:
                model = get_model()
                results = model.predict(
                    source=img, conf=SETTINGS["detection_confidence"], verbose=False
                )
                self._last_detection_time = time.time()

                # Extract detection results without drawing
                self.detection_results = []
                current_classes = set()

                if results and len(results) > 0:
                    detections = results[0].boxes.data.cpu().numpy()
                    img_height, img_width = img.shape[:2]

                    should_log = False
                    current_time = time.time()

                    detected_classes = {}
                    for detection in detections:
                        x1, y1, x2, y2, conf, class_id = detection
                        class_name = model.names[int(class_id)]
                        detected_classes[class_name] = conf
                        current_classes.add(class_name)

                    client_last_logged = last_logged_predictions.setdefault(
                        self.client_id, {}
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

                    if should_log and detected_classes:
                        logger.info(
                            f"[Client-Drawing] Client {self.client_id}: Found {len(detections)} detections: {', '.join([f'{c} ({v:.2f})' for c, v in detected_classes.items()])}"
                        )

                        for class_name in current_classes:
                            client_last_logged[class_name] = current_time

                    for class_name in list(client_last_logged.keys()):
                        if class_name not in current_classes:
                            del client_last_logged[class_name]

                    # Process detections normally
                    for detection in detections:
                        x1, y1, x2, y2, conf, class_id = detection
                        class_name = model.names[int(class_id)]

                        self.detection_results.append(
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

            except Exception as e:
                logger.error(f"[Client-Drawing] Error in YOLO detection: {e}")

        # Convert frame back to VideoFrame without drawing boxes
        new_frame = VideoFrame.from_ndarray(img, format="bgr24")
        new_frame.pts = frame.pts
        new_frame.time_base = frame.time_base

        return new_frame
