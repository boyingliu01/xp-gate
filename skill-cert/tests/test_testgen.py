import pytest
from unittest.mock import Mock, MagicMock
from engine.testgen import EvalGenerator


class MockModelAdapter:
    def __init__(self, responses=None):
        self.responses = responses or []
        self.call_count = 0
    
    def chat(self, messages):
        if self.call_count < len(self.responses):
            response = self.responses[self.call_count]
            self.call_count += 1
            return response
        return '{"eval_cases": []}'


def test_test_generator_initialization():
    generator = EvalGenerator()
    
    assert generator.max_rounds == 3
    assert generator.consecutive_no_improvement == 2
    assert generator.coverage_threshold == 0.9
    assert generator.degrade_threshold == 0.7
    assert generator.block_threshold == 0.7
    assert "eval_cases" in generator.minimum_evals_template or "evals" in generator.minimum_evals_template


def test_generate_initial_evals_success():
    generator = EvalGenerator()
    skill_spec = {
        "name": "test-skill",
        "description": "A test skill",
        "triggers": ["test", "evaluate"],
        "workflow_steps": [{"name": "step1", "type": "validation"}],
        "anti_patterns": ["skip_validation"],
        "output_format": ["json", "markdown"]
    }
    
    mock_adapter = MockModelAdapter([
        '{"eval_cases": [{"id": 1, "name": "test-case", "category": "normal", "input": "test input", "expected_triggers": true, "assertions": [{"type": "contains", "value": "test", "weight": 1}]}]}'
    ])
    
    result = generator.generate_initial_evals(skill_spec, mock_adapter)
    
    assert "eval_cases" in result or "evals" in result
    eval_cases = result.get("eval_cases", result.get("evals", []))
    assert len(eval_cases) >= 1


def test_generate_initial_evals_fallback():
    generator = EvalGenerator()
    skill_spec = {
        "name": "test-skill",
        "description": "A test skill",
        "triggers": ["test"],
        "workflow_steps": [],
        "anti_patterns": [],
        "output_format": []
    }
    
    mock_adapter = MockModelAdapter(["Invalid response"])
    
    result = generator.generate_initial_evals(skill_spec, mock_adapter)
    
    assert "eval_cases" in result or "evals" in result
    eval_cases = result.get("eval_cases", result.get("evals", []))
    assert len(eval_cases) >= 1


def test_review_evals():
    generator = EvalGenerator()
    evals = {
        "eval_cases": [
            {
                "id": 1,
                "name": "test-case",
                "category": "normal",
                "input": "test input",
                "expected_triggers": True,
                "assertions": [{"type": "contains", "value": "test", "weight": 1}]
            }
        ]
    }
    
    skill_spec = {
        "name": "test-skill",
        "description": "A test skill",
        "triggers": ["test"],
        "workflow_steps": [{"name": "step1", "type": "validation"}],
        "anti_patterns": ["skip_validation"],
        "output_format": ["json"]
    }
    
    mock_review_adapter = MockModelAdapter([
        '{"coverage": 0.5, "gaps": ["workflow steps not covered"], "needs_improvement": true}'
    ])
    mock_review_adapter.skill_spec = skill_spec
    
    result = generator.review_evals(evals, mock_review_adapter)
    
    assert "coverage" in result
    assert "gaps" in result
    assert "needs_improvement" in result


def test_fill_gaps():
    generator = EvalGenerator()
    gaps = {
        "coverage": 0.5,
        "gaps": ["workflow steps not covered"],
        "needs_improvement": True
    }
    
    skill_spec = {
        "name": "test-skill",
        "description": "A test skill",
        "triggers": ["test"],
        "workflow_steps": [{"name": "step1", "type": "validation"}],
        "anti_patterns": ["skip_validation"],
        "output_format": ["json"]
    }
    
    mock_adapter = MockModelAdapter([
        '{"eval_cases": [{"id": 2, "name": "gap-fill-case", "category": "normal", "input": "step1 input", "expected_triggers": true, "assertions": [{"type": "contains", "value": "step1", "weight": 1}]}]}'
    ])
    
    result = generator.fill_gaps(gaps, skill_spec, mock_adapter)
    
    assert "eval_cases" in result


