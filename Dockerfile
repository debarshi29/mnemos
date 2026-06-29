# syntax=docker/dockerfile:1
# ── mnemos backend ─────────────────────────────────────────────────────────────
FROM python:3.11-slim

# Flush Python stdout/stderr immediately — keeps build log live
ENV PYTHONUNBUFFERED=1

# curl is the only runtime dep (healthcheck); gcc not needed — all packages
# ship pre-built wheels for Python 3.11 / linux/amd64
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "uv>=0.4"

WORKDIR /app

# ── Layer 1: dependencies ──────────────────────────────────────────────────────
# Only pyproject.toml and uv.lock are copied here — this layer is only
# invalidated when dependencies actually change, not on every source edit.
#
# uv sync --no-install-project: install all declared deps into a venv but skip
# the mnemos package itself (src/ not needed at this point).
# --frozen              use uv.lock as-is, no resolution
# --mount=type=cache    uv's wheel cache persists between builds (BuildKit)
COPY pyproject.toml uv.lock* ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project

# Activate the venv for all subsequent RUN / CMD steps
ENV PATH="/app/.venv/bin:$PATH"

# ── Layer 2: embedding model ───────────────────────────────────────────────────
# Baked into the image so cold starts are instant (~90 MB from HuggingFace).
# Only re-runs when Layer 1 changes (i.e. dependencies updated).
# Progress prints keep the build log alive during the download.
RUN python - <<'EOF'
from sentence_transformers import SentenceTransformer
print("Downloading all-MiniLM-L6-v2 (~90 MB)...", flush=True)
SentenceTransformer("all-MiniLM-L6-v2")
print("Model ready.", flush=True)
EOF

# ── Layer 3: application source ────────────────────────────────────────────────
# Arrives last — code-only changes only re-run these two cheap COPY steps.
COPY src/ src/
COPY config.yaml .

RUN mkdir -p /app/data

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8000"]
