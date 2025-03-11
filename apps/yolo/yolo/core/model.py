from ultralytics import YOLO
from utils.logger import setup_logger
from config import SETTINGS

logger = setup_logger()

_model = None


def get_model():
    """
    Get or initialize the YOLO model.
    Returns a singleton instance of the loaded model.
    """
    global _model

    if _model is None:
        try:
            model_path = SETTINGS["model_path"]
            _model = YOLO(model_path)
            logger.info(f"YOLO model loaded from {model_path}")
        except Exception as e:
            logger.error(f"Failed to load YOLO model: {e}")
            raise

    return _model
