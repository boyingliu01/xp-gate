import json
import time
import requests
from typing import List, Dict, Any, Optional
from .base import ModelAdapter


class AnthropicCompatAdapter(ModelAdapter):
    SUPPORTED_MODELS = [
        "qwen3.6-plus", "qwen3.5-plus", "qwen3-max-2026-01-23",
        "qwen3-coder-next", "qwen3-coder-plus",
        "glm-5", "glm-4.7", "kimi-k2.5", "MiniMax-M2.5",
    ]

    def __init__(self, base_url: str, api_key: str, model: str,
                 fallback_model: Optional[str] = None, rpm_limit: int = 60):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.model = model
        self.fallback_model = fallback_model
        self.session = requests.Session()
        self.session.headers.update({
            "x-api-key": api_key,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
        })

    def chat(self, messages: List[Dict[str, str]], system: Optional[str] = None, timeout: int = 120) -> str:
        formatted = [
            {"role": "user" if m["role"] == "user" else "assistant", "content": m["content"]}
            for m in messages if m["role"] in ("user", "assistant")
        ]
        payload = {"model": self.model, "max_tokens": 8192, "messages": formatted}
        if system:
            payload["system"] = system
        return self._request(payload)

    def batch_chat(self, requests_list: List[Dict[str, Any]], max_concurrency: int = 5) -> List[str]:
        results = []
        for req in requests_list:
            try:
                results.append(self.chat(req.get("messages", []), req.get("system")))
            except Exception as e:
                results.append(f"ERROR: {e}")
        return results

    def _request(self, payload: Dict[str, Any], max_retries: int = 3) -> str:
        for attempt in range(max_retries):
            try:
                resp = self.session.post(
                    f"{self.base_url}/messages",
                    json=payload,
                    timeout=120,
                )
                resp.raise_for_status()
                data = resp.json()
                for block in data.get("content", []):
                    if block.get("type") == "text":
                        return block["text"]
                return json.dumps(data)
            except Exception as e:
                if attempt == max_retries - 1:
                    raise
                time.sleep(2 ** attempt)
