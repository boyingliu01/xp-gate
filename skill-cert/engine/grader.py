"""Grading module for skill-cert engine — evaluates model outputs against eval assertions."""

import json
import re
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field
from dataclasses import dataclass


class JudgeResult(BaseModel):
    """Structure for LLM-as-judge evaluation results."""
    passed: bool
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str = ""
    judge_version: str = "1.0"
    judge_model: str = ""


class EvalAssertion(BaseModel):
    """Single assertion in an evaluation case."""
    name: str
    type: str  # contains, not_contains, regex, starts_with, json_valid
    value: str
    weight: int = 1  # 1=Normal, 2=Important, 3=Critical


class EvalCase(BaseModel):
    """Single evaluation test case."""
    id: int
    name: str
    category: str  # normal, boundary, failure, trigger
    prompt: str
    expected_output: Optional[str] = None
    files: List[str] = Field(default_factory=list)
    assertions: List[EvalAssertion]


@dataclass
class AssertionResult:
    """Result of a single assertion evaluation."""
    assertion: EvalAssertion
    passed: bool
    confidence: float
    reason: str


class Grader:
    """Evaluates model outputs against eval assertions."""
    
    def __init__(self, llm_client=None):
        """Initialize grader with optional LLM client for judge mode."""
        self.llm_client = llm_client
    
    def grade_output(self, eval_case: EvalCase, model_output: str) -> Dict[str, Any]:
        """Evaluate a single model output against eval case assertions."""
        results = []
        total_weighted_score = 0
        total_possible_score = 0
        
        for assertion in eval_case.assertions:
            result = self._evaluate_assertion(assertion, model_output)
            results.append(result)
            
            # Calculate weighted score
            weight_multiplier = self._get_weight_multiplier(assertion.weight)
            if result.passed:
                total_weighted_score += weight_multiplier
            total_possible_score += weight_multiplier
        
        # Calculate pass rate
        pass_rate = total_weighted_score / total_possible_score if total_possible_score > 0 else 0.0
        
        # Determine if we need LLM-as-judge for complex behavior
        deterministic_passed_count = sum(1 for r in results if r.confidence == 1.0 and r.passed)
        deterministic_total_count = sum(1 for r in results if r.confidence == 1.0)
        
        # If not all deterministic assertions passed, or if we have complex cases, use LLM judge
        use_llm_judge = (
            deterministic_total_count < len(results) or  # Some assertions are non-deterministic
            deterministic_passed_count < deterministic_total_count  # Some deterministic failed
        )
        
        judge_result = None
        if use_llm_judge and self.llm_client:
            judge_result = self._llm_judge(eval_case, model_output, results)
        
        return {
            "eval_id": eval_case.id,
            "eval_name": eval_case.name,
            "category": eval_case.category,
            "model_output": model_output,
            "assertion_results": [
                {
                    "assertion": result.assertion.dict(),
                    "passed": result.passed,
                    "confidence": result.confidence,
                    "reason": result.reason
                }
                for result in results
            ],
            "total_weighted_score": total_weighted_score,
            "total_possible_score": total_possible_score,
            "pass_rate": pass_rate,
            "judge_result": judge_result.dict() if judge_result else None,
            "final_passed": judge_result.passed if judge_result and judge_result.confidence >= 0.8 else pass_rate >= 0.5
        }
    
    def _evaluate_assertion(self, assertion: EvalAssertion, model_output: str) -> AssertionResult:
        """Evaluate a single assertion against model output."""
        if assertion.type == "contains":
            passed = assertion.value.lower() in model_output.lower()
            confidence = 1.0
            reason = f"'{assertion.value}' {'found' if passed else 'not found'} in output"
        elif assertion.type == "not_contains":
            passed = assertion.value.lower() not in model_output.lower()
            confidence = 1.0
            reason = f"'{assertion.value}' {'not found' if passed else 'found'} in output"
        elif assertion.type == "regex":
            try:
                pattern = re.compile(assertion.value)
                match = pattern.search(model_output)
                passed = bool(match)
                confidence = 1.0
                reason = f"Regex '{assertion.value}' {'matched' if passed else 'did not match'} output"
            except re.error:
                passed = False
                confidence = 0.0
                reason = f"Invalid regex pattern: {assertion.value}"
        elif assertion.type == "starts_with":
            passed = model_output.startswith(assertion.value)
            confidence = 1.0
            reason = f"Output {'starts with' if passed else 'does not start with'} '{assertion.value}'"
        elif assertion.type == "json_valid":
            try:
                json.loads(model_output)
                passed = True
                confidence = 1.0
                reason = "Output is valid JSON"
            except json.JSONDecodeError:
                passed = False
                confidence = 1.0
                reason = "Output is not valid JSON"
        else:
            # Unknown assertion type - treat as failed with low confidence
            passed = False
            confidence = 0.0
            reason = f"Unknown assertion type: {assertion.type}"
        
        return AssertionResult(
            assertion=assertion,
            passed=passed,
            confidence=confidence,
            reason=reason
        )
    
    def _get_weight_multiplier(self, weight: int) -> int:
        """Convert weight to multiplier: 1=Normal=1, 2=Important=2, 3=Critical=3."""
        return max(1, min(3, weight))  # Clamp between 1 and 3
    
    def _llm_judge(self, eval_case: EvalCase, model_output: str, assertion_results: List[AssertionResult]) -> Optional[JudgeResult]:
        """Use LLM as judge for complex behavior evaluation."""
        # Mock implementation - in real scenario, this would call an LLM
        # For now, return a mock result based on assertion results
        passed_assertions = sum(1 for r in assertion_results if r.passed)
        total_assertions = len(assertion_results)
        
        if total_assertions == 0:
            return JudgeResult(
                passed=False,
                confidence=0.0,
                reasoning="No assertions to evaluate"
            )
        
        # Calculate confidence based on assertion results
        passed_ratio = passed_assertions / total_assertions
        confidence = passed_ratio  # Simplified confidence calculation
        
        # If confidence is low, we might want a secondary judge
        if confidence < 0.8 and self.llm_client:
            # In a real implementation, we'd call a secondary judge here
            # For now, just return the initial result
            pass
        
        return JudgeResult(
            passed=passed_ratio >= 0.5,
            confidence=confidence,
            reasoning=f"LLM evaluation: {passed_assertions}/{total_assertions} assertions passed ({passed_ratio:.2f})"
        )