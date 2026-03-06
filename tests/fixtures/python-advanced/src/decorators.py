"""Test fixture for decorator patterns.

Covers: @staticmethod, @classmethod, @property, custom decorators, stacked decorators.
"""

from functools import wraps


def my_decorator(func):
    """A custom decorator."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)
    return wrapper


def log_calls(level: str):
    """A decorator factory (parameterized decorator)."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            return func(*args, **kwargs)
        return wrapper
    return decorator


class Service:
    """A service class demonstrating decorator patterns."""

    @staticmethod
    def create_id() -> str:
        """Generate a unique ID."""
        return "abc-123"

    @classmethod
    def from_config(cls, config: dict) -> "Service":
        """Create a Service from a config dict."""
        return cls()

    @property
    def name(self) -> str:
        """The service name."""
        return "my-service"

    @my_decorator
    def process(self, data: list) -> list:
        """Process data with a custom decorator."""
        return [d for d in data if d]

    @log_calls("info")
    @my_decorator
    def handle(self, request: dict) -> dict:
        """Handle a request with stacked decorators."""
        return {"status": "ok"}


@my_decorator
def standalone_decorated(x: int) -> int:
    """A standalone function with a custom decorator."""
    return x + 1


@log_calls("debug")
@my_decorator
def double_decorated(x: int, y: int) -> int:
    """A standalone function with two stacked decorators."""
    return x + y
