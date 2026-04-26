import asyncio
import httpx
import json
from typing import List, Dict, Any, Optional
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from aiolimiter import AsyncLimiter
from .base import ModelAdapter


class OpenAICompatAdapter(ModelAdapter):
    """Adapter for OpenAI-compatible APIs (e.g., OpenAI, Azure OpenAI, local models with OpenAI-compatible endpoints)."""
    
    def __init__(
        self, 
        base_url: str, 
        api_key: str, 
        model: str, 
        fallback_model: Optional[str] = None,
        rpm_limit: int = 60
    ):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.model = model
        self.fallback_model = fallback_model
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(120.0))
        self.rate_limiter = AsyncLimiter(max_rate=rpm_limit, time_period=60)
        
    async def _make_request(
        self, 
        messages: List[Dict[str, str]], 
        system: str = None, 
        timeout: int = 120
    ) -> str:
        """Make a single request to the API with retry logic."""
        prepared_messages = []
        if system:
            prepared_messages.append({"role": "system", "content": system})
        prepared_messages.extend(messages)
        
        model_to_use = self.model
        
        await self.rate_limiter.acquire()
        
        response = await self._call_with_retry(prepared_messages, model_to_use, timeout)
        return response
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError))
    )
    async def _call_with_retry(
        self, 
        messages: List[Dict[str, str]], 
        model: str, 
        timeout: int
    ) -> str:
        """Internal method to make API call with retry logic."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.0  # Fixed temperature for consistency
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
                timeout=timeout
            )
            
            if response.status_code == 401:  # Invalid API key
                raise RuntimeError("Invalid API key")
            elif response.status_code == 404:  # Model not found
                raise RuntimeError("Model not found")
            elif response.status_code == 429:  # Insufficient quota
                raise RuntimeError("Insufficient quota")
            elif response.status_code >= 500:  # Server errors - retry
                response.raise_for_status()
            else:
                response.raise_for_status()
                
            result = response.json()
            return result["choices"][0]["message"]["content"]
            
        except httpx.TimeoutException:
            raise
        except httpx.ConnectError:
            raise
        except httpx.HTTPStatusError as e:
            if e.response.status_code in [401, 404, 429]:
                raise RuntimeError(f"Non-retryable error: {e.response.status_code}")
            else:
                raise
    
    def chat(self, messages: List[Dict[str, str]], system: str = None, timeout: int = 120) -> str:
        """
        Send a chat request to the model.
        
        Args:
            messages: List of message dictionaries with 'role' and 'content'
            system: Optional system message
            timeout: Request timeout in seconds
            
        Returns:
            Model response as a string
        """
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(self._make_request(messages, system, timeout))
        else:
            return loop.run_until_complete(self._make_request(messages, system, timeout))
    
    async def _process_single_request(
        self, 
        request_data: Dict[str, Any], 
        semaphore: asyncio.Semaphore
    ) -> str:
        """Process a single request with concurrency control."""
        async with semaphore:
            messages = request_data.get("messages", [])
            system = request_data.get("system", None)
            timeout = request_data.get("timeout", 120)
            return await self._make_request(messages, system, timeout)
    
    async def _batch_chat_async(self, requests: List[Dict[str, Any]], max_concurrency: int = 5) -> List[str]:
        """Internal async method for batch processing."""
        semaphore = asyncio.Semaphore(max_concurrency)
        tasks = [
            self._process_single_request(request, semaphore) 
            for request in requests
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        processed_results = []
        for result in results:
            if isinstance(result, Exception):
                processed_results.append(f"Error: {str(result)}")
            else:
                processed_results.append(result)
        
        return processed_results
    
    def batch_chat(self, requests: List[Dict[str, Any]], max_concurrency: int = 5) -> List[str]:
        """
        Send multiple chat requests concurrently.
        
        Args:
            requests: List of request dictionaries containing messages, system, timeout
            max_concurrency: Maximum number of concurrent requests
            
        Returns:
            List of model responses in the same order as requests
        """
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(self._batch_chat_async(requests, max_concurrency))
        else:
            return loop.run_until_complete(self._batch_chat_async(requests, max_concurrency))
    
    def __del__(self):
        """Cleanup async client on deletion."""
        if hasattr(self, 'client') and not self.client.is_closed:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self.client.aclose())
            except RuntimeError:
                asyncio.run(self.client.aclose())