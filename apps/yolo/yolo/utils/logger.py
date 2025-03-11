import logging


def setup_logger():
    """Configure and return the application logger."""
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("yolo_webrtc")
    return logger
