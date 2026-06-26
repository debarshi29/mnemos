# syntax=docker/dockerfile:1
# ── mnemos backend ─────────────────────────────────────────────────────────────

FROM python:3.11-slim AS builder

# Build tools needed only to compile C extensions (numpy, tokenizers, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /build

# Copy ONLY the dependency spec — source changes never reach this layer
COPY pyproject.toml uv.lock* ./

# --no-install-project: install all declared deps but not the mnemos package
# --mount=type=cache:   wheel cache persists across builds (BuildKit)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --no-install-project .

# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim

# Runtime-only tools: curl for healthcheck; no gcc needed
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from the builder stage
COPY --from=builder /usr/local/lib/python3.11 /usr/local/lib/python3.11
COPY --from=builder /usr/local/bin /usr/local/bin

# Bake the embedding model into the image — avoids ~90 MB download on cold start.
# This layer is only invalidated when pyproject.toml changes, not on source edits.
RUN python -c "from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('all-MiniLM-L6-v2')"

WORKDIR /app

# Source arrives last — code changes bust only these final cheap layers
COPY src/ src/
COPY config.yaml .

RUN mkdir -p /app/data

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8000"]
