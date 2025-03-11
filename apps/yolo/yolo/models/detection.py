from typing import Dict, List
from pydantic import BaseModel


class Detection(BaseModel):
    """Detection data model."""

    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float
    class_id: int
    class_name: str
    image_width: int = None
    image_height: int = None


class DetectionResponse(BaseModel):
    """Response model for detection data."""

    type: str = "detections"
    data: List[Detection]


class ClientIdResponse(BaseModel):
    """Response model for client ID assignment."""

    type: str = "client_id"
    client_id: str


class ClientDetection(BaseModel):
    """Store for client detection data."""

    active: bool = True
    detections: List[Detection] = []


# Global storage for client detections and timing data
client_detections: Dict[str, ClientDetection] = {}
last_logged_predictions: Dict[str, Dict[str, float]] = {}