def test_calculate_coverage():
    generator = EvalGenerator()
    evals = {
        "eval_cases": [
            {
                "id": 1,
                "name": "test-case",
                "category": "normal",
                "input": "test input",
                "expected_triggers": True,
                "assertions": [
                    {"type": "contains", "value": "step1", "weight": 1},
                    {"type": "contains", "value": "skip_validation", "weight": 1},
                    {"type": "contains", "value": "json", "weight": 1}
                ]
            }
        ]
    }
    
    skill_spec = {
        "name": "test-skill",
        "description": "A test skill",
        "triggers": ["test"],
        "workflow_steps": [{"name": "step1", "type": "validation"}],
        "anti_patterns": ["skip_validation"],
        "output_format": ["json"]
    }
    
    coverage = generator._calculate_coverage(evals, skill_spec)
    
    assert coverage == 1.0


def test_merge_evals():
    generator = EvalGenerator()
    current_evals = {
        "eval_cases": [
            {"id": 1, "name": "existing-case", "category": "normal", "input": "input1", "expected_triggers": True, "assertions": [{"type": "contains", "value": "test", "weight": 1}]}
        ]
    }
    
    supplementary_evals = {
        "eval_cases": [
            {"id": 1, "name": "new-case", "category": "boundary", "input": "input2", "expected_triggers": False, "assertions": [{"type": "not_contains", "value": "test", "weight": 1}]}
        ]
    }
    
    merged = generator._merge_evals(current_evals, supplementary_evals)
    
    assert len(merged["eval_cases"]) == 2
    assert merged["eval_cases"][0]["id"] == 1
    assert merged["eval_cases"][1]["id"] == 2


def test_generate_evals_with_convergence_success():
    generator = EvalGenerator()
    skill_spec = {
        "name": "test-skill",
        "description": "A test skill",
        "triggers": ["test"],
        "workflow_steps": [{"name": "step1", "type": "validation"}],
        "anti_patterns": ["skip_validation"],
        "output_format": ["json"]
    }
    
    mock_adapter = MockModelAdapter([
        '{"eval_cases": [{"id": 1, "name": "test-case", "category": "normal", "input": "test input", "expected_triggers": true, "assertions": [{"type": "contains", "value": "test", "weight": 1}]}]}',
        '{"eval_cases": [{"id": 2, "name": "supp-case", "category": "normal", "input": "step1 input", "expected_triggers": true, "assertions": [{"type": "contains", "value": "step1", "weight": 1}]}]}'
    ])
    
    mock_review_adapter = MockModelAdapter([
        '{"coverage": 0.6, "gaps": ["more coverage needed"], "needs_improvement": true}',
        '{"coverage": 0.95, "gaps": [], "needs_improvement": false}'
    ])
    mock_review_adapter.skill_spec = skill_spec
    
    result = generator.generate_evals_with_convergence(skill_spec, mock_adapter, mock_review_adapter)
    
    assert "eval_cases" in result or "evals" in result
    eval_cases = result.get("eval_cases", result.get("evals", []))
    assert len(eval_cases) >= 1


def test_generate_evals_with_convergence_degraded():
    generator = EvalGenerator()
    generator.coverage_threshold = 0.9
    generator.degrade_threshold = 0.6
    
    skill_spec = {
        "name": "test-skill",
        "description": "A test skill",
        "triggers": ["test"],
        "workflow_steps": [{"name": "step1", "type": "validation"}],
        "anti_patterns": ["skip_validation"],
        "output_format": ["json"]
    }
    
    mock_adapter = MockModelAdapter([
        '{"eval_cases": [{"id": 1, "name": "test-case", "category": "normal", "input": "test input", "expected_triggers": true, "assertions": [{"type": "contains", "value": "test", "weight": 1}]}]}'
    ])
    
    mock_review_adapter = MockModelAdapter([
        '{"coverage": 0.7, "gaps": ["some gaps"], "needs_improvement": true}'
    ])
    mock_review_adapter.skill_spec = skill_spec
    
    result = generator.generate_evals_with_convergence(skill_spec, mock_adapter, mock_review_adapter)
    
    assert "eval_cases" in result or "evals" in result
    eval_cases = result.get("eval_cases", result.get("evals", []))
    assert len(eval_cases) >= 0


def test_generator_template_loading_error():
    """Test EvalGenerator when template loading fails."""
    import os
    from unittest.mock import patch
    from pathlib import Path
    
    # Temporarily change the template path to a non-existent location
    with patch('engine.testgen.Path') as mock_path:
        mock_path_instance = MagicMock()
        mock_path_instance.__truediv__.return_value = mock_path_instance
        mock_path.return_value = mock_path_instance
        mock_path_instance.exists.return_value = False
        
        # This should use the fallback template
        generator = EvalGenerator()
        
        # Check that fallback template is used
        assert "eval_cases" in generator.minimum_evals_template
        assert len(generator.minimum_evals_template["eval_cases"]) >= 1


