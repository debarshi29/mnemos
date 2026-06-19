"""
Provider-switchable LLM client.
Set `llm.provider` in config.yaml to: groq | gemini | ollama
All callers use chat() — one signature regardless of provider.
"""

from __future__ import annotations
from typing import TYPE_CHECKING
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
