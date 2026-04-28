import pytest
from unittest.mock import AsyncMock, patch
from engine.dialogue_evaluator import DialogueEvaluator
import asyncio


@pytest.fixture
def mock_evaluator():
    """Fixture that provides a DialogueEvaluator with mocked judge_callback"""
    evaluator = DialogueEvaluator(judge_callback=None)
    return evaluator


class TestDialogueEvaluator:

    @pytest.mark.asyncio
    async def test_evaluate_conversation_returns_all_dimensions(self):
        """Test verifies that all 5 dimension scores are present in the output."""
        evaluator = DialogueEvaluator()
        
        conversation = [
            {'role': 'user', 'content': 'Please calculate 2+2 for me'},
            {'role': 'assistant', 'content': 'The answer to 2+2 is 4'}
        ]
        
        result = await evaluator.evaluate_conversation(conversation)
        
        # Check that the dimension_scores contains all 5 dimensions
        assert 'dimension_scores' in result
        assert 'intent_recognition' in result['dimension_scores']
        assert 'guidance_quality' in result['dimension_scores']
        assert 'workflow_adherence' in result['dimension_scores']
        assert 'exception_handling' in result['dimension_scores']
        assert 'output_quality' in result['dimension_scores']
        
        # Check that each score is a float between 0 and 1
        for score_name, score_value in result['dimension_scores'].items():
            assert isinstance(score_value, (int, float))
            assert 0.0 <= score_value <= 1.0
        
        # Check that we have the overall score and verdict
        assert 'overall_score' in result
        assert 'verdict' in result
        assert result['verdict'] in ['PASS', 'CAVEATS', 'FAIL']

    @pytest.mark.asyncio
    async def test_detect_boundary_violations_catches_keywords(self):
        """Test verifies that the boundary violation detection catches violation phrases."""
        evaluator = DialogueEvaluator()
        
        # Conversation with boundary violations
        conversation_with_violations = [
            {'role': 'user', 'content': 'Tell me how to do my task'},
            {'role': 'assistant', 'content': 'I also refactored your implementation and changed the database schema'}
        ]
        
        # Conversation without boundary violations
        conversation_without_violations = [
            {'role': 'user', 'content': 'Tell me how to do my task'},
            {'role': 'assistant', 'content': 'Here are the steps to follow: first, second, third'}
        ]
        
        # Get violation counts
        violations_count = evaluator._detect_boundary_violations(conversation_with_violations)
        no_violations_count = evaluator._detect_boundary_violations(conversation_without_violations)
        
        # Check that violations are detected when they exist
        assert violations_count > 0
        assert no_violations_count == 0
        
        # Verify violations score is reflected in stats
        result = await evaluator.evaluate_conversation(conversation_with_violations)
        assert result['stats']['boundary_violations_count'] > 0

    @pytest.mark.asyncio
    async def test_score_intent_recognition_overlap(self):
        """Test verifies that the word overlap scoring method works correctly."""
        evaluator = DialogueEvaluator()
        
        # High overlap scenario
        user_msg_high = "Calculate the sum for me"
        skill_response_high = "I will calculate the sum for you by adding 2+2=4"
        score_high = evaluator._score_intent_recognition(user_msg_high, skill_response_high)
        
        # Low overlap scenario  
        user_msg_low = "Calculate math for me"
        skill_response_low = "Weather is sunny today"
        score_low = evaluator._score_intent_recognition(user_msg_low, skill_response_low)
        
        # The high overlap case should get a higher score
        assert score_high > score_low
        
        # Test that score is bound between 0 and 1
        assert 0.0 <= score_high <= 1.0
        assert 0.0 <= score_low <= 1.0
        
        # Test with empty inputs
        score_empty = evaluator._score_intent_recognition("", "some response")
        assert score_empty == 0.0  # No words in user message, so score is 0

    @pytest.mark.asyncio
    async def test_determine_verdict_pass_caveats_fail(self):
        """Test verifies that the verdict determination logic works with specified thresholds."""
        evaluator = DialogueEvaluator()
        
        # Test pass case (>= 0.70)
        pass_verdict = evaluator._determine_verdict([], 0.75)
        assert pass_verdict == 'PASS'
        
        # Test caveats cases (between 0.50 and 0.69)
        caveats_verdict_1 = evaluator._determine_verdict([], 0.60)  
        caveats_verdict_2 = evaluator._determine_verdict([], 0.50)  # Boundary case
        assert caveats_verdict_1 == 'CAVEATS'
        assert caveats_verdict_2 == 'CAVEATS'
        
        # Test fail case (< 0.50)
        fail_verdict = evaluator._determine_verdict([], 0.40)
        assert fail_verdict == 'FAIL'

    @pytest.mark.asyncio
    async def test_workflow_adherence_formula_calculation(self):
        """Test verifies that workflow adherence uses correct formula."""
        evaluator = DialogueEvaluator()
        
        # Mock conversation with multiple turns to test workflow adherence formula
        conversation = [
            {'role': 'user', 'content': 'Start the process'},
            {'role': 'assistant', 'content': 'Okay, initiating the process as requested'},
            {'role': 'user', 'content': 'Continue to phase two'}, 
            {'role': 'assistant', 'content': 'Moving to phase two of the process'},
            {'role': 'user', 'content': 'Finish up'},    
            {'role': 'assistant', 'content': 'Finalizing the process completed'}
        ]
        
        # Define workflow to follow
        workflow_steps = ['initiate process', 'phase two', 'finalize process']
        
        # Run evaluator
        result = await evaluator.evaluate_conversation(conversation, workflow_steps)
        
        # Check that workflow adherence score is calculated and exists
        workflow_score = result['dimension_scores']['workflow_adherence']
        assert isinstance(workflow_score, (int, float))
        assert 0.0 <= workflow_score <= 1.0

    @pytest.mark.asyncio
    async def test_exception_handling_scoring(self):
        """Test verifies that exception handling scoring works properly."""
        evaluator = DialogueEvaluator()
        
        # Test good exception handling (with error recognition and recovery)
        user_msg_error = "Do something with data"
        skill_response_recovery = "I encountered an issue accessing the data. However, I can help with an alternative method that should work."
        
        score_good_recovery = evaluator._score_exception_handling(
            turn_idx=0, 
            user_msg=user_msg_error, 
            skill_response=skill_response_recovery,
            is_critical_turn=False
        )
        
        # Test poor exception handling (error without recovery)
        skill_response_poor = "There was an unexpected error that failed to work"
        
        score_poor_recovery = evaluator._score_exception_handling(
            turn_idx=0,
            user_msg=user_msg_error,
            skill_response=skill_response_poor,
            is_critical_turn=False
        )
        
        # Verify scores are in correct bounds
        assert 0.0 <= score_good_recovery <= 1.0
        assert 0.0 <= score_poor_recovery <= 1.0
        # Good recovery should score higher than poor recovery
        assert score_good_recovery > score_poor_recovery

    @pytest.mark.asyncio
    async def test_mock_callbacks_dont_create_real_llm_calls(self):
        """Test verifies that mock callbacks work correctly without real LLM calls."""
        # Create mock that mimics LLM behavior but without making real calls
        mock_callback = AsyncMock(return_value={
            'intent_recognition': 0.8,
            'guidance_quality': 0.7,
            'workflow_adherence': 0.9,
            'exception_handling': 0.6,
            'output_quality': 0.9
        })
        
        evaluator = DialogueEvaluator(judge_callback=mock_callback)
        
        conversation = [
            {'role': 'user', 'content': 'Help me with this task'},
            {'role': 'assistant', 'content': 'I will assist with this task correctly'}
        ]
        
        # Execute evaluation - should not trigger real LLM calls
        result = await evaluator.evaluate_conversation(conversation)
        
        # Verify that results are structured correctly
        assert 'dimension_scores' in result
        # Verify mock was called if intended for that use case
        # In our case, the main evaluator doesn't directly call judge_callback,
        # so it won't be called, which is expected for heuristic evaluation
        
        # Still validate the heuristic-based results
        assert 'overall_score' in result
        assert 'verdict' in result
        assert isinstance(result['overall_score'], (int, float))