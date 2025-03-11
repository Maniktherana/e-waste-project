import cv2
import time
from av import VideoFrame

from tracks.base import BaseVideoStreamTrack
from core.model import get_model
from utils.logger import setup_logger
from config import SETTINGS

logger = setup_logger()


class YOLOVideoStreamTrack(BaseVideoStreamTrack):
    """
    A video track that performs YOLO object detection on incoming frames
    and returns frames with bounding boxes drawn on them.
    """

    async def recv(self):
        frame = await self.track.recv()

        img = frame.to_ndarray(format="bgr24")

        if self.should_process_frame():
            try:
                model = get_model()
                results = model.predict(
                    source=img, conf=SETTINGS["detection_confidence"], verbose=False
                )
                self._last_detection_time = time.time()

                # Extract detection results
                self.detection_results = []
                if results and len(results) > 0:
                    detections = results[0].boxes.data.cpu().numpy()
                    for detection in detections:
                        x1, y1, x2, y2, conf, class_id = detection
                        class_name = model.names[int(class_id)]

                        logger.info(
                            f"Detected: {class_name} (Confidence: {conf:.2f}), "
                            f"Coordinates: ({x1:.2f}, {y1:.2f}), ({x2:.2f}, {y2:.2f})"
                        )

                        # Draw bounding box and label
                        cv2.rectangle(
                            img, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2
                        )
                        label = f"{class_name} {conf:.2f}"
                        cv2.putText(
                            img,
                            label,
                            (int(x1), int(y1) - 10),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.5,
                            (0, 255, 0),
                            2,
                        )

                        self.detection_results.append(
                            {
                                "x1": float(x1),
                                "y1": float(y1),
                                "x2": float(x2),
                                "y2": float(y2),
                                "confidence": float(conf),
                                "class_id": int(class_id),
                                "class_name": class_name,
                            }
                        )
            except Exception as e:
                logger.error(f"Error in YOLO detection: {e}")

        new_frame = VideoFrame.from_ndarray(img, format="bgr24")
        new_frame.pts = frame.pts
        new_frame.time_base = frame.time_base

        return new_frame
