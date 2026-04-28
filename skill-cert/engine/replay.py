import json
import logging
from typing import Any, Dict, List
from pathlib import Path

logger = logging.getLogger(__name__)


class HistoryReplay:
    def __init__(self, skill_runner):
        """
        Initialize with a skill runner instance.
        
        Args:
            skill_runner: An EvalRunner instance that has run_with_skill method
        """
        self.skill_runner = skill_runner

    def load_session(self, file_path: str) -> List[Dict[str, Any]]:
        """
        Load JSONL file and parse each line as JSON.
        
        Args:
            file_path: Path to JSONL session file
            
        Returns:
            List of message dictionaries
        """
        messages = []
        file_path = Path(file_path)
        
        with open(file_path, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                
                try:
                    message = json.loads(line)
                    if self._has_required_fields(message):
                        messages.append(message)
                    else:
                        self._log_missing_fields_warning(line_num, file_path)
                except json.JSONDecodeError as e:
                    self._log_invalid_json_warning(line_num, file_path, e)
        
        return messages
    
    def _has_required_fields(self, message: Dict[str, Any]) -> bool:
        """Validate message has required fields."""
        return "role" in message and "content" in message
    
    def _log_missing_fields_warning(self, line_num: int, file_path: Path) -> None:
        """Log warning when message lacks required fields."""
        logger.warning(f"Skipping line {line_num} in {file_path}: missing 'role' or 'content' key")
    
    def _log_invalid_json_warning(self, line_num: int, file_path: Path, error: Exception) -> None:
        """Log warning when JSON parsing fails."""
        logger.warning(f"Skipping invalid JSON on line {line_num} in {file_path}: {error}")

    async def replay_session(self, session: List[Dict], skill_context: str) -> List[Dict]:
        """
        Replay session against skill, collecting results for user messages.
        
        Args:
            session: List of message dictionaries
            skill_context: Context for running the skill
            
        Returns:
            Results with user message, new response, and context length
        """
        results = []
        
        for message in session:
            if message.get("role") != "user":
                continue
                
            user_content = message.get("content", "")
            eval_obj = self._create_eval_object(user_content)
            
            skill_results = await self.skill_runner.run_with_skill([eval_obj], skill_context)
            new_response = self._extract_response(skill_results)
            
            results.append({
                "user_message": user_content,
                "new_response": new_response,
                "context_length": len(user_content)
            })
        
        return results
    
    def _create_eval_object(self, content: str) -> Dict[str, Any]:
        """Create evaluation object for skill runner."""
        return {
            "vars": {"input": content},
            "asserts": []
        }
    
    def _extract_response(self, skill_results: List[Any]) -> str:
        """Extract response from skill runner results."""
        if not skill_results:
            return "No response"
            
        first_result = skill_results[0]
        if hasattr(first_result, 'response'):
            return first_result.response
        elif isinstance(first_result, dict) and 'response' in first_result:
            return first_result['response']
        elif isinstance(first_result, str):
            return first_result
        else:
            return str(first_result)