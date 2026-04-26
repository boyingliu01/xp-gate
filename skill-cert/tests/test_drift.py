"""Tests for engine/drift.py — cross-model drift detection."""

import pytest
from engine.drift import DriftDetector, DriftResult
from engine.grader import Grader, EvalCase, EvalAssertion


class MockModelAdapter:
    """Mock model adapter for testing."""
    
    def __init__(self, responses):
        self.responses = responses
        self.call_count = 0
    
    def generate(self, prompt):
        """Return predefined response based on prompt."""
        # Simple mapping for testing
        if "hello" in prompt.lower():
            return self.responses.get("hello", "Hello response")
        elif "goodbye" in prompt.lower():
            return self.responses.get("goodbye", "Goodbye response")
        else:
            return self.responses.get("default", "Default response")


class TestDriftDetector:
    """Test the DriftDetector class and its drift detection functionality."""
    
    def test_detect_drift_basic(self):
        """Test basic drift detection between two models."""
        detector = DriftDetector()
        grader = Grader()
        
        # Create eval cases
        eval_cases = [
            EvalCase(
                id=1,
                name="hello_test",
                category="normal",
                prompt="Say hello",
                assertions=[EvalAssertion(name="contains_hello", type="contains", value="hello", weight=1)]
            ),
            EvalCase(
                id=2,
                name="goodbye_test",
                category="normal",
                prompt="Say goodbye",
                assertions=[EvalAssertion(name="contains_goodbye", type="contains", value="goodbye", weight=1)]
            )
        ]
        
        # Create mock model adapters with different responses
        model_adapters = {
            "model_a": MockModelAdapter({"hello": "Hello there!", "goodbye": "Goodbye!"}),
            "model_b": MockModelAdapter({"hello": "Hi there!", "goodbye": "Bye!"})
        }
        
        # Detect drift
        results = detector.detect_drift(eval_cases, model_adapters, grader)
        
        assert len(results) == 1  # Only one pair: model_a vs model_b
        result = results[0]
        
        assert result.model_a == "model_a"
        assert result.model_b == "model_b"
        assert isinstance(result.pass_rate_a, float)
        assert isinstance(result.pass_rate_b, float)
        assert isinstance(result.variance, float)
        assert result.severity in ["none", "low", "moderate", "high"]
        assert result.verdict in ["PASS", "PASS_WITH_CAVEATS", "FAIL"]
    
    def test_detect_drift_no_variance(self):
        """Test drift detection when models have identical performance."""
        detector = DriftDetector()
        grader = Grader()
        
        eval_cases = [
            EvalCase(
                id=1,
                name="identical_test",
                category="normal",
                prompt="Say hello",
                assertions=[EvalAssertion(name="contains_hello", type="contains", value="hello", weight=1)]
            )
        ]
        
        # Both models give identical responses
        model_adapters = {
            "model_a": MockModelAdapter({"hello": "Hello world"}),
            "model_b": MockModelAdapter({"hello": "Hello world"})
        }
        
        results = detector.detect_drift(eval_cases, model_adapters, grader)
        
        assert len(results) == 1
        result = results[0]
        
        # Since both models have identical responses, pass rates should be the same
        assert result.pass_rate_a == result.pass_rate_b
        assert result.variance == 0.0
        assert result.severity == "none"
        assert result.verdict == "PASS"
    
    def test_detect_drift_high_variance(self):
        """Test drift detection when models have very different performance."""
        detector = DriftDetector()
        grader = Grader()
        
        eval_cases = [
            EvalCase(
                id=1,
                name="different_test",
                category="normal",
                prompt="Say hello",
                assertions=[EvalAssertion(name="contains_hello", type="contains", value="hello", weight=1)]
            )
        ]
        
        # Models have very different responses
        model_adapters = {
            "model_a": MockModelAdapter({"hello": "Hello world"}),  # Will pass
            "model_b": MockModelAdapter({"hello": "Goodbye world"})  # Will fail
        }
        
        results = detector.detect_drift(eval_cases, model_adapters, grader)
        
        assert len(results) == 1
        result = results[0]
        
        # Model A should pass, Model B should fail
        assert result.pass_rate_a == 1.0
        assert result.pass_rate_b == 0.0
        assert result.variance == 1.0  # Maximum variance
        assert result.severity == "high"  # High variance should result in high severity
        assert result.verdict == "FAIL"  # High severity should result in FAIL verdict
    
    def test_determine_severity_thresholds(self):
        """Test severity determination based on variance thresholds."""
        detector = DriftDetector()
        
        # Test each threshold
        assert detector._determine_severity(0.05) == "none"  # <= 0.10
        assert detector._determine_severity(0.10) == "none"  # <= 0.10
        assert detector._determine_severity(0.15) == "low"   # <= 0.20
        assert detector._determine_severity(0.20) == "low"   # <= 0.20
        assert detector._determine_severity(0.25) == "moderate"  # <= 0.35
        assert detector._determine_severity(0.30) == "moderate"  # <= 0.35
        assert detector._determine_severity(0.35) == "moderate"  # <= 0.35
        assert detector._determine_severity(0.40) == "high"  # > 0.35
        assert detector._determine_severity(0.50) == "high"  # > 0.35
    
    def test_map_verdict(self):
        """Test verdict mapping based on severity."""
        detector = DriftDetector()
        
        # Test verdict mapping
        assert detector._map_verdict("none") == "PASS"
        assert detector._map_verdict("low") == "PASS"
        assert detector._map_verdict("moderate") == "PASS_WITH_CAVEATS"
        assert detector._map_verdict("high") == "FAIL"
    
    def test_aggregate_drift_report_empty(self):
        """Test aggregate drift report with no results."""
        detector = DriftDetector()
        
        report = detector.aggregate_drift_report([])
        
        assert report["drift_detected"] is False
        assert report["highest_severity"] == "none"
        assert report["average_variance"] == 0.0
        assert report["model_pairs_compared"] == 0
        assert "No drift analysis performed" in report["summary"]
    
    def test_aggregate_drift_report_single_result(self):
        """Test aggregate drift report with single result."""
        detector = DriftDetector()
        
        results = [
            DriftResult(
                model_a="model_a",
                model_b="model_b",
                pass_rate_a=0.8,
                pass_rate_b=0.6,
                variance=0.2,
                severity="low",
                verdict="PASS"
            )
        ]
        
        report = detector.aggregate_drift_report(results)
        
        assert report["drift_detected"] is False  # Low severity doesn't count as detected
        assert report["highest_severity"] == "low"
        assert report["average_variance"] == 0.2
        assert report["max_variance"] == 0.2
        assert report["model_pairs_compared"] == 1
        assert report["severity_distribution"]["low"] == 1
        assert report["overall_verdict"] == "PASS"
    
    def test_aggregate_drift_report_multiple_results(self):
        """Test aggregate drift report with multiple results."""
        detector = DriftDetector()
        
        results = [
            DriftResult(
                model_a="model_a",
                model_b="model_b",
                pass_rate_a=0.8,
                pass_rate_b=0.6,
                variance=0.2,
                severity="low",
                verdict="PASS"
            ),
            DriftResult(
                model_a="model_a",
                model_b="model_c",
                pass_rate_a=0.8,
                pass_rate_b=0.3,
                variance=0.5,
                severity="high",
                verdict="FAIL"
            )
        ]
        
        report = detector.aggregate_drift_report(results)
        
        assert report["drift_detected"] is True  # High severity detected
        assert report["highest_severity"] == "high"
        assert report["average_variance"] == 0.35  # (0.2 + 0.5) / 2
        assert report["max_variance"] == 0.5
        assert report["model_pairs_compared"] == 2
        assert report["severity_distribution"]["low"] == 1
        assert report["severity_distribution"]["high"] == 1
        assert report["overall_verdict"] == "FAIL"  # At least one FAIL results in overall FAIL
    
    def test_get_highest_severity(self):
        """Test getting highest severity from multiple results."""
        detector = DriftDetector()
        
        results = [
            DriftResult(
                model_a="a", model_b="b", pass_rate_a=0.5, pass_rate_b=0.5,
                variance=0.0, severity="none", verdict="PASS"
            ),
            DriftResult(
                model_a="a", model_b="c", pass_rate_a=0.5, pass_rate_b=0.5,
                variance=0.15, severity="low", verdict="PASS"
            ),
            DriftResult(
                model_a="a", model_b="d", pass_rate_a=0.5, pass_rate_b=0.5,
                variance=0.3, severity="moderate", verdict="PASS_WITH_CAVEATS"
            ),
            DriftResult(
                model_a="a", model_b="e", pass_rate_a=0.5, pass_rate_b=0.5,
                variance=0.4, severity="high", verdict="FAIL"
            )
        ]
        
        highest = detector._get_highest_severity(results)
        
        assert highest == "high"
    
    def test_aggregate_verdict(self):
        """Test aggregating verdicts from multiple comparisons."""
        detector = DriftDetector()
        
        # Test with all PASS
        results_all_pass = [
            DriftResult(model_a="a", model_b="b", pass_rate_a=0.5, pass_rate_b=0.5, variance=0.05, severity="none", verdict="PASS"),
            DriftResult(model_a="a", model_b="c", pass_rate_a=0.5, pass_rate_b=0.5, variance=0.08, severity="none", verdict="PASS")
        ]
        assert detector._aggregate_verdict(results_all_pass) == "PASS"
        
        # Test with one PASS_WITH_CAVEATS
        results_with_caveats = [
            DriftResult(model_a="a", model_b="b", pass_rate_a=0.5, pass_rate_b=0.5, variance=0.05, severity="none", verdict="PASS"),
            DriftResult(model_a="a", model_b="c", pass_rate_a=0.5, pass_rate_b=0.5, variance=0.25, severity="moderate", verdict="PASS_WITH_CAVEATS")
        ]
        assert detector._aggregate_verdict(results_with_caveats) == "PASS_WITH_CAVEATS"
        
        # Test with one FAIL
        results_with_fail = [
            DriftResult(model_a="a", model_b="b", pass_rate_a=0.5, pass_rate_b=0.5, variance=0.05, severity="none", verdict="PASS"),
            DriftResult(model_a="a", model_b="c", pass_rate_a=0.5, pass_rate_b=0.5, variance=0.4, severity="high", verdict="FAIL")
        ]
        assert detector._aggregate_verdict(results_with_fail) == "FAIL"