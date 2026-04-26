"""Tests for engine/reporter.py — report generation functionality."""

import pytest
from engine.reporter import Reporter


class TestReporter:
    """Test the Reporter class and its report generation functionality."""
    
    def test_generate_report_basic(self):
        """Test basic report generation."""
        reporter = Reporter()
        
        # Sample metrics data
        metrics = {
            "overall_score": 0.85,
            "l1_trigger_accuracy": 0.90,
            "l2_with_without_skill_delta": 0.75,
            "l3_step_adherence": 0.80,
            "l4_execution_stability": 0.95,
            "metrics_breakdown": {
                "l1_details": {
                    "total_trigger_evals": 10,
                    "passed_trigger_evals": 9,
                    "trigger_accuracy": 0.90
                },
                "l2_details": {
                    "with_skill_avg_pass_rate": 0.85,
                    "without_skill_avg_pass_rate": 0.60,
                    "delta": 0.25,
                    "improvement_percentage": 41.67
                },
                "l3_details": {
                    "total_evaluations": 20,
                    "passing_evaluations": 16,
                    "step_coverage_ratio": 0.80
                },
                "l4_details": {
                    "deterministic_evals_count": 15,
                    "avg_deterministic_pass_rate": 0.90,
                    "stdev_deterministic_pass_rate": 0.05,
                    "execution_stability": 0.95
                }
            }
        }
        
        # Sample drift data
        drift = {
            "drift_detected": False,
            "highest_severity": "none",
            "average_variance": 0.05,
            "max_variance": 0.10,
            "model_pairs_compared": 1,
            "severity_distribution": {"none": 1, "low": 0, "moderate": 0, "high": 0},
            "overall_verdict": "PASS",
            "summary": "No significant drift detected"
        }
        
        # Sample config data
        config = {
            "total_evaluations": 20,
            "avg_pass_rate": 0.85,
            "critical_passed": 8,
            "critical_total": 10,
            "important_passed": 15,
            "important_total": 18,
            "normal_passed": 45,
            "normal_total": 50,
            "timestamp": "2023-10-01T12:00:00Z"
        }
        
        markdown_report, json_report = reporter.generate_report(metrics, drift, config)
        
        # Check that markdown contains expected elements
        assert "# Skill Certification Report" in markdown_report
        assert "**Verdict**: PASS" in markdown_report
        assert "**Overall Score**: 85.00%" in markdown_report
        assert "L1:90%, L2:75%, L3:80%, L4:95%" in markdown_report
        
        # Check that JSON report has expected structure
        assert json_report["verdict"] == "PASS"
        assert json_report["overall_score"] == 0.85
        assert json_report["metrics"]["l1_trigger_accuracy"] == 0.90
        assert json_report["drift_analysis"]["drift_detected"] is False
        assert json_report["evaluation_coverage"]["total_evaluations"] == 20
        assert len(json_report["improvement_suggestions"]) > 0
    
    def test_generate_report_with_drift(self):
        """Test report generation with drift detected."""
        reporter = Reporter()
        
        metrics = {
            "overall_score": 0.60,
            "l1_trigger_accuracy": 0.50,
            "l2_with_without_skill_delta": 0.65,
            "l3_step_adherence": 0.70,
            "l4_execution_stability": 0.55,
            "metrics_breakdown": {
                "l1_details": {"total_trigger_evals": 10, "passed_trigger_evals": 5, "trigger_accuracy": 0.50},
                "l2_details": {"with_skill_avg_pass_rate": 0.70, "without_skill_avg_pass_rate": 0.65, "delta": 0.05, "improvement_percentage": 7.69},
                "l3_details": {"total_evaluations": 20, "passing_evaluations": 14, "step_coverage_ratio": 0.70},
                "l4_details": {"deterministic_evals_count": 10, "avg_deterministic_pass_rate": 0.60, "stdev_deterministic_pass_rate": 0.15, "execution_stability": 0.85}
            }
        }
        
        drift = {
            "drift_detected": True,
            "highest_severity": "high",
            "average_variance": 0.40,
            "max_variance": 0.50,
            "model_pairs_compared": 2,
            "severity_distribution": {"none": 0, "low": 0, "moderate": 1, "high": 1},
            "overall_verdict": "FAIL",
            "summary": "Significant drift detected between models",
            "drift_results": [
                {"model_a": "model_x", "model_b": "model_y", "severity": "moderate", "variance": 0.30},
                {"model_a": "model_x", "model_b": "model_z", "severity": "high", "variance": 0.50}
            ]
        }
        
        config = {
            "total_evaluations": 20,
            "avg_pass_rate": 0.60,
            "critical_passed": 5,
            "critical_total": 10,
            "important_passed": 10,
            "important_total": 15,
            "normal_passed": 30,
            "normal_total": 40,
            "timestamp": "2023-10-01T12:00:00Z"
        }
        
        markdown_report, json_report = reporter.generate_report(metrics, drift, config)
        
        # Check that markdown reflects the lower score and drift detection
        assert "**Verdict**: FAIL" in markdown_report
        assert "Cross-Model Drift Detected" in markdown_report
        assert "**Highest Severity**: high" in markdown_report
        assert "model_x vs model_y" in markdown_report
        assert "model_x vs model_z" in markdown_report
        
        # Check JSON report
        assert json_report["verdict"] == "FAIL"
        assert json_report["drift_analysis"]["drift_detected"] is True
        assert json_report["drift_analysis"]["highest_severity"] == "high"
    
    def test_generate_report_low_score(self):
        """Test report generation with low overall score."""
        reporter = Reporter()
        
        metrics = {
            "overall_score": 0.40,
            "l1_trigger_accuracy": 0.30,
            "l2_with_without_skill_delta": 0.45,
            "l3_step_adherence": 0.35,
            "l4_execution_stability": 0.50,
            "metrics_breakdown": {
                "l1_details": {"total_trigger_evals": 10, "passed_trigger_evals": 3, "trigger_accuracy": 0.30},
                "l2_details": {"with_skill_avg_pass_rate": 0.50, "without_skill_avg_pass_rate": 0.45, "delta": 0.05, "improvement_percentage": 11.11},
                "l3_details": {"total_evaluations": 20, "passing_evaluations": 7, "step_coverage_ratio": 0.35},
                "l4_details": {"deterministic_evals_count": 8, "avg_deterministic_pass_rate": 0.45, "stdev_deterministic_pass_rate": 0.20, "execution_stability": 0.80}
            }
        }
        
        drift = {
            "drift_detected": False,
            "highest_severity": "none",
            "average_variance": 0.02,
            "max_variance": 0.05,
            "model_pairs_compared": 1,
            "severity_distribution": {"none": 1, "low": 0, "moderate": 0, "high": 0},
            "overall_verdict": "PASS",
            "summary": "No significant drift detected"
        }
        
        config = {
            "total_evaluations": 20,
            "avg_pass_rate": 0.40,
            "critical_passed": 2,
            "critical_total": 10,
            "important_passed": 6,
            "important_total": 15,
            "normal_passed": 20,
            "normal_total": 35,
            "timestamp": "2023-10-01T12:00:00Z"
        }
        
        markdown_report, json_report = reporter.generate_report(metrics, drift, config)
        
        # Check that markdown reflects the low score
        assert "**Verdict**: FAIL" in markdown_report  # Score < 0.6 should result in FAIL
        assert "Major improvements needed across multiple areas" in markdown_report
        assert "The skill requires significant improvements before certification" in markdown_report
    
    def test_generate_report_medium_score(self):
        """Test report generation with medium overall score."""
        reporter = Reporter()
        
        metrics = {
            "overall_score": 0.70,
            "l1_trigger_accuracy": 0.65,
            "l2_with_without_skill_delta": 0.75,
            "l3_step_adherence": 0.70,
            "l4_execution_stability": 0.70,
            "metrics_breakdown": {
                "l1_details": {"total_trigger_evals": 10, "passed_trigger_evals": 6, "trigger_accuracy": 0.65},
                "l2_details": {"with_skill_avg_pass_rate": 0.80, "without_skill_avg_pass_rate": 0.75, "delta": 0.05, "improvement_percentage": 6.67},
                "l3_details": {"total_evaluations": 20, "passing_evaluations": 14, "step_coverage_ratio": 0.70},
                "l4_details": {"deterministic_evals_count": 12, "avg_deterministic_pass_rate": 0.75, "stdev_deterministic_pass_rate": 0.10, "execution_stability": 0.90}
            }
        }
        
        drift = {
            "drift_detected": False,
            "highest_severity": "none",
            "average_variance": 0.03,
            "max_variance": 0.06,
            "model_pairs_compared": 1,
            "severity_distribution": {"none": 1, "low": 0, "moderate": 0, "high": 0},
            "overall_verdict": "PASS",
            "summary": "No significant drift detected"
        }
        
        config = {
            "total_evaluations": 20,
            "avg_pass_rate": 0.70,
            "critical_passed": 6,
            "critical_total": 10,
            "important_passed": 12,
            "important_total": 15,
            "normal_passed": 25,
            "normal_total": 30,
            "timestamp": "2023-10-01T12:00:00Z"
        }
        
        markdown_report, json_report = reporter.generate_report(metrics, drift, config)
        
        # Check that markdown reflects the medium score
        assert "**Verdict**: PASS_WITH_CAVEATS" in markdown_report  # 0.6 <= score < 0.8
        assert "Several areas need improvement to reach optimal performance" in markdown_report
        assert "skill shows promise but needs improvements" in markdown_report
    
    def test_generate_suggestions(self):
        """Test improvement suggestion generation."""
        reporter = Reporter()
        
        metrics = {
            "l1_trigger_accuracy": 0.5,
            "l2_with_without_skill_delta": 0.4,
            "l3_step_adherence": 0.6,
            "l4_execution_stability": 0.7
        }
        
        drift = {"drift_detected": True, "highest_severity": "moderate"}
        
        suggestions = reporter._generate_suggestions(metrics, drift, "PASS_WITH_CAVEATS", 0.65)
        
        # Check that appropriate suggestions are generated
        assert any("trigger accuracy" in s.lower() for s in suggestions)
        assert any("skill may not be providing sufficient value" in s.lower() for s in suggestions)
        assert any("address cross-model drift" in s.lower() for s in suggestions)
    
    def test_create_summary(self):
        """Test executive summary creation."""
        reporter = Reporter()
        
        summary = reporter._create_summary("PASS", 0.85, 0.9, 0.8, 0.85, 0.85)
        assert "PASS" in summary
        assert "L1:90%, L2:80%, L3:85%, L4:85%" in summary
        assert "performs well" in summary.lower()
        
        summary_low = reporter._create_summary("FAIL", 0.4, 0.3, 0.4, 0.5, 0.4)
        assert "FAIL" in summary_low
        assert "requires significant improvements" in summary_low.lower()