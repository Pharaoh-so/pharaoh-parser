"""Test fixture for complex type annotations.

Covers: Optional, Union, Dict, List, generics, complex return types.
"""

from typing import Any, Callable, Dict, Generic, List, Optional, Tuple, TypeVar, Union

T = TypeVar("T")
K = TypeVar("K")
V = TypeVar("V")


def simple_optional(x: Optional[int] = None) -> Optional[str]:
    """Function with Optional types."""
    if x is None:
        return None
    return str(x)


def union_params(value: Union[str, int, float]) -> Union[bool, None]:
    """Function with Union types."""
    return value is not None


def complex_dict(data: Dict[str, List[int]]) -> Dict[str, Any]:
    """Function with nested generic types."""
    return {k: sum(v) for k, v in data.items()}


def tuple_return(x: int, y: int) -> Tuple[int, int, int]:
    """Function returning a Tuple."""
    return (x, y, x + y)


def callable_param(fn: Callable[[int, int], int], a: int, b: int) -> int:
    """Function taking a Callable parameter."""
    return fn(a, b)


class Container(Generic[T]):
    """A generic container class."""

    def __init__(self, value: T) -> None:
        self._value = value

    def get(self) -> T:
        """Get the contained value."""
        return self._value

    def map(self, fn: Callable[[T], T]) -> "Container[T]":
        """Apply a function to the contained value."""
        return Container(fn(self._value))


class MultiGeneric(Generic[K, V]):
    """A class with multiple type parameters."""

    def __init__(self, key: K, value: V) -> None:
        self._key = key
        self._value = value

    def pair(self) -> Tuple[K, V]:
        """Return the key-value pair."""
        return (self._key, self._value)
