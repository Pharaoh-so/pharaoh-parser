"""Utility helper functions."""

__all__ = ["add", "multiply", "fetch_data"]


def add(a: int, b: int) -> int:
    """Add two numbers together and return the sum."""
    return a + b


def multiply(a: int, b: int) -> int:
    """Multiply two numbers."""
    return a * b


def _private_helper(x: int) -> int:
    return x * 2


async def fetch_data(url: str) -> dict:
    """Fetch data from a remote URL.

    This function is used by the router module
    to retrieve external resources.
    """
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()


def process_items(items: list, strict: bool = False) -> list:
    """Process a list of items with complexity."""
    results = []
    for item in items:
        if item is None:
            continue
        if strict and not isinstance(item, str):
            raise ValueError("Expected string")
        if len(item) > 100 or item.startswith("skip"):
            continue
        try:
            results.append(item.strip())
        except AttributeError:
            pass
    return results
