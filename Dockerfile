# ── mnemos backend ────────────────────────────────────────────────────────────
FROM python:3.11-slim AS base

# build deps for numpy / scipy / tokenizers wheel compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ curl \
    && rm -rf /var/lib/apt/lists/*

# install uv (same tool used locally)
RUN pip install --no-cache-dir uv

WORKDIR /app

# ── dependency layer (cached unless pyproject.toml changes) ───────────────────
COPY pyproject.toml .
COPY src/ src/
RUN uv pip install --system -e .

# ── pre-download embedding model (baked in → fast cold start) ─────────────────
# model lands in /root/.cache/huggingface which stays in the image layer
RUN python -c "from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('all-MiniLM-L6-v2')" 2>/dev/null || true

# ── application files ─────────────────────────────────────────────────────────
COPY config.yaml .
COPY .env.example .

# persistent data lives on a volume, not in the image
RUN mkdir -p /app/data

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8000"]
