import asyncio
from typing import Set
from aiortc import RTCPeerConnection
from utils.logger import setup_logger

logger = setup_logger()

peer_connections: Set[RTCPeerConnection] = set()


async def pc_cleanup(pc: RTCPeerConnection) -> None:
    """
    Clean up a peer connection.

    Args:
        pc: The RTCPeerConnection to clean up
    """
    logger.info("Cleaning up peer connection")
    peer_connections.discard(pc)
    await pc.close()


async def cleanup_peer_connections() -> None:
    """
    Clean up all peer connections during application shutdown.
    """
    logger.info(f"Cleaning up {len(peer_connections)} peer connections")
    coros = [pc_cleanup(pc) for pc in peer_connections]
    await asyncio.gather(*coros)
    peer_connections.clear()
