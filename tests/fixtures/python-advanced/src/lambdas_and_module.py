"""Test fixture for lambdas and module-level code patterns.

Covers: lambdas assigned to variables, if __name__ == "__main__" blocks,
module-level constants, class variables vs instance attributes, __slots__.
"""

# Module-level constants (the parser won't extract these as functions)
MAX_SIZE = 100
DEFAULT_NAME = "unnamed"

# Lambda assigned to a variable (parser should NOT detect as a function)
double = lambda x: x * 2
triple = lambda x: x * 3


def real_function(x: int) -> int:
    """A normal function for contrast with lambdas."""
    return x + 1


class WithClassVars:
    """A class with class variables and instance attributes."""

    # Class-level attributes
    count: int = 0
    label: str = "default"

    def __init__(self, name: str) -> None:
        # Instance attributes
        self.name = name
        self.active = True

    def increment(self) -> None:
        """Increment the class counter."""
        WithClassVars.count += 1


class WithSlots:
    """A class using __slots__ for memory efficiency."""

    __slots__ = ("x", "y", "z")

    def __init__(self, x: int, y: int, z: int) -> None:
        self.x = x
        self.y = y
        self.z = z

    def magnitude(self) -> float:
        """Calculate magnitude."""
        return (self.x ** 2 + self.y ** 2 + self.z ** 2) ** 0.5


class EmptyClass:
    """An empty class with no methods."""
    pass


def _private_module_func() -> None:
    """Private function at module level."""
    pass


if __name__ == "__main__":
    result = real_function(10)
    obj = WithClassVars("test")
    print(result, obj)
