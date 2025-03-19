from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os

from utils.logger import setup_logger
from core.model import get_model
from routers import index, webrtc, websocket, localonly, file_upload
from utils.webrtc_utils import cleanup_peer_connections

logger = setup_logger()


def create_application() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(title="YOLO WebRTC Object Detection")

    uploads_dir = os.path.join(os.getcwd(), "uploads")
    processed_dir = os.path.join(os.getcwd(), "processed")
    os.makedirs(uploads_dir, exist_ok=True)
    os.makedirs(processed_dir, exist_ok=True)

    logger.info(
        f"File directories initialized: uploads={uploads_dir}, processed={processed_dir}"
    )

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    get_model()

    app.include_router(index.router)
    app.include_router(webrtc.router)
    app.include_router(websocket.router)
    app.include_router(localonly.router)
    app.include_router(file_upload.router)

    # Shutdown event handler
    @app.on_event("shutdown")
    async def on_shutdown():
        logger.info("Application shutting down...")
        await cleanup_peer_connections()

    return app


app = create_application()

if __name__ == "__main__":
    logger.info("Starting server...")
    uvicorn.run("main:app", host="0.0.0.0", port=5005, reload=True, log_level="warning")
