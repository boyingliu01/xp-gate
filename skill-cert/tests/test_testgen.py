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


def test_generate_evals_with_convergence_blocked():
    generator = EvalGenerator()
    generator.coverage_threshold = 0.8
    generator.degrade_threshold = 0.7
    generator.block_threshold = 0.6
    
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
        '{"coverage": 0.4, "gaps": ["many gaps"], "needs_improvement": true}'
    ])
    mock_review_adapter.skill_spec = skill_spec
    
    result = generator.generate_evals_with_convergence(skill_spec, mock_adapter, mock_review_adapter)
    
    assert "eval_cases" in result or "evals" in result
    assert result == generator.minimum_evals_template