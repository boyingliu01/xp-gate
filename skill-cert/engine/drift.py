"""Drift detection module for skill-cert engine — detects cross-model performance variations."""

from typing import Dict, Any, List, Optional
from pydantic import BaseModel
from dataclasses import dataclass
from engine.grader import EvalCase, Grader


@dataclass
class DriftResult:
    """Result of drift detection analysis."""
    model_a: str
    model_b: str
    pass_rate_a: float
    pass_rate_b: float
    variance: float
    severity: str  # none, low, moderate, high
    verdict: str  # PASS, PASS_WITH_CAVEATS, FAIL


class DriftDetector:
    """Detects cross-model drift in skill certification results."""
    
    def __init__(self):
        """Initialize drift detector."""
        pass
    
    def detect_drift(
        self, 
        eval_cases: List[EvalCase], 
        model_adapters: Dict[str, Any],
        grader: Grader
    ) -> List[DriftResult]:
        """
        Run same evals across multiple models and detect drift.
        
        Args:
            eval_cases: List of evaluation cases to run
            model_adapters: Dictionary mapping model names to adapter objects
            grader: Grader instance to evaluate outputs
            
        Returns:
            List of drift results comparing model pairs
        """
        results = []
        model_names = list(model_adapters.keys())
        
        # Run evaluations for each model
        model_eval_results = {}
        for model_name in model_names:
            adapter = model_adapters[model_name]
            eval_results = []
            
            for eval_case in eval_cases:
                # Get model output using the adapter
                model_output = adapter.generate(eval_case.prompt)
                
                # Grade the output
                grade_result = grader.grade_output(eval_case, model_output)
                eval_results.append(grade_result)
            
            # Calculate pass rate for this model
            if eval_results:
                total_pass_rate = sum(r['pass_rate'] for r in eval_results) / len(eval_results)
            else:
                total_pass_rate = 0.0
                
            model_eval_results[model_name] = {
                'results': eval_results,
                'pass_rate': total_pass_rate
            }
        
        # Compare pass rates between all pairs of models
        for i in range(len(model_names)):
            for j in range(i + 1, len(model_names)):
                model_a = model_names[i]
                model_b = model_names[j]
                
                pass_rate_a = model_eval_results[model_a]['pass_rate']
                pass_rate_b = model_eval_results[model_b]['pass_rate']
                
                # Calculate variance (absolute difference)
                variance = abs(pass_rate_a - pass_rate_b)
                
                # Determine severity based on thresholds
                severity = self._determine_severity(variance)
                
                # Map severity to verdict
                verdict = self._map_verdict(severity)
                
                drift_result = DriftResult(
                    model_a=model_a,
                    model_b=model_b,
                    pass_rate_a=pass_rate_a,
                    pass_rate_b=pass_rate_b,
                    variance=variance,
                    severity=severity,
                    verdict=verdict
                )
                
                results.append(drift_result)
        
        return results
    
    def _determine_severity(self, variance: float) -> str:
        """Determine drift severity based on variance thresholds."""
        if variance <= 0.10:
            return "none"
        elif variance <= 0.20:
            return "low"
        elif variance <= 0.35:
            return "moderate"
        else:
            return "high"
    
    def _map_verdict(self, severity: str) -> str:
        """Map severity level to verdict."""
        if severity in ["none", "low"]:
            return "PASS"
        elif severity == "moderate":
            return "PASS_WITH_CAVEATS"
        else:  # high
            return "FAIL"
    
    def aggregate_drift_report(self, drift_results: List[DriftResult]) -> Dict[str, Any]:
        """Generate aggregated drift report from individual results."""
        if not drift_results:
            return {
                "drift_detected": False,
                "highest_severity": "none",
                "average_variance": 0.0,
                "model_pairs_compared": 0,
                "summary": "No drift analysis performed"
            }
        
        # Calculate aggregate metrics
        highest_severity = self._get_highest_severity(drift_results)
        avg_variance = sum(r.variance for r in drift_results) / len(drift_results)
        max_variance = max(r.variance for r in drift_results)
        
        # Count severity levels
        severity_counts = {
            "none": sum(1 for r in drift_results if r.severity == "none"),
            "low": sum(1 for r in drift_results if r.severity == "low"),
            "moderate": sum(1 for r in drift_results if r.severity == "moderate"),
            "high": sum(1 for r in drift_results if r.severity == "high")
        }
        
        # Determine overall verdict
        overall_verdict = self._aggregate_verdict(drift_results)
        
        # Drift is considered detected if there's any moderate or high severity
        drift_detected = highest_severity in ["moderate", "high"]
        
        return {
            "drift_detected": drift_detected,
            "highest_severity": highest_severity,
            "average_variance": avg_variance,
            "max_variance": max_variance,
            "model_pairs_compared": len(drift_results),
            "severity_distribution": severity_counts,
            "overall_verdict": overall_verdict,
            "summary": f"Drift analysis completed. Highest severity: {highest_severity}. Average variance: {avg_variance:.3f}"
        }
    
    def _get_highest_severity(self, drift_results: List[DriftResult]) -> str:
        """Get the highest severity level from a list of drift results."""
        severity_order = {"none": 0, "low": 1, "moderate": 2, "high": 3}
        return max(drift_results, key=lambda r: severity_order[r.severity]).severity
    
    def _aggregate_verdict(self, drift_results: List[DriftResult]) -> str:
        """Aggregate verdicts from all comparisons."""
        # If any comparison resulted in FAIL, overall verdict is FAIL
        if any(r.verdict == "FAIL" for r in drift_results):
            return "FAIL"
        # If any comparison resulted in PASS_WITH_CAVEATS, overall verdict is PASS_WITH_CAVEATS
        elif any(r.verdict == "PASS_WITH_CAVEATS" for r in drift_results):
            return "PASS_WITH_CAVEATS"
        else:
            return "PASS"