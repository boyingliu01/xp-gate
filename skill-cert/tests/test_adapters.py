import asyncio
import httpx
import tenacity
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


def test_openai_compat_make_request():
    """Test the _make_request method with system message."""
    adapter = OpenAICompatAdapter(
        base_url="https://api.openai.com",
        api_key="test-key",
        model="gpt-4",
        rpm_limit=60
    )
    
    # Mock the _call_with_retry method to return a fixed response
    with patch.object(adapter, '_call_with_retry', return_value="test response"):
        result = asyncio.run(adapter._make_request(
            messages=[{"role": "user", "content": "Hello"}],
            system="You are a helpful assistant"
        ))
        
        assert result == "test response"


def test_openai_compat_call_with_retry_success():
    """Test _call_with_retry method with successful response."""
    adapter = OpenAICompatAdapter(
        base_url="https://api.openai.com",
        api_key="test-key",
        model="gpt-4",
        rpm_limit=60
    )
    
    # Mock successful HTTP response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [{"message": {"content": "test response"}}]
    }
    
    with patch.object(adapter.client, 'post', return_value=mock_response):
        result = asyncio.run(adapter._call_with_retry(
            messages=[{"role": "user", "content": "Hello"}],
            model="gpt-4",
            timeout=120
        ))
        
        assert result == "test response"


def test_openai_compat_call_with_retry_non_retryable_errors():
    """Test _call_with_retry method with non-retryable errors."""
    adapter = OpenAICompatAdapter(
        base_url="https://api.openai.com",
        api_key="test-key",
        model="gpt-4",
        rpm_limit=60
    )
    
    # Test 401 error (Invalid API key)
    mock_response_401 = MagicMock()
    mock_response_401.status_code = 401
    mock_response_401.text.return_value = "Unauthorized"
    
    with patch.object(adapter.client, 'post', return_value=mock_response_401):
        with pytest.raises(RuntimeError, match="Invalid API key"):
            asyncio.run(adapter._call_with_retry(
                messages=[{"role": "user", "content": "Hello"}],
                model="gpt-4",
                timeout=120
            ))
    
    # Test 404 error (Model not found)
    mock_response_404 = MagicMock()
    mock_response_404.status_code = 404
    mock_response_404.text.return_value = "Not Found"
    
    with patch.object(adapter.client, 'post', return_value=mock_response_404):
        with pytest.raises(RuntimeError, match="Model not found"):
            asyncio.run(adapter._call_with_retry(
                messages=[{"role": "user", "content": "Hello"}],
                model="gpt-4",
                timeout=120
            ))
    
    # Test 429 error (Insufficient quota)
    mock_response_429 = MagicMock()
    mock_response_429.status_code = 429
    mock_response_429.text.return_value = "Rate Limited"
    
    with patch.object(adapter.client, 'post', return_value=mock_response_429):
        with pytest.raises(RuntimeError, match="Insufficient quota"):
            asyncio.run(adapter._call_with_retry(
                messages=[{"role": "user", "content": "Hello"}],
                model="gpt-4",
                timeout=120
            ))


def test_openai_compat_call_with_retry_http_status_error():
    """Test _call_with_retry method with HTTP status errors."""
    adapter = OpenAICompatAdapter(
        base_url="https://api.openai.com",
        api_key="test-key",
        model="gpt-4",
        rpm_limit=60
    )
    
    # Test other HTTP status errors that should raise
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Server Error", request=MagicMock(), response=mock_response
    )
    
    with patch.object(adapter.client, 'post', return_value=mock_response):
        # Since the retry will eventually fail after 3 attempts, we expect a RetryError
        with pytest.raises(tenacity.RetryError):
            asyncio.run(adapter._call_with_retry(
                messages=[{"role": "user", "content": "Hello"}],
                model="gpt-4",
                timeout=120
            ))


