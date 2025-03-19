import os
import uuid
import time
import shutil
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
import cv2
from pydantic import BaseModel

from core.model import get_model
from utils.logger import setup_logger
from config import SETTINGS

logger = setup_logger()

router = APIRouter()

UPLOAD_DIR = os.path.join(os.getcwd(), "uploads")
PROCESSED_DIR = os.path.join(os.getcwd(), "processed")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)


class DetectionResult(BaseModel):
    """Model for detection response"""

    class_name: str
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float
    image_width: int
    image_height: int


class ProcessingResponse(BaseModel):
    """Response model for initial processing"""

    detections: List[DetectionResult]
    file_id: str
    width: int
    height: int
    is_video: bool
    duration: Optional[float] = None


def process_image(
    img_path: str, output_path: str, conf_threshold: float = None
) -> List[Dict[str, Any]]:
    """Process an image with YOLO object detection"""
    if conf_threshold is None:
        conf_threshold = SETTINGS["detection_confidence"]

    img = cv2.imread(img_path)
    if img is None:
        raise HTTPException(status_code=400, detail="Could not read image file")

    img_height, img_width = img.shape[:2]

    model = get_model()
    results = model.predict(
        source=img,
        conf=conf_threshold,
        verbose=False,
    )

    detections = []

    if results and len(results) > 0:
        boxes = results[0].boxes.data.cpu().numpy()

        for box in boxes:
            x1, y1, x2, y2, conf, class_id = box
            class_name = model.names[int(class_id)]

            detections.append(
                DetectionResult(
                    x1=float(x1),
                    y1=float(y1),
                    x2=float(x2),
                    y2=float(y2),
                    confidence=float(conf),
                    class_name=class_name,
                    class_id=int(class_id),
                    image_width=img_width,
                    image_height=img_height,
                )
            )

            cv2.rectangle(img, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)

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

    cv2.imwrite(output_path, img)

    return detections


def process_video(
    video_path: str, output_path: str, conf_threshold: float = None
) -> tuple:
    """Process a video with YOLO object detection"""
    if conf_threshold is None:
        conf_threshold = SETTINGS["detection_confidence"]

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="Could not open video file")

    fps = int(cap.get(cv2.CAP_PROP_FPS))
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frame_count / fps if fps > 0 else 0

    frames_per_second = max(1, int(fps / 4))
    min_total_frames = 15
    
    if frame_count < min_total_frames * frames_per_second:
        # For very short videos, process more frames
        frames_per_second = max(1, int(frame_count / min_total_frames))
    
    logger.info(f"Video processing: fps={fps}, total frames={frame_count}, processing 1 frame every {frames_per_second} frames")

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(output_path, fourcc, fps, (frame_width, frame_height))

    model = get_model()
    
    all_detections = {}
    
    frame_detections = {}
    
    frame_idx = 0
    processed_frames = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        # Only run detection on every nth frame to improve performance
        should_process = frame_idx % frames_per_second == 0
        has_detections = False
        
        if should_process:
            processed_frames += 1
            try:
                results = model.predict(
                    source=frame, conf=conf_threshold, verbose=False
                )

                if results and len(results) > 0:
                    detections = results[0].boxes.data.cpu().numpy()
                    
                    frame_classes = set()  # Track classes detected in this frame

                    for detection in detections:
                        x1, y1, x2, y2, conf, class_id = detection
                        class_name = model.names[int(class_id)]
                        frame_classes.add(class_name)
                        
                        if (
                            class_name not in all_detections
                            or conf > all_detections[class_name].confidence
                        ):
                            all_detections[class_name] = DetectionResult(
                                x1=float(x1),
                                y1=float(y1),
                                x2=float(x2),
                                y2=float(y2),
                                confidence=float(conf),
                                class_id=int(class_id),
                                class_name=class_name,
                                image_width=frame_width,
                                image_height=frame_height,
                            )
                    
                    if frame_classes:
                        has_detections = True
                        frame_detections[frame_idx] = frame_classes
                        
                        for detection in detections:
                            x1, y1, x2, y2, conf, class_id = detection
                            class_name = model.names[int(class_id)]
                            
                            cv2.rectangle(
                                frame,
                                (int(x1), int(y1)),
                                (int(x2), int(y2)),
                                (0, 255, 0),
                                2,
                            )

                            label = f"{class_name} {conf:.2f}"
                            cv2.putText(
                                frame,
                                label,
                                (int(x1), int(y1) - 10),
                                cv2.FONT_HERSHEY_SIMPLEX,
                                0.5,
                                (0, 255, 0),
                                2,
                            )
            
            except Exception as e:
                logger.error(f"Error processing video frame {frame_idx}: {e}")
        
        elif frame_detections:
            nearest_frame = None
            min_distance = frames_per_second // 2
            
            for processed_frame_idx in frame_detections:
                distance = abs(processed_frame_idx - frame_idx)
                if distance < min_distance:
                    nearest_frame = processed_frame_idx
                    min_distance = distance
            
            if nearest_frame is not None:
                has_detections = True
                
                for class_name in frame_detections[nearest_frame]:
                    if class_name in all_detections:
                        detection = all_detections[class_name]
                        
                        cv2.rectangle(
                            frame,
                            (int(detection.x1), int(detection.y1)),
                            (int(detection.x2), int(detection.y2)),
                            (0, 255, 0),
                            2,
                        )

                        label = f"{detection.class_name} {detection.confidence:.2f}"
                        cv2.putText(
                            frame,
                            label,
                            (int(detection.x1), int(detection.y1) - 10),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.5,
                            (0, 255, 0),
                            2,
                        )

        out.write(frame)
        frame_idx += 1

        if frame_idx % 100 == 0:
            progress = (frame_idx / frame_count) * 100 if frame_count > 0 else 0
            logger.info(f"Video processing progress: {progress:.1f}% ({frame_idx}/{frame_count})")

    cap.release()
    out.release()
    
    logger.info(f"Video processing complete. Processed {processed_frames} frames. Found {len(all_detections)} unique classes.")

    detections_list = list(all_detections.values())
    
    return detections_list, duration, frame_width, frame_height


