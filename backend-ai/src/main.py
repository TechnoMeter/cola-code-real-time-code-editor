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

# Tracks active room worker tasks
active_room_tasks = {}

async def redis_room_discoverer():
    """
    Resilient Redis Pub/Sub listener that automatically reconnects on socket drop.
    """
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    
    while True:  # Infinite reconnect loop
        try:
            r = aioredis.from_url(redis_url, socket_keepalive=True)
            pubsub = r.pubsub()
            await pubsub.psubscribe("doc-update-*")
            logger.info("[AI Coordinator] Core Discovery Engine online. Monitoring Pub/Sub channels...")

            async for message in pubsub.listen():
                if message["type"] == "pmessage":
                    channel = message["channel"].decode("utf-8")
                    room_id = channel.replace("doc-update-", "")

                    # Prune done/cancelled tasks
                    if room_id in active_room_tasks and active_room_tasks[room_id].done():
                        del active_room_tasks[room_id]

                    # Spawn worker if none exists
                    if room_id not in active_room_tasks:
                        logger.info(f"[AI Coordinator] Spawning dynamic copilot worker for room: '{room_id}'")
                        task = asyncio.create_task(listen_and_sync(room_id))
                        active_room_tasks[room_id] = task

        except asyncio.CancelledError:
            logger.info("[AI Coordinator] Supervisor shutdown requested.")
            break
        except Exception as e:
            logger.error(f"[AI Coordinator] Redis Pub/Sub dropped connection: {e}. Reconnecting in 5s...")
            await asyncio.sleep(5)

@asynccontextmanager
async def lifespan(app: FastAPI):
    discovery_task = asyncio.create_task(redis_room_discoverer())
    yield
    discovery_task.cancel()
    await asyncio.gather(discovery_task, return_exceptions=True)
    for room_id, task in active_room_tasks.items():
        task.cancel()

app = FastAPI(lifespan=lifespan)

# --- UPDATE HEALTH ROUTE ---
@app.api_route("/health", methods=["GET", "HEAD"])
def health_check():
    return {
        "status": "healthy", 
        "active_monitored_rooms": [r for r, t in active_room_tasks.items() if not t.done()]
    }

@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return {"status": "ok", "service": "backend-ai"}