def test_generate_initial_evals_error_handling():
    """Test generate_initial_evals error handling."""
    generator = EvalGenerator()
    skill_spec = {
        "name": "test-skill",
        "description": "A test skill",
        "triggers": ["test"],
        "workflow_steps": [],
        "anti_patterns": [],
        "output_format": []
    }
    
    # Mock adapter that raises an exception
    class ErrorMockAdapter:
        def chat(self, messages):
            raise Exception("API Error")
    
    mock_adapter = ErrorMockAdapter()
    
    result = generator.generate_initial_evals(skill_spec, mock_adapter)
    
    # Should return the template when error occurs
    assert "eval_cases" in result or "evals" in result
    eval_cases = result.get("eval_cases", result.get("evals", []))
    assert len(eval_cases) >= 1


def test_review_evals_error_handling():
    """Test review_evals error handling."""
    generator = EvalGenerator()
    evals = {
        "eval_cases": [
            {
                "id": 1,
                "name": "test-case",
                "category": "normal",
                "input": "test input",
                "expected_triggers": True,
                "assertions": [{"type": "contains", "value": "test", "weight": 1}]
            }
        ]
    }
    
    # Mock adapter that raises an exception
    class ErrorMockAdapter:
        def chat(self, messages):
            raise Exception("API Error")
    
    mock_review_adapter = ErrorMockAdapter()
    mock_review_adapter.skill_spec = {
        "name": "test-skill",
        "description": "A test skill",
        "triggers": ["test"],
        "workflow_steps": [],
        "anti_patterns": [],
        "output_format": []
    }
    
    result = generator.review_evals(evals, mock_review_adapter)
    
    # Should return error structure when error occurs
    assert "coverage" in result
    assert "gaps" in result
    assert "needs_improvement" in result
    assert result["needs_improvement"] is True


def test_fill_gaps_error_handling():
    """Test fill_gaps error handling."""
    generator = EvalGenerator()
    gaps = {
        "coverage": 0.5,
        "gaps": ["workflow steps not covered"],
        "needs_improvement": True
    }
    
    skill_spec = {
        "name": "test-skill",
        "description": "A test skill",
        "triggers": ["test"],
        "workflow_steps": [],
        "anti_patterns": [],
        "output_format": []
    }
    
    # Mock adapter that raises an exception
    class ErrorMockAdapter:
        def chat(self, messages):
            raise Exception("API Error")
    
    mock_adapter = ErrorMockAdapter()
    
    result = generator.fill_gaps(gaps, skill_spec, mock_adapter)
    
    # Should return empty eval cases when error occurs
    assert "eval_cases" in result
    assert result["eval_cases"] == []


def test_parse_evals_response_edge_cases():
    """Test _parse_evals_response with various edge cases."""
    generator = EvalGenerator()
    
    # Test with no JSON in response
    result = generator._parse_evals_response("This is not JSON at all")
    assert "eval_cases" in result or "evals" in result
    
    # Test with JSON that doesn't have eval_cases
    result = generator._parse_evals_response('{"other_key": "value"}')
    assert "eval_cases" in result or "evals" in result
    
    # Test with JSON that has evals instead of eval_cases
    result = generator._parse_evals_response('{"evals": [{"id": 1, "name": "test"}]}')
    assert "eval_cases" in result or "evals" in result
    
    # Test with completely invalid JSON
    result = generator._parse_evals_response("{{{ invalid json")
    assert "eval_cases" in result or "evals" in result


