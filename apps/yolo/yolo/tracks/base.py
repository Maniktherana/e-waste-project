from aiortc import VideoStreamTrack
from utils.logger import setup_logger
from config import SETTINGS

logger = setup_logger()


class BaseVideoStreamTrack(VideoStreamTrack):
    """
    Base class for video stream tracks with YOLO processing.
    """

    def __init__(self, track):
        super().__init__()
        self.track = track
        self.detection_results = []
        self._last_detection_time = 0
        self._frame_count = 0
        self._detection_interval = SETTINGS["detection_interval"]

    def should_process_frame(self) -> bool:
        """
        Determine if the current frame should be processed based on the frame counter.
        """
        self._frame_count += 1
        return self._frame_count % self._detection_interval == 0
