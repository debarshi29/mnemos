SHELL := bash

.PHONY: dev backend frontend install

# Start both backend and frontend in parallel (requires bash + kill-on-exit)
dev:
	@trap 'kill 0' EXIT; \
	uv run uvicorn src.api:app --reload & \
	cd frontend && npm run dev & \
	wait

backend:
	uv run uvicorn src.api:app --reload

frontend:
	cd frontend && npm run dev

install:
	uv sync
	cd frontend && npm install
