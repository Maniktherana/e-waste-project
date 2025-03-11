from fastapi import APIRouter, Request
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRelay

from tracks.yolo_track import YOLOVideoStreamTrack
from tracks.client_track import ClientDrawingYOLOVideoStreamTrack
from utils.webrtc_utils import peer_connections, pc_cleanup
from utils.logger import setup_logger

logger = setup_logger()

router = APIRouter()


@router.post("/offer")
async def offer(request: Request):
    """
    Handle WebRTC offer with server-side drawing of detection boxes.
    """
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    peer_connections.add(pc)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info(f"Connection state is {pc.connectionState}")
        if pc.connectionState == "failed" or pc.connectionState == "closed":
            await pc_cleanup(pc)

    relay = MediaRelay()

    @pc.on("track")
    def on_track(track):
        logger.info(f"Track {track.kind} received")

        if track.kind == "video":
            yolo_track = YOLOVideoStreamTrack(relay.subscribe(track))
            pc.addTrack(yolo_track)

        @track.on("ended")
        async def on_ended():
            logger.info(f"Track {track.kind} ended")

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}


@router.post("/client-drawing-offer")
async def client_drawing_offer(request: Request):
    """
    Handle WebRTC offer with client-side drawing of detection boxes.
    """
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])
    client_id = params.get("client_id")

    logger.info(f"Received client-drawing-offer with client_id: {client_id}")

    pc = RTCPeerConnection()
    peer_connections.add(pc)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info(f"Client {client_id}: Connection state is {pc.connectionState}")
        if pc.connectionState == "failed" or pc.connectionState == "closed":
            await pc_cleanup(pc)

    relay = MediaRelay()

    @pc.on("track")
    def on_track(track):
        logger.info(f"Client {client_id}: Track {track.kind} received")

        if track.kind == "video":
            logger.info(
                f"Creating ClientDrawingYOLOVideoStreamTrack for client {client_id}"
            )
            yolo_track = ClientDrawingYOLOVideoStreamTrack(
                relay.subscribe(track), client_id
            )
            pc.addTrack(yolo_track)
            logger.info(f"Track added to peer connection for client {client_id}")

        @track.on("ended")
        async def on_ended():
            logger.info(f"Client {client_id}: Track {track.kind} ended")

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    logger.info(f"Sending answer to client {client_id}")
    return {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}


@router.get("/detections/{client_id}")
async def get_detections(client_id: str):
    """
    Optional endpoint to retrieve the latest detection results.
    This can be used if you want to handle drawing boxes on the client side.
    """
    return {"error": "Detection retrieval by client ID not implemented yet"}
