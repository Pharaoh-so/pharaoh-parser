"""Test fixture for complex import patterns.

Covers: star imports, relative imports, conditional imports,
multi-line imports, aliased imports.
"""

# Standard import
import os

# Aliased import
import json as j

# Star import
from os.path import *

# Multi-line parenthesized import
from typing import (
    Any,
    Dict,
    List,
    Optional,
    Union,
)

# Relative imports
from . import decorators
from .. import src
from .inheritance import Animal, Dog

# Conditional import pattern
try:
    import ujson as json_lib
except ImportError:
    import json as json_lib

# Multiple symbols from one module
from collections import OrderedDict, defaultdict, namedtuple

# Aliased from-import
from datetime import datetime as dt, timedelta as td


def use_imports() -> None:
    """Function that uses the imported modules."""
    pass
