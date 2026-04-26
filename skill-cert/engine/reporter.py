"""Reporting module for skill-cert engine — generates Markdown and JSON reports."""

from typing import Dict, Any, Tuple, List
from pydantic import BaseModel
from jinja2 import Template, Environment, PackageLoader
import json


class Reporter:
    """Generates Markdown and JSON reports for skill certification results."""
    
    def __init__(self):
        """Initialize reporter with Jinja2 templates."""
        # Define templates inline for simplicity
        self.markdown_template_str = """# Skill Certification Report

## Executive Summary

**Verdict**: {{ verdict }}
**Overall Score**: {{ "%.2f"|format(overall_score * 100) }}%

{{ summary }}

## L1-L4 Metrics

### L1: Trigger Accuracy
- **Score**: {{ "%.2f"|format(l1_score * 100) }}%
- **Details**: {{ l1_details.total_trigger_evals }} trigger evaluations, {{ l1_details.passed_trigger_evals }} passed
- **Accuracy**: {{ "%.2f"|format(l1_details.trigger_accuracy * 100) }}%

### L2: With/Without Skill Delta
- **Score**: {{ "%.2f"|format(l2_score * 100) }}%
- **With Skill Avg**: {{ "%.2f"|format(l2_details.with_skill_avg_pass_rate * 100) }}%
- **Without Skill Avg**: {{ "%.2f"|format(l2_details.without_skill_avg_pass_rate * 100) }}%
- **Improvement**: {{ "%.2f"|format(l2_details.improvement_percentage) }}%

### L3: Step Adherence
- **Score**: {{ "%.2f"|format(l3_score * 100) }}%
- **Coverage**: {{ "%.2f"|format(l3_details.step_coverage_ratio * 100) }}% of evaluations covered expected steps

### L4: Execution Stability
- **Score**: {{ "%.2f"|format(l4_score * 100) }}%
- **Stability**: {{ "%.2f"|format(l4_details.execution_stability * 100) }}%
- **Std Dev**: {{ "%.3f"|format(l4_details.stdev_deterministic_pass_rate) }}

## Drift Analysis

{% if drift_detected %}
### Cross-Model Drift Detected
- **Highest Severity**: {{ highest_severity }}
- **Average Variance**: {{ "%.3f"|format(average_variance) }}
- **Max Variance**: {{ "%.3f"|format(max_variance) }}

#### Model Comparisons
{% for result in drift_results %}
- {{ result.model_a }} vs {{ result.model_b }}: {{ result.severity }} severity (variance: {{ "%.3f"|format(result.variance) }})
{% endfor %}
{% else %}
### No Significant Drift Detected
- All model comparisons show consistent performance
{% endif %}

## Evaluation Coverage

- **Total Evaluations**: {{ total_evaluations }}
- **Pass Rate**: {{ "%.2f"|format(avg_pass_rate * 100) }}%
- **Critical Assertions**: {{ critical_passed }}/{{ critical_total }} passed
- **Important Assertions**: {{ important_passed }}/{{ important_total }} passed
- **Normal Assertions**: {{ normal_passed }}/{{ normal_total }} passed

## Improvement Suggestions

{% for suggestion in suggestions %}
- {{ suggestion }}
{% endfor %}

## Raw Results

For detailed results, see the JSON output.
"""

        self.env = Environment()
        self.markdown_template = self.env.from_string(self.markdown_template_str)
    
    def generate_report(
        self, 
        metrics: Dict[str, Any], 
        drift: Dict[str, Any], 
        config: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Generate Markdown and JSON reports from metrics and drift analysis.
        
        Args:
            metrics: Metrics calculation results from MetricsCalculator
            drift: Drift analysis results from DriftDetector
            config: Configuration parameters
            
        Returns:
            Tuple of (markdown_report, json_report)
        """
        # Prepare data for the template
        overall_score = metrics.get('overall_score', 0.0)
        l1_score = metrics.get('l1_trigger_accuracy', 0.0)
        l2_score = metrics.get('l2_with_without_skill_delta', 0.0)
        l3_score = metrics.get('l3_step_adherence', 0.0)
        l4_score = metrics.get('l4_execution_stability', 0.0)
        
        l1_details = metrics.get('metrics_breakdown', {}).get('l1_details', {})
        l2_details = metrics.get('metrics_breakdown', {}).get('l2_details', {})
        l3_details = metrics.get('metrics_breakdown', {}).get('l3_details', {})
        l4_details = metrics.get('metrics_breakdown', {}).get('l4_details', {})
        
        # Determine verdict based on overall score and drift analysis
        # If drift analysis indicates failure, use that verdict regardless of score
        drift_verdict = drift.get('overall_verdict', 'PASS')
        if drift_verdict == 'FAIL':
            verdict = 'FAIL'
        elif drift_verdict == 'PASS_WITH_CAVEATS' and overall_score < 0.8:
            verdict = 'PASS_WITH_CAVEATS'
        elif overall_score >= 0.8:
            verdict = "PASS"
        elif overall_score >= 0.6:
            verdict = "PASS_WITH_CAVEATS"
        else:
            verdict = "FAIL"
        
        # Prepare drift data
        drift_detected = drift.get('drift_detected', False)
        highest_severity = drift.get('highest_severity', 'none')
        average_variance = drift.get('average_variance', 0.0)
        max_variance = drift.get('max_variance', 0.0)
        drift_results = drift.get('drift_results', [])  # This would come from drift analysis
        
        # Calculate evaluation coverage stats
        total_evaluations = config.get('total_evaluations', 0)
        avg_pass_rate = config.get('avg_pass_rate', 0.0)
        critical_passed = config.get('critical_passed', 0)
        critical_total = config.get('critical_total', 0)
        important_passed = config.get('important_passed', 0)
        important_total = config.get('important_total', 0)
        normal_passed = config.get('normal_passed', 0)
        normal_total = config.get('normal_total', 0)
        
        # Generate improvement suggestions
        suggestions = self._generate_suggestions(
            metrics, drift, verdict, overall_score
        )
        
        # Create summary
        summary = self._create_summary(verdict, overall_score, l1_score, l2_score, l3_score, l4_score)
        
        # Render markdown
        markdown_report = self.markdown_template.render(
            verdict=verdict,
            overall_score=overall_score,
            summary=summary,
            l1_score=l1_score,
            l2_score=l2_score,
            l3_score=l3_score,
            l4_score=l4_score,
            l1_details=l1_details,
            l2_details=l2_details,
            l3_details=l3_details,
            l4_details=l4_details,
            drift_detected=drift_detected,
            highest_severity=highest_severity,
            average_variance=average_variance,
            max_variance=max_variance,
            drift_results=drift_results,
            total_evaluations=total_evaluations,
            avg_pass_rate=avg_pass_rate,
            critical_passed=critical_passed,
            critical_total=critical_total,
            important_passed=important_passed,
            important_total=important_total,
            normal_passed=normal_passed,
            normal_total=normal_total,
            suggestions=suggestions
        )
        
        # Create JSON report
        json_report = {
            "verdict": verdict,
            "overall_score": overall_score,
            "metrics": {
                "l1_trigger_accuracy": l1_score,
                "l2_with_without_skill_delta": l2_score,
                "l3_step_adherence": l3_score,
                "l4_execution_stability": l4_score
            },
            "drift_analysis": drift,
            "evaluation_coverage": {
                "total_evaluations": total_evaluations,
                "avg_pass_rate": avg_pass_rate,
                "assertion_breakdown": {
                    "critical": {"passed": critical_passed, "total": critical_total},
                    "important": {"passed": important_passed, "total": important_total},
                    "normal": {"passed": normal_passed, "total": normal_total}
                }
            },
            "improvement_suggestions": suggestions,
            "timestamp": config.get("timestamp", ""),
            "config": config
        }
        
        return markdown_report, json_report
    
    def _generate_suggestions(
        self, 
        metrics: Dict[str, Any], 
        drift: Dict[str, Any], 
        verdict: str, 
        overall_score: float
    ) -> List[str]:
        """Generate improvement suggestions based on metrics and drift analysis."""
        suggestions = []
        
        # L1 suggestions
        l1_score = metrics.get('l1_trigger_accuracy', 0.0)
        if l1_score < 0.7:
            suggestions.append("Improve trigger accuracy - skill may not be properly detecting trigger conditions")
        
        # L2 suggestions
        l2_score = metrics.get('l2_with_without_skill_delta', 0.0)
        if l2_score < 0.5:
            suggestions.append("Skill may not be providing sufficient value - consider enhancing core functionality")
        
        # L3 suggestions
        l3_score = metrics.get('l3_step_adherence', 0.0)
        if l3_score < 0.7:
            suggestions.append("Improve adherence to expected workflow steps")
        
        # L4 suggestions
        l4_score = metrics.get('l4_execution_stability', 0.0)
        if l4_score < 0.8:
            suggestions.append("Address execution instability - results vary significantly across runs")
        
        # Drift suggestions
        if drift.get('drift_detected', False):
            suggestions.append(f"Address cross-model drift (highest severity: {drift.get('highest_severity', 'none')})")
        
        # Overall suggestions
        if overall_score < 0.6:
            suggestions.append("Major improvements needed across multiple areas")
        elif overall_score < 0.8:
            suggestions.append("Several areas need improvement to reach optimal performance")
        
        if not suggestions:
            suggestions.append("Performance is strong across all metrics")
        
        return suggestions
    
    def _create_summary(self, verdict: str, overall_score: float, l1: float, l2: float, l3: float, l4: float) -> str:
        """Create executive summary based on results."""
        summary_parts = [f"This skill certification resulted in a {verdict} verdict."]
        
        if overall_score >= 0.8:
            summary_parts.append("The skill performs well across all evaluation dimensions.")
        elif overall_score >= 0.6:
            summary_parts.append("The skill shows promise but needs improvements in certain areas.")
        else:
            summary_parts.append("The skill requires significant improvements before certification.")
        
        summary_parts.append(
            f"L1:{l1:.0%}, L2:{l2:.0%}, L3:{l3:.0%}, L4:{l4:.0%}"
        )
        
        return " ".join(summary_parts)