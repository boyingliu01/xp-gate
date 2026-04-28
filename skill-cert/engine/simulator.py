import random
from typing import List, Dict, Optional

class UserSimulator:
    """
    Simulates user behavior in a multi-turn conversation.
    """
    
    def __init__(self, persona_profiles: Optional[dict] = None):
        """
        Initialize the UserSimulator.
        
        Args:
            persona_profiles: Optional dictionary with different persona characteristics
        """
        self.persona_profiles = persona_profiles or {
            "professional": {
                "style": "conversational but focused",
                "tone": "professional",
                "depth": "medium",
                "questions": [
                    "Could you explain that in more detail?",
                    "Can you clarify how this applies to X?",
                    "What are the potential risks of Y?",
                    "How does this compare with previous approaches?"
                ],
                "clarifications": [
                    "I need to implement feature Z. Would this approach work?",
                    "Can this also handle edge case X?",
                    "I'd like to modify the original requirement Y.",
                    "Would this also work for scenario A or B?"
                ]
            }
        }
    
    async def generate_next_message(
        self, 
        eval_case: Dict, 
        context_history: List[Dict],
        skill_context: str = ""
    ) -> Dict:
        """
        Generate the next simulated user message based on the conversation history.
        
        Args:
            eval_case: The original evaluation case being simulated
            context_history: List of conversation turns [{"role": "user"/"assistant", "content": "..."}]
            skill_context: Additional context about the skill evaluation
        
        Returns:
            Dictionary with the simulated user message
        """
        # Determine the persona to use based on the evaluation case or default
        persona_name = eval_case.get("persona", "professional")
        persona = self.persona_profiles.get(persona_name, self.persona_profiles["professional"])
        
        # If first message, generate initial user request based on eval_case
        if not context_history:
            return {
                "role": "user",
                "content": eval_case.get("input", eval_case.get("prompt", "Please help me with this task")),
                "timestamp": self._generate_timestamp(),
                "simulated": True
            }
        
        # Get the last message from the assistant
        last_assistant_msg = None
        for msg in reversed(context_history):
            if msg.get("role", "").lower() in ["assistant", "assistant"]:
                last_assistant_msg = msg
                break
        
        # Generate a follow-up message based on context
        if last_assistant_msg:
            content = self._generate_follow_up_message(
                last_response=last_assistant_msg.get("content", ""),
                user_prompt=eval_case.get("input", ""),
                persona=persona
            )
        else:
            content = random.choice(persona["questions"])
        
        return {
            "role": "user",
            "content": content,
            "timestamp": self._generate_timestamp(),
            "simulated": True
        }
    
    def _generate_follow_up_message(
        self, 
        last_response: str, 
        user_prompt: str, 
        persona: dict
    ) -> str:
        """
        Generate a follow-up message based on the last assistant response.
        """
        # Check if response contains completion signals that indicate task completion
        completion_keywords = [
            "completed", "finished", "done", "completed:", "finished:", 
            "done:", "here is the", "result:"
        ]
        
        last_response_lower = last_response.lower()
        if any(keyword in last_response_lower for keyword in completion_keywords):
            # If the task seems complete, user might ask for verification or ask a follow-up question
            follow_ups = [
                "Thanks, that looks good!",
                "Great, that completes what I asked for!",
                "Perfect, thanks for completing that task!",
                "Excellent - I think that addresses what I needed!"
            ]
            return random.choice(follow_ups)
        
        # If no specific direction, continue with professional inquiries
        if len(last_response.split()) < 20:  # Response is quite short
            return random.choice(persona["questions"])
        else:
            # Choose between clarification or follow-up based on context
            choices = persona["clarifications"] + persona["questions"]
            return random.choice(choices)
    
    def _generate_timestamp(self) -> float:
        """
        Generate a timestamp for simulation purposes.
        """
        import time
        return time.time()
