from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Any
import requests


@dataclass(frozen=True)
class LLMConfig:
    provider: str
    api_base: str
    model: str
    api_key: str | None
    temperature: float
    enabled: bool


class LLMClient:
    def __init__(self, cfg: LLMConfig) -> None:
        self.cfg = cfg
        self.total_prompt_tokens: int = 0
        self.total_completion_tokens: int = 0

    def chat(self, *, system: str, messages: list[dict[str, str]], max_tokens: int | None = None) -> str:
        if not self.cfg.enabled:
            return "I suggest a practical merge and gradual convergence."

        payload: dict[str, Any] = {
            "model": self.cfg.model,
            "messages": [{"role": "system", "content": system}] + messages,
            "temperature": self.cfg.temperature,
            "max_tokens": max_tokens if max_tokens is not None else 400,
        }

        try:
            if self.cfg.provider == "github-models":
                headers = {
                    "Content-Type": "application/json",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                }
                if self.cfg.api_key:
                    headers["Authorization"] = f"Bearer {self.cfg.api_key}"
                endpoint = f"{self.cfg.api_base.rstrip('/')}/chat/completions"
                resp = requests.post(endpoint, json=payload, headers=headers, timeout=10)
            elif self.cfg.provider == "pollinations":
                headers = {"Content-Type": "application/json"}
                if self.cfg.api_key:
                    headers["Authorization"] = f"Bearer {self.cfg.api_key}"
                resp = requests.post(
                    f"{self.cfg.api_base.rstrip('/')}/openai",
                    json=payload,
                    headers=headers,
                    timeout=6,
                )
            else:
                return "Let's branch minimally and converge quickly on one plan."

            resp.raise_for_status()
            data = resp.json()
            # Accumulate token usage from the API response
            usage = data.get("usage")
            if isinstance(usage, dict):
                self.total_prompt_tokens += int(usage.get("prompt_tokens", 0))
                self.total_completion_tokens += int(usage.get("completion_tokens", 0))
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            if isinstance(content, str) and content.strip():
                return content.strip()
        except Exception:
            pass

        return "Let's converge by keeping one strong branch and pruning weaker variants."

    def token_summary(self) -> dict:
        """Return aggregated token usage counts."""
        return {
            "prompt_tokens": self.total_prompt_tokens,
            "completion_tokens": self.total_completion_tokens,
            "total_tokens": self.total_prompt_tokens + self.total_completion_tokens,
        }

    def chat_json(self, *, system: str, messages: list[dict[str, str]], fallback: dict[str, Any], max_tokens: int | None = None) -> dict[str, Any]:
        text = self.chat(system=system, messages=messages, max_tokens=max_tokens)

        # Prefer fenced JSON blocks when present.
        fenced = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text)
        if fenced:
            try:
                parsed = json.loads(fenced.group(1))
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                pass

        # Fallback to first object-like payload in free text.
        inline = re.search(r"\{[\s\S]*\}", text)
        if inline:
            try:
                parsed = json.loads(inline.group(0))
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                pass

        return fallback
