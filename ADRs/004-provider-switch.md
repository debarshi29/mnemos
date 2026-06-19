# ADR 004: Single-file provider switch for LLM

**Status:** Accepted  
**Date:** 2026-06-19

## Context

The project targets zero-cost operation for the owner and every cloner. No single free LLM provider is universally available (Groq has rate limits, Gemini requires a Google account, Ollama requires local hardware). The system must support all three without requiring code changes.

## Decision

All LLM calls go through a single `src/llm_client.py` with one public function: `chat(messages, system, temperature) -> str`. Provider is selected by `llm.provider` in `config.yaml`. No other file imports a provider SDK directly.

## Rationale

- **Testability**: mock `src.llm_client.chat` in tests — no provider SDK involved.
- **Portability**: a cloner sets one config line, not scattered env vars across the codebase.
- **Swap cost**: adding a new provider (e.g., Anthropic, Mistral) means adding one `_provider_name()` function in one file.
- The three supported providers (Groq, Gemini, Ollama) cover: fastest free cloud (Groq), Google-account free (Gemini), fully local/offline (Ollama).

## Consequences

- All providers must support a `system` message — this is a lowest-common-denominator constraint. (Gemini implements it as `system_instruction`; handled internally.)
- Streaming is not supported in v0.1 to keep the interface simple. Can be added per-provider without changing callers.
