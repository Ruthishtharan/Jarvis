import asyncio
import concurrent.futures
from typing import Callable, Any
from utils.logger import get_logger

logger = get_logger(__name__)

_thread_pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)


async def run_in_thread(func: Callable, *args, **kwargs) -> Any:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_thread_pool, lambda: func(*args, **kwargs))


async def run_with_timeout(coro, timeout: float, fallback=None):
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except asyncio.TimeoutError:
        logger.warning(f"Task timed out after {timeout}s")
        return fallback


async def gather_safe(*coros) -> list:
    results = await asyncio.gather(*coros, return_exceptions=True)
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            logger.error(f"Parallel task {i} failed: {r}")
            results[i] = None
    return results


def run_async(coro) -> Any:
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            return asyncio.ensure_future(coro)
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)
