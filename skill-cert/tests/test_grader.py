"""Tests for engine/grader.py — evaluation grading functionality."""

import pytest
from engine.grader import Grader, EvalCase, EvalAssertion, JudgeResult


class TestGrader:
    """Test the Grader class and its grading functionality."""
    
    def test_grade_output_basic(self):
        """Test basic grading of a model output."""
        grader = Grader()
        
        eval_case = EvalCase(
            id=1,
            name="test_case",
            category="normal",
            prompt="Say hello",
            expected_output="Hello world",
            assertions=[
                EvalAssertion(name="contains_hello", type="contains", value="hello", weight=1),
                EvalAssertion(name="not_contains_bad", type="not_contains", value="bad", weight=2)
            ]
        )
        
        model_output = "Hello world, this is good"
        result = grader.grade_output(eval_case, model_output)
        
        assert result["eval_id"] == 1
        assert result["eval_name"] == "test_case"
        assert result["category"] == "normal"
        assert result["model_output"] == "Hello world, this is good"
        assert result["total_weighted_score"] == 3  # Both assertions pass (1*1 + 1*2)
        assert result["total_possible_score"] == 3  # Both assertions have weights 1+2
        assert result["pass_rate"] == 1.0
        assert result["final_passed"] is True
    
    def test_grade_output_with_failures(self):
        """Test grading when some assertions fail."""
        grader = Grader()
        
        eval_case = EvalCase(
            id=2,
            name="test_case_failure",
            category="normal",
            prompt="Say goodbye",
            expected_output="Goodbye",
            assertions=[
                EvalAssertion(name="contains_goodbye", type="contains", value="Goodbye", weight=1),
                EvalAssertion(name="contains_hello", type="contains", value="helloXXX", weight=2)  # Use term that won't match
            ]
        )
        
        model_output = "Goodbye, but no helloXX"
        result = grader.grade_output(eval_case, model_output)
        
        assert result["total_weighted_score"] == 1  # Only first assertion passes (1*1)
        assert result["total_possible_score"] == 3  # Both assertions have weights 1+2
        assert result["pass_rate"] == 1/3
        assert result["final_passed"] is False  # Less than 50% pass rate
    
    def test_grade_output_regex_assertion(self):
        """Test grading with regex assertion."""
        grader = Grader()
        
        eval_case = EvalCase(
            id=3,
            name="regex_test",
            category="normal",
            prompt="Provide a phone number",
            expected_output="(123) 456-7890",
            assertions=[
                EvalAssertion(name="phone_pattern", type="regex", value=r"\(\d{3}\) \d{3}-\d{4}", weight=1)
            ]
        )
        
        model_output = "Call me at (123) 456-7890"
        result = grader.grade_output(eval_case, model_output)
        
        assert result["total_weighted_score"] == 1
        assert result["total_possible_score"] == 1
        assert result["pass_rate"] == 1.0
        assert result["final_passed"] is True
    
    def test_grade_output_json_valid_assertion(self):
        """Test grading with JSON validation assertion."""
        grader = Grader()
        
        eval_case = EvalCase(
            id=4,
            name="json_test",
            category="normal",
            prompt="Provide JSON data",
            expected_output='{"name": "test", "value": 123}',
            assertions=[
                EvalAssertion(name="valid_json", type="json_valid", value="", weight=1)
            ]
        )
        
        model_output = '{"name": "test", "value": 123}'
        result = grader.grade_output(eval_case, model_output)
        
        assert result["total_weighted_score"] == 1
        assert result["total_possible_score"] == 1
        assert result["pass_rate"] == 1.0
        assert result["final_passed"] is True
    
    def test_grade_output_invalid_json(self):
        """Test grading with invalid JSON."""
        grader = Grader()
        
        eval_case = EvalCase(
            id=5,
            name="invalid_json_test",
            category="normal",
            prompt="Provide JSON data",
            expected_output='{"name": "test", "value": 123}',
            assertions=[
                EvalAssertion(name="valid_json", type="json_valid", value="", weight=1)
            ]
        )
        
        model_output = '{"name": "test", "value": 123'  # Invalid JSON
        result = grader.grade_output(eval_case, model_output)
        
        assert result["total_weighted_score"] == 0
        assert result["total_possible_score"] == 1
        assert result["pass_rate"] == 0.0
        assert result["final_passed"] is False
    
    def test_grade_output_starts_with_assertion(self):
        """Test grading with starts_with assertion."""
        grader = Grader()
        
        eval_case = EvalCase(
            id=6,
            name="starts_with_test",
            category="normal",
            prompt="Start with greeting",
            expected_output="Hello there",
            assertions=[
                EvalAssertion(name="starts_with_hello", type="starts_with", value="Hello", weight=1)
            ]
        )
        
        model_output = "Hello there, nice to meet you"
        result = grader.grade_output(eval_case, model_output)
        
        assert result["total_weighted_score"] == 1
        assert result["total_possible_score"] == 1
        assert result["pass_rate"] == 1.0
        assert result["final_passed"] is True
    
    def test_grade_output_not_contains_assertion(self):
        """Test grading with not_contains assertion."""
        grader = Grader()
        
        eval_case = EvalCase(
            id=7,
            name="not_contains_test",
            category="normal",
            prompt="Don't mention bad words",
            expected_output="Good content",
            assertions=[
                EvalAssertion(name="no_bad_word", type="not_contains", value="bad", weight=1)
            ]
        )
        
        model_output = "This is good content"
        result = grader.grade_output(eval_case, model_output)
        
        assert result["total_weighted_score"] == 1
        assert result["total_possible_score"] == 1
        assert result["pass_rate"] == 1.0
        assert result["final_passed"] is True
    
    def test_grade_output_with_critical_weight(self):
        """Test grading with critical weight (higher weight)."""
        grader = Grader()
        
        eval_case = EvalCase(
            id=8,
            name="critical_weight_test",
            category="normal",
            prompt="Important test",
            expected_output="Must contain this",
            assertions=[
                EvalAssertion(name="critical_check", type="contains", value="this", weight=3),  # Critical
                EvalAssertion(name="normal_check", type="contains", value="thatYYY", weight=1)    # Normal - use term that won't match
            ]
        )
        
        model_output = "Contains this but not thatZZZ"
        result = grader.grade_output(eval_case, model_output)
        
        assert result["total_weighted_score"] == 3  # Only critical assertion passes
        assert result["total_possible_score"] == 4  # Critical(3) + Normal(1)
        assert result["pass_rate"] == 3/4
        assert result["final_passed"] is True  # More than 50% pass rate
    
    def test_grade_output_empty_assertions(self):
        """Test grading with no assertions."""
        grader = Grader()
        
        eval_case = EvalCase(
            id=9,
            name="empty_test",
            category="normal",
            prompt="Empty test",
            expected_output="",
            assertions=[]
        )
        
        model_output = "Any output"
        result = grader.grade_output(eval_case, model_output)
        
        assert result["total_weighted_score"] == 0
        assert result["total_possible_score"] == 0
        assert result["pass_rate"] == 0.0  # Division by zero handled
        assert result["final_passed"] is False  # No assertions to pass
    
    def test_get_weight_multiplier(self):
        """Test weight multiplier calculation."""
        grader = Grader()
        
        # Test different weights
        assert grader._get_weight_multiplier(1) == 1  # Normal
        assert grader._get_weight_multiplier(2) == 2  # Important
        assert grader._get_weight_multiplier(3) == 3  # Critical
        # Test clamping
        assert grader._get_weight_multiplier(0) == 1  # Clamped to 1
        assert grader._get_weight_multiplier(5) == 3  # Clamped to 3
        assert grader._get_weight_multiplier(10) == 3  # Clamped to 3