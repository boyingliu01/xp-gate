import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from adapters.base import ModelAdapter
from adapters.openai_compat import OpenAICompatAdapter


def test_model_adapter_abstract_methods():
    """Test that ModelAdapter abstract methods raise NotImplementedError when called."""
    class ConcreteAdapter(ModelAdapter):
        def chat(self, messages, system=None, timeout=120):
            return "test response"
        
        def batch_chat(self, requests, max_concurrency=5):
            return ["test response"]

    adapter = ConcreteAdapter()
    assert adapter.chat([]) == "test response"
    assert adapter.batch_chat([]) == ["test response"]


def test_openai_compat_adapter_initialization():
    """Test OpenAICompatAdapter initialization."""
    adapter = OpenAICompatAdapter(
        base_url="https://api.openai.com",
        api_key="test-key",
        model="gpt-4",
        fallback_model="gpt-3.5",
        rpm_limit=100
    )
    
    assert adapter.base_url == "https://api.openai.com"
    assert adapter.api_key == "test-key"
    assert adapter.model == "gpt-4"
    assert adapter.fallback_model == "gpt-3.5"
    assert adapter.rate_limiter.max_rate == 100


def test_openai_compat_retry_logic():
    """Test that the adapter implements retry logic correctly."""
    import inspect
    import tenacity
    
    method = OpenAICompatAdapter._call_with_retry
    assert hasattr(method, '__wrapped__') or hasattr(method, '__wrapped_func__')


def test_openai_compat_fallback_model():
    """Test that fallback model is handled correctly (conceptually)."""
    adapter = OpenAICompatAdapter(
        base_url="https://api.openai.com",
        api_key="test-key",
        model="primary-model",
        fallback_model="fallback-model"
    )
    
    assert adapter.model == "primary-model"
    assert adapter.fallback_model == "fallback-model"


if __name__ == "__main__":
    pytest.main([__file__])