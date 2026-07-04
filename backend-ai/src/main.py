import asyncio
import logging
import os
from fastapi import FastAPI
from contextlib import asynccontextmanager
import redis.asyncio as aioredis
from .yjs_client import listen_and_sync
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Tracks active room worker tasks to prevent redundant loop scaling
active_room_tasks = {}

async def redis_room_discoverer():
    """
    Monitors the shared Redis Pub/Sub cluster to dynamically track 
    and orchestrate headless AI Copilot workers across active user rooms.
    """
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    try:
        r = aioredis.from_url(redis_url)
        pubsub = r.pubsub()
        await pubsub.psubscribe("doc-update-*")
        logger.info("[AI Coordinator] Core Discovery Engine online. Monitoring Pub/Sub channels...")

        async for message in pubsub.listen():
            if message["type"] == "pmessage":
                channel = message["channel"].decode("utf-8")
                # Parse the target room identity from the channel header string
                room_id = channel.replace("doc-update-", "")

                # Spawn an autonomous headless workspace listener if one does not exist
                if room_id not in active_room_tasks or active_room_tasks[room_id].done():
                    logger.info(f"[AI Coordinator] Spawning dynamic copilot worker for room: '{room_id}'")
                    task = asyncio.create_task(listen_and_sync(room_id))
                    active_room_tasks[room_id] = task
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.error(f"[AI Coordinator] Discovery supervisor error encountered: {e}")
        await asyncio.sleep(5)  # Resilient backoff retry delay

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fire up the room discovery task context
    discovery_task = asyncio.create_task(redis_room_discoverer())
    yield
    # Gracefully clean up all active workers on shutdown
    discovery_task.cancel()
    await asyncio.gather(discovery_task, return_exceptions=True)
    for room_id, task in active_room_tasks.items():
        task.cancel()

app = FastAPI(lifespan=lifespan)

@app.get("/health")
def health_check():
    return {
        "status": "healthy", 
        "active_monitored_rooms": [r for r, t in active_room_tasks.items() if not t.done()]
    }