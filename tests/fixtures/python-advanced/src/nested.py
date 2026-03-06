"""Test fixture for nested function patterns.

Covers: closures, inner functions, factory patterns.
The parser only extracts top-level and class-level functions,
so nested functions should NOT appear in the output.
"""


def outer_function(x: int) -> int:
    """A function containing inner functions."""

    def inner_add(y: int) -> int:
        """This inner function should NOT be detected by the parser."""
        return x + y

    return inner_add(10)


def make_multiplier(factor: int):
    """A factory function that returns a closure."""

    def multiplier(value: int) -> int:
        return value * factor

    return multiplier


def deeply_nested() -> int:
    """Three levels of nesting."""

    def level_one() -> int:
        def level_two() -> int:
            return 42
        return level_two()

    return level_one()


class WithNestedMethods:
    """A class with methods that contain nested functions."""

    def method_with_inner(self) -> int:
        """This method contains an inner function."""
        def helper() -> int:
            return 99
        return helper()
