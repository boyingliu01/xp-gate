import asyncio
import logging
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)

class DialogueRunner:
    """
    Orchestrates UserSimulator + DialogueEvaluator + SkillRunner in a multi-turn loop.
    """
    def __init__(self, 
                 simulator, 
                 evaluator, 
                 skill_runner, 
                 max_turns: int = 10, 
                 completion_signals: List[str] = None):
        """
        Initialize the DialogueRunner
        
        Args:
            simulator: UserSimulator instance to generate user messages
            evaluator: DialogueEvaluator instance to evaluate conversations
            skill_runner: EvalRunner instance for executing evaluations
            max_turns: Maximum number of conversation turns allowed
            completion_signals: List of strings that indicate conversation completion
        """
        self.simulator = simulator
        self.evaluator = evaluator
        self.skill_runner = skill_runner
        self.max_turns = max_turns
        self.completion_signals = completion_signals or [
            "COMPLETED:", "FINISHED:", "DONE", "HERE IS THE"
        ]

    async def run_dialogue_eval(self, eval_case: Dict, skill_context: str) -> Dict:
        """
        Run multi-turn dialogue evaluation.
        
        Args:
            eval_case: The evaluation case to execute
            skill_context: Context about the skill being evaluated
            
        Returns:
            Dictionary with conversation history, evaluation result and turns count
        """
        # Initialize conversation with first user message
        history = []
        first_message = await self.simulator.generate_next_message(eval_case, [], skill_context)
        history.append(first_message)
        
        completed_turns = 0
        
        # Each iteration of this loop handles one round: assistant responds -> check completion -> user follows up
        # So one full iteration (assistant + completion check + maybe user message) is one turn
        while completed_turns < self.max_turns:
            # Get skill response to the latest user message
            current_user_message = history[-1]  # Get the last message (should be user message)
            
            single_eval_case = {
                "id": f"dialogue_turn_{completed_turns}",
                "name": f"Dialogue_Turn_{completed_turns}",
                "category": "dialogue",
                "input": current_user_message.get("content", "")
            }
            
            # Prepare eval for batch method with one item
            eval_list = [single_eval_case]
            try:
                skill_responses = await self.skill_runner.run_with_skill(
                    eval_list, skill_context, getattr(self.skill_runner, '_current_adapter', None)
                )
            except Exception:
                # Handle the case where '_current_adapter' attribute doesn't exist
                try:
                    skill_responses = await self.skill_runner.run_with_skill(
                        eval_list, skill_context, None
                    ) 
                except Exception as e2:
                    logger.error(f"Skill runner failed: {str(e2)}")
                    break
            
            # Process the skill response
            if skill_responses and len(skill_responses) > 0:
                skill_response = skill_responses[0]
                assistant_message = {
                    "role": "assistant",
                    "content": skill_response.get("output", ""),
                    "eval_id": skill_response.get("eval_id", f"dialogue_turn_{completed_turns}")
                }
                history.append(assistant_message)
                
                # Check for completion based on signals after adding assistant response
                if self._is_conversation_complete(history):
                    break  # Exit without generating another user message
                    
            else:
                # If skill response failed, we can't continue 
                break
                
            # Generate next user message based on the assistant response
            try:
                next_user_message = await self.simulator.generate_next_message(
                    eval_case, 
                    history, 
                    skill_context
                )
                history.append(next_user_message)
            except Exception as e:
                logger.error(f"Failed to generate next user message: {str(e)}")
                break  # Can't continue without user input
                
            # Completed one full turn
            completed_turns += 1
            
            # Check if history has reached max_turns after incrementing
            if completed_turns >= self.max_turns:
                break
        
        # Once dialog is complete, evaluate the full conversation
        evaluation_result = await self.evaluator.evaluate_conversation(
            conversation=history,
            workflow_steps=eval_case.get("workflow_steps", [])
        )
        
        # Return structured result
        return {
            "conversation": history,
            "evaluation": evaluation_result,
            "turns_completed": completed_turns
        }

    def _is_conversation_complete(self, history: List[Dict]) -> bool:
        """
        Check if the conversation should terminate early.
        
        Returns True if:
        - History length is at least 4 messages
        - The last message (should be assistant) contains any completion signal
        """
        # Return False if there isn't enough history yet
        if len(history) < 4:
            return False
            
        # Get the last message - assuming odd indices are user, even are assistant
        # (first message is user, then pair assistant-user, etc.)
        # If length is odd: last is user. If even: last is assistant.
        # So for checking completion signals, we need the last assistant message
        last_assistant_msg = None
        
        # Find the last assistant message by scanning in reverse
        for msg in reversed(history):
            if msg.get('role', '').lower() in ['assistant', 'llm', 'ai']:
                last_assistant_msg = msg
                break

        if not last_assistant_msg:
            return False
        
        last_message_content = last_assistant_msg.get('content', '')
        last_message_upper = last_message_content.upper()
        
        # Check if any completion signal is in the final assistant message
        for signal in self.completion_signals:
            if signal in last_message_upper:
                logger.debug(f"Completion signal '{signal}' detected in message: {last_message_content[:100]}...")
                return True
                
        return False