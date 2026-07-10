"""
Provider-switchable LLM client.
Set `llm.provider` in config.yaml to: groq | gemini | ollama
All callers use chat() — one signature regardless of provider.
stream() yields tokens as they arrive for SSE endpoints.
"""

from __future__ import annotations
from collections.abc import Iterator
from src.config import get, api_key


def chat(messages: list[dict], system: str | None = None, temperature: float = 0.2) -> str:
    """
    Send a chat request to the configured provider.
    messages: list of {"role": "user"|"assistant", "content": str}
    Returns the assistant reply as a plain string.
    """
    provider = get("llm.provider", "groq")
    if provider == "groq":
        return _groq(messages, system, temperature)
    elif provider == "gemini":
        return _gemini(messages, system, temperature)
    elif provider == "ollama":
        return _ollama(messages, system, temperature)
    else:
        raise ValueError(f"Unknown LLM provider: {provider!r}. Choose groq | gemini | ollama")


def stream(messages: list[dict], system: str | None = None, temperature: float = 0.2) -> Iterator[str]:
    """Yield reply tokens as they arrive. Falls back to a single chunk if the
    provider does not support true streaming."""
    provider = get("llm.provider", "groq")
    if provider == "groq":
        yield from _groq_stream(messages, system, temperature)
    elif provider == "gemini":
        yield from _gemini_stream(messages, system, temperature)
    elif provider == "ollama":
        yield from _ollama_stream(messages, system, temperature)
    else:
        raise ValueError(f"Unknown LLM provider: {provider!r}. Choose groq | gemini | ollama")


def _groq(messages: list[dict], system: str | None, temperature: float) -> str:
    from groq import Groq
    client = Groq(api_key=api_key("groq"))
    full_messages = []
    if system:
        full_messages.append({"role": "system", "content": system})
    full_messages.extend(messages)
    resp = client.chat.completions.create(
        model=get("llm.groq_model", "llama-3.1-8b-instant"),
        messages=full_messages,
        temperature=temperature,
    )
    return resp.choices[0].message.content


def _gemini(messages: list[dict], system: str | None, temperature: float) -> str:
    import google.generativeai as genai
    genai.configure(api_key=api_key("gemini"))
    model = genai.GenerativeModel(
        model_name=get("llm.gemini_model", "gemini-1.5-flash"),
        system_instruction=system or "",
    )
    history = []
    for m in messages[:-1]:
        history.append({
            "role": "user" if m["role"] == "user" else "model",
            "parts": [m["content"]],
        })
    chat_session = model.start_chat(history=history)
    resp = chat_session.send_message(
        messages[-1]["content"],
        generation_config={"temperature": temperature},
    )
    return resp.text


def _ollama(messages: list[dict], system: str | None, temperature: float) -> str:
    import httpx
    base = get("llm.ollama_base_url", "http://localhost:11434")
    full_messages = []
    if system:
        full_messages.append({"role": "system", "content": system})
    full_messages.extend(messages)
    resp = httpx.post(
        f"{base}/api/chat",
        json={
            "model": get("llm.ollama_model", "llama3"),
            "messages": full_messages,
            "stream": False,
            "options": {"temperature": temperature},
        },
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["message"]["content"]


# ── Streaming variants ─────────────────────────────────────────────────────────

def _groq_stream(messages: list[dict], system: str | None, temperature: float) -> Iterator[str]:
    from groq import Groq
    client = Groq(api_key=api_key("groq"))
    full_messages = []
    if system:
        full_messages.append({"role": "system", "content": system})
    full_messages.extend(messages)
    response = client.chat.completions.create(
        model=get("llm.groq_model", "llama-3.1-8b-instant"),
        messages=full_messages,
        temperature=temperature,
        stream=True,
    )
    for chunk in response:
        token = chunk.choices[0].delta.content if chunk.choices else None
        if token:
            yield token


def _gemini_stream(messages: list[dict], system: str | None, temperature: float) -> Iterator[str]:
    import google.generativeai as genai
    genai.configure(api_key=api_key("gemini"))
    model = genai.GenerativeModel(
        model_name=get("llm.gemini_model", "gemini-1.5-flash"),
        system_instruction=system or "",
    )
    contents = [
        {"role": "user" if m["role"] == "user" else "model", "parts": [m["content"]]}
        for m in messages
    ]
    for chunk in model.generate_content(
        contents,
        stream=True,
        generation_config={"temperature": temperature},
    ):
        if chunk.text:
            yield chunk.text


def _ollama_stream(messages: list[dict], system: str | None, temperature: float) -> Iterator[str]:
    import json as _json
    import httpx
    base = get("llm.ollama_base_url", "http://localhost:11434")
    full_messages = []
    if system:
        full_messages.append({"role": "system", "content": system})
    full_messages.extend(messages)
    with httpx.stream(
        "POST", f"{base}/api/chat",
        json={"model": get("llm.ollama_model", "llama3"), "messages": full_messages,
              "stream": True, "options": {"temperature": temperature}},
        timeout=120,
    ) as r:
        for line in r.iter_lines():
            if line:
                token = _json.loads(line).get("message", {}).get("content", "")
                if token:
                    yield token