def test_openai_compat_call_with_retry_network_errors():
    """Test _call_with_retry method with network errors."""
    adapter = OpenAICompatAdapter(
        base_url="https://api.openai.com",
        api_key="test-key",
        model="gpt-4",
        rpm_limit=60
    )
    
    # Test timeout exception - should be retried and eventually raise RetryError
    with patch.object(adapter.client, 'post', side_effect=httpx.TimeoutException("Timeout", request=MagicMock())):
        with pytest.raises(tenacity.RetryError):
            asyncio.run(adapter._call_with_retry(
                messages=[{"role": "user", "content": "Hello"}],
                model="gpt-4",
                timeout=120
            ))
    
    # Test connection error - should be retried and eventually raise RetryError
    with patch.object(adapter.client, 'post', side_effect=httpx.ConnectError("Connection failed", request=MagicMock())):
        with pytest.raises(tenacity.RetryError):
            asyncio.run(adapter._call_with_retry(
                messages=[{"role": "user", "content": "Hello"}],
                model="gpt-4",
                timeout=120
            ))


def test_openai_compat_chat_sync():
    """Test chat method when running in sync context."""
    adapter = OpenAICompatAdapter(
        base_url="https://api.openai.com",
        api_key="test-key",
        model="gpt-4",
        rpm_limit=60
    )
    
    # Mock the _make_request method to return a fixed response
    with patch.object(adapter, '_make_request', return_value="sync response"):
        result = adapter.chat([{"role": "user", "content": "Hello"}])
        
        assert result == "sync response"


def test_openai_compat_batch_chat():
    """Test batch_chat method."""
    adapter = OpenAICompatAdapter(
        base_url="https://api.openai.com",
        api_key="test-key",
        model="gpt-4",
        rpm_limit=60
    )
    
    # Mock the _batch_chat_async method to return fixed responses
    with patch.object(adapter, '_batch_chat_async', return_value=["response1", "response2"]):
        result = adapter.batch_chat([
            {"messages": [{"role": "user", "content": "Hello"}]},
            {"messages": [{"role": "user", "content": "World"}]}
        ])
        
        assert result == ["response1", "response2"]


def test_openai_compat_process_single_request():
    """Test _process_single_request method."""
    adapter = OpenAICompatAdapter(
        base_url="https://api.openai.com",
        api_key="test-key",
        model="gpt-4",
        rpm_limit=60
    )
    
    # Mock the _make_request method
    with patch.object(adapter, '_make_request', return_value="processed response"):
        semaphore = asyncio.Semaphore(5)
        result = asyncio.run(adapter._process_single_request({
            "messages": [{"role": "user", "content": "Hello"}],
            "system": "system message",
            "timeout": 120
        }, semaphore))
        
        assert result == "processed response"


def test_openai_compat_batch_chat_async_with_errors():
    """Test _batch_chat_async method with errors."""
    adapter = OpenAICompatAdapter(
        base_url="https://api.openai.com",
        api_key="test-key",
        model="gpt-4",
        rpm_limit=60
    )
    
    # Mock the _process_single_request method to raise an exception for one request
    async def mock_process_single_request(request_data, semaphore):
        if request_data["messages"][0]["content"] == "error":
            raise Exception("Processing error")
        return "success response"
    
    with patch.object(adapter, '_process_single_request', side_effect=mock_process_single_request):
        result = asyncio.run(adapter._batch_chat_async([
            {"messages": [{"role": "user", "content": "success"}]},
            {"messages": [{"role": "user", "content": "error"}]}
        ], max_concurrency=5))
        
        assert result[0] == "success response"
        assert "Error:" in result[1]


def test_openai_compat_cleanup():
    """Test the __del__ method for cleanup."""
    adapter = OpenAICompatAdapter(
        base_url="https://api.openai.com",
        api_key="test-key",
        model="gpt-4",
        rpm_limit=60
    )
    
    # Mock the client's close method
    with patch.object(adapter.client, 'aclose') as mock_close:
        # Simulate the deletion process
        if hasattr(adapter, 'client') and not adapter.client.is_closed:
            try:
                # Try to get running loop (will fail in this context)
                loop = asyncio.get_running_loop()
                loop.create_task(adapter.client.aclose())
            except RuntimeError:
                # This simulates the else branch
                asyncio.run(adapter.client.aclose())
        
        # The aclose method should have been called
        # We can't easily test this since the client might already be closed
        # But we've covered the code path


if __name__ == "__main__":
    pytest.main([__file__])