@router.post("/upload", response_model=ProcessingResponse)
async def upload_file(file: UploadFile = File(...), confidence: float = Form(None)):
    """Upload an image or video file, process it with YOLO detection, and return the metadata"""
    if confidence is None:
        confidence = SETTINGS["detection_confidence"]

    logger.info(f"Received file upload: {file.filename} (confidence: {confidence})")

    file_id = str(uuid.uuid4())
    file_ext = os.path.splitext(file.filename)[1].lower()

    image_extensions = [".jpg", ".jpeg", ".png", ".bmp"]
    video_extensions = [".mp4", ".avi", ".mov", ".mkv"]

    is_image = file_ext in image_extensions
    is_video = file_ext in video_extensions

    if not (is_image or is_video):
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload an image (jpg, png) or video (mp4, avi, mov)",
        )

    upload_path = os.path.join(UPLOAD_DIR, f"{file_id}{file_ext}")
    output_path = os.path.join(PROCESSED_DIR, f"{file_id}_processed{file_ext}")

    try:
        with open(upload_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Error saving uploaded file: {e}")
        raise HTTPException(status_code=500, detail=f"Error saving file: {str(e)}")
    finally:
        await file.close()

    try:
        logger.info(f"Processing {'image' if is_image else 'video'}: {file.filename}")

        if is_image:
            detections = process_image(upload_path, output_path, confidence)

            img = cv2.imread(output_path)
            height, width = img.shape[:2]

            response = ProcessingResponse(
                detections=detections,
                file_id=file_id,
                width=width,
                height=height,
                is_video=False,
            )
        else:
            detections, duration, width, height = process_video(
                upload_path, output_path, confidence
            )

            response = ProcessingResponse(
                detections=detections,
                file_id=file_id,
                width=width,
                height=height,
                is_video=True,
                duration=duration,
            )
            
        # Log detection results
        class_counts = {}
        for det in detections:
            class_name = det.class_name
            class_counts[class_name] = class_counts.get(class_name, 0) + 1
        
        logger.info(f"File processed successfully. Detected classes: {class_counts}")

        try:
            if os.path.exists(upload_path):
                os.remove(upload_path)
        except Exception as e:
            logger.warning(f"Could not remove uploaded file {upload_path}: {e}")

        return response

    except Exception as e:
        logger.error(f"Error processing file: {e}")
        for path in [upload_path, output_path]:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception:
                pass

        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")


@router.get("/download/{file_id}")
async def download_processed_file(file_id: str):
    """
    Download the processed file directly
    """
    for ext in [".jpg", ".jpeg", ".png", ".mp4", ".avi", ".mov"]:
        file_path = os.path.join(PROCESSED_DIR, f"{file_id}_processed{ext}")
        if os.path.exists(file_path):
            logger.info(f"Serving file for download: {file_path}")

            content_type = None
            if ext in [".jpg", ".jpeg"]:
                content_type = "image/jpeg"
            elif ext == ".png":
                content_type = "image/png"
            elif ext == ".mp4":
                content_type = "video/mp4"
            elif ext == ".avi":
                content_type = "video/x-msvideo"
            elif ext == ".mov":
                content_type = "video/quicktime"

            return FileResponse(
                path=file_path, media_type=content_type, filename=f"processed{ext}"
            )

    raise HTTPException(status_code=404, detail="Processed file not found")


# Cleanup job to remove old processed files
@router.on_event("startup")
def start_cleanup_task():
    """Start background task to clean up old files"""
    import asyncio

    async def cleanup_old_files():
        while True:
            try:
                current_time = time.time()
                max_age = 3600  # 1 hour in seconds

                for dir_path in [UPLOAD_DIR, PROCESSED_DIR]:
                    for filename in os.listdir(dir_path):
                        file_path = os.path.join(dir_path, filename)
                        try:
                            file_age = current_time - os.path.getmtime(file_path)

                            if file_age > max_age:
                                os.remove(file_path)
                                logger.info(f"Removed old file: {file_path}")
                        except Exception as e:
                            logger.error(
                                f"Error checking/removing file {file_path}: {e}"
                            )
            except Exception as e:
                logger.error(f"Error in cleanup task: {e}")

            await asyncio.sleep(900)  # 15 minutes

    asyncio.create_task(cleanup_old_files())