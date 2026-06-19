"""Loads config.yaml and .env, exposes a single typed Config object."""

import os
from pathlib import Path
from functools import lru_cache
import yaml
from dotenv import load_dotenv

load_dotenv()

_ROOT = Path(__file__).parent.parent


@lru_cache(maxsize=1)
def load_config() -> dict:
    with open(_ROOT / "config.yaml") as f:
        cfg = yaml.safe_load(f)
    # resolve relative paths against repo root
    cfg["database"]["path"] = str(_ROOT / cfg["database"]["path"])
    cfg["vector_store"]["path"] = str(_ROOT / cfg["vector_store"]["path"])
    return cfg


def get(key_path: str, default=None):
    """Dot-path accessor: get('memory.ema_new_weight')"""
    cfg = load_config()
    parts = key_path.split(".")
    node = cfg
    for p in parts:
        if not isinstance(node, dict) or p not in node:
            return default
        node = node[p]
    return node


def api_key(provider: str) -> str | None:
    mapping = {
        "groq": "GROQ_API_KEY",
        "gemini": "GOOGLE_API_KEY",
    }
    return os.getenv(mapping.get(provider, ""))
