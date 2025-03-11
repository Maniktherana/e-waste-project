from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def index():
    """Root endpoint that confirms the API is running."""
    return {"message": "YOLO WebRTC API is running"}
