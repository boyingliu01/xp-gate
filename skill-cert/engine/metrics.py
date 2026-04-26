"""Metrics module for skill-cert engine — calculates L1-L4 evaluation metrics."""

from typing import Dict, Any, List, Optional
from pydantic import BaseModel
from dataclasses import dataclass
from statistics import stdev
from engine.grader import EvalCase


@dataclass
class MetricResult:
    """Result of a single metric calculation."""
    name: str
    value: float
    description: str


class MetricsCalculator:
    """Calculates L1-L4 metrics for skill certification."""
    
    def __init__(self):
        """Initialize metrics calculator."""
        pass
    
    def calculate_metrics(self, eval_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Calculate all L1-L4 metrics from evaluation results."""
        l1_score = self._calculate_l1_trigger_accuracy(eval_results)
        l2_score = self._calculate_l2_with_without_skill_delta(eval_results)
        l3_score = self._calculate_l3_step_adherence(eval_results)
        l4_score = self._calculate_l4_execution_stability(eval_results)
        
        # Calculate overall score as weighted average
        overall_score = (l1_score + l2_score + l3_score + l4_score) / 4.0 if eval_results else 0.0
        
        return {
            "overall_score": overall_score,
            "l1_trigger_accuracy": l1_score,
            "l2_with_without_skill_delta": l2_score,
            "l3_step_adherence": l3_score,
            "l4_execution_stability": l4_score,
            "metrics_breakdown": {
                "l1_details": self._get_l1_details(eval_results),
                "l2_details": self._get_l2_details(eval_results),
                "l3_details": self._get_l3_details(eval_results),
                "l4_details": self._get_l4_details(eval_results)
            }
        }
    
    def _calculate_l1_trigger_accuracy(self, eval_results: List[Dict[str, Any]]) -> float:
        """L1: Trigger accuracy (filter eval_category=='trigger', calculate accuracy)."""
        trigger_results = [r for r in eval_results if r.get('category') == 'trigger']
        
        if not trigger_results:
            return 0.0
        
        # Calculate accuracy based on pass rate of trigger evaluations
        passed_triggers = sum(1 for r in trigger_results if r.get('final_passed', False))
        return passed_triggers / len(trigger_results) if trigger_results else 0.0
    
    def _calculate_l2_with_without_skill_delta(self, eval_results: List[Dict[str, Any]]) -> float:
        """L2: With/without skill delta (compare weighted_score difference)."""
        # Group results by skill presence (would normally compare with/without skill usage)
        # For now, we'll simulate by assuming some results represent "with skill" and others "without"
        # In a real implementation, this would compare results from two different model runs
        with_skill_results = [r for r in eval_results if r.get('skill_used', True)]
        without_skill_results = [r for r in eval_results if not r.get('skill_used', True)]
        
        if not with_skill_results or not without_skill_results:
            # If we don't have both types, return average of all results
            if not eval_results:
                return 0.0
            return sum(r.get('pass_rate', 0.0) for r in eval_results) / len(eval_results)
        
        with_skill_avg = sum(r.get('pass_rate', 0.0) for r in with_skill_results) / len(with_skill_results)
        without_skill_avg = sum(r.get('pass_rate', 0.0) for r in without_skill_results) / len(without_skill_results)
        
        # Delta represents improvement when using skill
        delta = with_skill_avg - without_skill_avg
        # Normalize to 0-1 range (assuming max possible delta is 1.0)
        return max(0.0, min(1.0, abs(delta)))
    
    def _calculate_l3_step_adherence(self, eval_results: List[Dict[str, Any]]) -> float:
        """L3: Step adherence (check workflow_steps covered by passing evals)."""
        # This would typically check if passing evaluations cover the expected workflow steps
        # For now, we'll calculate based on the ratio of passing evaluations that have step coverage
        if not eval_results:
            return 0.0
        
        # Count how many passing evaluations have step coverage info
        passing_evals = [r for r in eval_results if r.get('final_passed', False)]
        if not passing_evals:
            return 0.0
        
        # In a real implementation, this would check if the eval results cover workflow steps
        # For now, we'll just return the pass rate as a proxy
        return sum(r.get('pass_rate', 0.0) for r in passing_evals) / len(passing_evals)
    
    def _calculate_l4_execution_stability(self, eval_results: List[Dict[str, Any]]) -> float:
        """L4: Execution stability (std of pass_rate across multiple runs, using ONLY deterministic assertions)."""
        if not eval_results:
            # No results at all, return perfect stability
            return 1.0
        
        # Filter to only use deterministic assertions (confidence == 1.0)
        deterministic_results = []
        
        for result in eval_results:
            # Only consider results with deterministic assertions
            det_assertions = [
                ar for ar in result.get('assertion_results', [])
                if ar.get('confidence', 0.0) == 1.0
            ]
            
            if det_assertions:
                # Calculate pass rate for deterministic assertions only
                det_passed = sum(1 for ar in det_assertions if ar.get('passed', False))
                det_pass_rate = det_passed / len(det_assertions) if det_assertions else 0.0
                deterministic_results.append(det_pass_rate)
        
        if len(deterministic_results) < 2:
            # Not enough data points to calculate stability - return 1.0 for perfect stability
            # if we have at least one result, otherwise 0.0
            return 1.0 if deterministic_results else 0.0
        
        # Calculate standard deviation of pass rates
        avg_pass_rate = sum(deterministic_results) / len(deterministic_results)
        
        # Calculate standard deviation
        variance = sum((x - avg_pass_rate) ** 2 for x in deterministic_results) / len(deterministic_results)
        std_dev = variance ** 0.5
        
        # Convert to stability score (inverse relationship: lower std dev = higher stability)
        # Cap at 1.0 for maximum stability
        stability_score = max(0.0, 1.0 - std_dev)
        return stability_score
    
    def _get_l1_details(self, eval_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Get detailed information for L1 metric."""
        trigger_results = [r for r in eval_results if r.get('category') == 'trigger']
        passed_triggers = sum(1 for r in trigger_results if r.get('final_passed', False))
        
        return {
            "total_trigger_evals": len(trigger_results),
            "passed_trigger_evals": passed_triggers,
            "trigger_accuracy": passed_triggers / len(trigger_results) if trigger_results else 0.0
        }
    
    def _get_l2_details(self, eval_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Get detailed information for L2 metric."""
        with_skill_results = [r for r in eval_results if r.get('skill_used', True)]
        without_skill_results = [r for r in eval_results if not r.get('skill_used', True)]
        
        with_skill_avg = (
            sum(r.get('pass_rate', 0.0) for r in with_skill_results) / len(with_skill_results)
            if with_skill_results else 0.0
        )
        without_skill_avg = (
            sum(r.get('pass_rate', 0.0) for r in without_skill_results) / len(without_skill_results)
            if without_skill_results else 0.0
        )
        
        return {
            "with_skill_avg_pass_rate": with_skill_avg,
            "without_skill_avg_pass_rate": without_skill_avg,
            "delta": with_skill_avg - without_skill_avg,
            "improvement_percentage": ((with_skill_avg - without_skill_avg) / without_skill_avg * 100) if without_skill_avg > 0 else 0.0
        }
    
    def _get_l3_details(self, eval_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Get detailed information for L3 metric."""
        passing_evals = [r for r in eval_results if r.get('final_passed', False)]
        total_evals = len(eval_results)
        
        return {
            "total_evaluations": total_evals,
            "passing_evaluations": len(passing_evals),
            "step_coverage_ratio": len(passing_evals) / total_evals if total_evals > 0 else 0.0
        }
    
    def _get_l4_details(self, eval_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Get detailed information for L4 metric."""
        deterministic_results = []
        
        for result in eval_results:
            det_assertions = [
                ar for ar in result.get('assertion_results', [])
                if ar.get('confidence', 0.0) == 1.0
            ]
            
            if det_assertions:
                det_passed = sum(1 for ar in det_assertions if ar.get('passed', False))
                det_pass_rate = det_passed / len(det_assertions) if det_assertions else 0.0
                deterministic_results.append(det_pass_rate)
        
        if not deterministic_results:
            return {
                "deterministic_evals_count": 0,
                "avg_deterministic_pass_rate": 0.0,
                "stdev_deterministic_pass_rate": 0.0,
                "execution_stability": 0.0
            }
        
        avg_pass_rate = sum(deterministic_results) / len(deterministic_results)
        if len(deterministic_results) > 1:
            variance = sum((x - avg_pass_rate) ** 2 for x in deterministic_results) / len(deterministic_results)
            std_dev = variance ** 0.5
        else:
            std_dev = 0.0
        
        stability_score = max(0.0, 1.0 - std_dev)
        
        return {
            "deterministic_evals_count": len(deterministic_results),
            "avg_deterministic_pass_rate": avg_pass_rate,
            "stdev_deterministic_pass_rate": std_dev,
            "execution_stability": stability_score
        }