"""The one chat client every model in this project is called through.

Why one path: vLLM-served local models and OpenAI's gpt-4o-mini are both
reached through an OpenAI-compatible chat-completions endpoint with the
contract's sampling settings. Differences in results then come from the model,
never from the harness. There is deliberately no HF ``generate`` path: it
would be a second chat-template implementation waiting to disagree with the
one vLLM serves.

Streaming is always on so time-to-first-token is measured the way the app
experiences it.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from openai import OpenAI

from .contract import Contract

PLACEHOLDER_API_KEY = "not-needed"


@dataclass(frozen=True)
class Endpoint:
    """Where to send chat completions. ``base_url=None`` means api.openai.com."""

    model: str
    base_url: str | None = None
    api_key: str | None = None

    @classmethod
    def vllm(
        cls,
        model: str = "rag-grounded",
        base_url: str = "http://127.0.0.1:8000/v1",
        api_key: str | None = None,
    ) -> "Endpoint":
        # Why 127.0.0.1 and not localhost: vLLM binds IPv4, and Python's HTTP
        # stack may resolve localhost to ::1 first and get connection refused.
        # Why a placeholder: the OpenAI SDK refuses to start without a key, and
        # the real OPENAI_API_KEY must never be sent to a local server.
        return cls(model=model, base_url=base_url, api_key=api_key or PLACEHOLDER_API_KEY)

    @classmethod
    def openai(cls, model: str = "gpt-4o-mini") -> "Endpoint":
        key = os.environ.get("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        return cls(model=model, base_url=None, api_key=key)


@dataclass
class ChatResult:
    text: str
    ttft_s: float | None
    total_s: float
    prompt_tokens: int | None
    completion_tokens: int | None
    finish_reason: str | None

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


class ChatClient:
    def __init__(self, endpoint: Endpoint, contract: Contract, timeout_s: float = 120.0):
        self.endpoint = endpoint
        self.contract = contract
        self._client = OpenAI(
            base_url=endpoint.base_url, api_key=endpoint.api_key, timeout=timeout_s
        )

    def complete(
        self,
        messages: Sequence[Mapping[str, str]],
        *,
        seed: int | None = None,
        extra_body: Mapping[str, Any] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        json_mode: bool = False,
    ) -> ChatResult:
        """Stream one completion with the contract's temperature and output cap.

        Evaluation always uses the contract defaults. The overrides exist for
        the dataset builder's side calls (question generation, checks), which
        are not production answers and may use JSON mode or more randomness.
        """
        kwargs: dict[str, Any] = {
            "model": self.endpoint.model,
            "messages": list(messages),
            "temperature": self.contract.temperature if temperature is None else temperature,
            "max_tokens": self.contract.max_output_tokens if max_tokens is None else max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        if seed is not None:
            kwargs["seed"] = seed
        if extra_body:
            kwargs["extra_body"] = dict(extra_body)

        started = time.perf_counter()
        ttft: float | None = None
        parts: list[str] = []
        finish_reason: str | None = None
        prompt_tokens = completion_tokens = None

        for chunk in self._client.chat.completions.create(**kwargs):
            if chunk.usage is not None:
                prompt_tokens = chunk.usage.prompt_tokens
                completion_tokens = chunk.usage.completion_tokens
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = choice.delta.content if choice.delta else None
            if delta:
                if ttft is None:
                    ttft = time.perf_counter() - started
                parts.append(delta)
            if choice.finish_reason:
                finish_reason = choice.finish_reason

        return ChatResult(
            text="".join(parts),
            ttft_s=ttft,
            total_s=time.perf_counter() - started,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            finish_reason=finish_reason,
        )

    def list_models(self) -> list[str]:
        return [m.id for m in self._client.models.list().data]