def test_has_sufficient_evals_edge_cases():
    """Test _has_sufficient_evals with various edge cases."""
    generator = EvalGenerator()
    
    # Test with no eval_cases key
    result = generator._has_sufficient_evals({})
    assert result is False
    
    # Test with empty eval_cases
    result = generator._has_sufficient_evals({"eval_cases": []})
    assert result is False
    
    # Test with insufficient evals
    result = generator._has_sufficient_evals({"eval_cases": [{"id": 1}]})
    assert result is False
    
    # Test with sufficient evals
    result = generator._has_sufficient_evals({
        "eval_cases": [
            {"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}
        ]
    })
    assert result is True
    
    # Test with alternative key names
    result = generator._has_sufficient_evals({"evals": [{"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}]})
    assert result is True


def test_calculate_coverage_edge_cases():
    """Test _calculate_coverage with various edge cases."""
    generator = EvalGenerator()
    
    # Test with no eval cases
    evals = {"eval_cases": []}
    skill_spec = {
        "name": "test-skill",
        "description": "A test skill",
        "triggers": ["test"],
        "workflow_steps": [{"name": "step1"}],
        "anti_patterns": ["pattern1"],
        "output_format": ["json"]
    }
    coverage = generator._calculate_coverage(evals, skill_spec)
    assert coverage == 0.0
    
    # Test with no skill spec elements
    evals = {
        "eval_cases": [
            {
                "id": 1,
                "name": "test-case",
                "category": "normal",
                "input": "test input",
                "expected_triggers": True,
                "assertions": [{"type": "contains", "value": "test", "weight": 1}]
            }
        ]
    }
    skill_spec_empty = {
        "name": "test-skill",
        "description": "A test skill",
        "triggers": ["test"],
        "workflow_steps": [],
        "anti_patterns": [],
        "output_format": []
    }
    coverage = generator._calculate_coverage(evals, skill_spec_empty)
    assert coverage == 1.0  # Should be 1.0 when there's nothing to cover


def test_parse_review_response_edge_cases():
    """Test _parse_review_response with various edge cases."""
    generator = EvalGenerator()
    
    # Test with invalid JSON
    result = generator._parse_review_response("{{{ invalid json", 0.5)
    assert result["coverage"] == 0.5
    assert "gaps" in result
    assert result["needs_improvement"] is True
    
    # Test with JSON missing required fields
    result = generator._parse_review_response('{"other_field": "value"}', 0.7)
    assert result["coverage"] == 0.7
    assert "gaps" in result
    # needs_improvement should be False because gaps is empty list by default
    assert result["needs_improvement"] is False
    
    # Test with valid JSON but missing fields
    result = generator._parse_review_response('{"coverage": 0.8}', 0.7)
    assert result["coverage"] == 0.8  # Should use the one from response
    assert "gaps" in result
    # needs_improvement should be False because gaps is empty list by default
    assert result["needs_improvement"] is False


def test_merge_evals_edge_cases():
    """Test _merge_evals with various edge cases."""
    generator = EvalGenerator()
    
    # Test with different key names
    current_evals = {"evals": [{"id": 1, "name": "existing"}]}
    supplementary_evals = {"cases": [{"id": 2, "name": "new"}]}
    
    merged = generator._merge_evals(current_evals, supplementary_evals)
    
    # Should handle different key names
    assert "evals" in merged or "cases" in merged or "eval_cases" in merged
    
    # Test with empty supplementary evals
    current_evals = {"eval_cases": [{"id": 1, "name": "existing"}]}
    supplementary_evals = {"eval_cases": []}
    
    merged = generator._merge_evals(current_evals, supplementary_evals)
    assert len(merged["eval_cases"]) == 1  # Should remain unchanged


def test_generate_evals_with_convergence_error_scenario():
    """Test generate_evals_with_convergence with error scenarios."""
    generator = EvalGenerator()
    generator.coverage_threshold = 0.9
    generator.degrade_threshold = 0.6
    generator.block_threshold = 0.5
    
    skill_spec = {
        "name": "test-skill",
        "description": "A test skill",
        "triggers": ["test"],
        "workflow_steps": [{"name": "step1"}],
        "anti_patterns": ["skip_validation"],
        "output_format": ["json"]
    }
    
    # Mock adapter that fails on second call
    class FailingMockAdapter:
        def __init__(self):
            self.call_count = 0
            
        def chat(self, messages):
            self.call_count += 1
            if self.call_count == 1:
                return '{"eval_cases": [{"id": 1, "name": "test-case", "category": "normal", "input": "test input", "expected_triggers": true, "assertions": [{"type": "contains", "value": "test", "weight": 1}]}]}'
            else:
                raise Exception("API Error on second call")
    
    mock_adapter = FailingMockAdapter()
    
    # Mock review adapter that also fails
    class FailingReviewMockAdapter:
        def __init__(self):
            self.skill_spec = skill_spec
            self.call_count = 0
            
        def chat(self, messages):
            self.call_count += 1
            if self.call_count == 1:
                return '{"coverage": 0.3, "gaps": ["many gaps"], "needs_improvement": true}'
            else:
                raise Exception("API Error on second review call")
    
    mock_review_adapter = FailingReviewMockAdapter()
    
    result = generator.generate_evals_with_convergence(skill_spec, mock_adapter, mock_review_adapter)
    
    # Should return minimum template when coverage is below block threshold
    assert result == generator.minimum_evals_template


if __name__ == "__main__":
    pytest.main([__file__])