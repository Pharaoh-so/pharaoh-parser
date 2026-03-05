"""Main entry point."""

from src.utils.helpers import add, multiply
from src.models.user import User


def main() -> None:
    """Run the application."""
    result = add(1, 2)
    product = multiply(3, 4)
    user = User(name="Alice", age=30)
    print(user.greet())


if __name__ == "__main__":
    main()
