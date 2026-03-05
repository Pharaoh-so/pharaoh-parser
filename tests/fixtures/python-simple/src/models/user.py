"""User model."""

from dataclasses import dataclass
from ..utils.helpers import add


@dataclass
class User:
    """Represents a user in the system."""

    name: str
    age: int

    def greet(self) -> str:
        """Return a greeting string."""
        return f"Hello, {self.name}!"

    async def save(self) -> None:
        """Persist the user to the database."""
        pass

    def _internal_method(self) -> None:
        """This is private."""
        pass


class _PrivateModel:
    """This class is private and not exported."""

    def do_something(self) -> None:
        pass
