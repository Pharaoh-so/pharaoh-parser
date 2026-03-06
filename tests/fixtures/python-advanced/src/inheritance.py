"""Test fixture for inheritance patterns.

Covers: single inheritance, multiple inheritance, abstract base classes.
"""

from abc import ABC, abstractmethod


class Animal:
    """Base class for animals."""

    def speak(self) -> str:
        """Make a sound."""
        return ""

    def move(self) -> str:
        """Describe movement."""
        return "moving"


class Dog(Animal):
    """A dog that inherits from Animal."""

    def speak(self) -> str:
        """Dogs bark."""
        return "woof"

    def fetch(self, item: str) -> str:
        """Fetch an item."""
        return f"fetched {item}"


class Serializable:
    """Mixin for serialization."""

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {}


class Printable:
    """Mixin for printing."""

    def pretty_print(self) -> str:
        """Pretty print."""
        return str(self)


class SmartDog(Dog, Serializable, Printable):
    """Multiple inheritance: Dog + two mixins."""

    def tricks(self) -> list:
        """List tricks."""
        return ["sit", "shake"]


class Shape(ABC):
    """Abstract base class for shapes."""

    @abstractmethod
    def area(self) -> float:
        """Calculate area."""
        pass

    @abstractmethod
    def perimeter(self) -> float:
        """Calculate perimeter."""
        pass

    def describe(self) -> str:
        """Non-abstract method."""
        return f"Shape with area {self.area()}"


class Circle(Shape):
    """Concrete shape implementation."""

    def __init__(self, radius: float) -> None:
        self.radius = radius

    def area(self) -> float:
        """Calculate circle area."""
        return 3.14159 * self.radius ** 2

    def perimeter(self) -> float:
        """Calculate circle perimeter."""
        return 2 * 3.14159 * self.radius
