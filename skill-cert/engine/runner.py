import asyncio
import logging
from typing import Dict, Any, List
from concurrent.futures import ThreadPoolExecutor
from aiolimiter import AsyncLimiter
import time

logger = logging.getLogger(__name__)


class EvalRunner:
    def __init__(self, max_concurrency: int = 5, rate_limit_rpm: int = 60, request_timeout: int = 120):
        self.max_concurrency = max_concurrency
        self.rate_limit_rpm = rate_limit_rpm
        self.request_timeout = request_timeout
        self.limiter = AsyncLimiter(max_rate=rate_limit_rpm / 60, time_period=1)
        self.executor = ThreadPoolExecutor(max_workers=max_concurrency)
        
    async def run_with_skill(self, evals: List[Dict[str, Any]], skill_path: str, model_adapter) -> List[Dict[str, Any]]:
        results = []
        
        semaphore = asyncio.Semaphore(self.max_concurrency)
        
        async def run_single_eval(eval_case):
            async with semaphore:
                async with self.limiter:
                    try:
                        skill_context = f"Using skill from {skill_path}. "
                        input_with_context = skill_context + eval_case.get("input", "")
                        
                        start_time = time.time()
                        response = await self._run_with_timeout(
                            model_adapter.chat([{"role": "user", "content": input_with_context}]),
                            self.request_timeout
                        )
                        end_time = time.time()
                        
                        result = {
                            "eval_id": eval_case.get("id"),
                            "eval_name": eval_case.get("name"),
                            "eval_category": eval_case.get("category"),
                            "model": getattr(model_adapter, 'model_name', 'unknown'),
                            "run": "with-skill",
                            "input": input_with_context,
                            "output": response,
                            "execution_time": end_time - start_time,
                            "error": None,
                            "tokens_used": len(response.split()) if response else 0
                        }
                        
                        return result
                    except asyncio.TimeoutError:
                        logger.warning(f"Eval {eval_case.get('id')} timed out")
                        return {
                            "eval_id": eval_case.get("id"),
                            "eval_name": eval_case.get("name"),
                            "eval_category": eval_case.get("category"),
                            "model": getattr(model_adapter, 'model_name', 'unknown'),
                            "run": "with-skill",
                            "input": eval_case.get("input", ""),
                            "output": None,
                            "execution_time": self.request_timeout,
                            "error": "timeout",
                            "tokens_used": 0
                        }
                    except Exception as e:
                        logger.error(f"Error running eval {eval_case.get('id')}: {str(e)}")
                        return {
                            "eval_id": eval_case.get("id"),
                            "eval_name": eval_case.get("name"),
                            "eval_category": eval_case.get("category"),
                            "model": getattr(model_adapter, 'model_name', 'unknown'),
                            "run": "with-skill",
                            "input": eval_case.get("input", ""),
                            "output": None,
                            "execution_time": 0,
                            "error": str(e),
                            "tokens_used": 0
                        }
        
        tasks = [run_single_eval(eval_case) for eval_case in evals]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Exception in eval {i}: {result}")
                processed_results.append({
                    "eval_id": evals[i].get("id"),
                    "eval_name": evals[i].get("name"),
                    "eval_category": evals[i].get("category"),
                    "model": getattr(model_adapter, 'model_name', 'unknown'),
                    "run": "with-skill",
                    "input": evals[i].get("input", ""),
                    "output": None,
                    "execution_time": 0,
                    "error": str(result),
                    "tokens_used": 0
                })
            else:
                processed_results.append(result)
        
        return processed_results

    async def run_without_skill(self, evals: List[Dict[str, Any]], model_adapter) -> List[Dict[str, Any]]:
        results = []
        
        semaphore = asyncio.Semaphore(self.max_concurrency)
        
        async def run_single_eval(eval_case):
            async with semaphore:
                async with self.limiter:
                    try:
                        start_time = time.time()
                        response = await self._run_with_timeout(
                            model_adapter.chat([{"role": "user", "content": eval_case.get("input", "")}]),
                            self.request_timeout
                        )
                        end_time = time.time()
                        
                        result = {
                            "eval_id": eval_case.get("id"),
                            "eval_name": eval_case.get("name"),
                            "eval_category": eval_case.get("category"),
                            "model": getattr(model_adapter, 'model_name', 'unknown'),
                            "run": "without-skill",
                            "input": eval_case.get("input", ""),
                            "output": response,
                            "execution_time": end_time - start_time,
                            "error": None,
                            "tokens_used": len(response.split()) if response else 0
                        }
                        
                        return result
                    except asyncio.TimeoutError:
                        logger.warning(f"Eval {eval_case.get('id')} timed out")
                        return {
                            "eval_id": eval_case.get("id"),
                            "eval_name": eval_case.get("name"),
                            "eval_category": eval_case.get("category"),
                            "model": getattr(model_adapter, 'model_name', 'unknown'),
                            "run": "without-skill",
                            "input": eval_case.get("input", ""),
                            "output": None,
                            "execution_time": self.request_timeout,
                            "error": "timeout",
                            "tokens_used": 0
                        }
                    except Exception as e:
                        logger.error(f"Error running eval {eval_case.get('id')}: {str(e)}")
                        return {
                            "eval_id": eval_case.get("id"),
                            "eval_name": eval_case.get("name"),
                            "eval_category": eval_case.get("category"),
                            "model": getattr(model_adapter, 'model_name', 'unknown'),
                            "run": "without-skill",
                            "input": eval_case.get("input", ""),
                            "output": None,
                            "execution_time": 0,
                            "error": str(e),
                            "tokens_used": 0
                        }
        
        tasks = [run_single_eval(eval_case) for eval_case in evals]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Exception in eval {i}: {result}")
                processed_results.append({
                    "eval_id": evals[i].get("id"),
                    "eval_name": evals[i].get("name"),
                    "eval_category": evals[i].get("category"),
                    "model": getattr(model_adapter, 'model_name', 'unknown'),
                    "run": "without-skill",
                    "input": evals[i].get("input", ""),
                    "output": None,
                    "execution_time": 0,
                    "error": str(result),
                    "tokens_used": 0
                })
            else:
                processed_results.append(result)
        
        return processed_results

    async def _run_with_timeout(self, coro, timeout: int):
        try:
            return await asyncio.wait_for(coro, timeout=timeout)
        except asyncio.TimeoutError:
            raise asyncio.TimeoutError(f"Operation timed out after {timeout} seconds")

    def close(self):
        self.executor.shutdown(wait=True)