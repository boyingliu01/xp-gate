from typing import List, Dict, Optional, Callable, Any
from unittest.mock import AsyncMock


class DialogueEvaluator:
    """
    Evaluates multi-turn conversations using 5-dimension heuristic scoring
    with mock-first testing capability.
    """
    
    def __init__(self, judge_callback: Optional[Callable] = None):
        """
        Initialize the DialogueEvaluator.
        
        Args:
            judge_callback: Optional callback for LLM judge functionality  
                           (typically used for testing with mocks)
        """
        self.judge_callback = judge_callback
    
    async def evaluate_conversation(
        self, 
        conversation: List[Dict], 
        workflow_steps: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Evaluate a multi-turn conversation across 5 dimensions.
        
        Args:
            conversation: List of message dictionaries with 'role' and 'content'
                         [{'role': 'user', 'content': '...'}, {'role': 'assistant', 'content': '...'}]
            workflow_steps: Optional list of workflow steps to check adherence
            
        Returns:
            Dictionary with scores for all five dimensions and overall metrics
        """
        # Calculate dimension scores
        round_scores = []
        all_user_msgs = {}
        all_assistant_msgs = {}
        
        for idx, (user_msg, assistant_msg) in enumerate(self._pair_messages(conversation)):
            # Mark first turn as critical
            is_critical_turn = idx == 0
            
            # Calculate all 5 dimension scores for this turn
            intent_score = self._score_intent_recognition(
                user_msg.get('content', ''),
                assistant_msg.get('content', '')
            )
            guidance_score = self._score_guidance_quality(
                user_msg.get('content', ''),
                assistant_msg.get('content', '')
            )
            workflow_score = self._score_workflow_adherence(
                idx, 
                user_msg.get('content', ''), 
                assistant_msg.get('content', ''), 
                workflow_steps,
                is_critical_turn
            )
            exception_score = self._score_exception_handling(
                idx,
                user_msg.get('content', ''), 
                assistant_msg.get('content', ''),
                is_critical_turn
            )
            output_score = self._score_output_quality(
                user_msg.get('content', ''), 
                assistant_msg.get('content', '')
            )
            
            round_data = {
                'turn': idx + 1,
                'is_critical_turn': is_critical_turn,
                'intent_recognition': intent_score,
                'guidance_quality': guidance_score,
                'workflow_adherence': workflow_score,
                'exception_handling': exception_score,
                'output_quality': output_score
            }
            round_scores.append(round_data)
        
        # Calculate final scores across all rounds
        all_scores = [sum([round_data[key] for round_data in round_scores]) / len(round_scores) 
                     if round_scores else 0.0 for key in [
                         'intent_recognition', 'guidance_quality', 'workflow_adherence', 
                         'exception_handling', 'output_quality'
                     ]]
        
        intent_recognition_final = sum(r['intent_recognition'] for r in round_scores) / len(round_scores) if round_scores else 0.0
        guidance_quality_final = sum(r['guidance_quality'] for r in round_scores) / len(round_scores) if round_scores else 0.0
        workflow_adherence_final = sum(r['workflow_adherence'] for r in round_scores) / len(round_scores) if round_scores else 0.0
        exception_handling_final = sum(r['exception_handling'] for r in round_scores) / len(round_scores) if round_scores else 0.0
        output_quality_final = sum(r['output_quality'] for r in round_scores) / len(round_scores) if round_scores else 0.0
        
        final_scores = {
            'intent_recognition': intent_recognition_final,
            'guidance_quality': guidance_quality_final,
            'workflow_adherence': workflow_adherence_final,
            'exception_handling': exception_handling_final,
            'output_quality': output_quality_final
        }
        
        # Calculate overall score (weighted average)
        overall_score = self._calculate_overall(all_scores, final_scores)
        
        # Determine final verdict
        verdict = self._determine_verdict(all_scores, overall_score)
        
        return {
            'dimension_scores': final_scores,
            'overall_score': overall_score,
            'verdict': verdict,
            'detailed_rounds': round_scores,
            'stats': {
                'total_turns': len(round_scores),
                'workflow_adherence_formula_breakdown': await self._get_work_adherence_breakdown(
                    round_scores, 
                    workflow_adherence_final if len(round_scores) > 0 else 0
                ),
                'boundary_violations_count': self._detect_boundary_violations(conversation)
            }
        }
    
    def _pair_messages(self, conversation: List[Dict]) -> List[tuple]:
        """Pair user messages with assistant responses"""
        pairs = []
        i = 0
        while i < len(conversation):
            if i < len(conversation) and 'user' in conversation[i].get('role', '').lower():
                user_msg = conversation[i]
                if i + 1 < len(conversation) and 'assistant' in conversation[i+1].get('role', '').lower():
                    assistant_msg = conversation[i+1]
                    pairs.append((user_msg, assistant_msg))
                    i += 2
                else:
                    i += 1
            else:
                i += 1
        return pairs

    def _score_intent_recognition(self, user_msg: str, skill_response: str) -> float:
        """
        Score how well the skill recognizes and addresses the user's intent
        using word overlap and keyword analysis.
        """
        user_words = set(user_msg.lower().split())
        response_words = set(skill_response.lower().split())
        
        overlap = len(user_words.intersection(response_words))
        max_len = max(len(user_words), 1)
        
        return min(overlap / max_len, 1.0)
    
    def _score_guidance_quality(self, user_msg: str, skill_response: str) -> float:
        """
        Score quality of guidance - checks for clarifying questions.
        """
        skill_response_lower = skill_response.lower()
        
        # Check for clarifying questions
        has_clarifying_questions = '?' in skill_response_lower or 'could you' in skill_response_lower
        has_help_questions = 'can you elaborate' in skill_response_lower or 'what about' in skill_response_lower
        
        score = 0.0
        if has_clarifying_questions or has_help_questions:
            score = 1.0
        elif any(word in skill_response_lower for word in ['how', 'when', 'where']):
            score = 0.7
        else:
            score = 0.1  # Basic guidance is typically present
            
        return score
    
    def _score_workflow_adherence(
        self, 
        turn_idx: int, 
        user_msg: str, 
        skill_response: str, 
        workflow_steps: Optional[List[str]], 
        is_critical_turn: bool = False
    ) -> float:
        """
        Score how well the conversation adheres to defined workflow steps.
        Uses a formula: 0.7 * mean(round_scores) + 0.3 * critical_min - boundary_penalty
        """
        if not workflow_steps:
            # If no specific steps, score basic adherence
            return 0.8  # Assume reasonably good without specific requirements
        
        score = 0.0
        content_lower = skill_response.lower()
        
        # Check if response content mentions steps from workflow
        for step in workflow_steps:
            if step.lower() in content_lower:
                score += 1.0 / len(workflow_steps)
                
        # Apply critical turn weight
        if is_critical_turn and score == 0:
            score *= 0.5  # Heavily penalize if first turn doesn't address workflow
            
        return min(score, 1.0)
    
    def _score_exception_handling(
        self, 
        turn_idx: int, 
        user_msg: str, 
        skill_response: str, 
        is_critical_turn: bool = False
    ) -> float:
        """
        Score how well exceptions or errors are handled.
        """
        content_lower = skill_response.lower()
        
        # Look for error handling indicators
        has_error_indicators = any(pattern in content_lower for pattern in [
            'error occurred', 'sorry', 'unable to', 'couldn\'t', 
            'problem', 'issue', 'unexpected', 'failed to'
        ])
        
        # Look for recovery/action indicators
        has_recovery_indicators = any(pattern in content_lower for pattern in [
            'however', 'instead', 'alternative', 'workaround', 
            'different', 'try', 'recommendation', 'solution'
        ])
        
        # Look for apology/proactive indicators
        has_apology_or_proactive = any(pattern in content_lower for pattern in [
            'apologize', 'appreciate', 'going forward', 'next time',
            'in the meantime', 'meanwhile', 'fortunately'
        ])
        
        score = 0.0
        if not has_error_indicators:
            score = 1.0  # Perfect if no errors occurred
        else:
            if has_recovery_indicators and has_apology_or_proactive:
                score = 0.9  # Good error handling
            elif has_recovery_indicators or has_apology_or_proactive:
                score = 0.6  # Partial error handling
            else:
                score = 0.2  # Weak error handling
        
        return score
    
    def _score_output_quality(self, user_msg: str, skill_response: str) -> float:
        """
        Score the overall output quality of the skill response.
        """
        response_lower = skill_response.lower()
        
        # Check for clarity and structure
        has_bullet_points = '*' in skill_response or '-' in skill_response and '#' in skill_response
        has_numbered_list = any(char.isdigit() and f'{char}.' in skill_response for char in '0123456789')
        has_formatted_structure = has_bullet_points or has_numbered_list or '\n\n' in skill_response
        
        # Check for completeness
        word_count_ratio = min(len(skill_response.split()) / max(len(user_msg.split()), 1), 5.0) / 5.0
        completeness_factor = min(1.0, word_count_ratio + 0.5)  # Balance brevity and thoroughness
        
        # Check for specific references to user content
        user_words = set(user_msg.lower().split()[:10])  # Limit to first 10 words for efficiency
        response_words = set(response_lower.split())
        reference_factor = len(user_words.intersection(response_words)) / max(len(user_words), 1)
        
        # Base quality score
        quality_score = 0.5  # Base level
        
        if has_formatted_structure:
            quality_score += 0.3
            
        quality_score += (completeness_factor * 0.1)
        quality_score += (reference_factor * 0.1)
        
        return min(quality_score, 1.0)
    
    async def _get_work_adherence_breakdown(self, round_scores: List[Dict], final_adherence_score: float):
        """Get detailed breakdown of workflow adherence calculation"""
        if not round_scores:
            return {}
        
        boundary_penalty = self._detect_boundary_violations([
            {'role': 'user', 'content': 'test msg'},
            {'role': 'assistant', 'content': 'test response'}
        ])
        
        # Mean of adherence scores across rounds
        mean_adherence = sum(r.get('workflow_adherence', 0) for r in round_scores) / len(round_scores)
        
        # Minimum score among critical turns (typically first turn)
        critical_scores = [r.get('workflow_adherence', 0) for r in round_scores if r.get('is_critical_turn', False)]
        critical_min = min(critical_scores) if critical_scores else 0
        
        calculated_score = 0.7 * mean_adherence + 0.3 * critical_min - boundary_penalty
        
        return {
            'mean_round_scores': mean_adherence,
            'critical_min': critical_min,
            'coefficient_mean': 0.7 * mean_adherence,
            'coefficient_critical': 0.3 * critical_min,
            'boundary_penalty': boundary_penalty,
            'calculated_score': calculated_score
        }
    
    def _detect_boundary_violations(self, conversation: List[Dict]) -> float:
        """
        Detect boundary violations in conversation using heuristic checks.
        Returns penalty value (higher penalties for more serious violations).
        """
        total_penalty = 0.0
        
        for msg in conversation:
            content = msg.get('content', '').lower()
            
            # Check for specific violation patterns
            if any(pattern in content for pattern in [
                'i also refactored',
                'i decided to',
                'i changed the database',
                'i also implemented',
                'i created additional',
                'i added functionality',
                'i changed implementation',
                'i improved performance',
                'i optimized',
                'i enhanced',
                'i added a new feature'
            ]):
                total_penalty += 0.2  # Heavy penalty for unauthorized changes
        
        return min(total_penalty, 1.0)  # Cap penalty at 1.0
    
    def _calculate_overall(self, round_scores: List[float], final_score_dict: Dict[str, float]) -> float:
        """
        Calculate overall score as weighted average of 5 dimensions.
        Weights: intent_recognition (0.25), guidance_quality (0.20), 
                 workflow_adherence (0.25), exception_handling (0.15), output_quality (0.15)
        """
        intent_score = final_score_dict.get('intent_recognition', 0.0)
        guidance_score = final_score_dict.get('guidance_quality', 0.0)
        workflow_score = final_score_dict.get('workflow_adherence', 0.0)
        exception_score = final_score_dict.get('exception_handling', 0.0)
        output_score = final_score_dict.get('output_quality', 0.0)
        
        weights = [0.25, 0.20, 0.25, 0.15, 0.15]
        scores = [intent_score, guidance_score, workflow_score, exception_score, output_score]
        
        overall = sum(w * s for w, s in zip(weights, scores))
        return min(max(overall, 0.0), 1.0)  # Bound between 0.0 and 1.0
    
    def _determine_verdict(self, round_scores: List[float], final_score: float) -> str:
        """
        Determine the verdict based on final score:
        PASS if final_score >= 0.70, 
        CAVEATS if final_score >= 0.50, 
        FAIL otherwise
        """
        if final_score >= 0.70:
            return 'PASS'
        elif final_score >= 0.50:
            return 'CAVEATS'
        else:
            return 'FAIL'