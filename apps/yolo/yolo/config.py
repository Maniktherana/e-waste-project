import os
from typing import Dict, Any

SETTINGS: Dict[str, Any] = {
    "model_path": os.path.join(os.getcwd(), "weights.pt"),
    "detection_confidence": 0.25,
    "detection_interval": 5,
    "log_interval": 1.0,
}
