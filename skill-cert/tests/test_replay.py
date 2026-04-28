import pytest
import json
from unittest.mock import AsyncMock, Mock, patch
import tempfile
import os
from pathlib import Path
import sys

# Add the root directory to the path
sys.path.insert(0, "/mnt/e/Private/opencode优化/xgate/skill-cert")
sys.path.insert(0, os.path.dirname(__file__) + '/..')

from engine.replay import HistoryReplay


class TestHistoryReplay:
    
    def test_load_session_parses_valid_jsonl(self):
        """Verify JSONL file loads correctly with valid messages."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            f.write('{"role": "user", "content": "Hello"}\n')
            f.write('{"role": "assistant", "content": "Hi there"}\n')
            f.write('{"role": "user", "content": "How are you?"}\n')
            temp_path = f.name
        
        try:
            replay = HistoryReplay(Mock())
            messages = replay.load_session(temp_path)
            
            assert len(messages) == 3
            assert messages[0]['role'] == 'user'
            assert messages[0]['content'] == 'Hello'
            assert messages[1]['role'] == 'assistant'
            assert messages[1]['content'] == 'Hi there'
            assert messages[2]['role'] == 'user'
            assert messages[2]['content'] == 'How are you?'
        finally:
            os.unlink(temp_path)

    def test_load_session_skips_malformed_lines(self, caplog):
        """Verify malformed lines are skipped with warning."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            f.write('{"role": "user", "content": "Valid"}\n')
            f.write('{invalid json\n')
            f.write('{"role": "assistant", "content": "Another valid one"}\n')
            f.write('not even json\n')
            temp_path = f.name
        
        try:
            replay = HistoryReplay(Mock())
            messages = replay.load_session(temp_path)
            
            # Should only parse the 2 valid lines
            assert len(messages) == 2
            assert messages[0]['content'] == 'Valid'
            assert messages[1]['content'] == 'Another valid one'
            
            # Check that warnings were logged
            assert any('Skipping invalid JSON' in record.message for record in caplog.records)
        finally:
            os.unlink(temp_path)
    
    @pytest.mark.asyncio
    async def test_replay_session_produces_results(self):
        """Verify replay_session produces correct structure with mock skill_runner."""
        # Create mock skill_runner with run_with_skill method
        mock_skill_runner = AsyncMock()
        
        # Create mock response for run_with_skill
        mock_response1 = Mock()
        mock_response1.response = "New response for user message"
        
        # Configure the mock to return predefined response
        mock_skill_runner.run_with_skill = AsyncMock(return_value=[mock_response1])
        
        replay = HistoryReplay(mock_skill_runner)
        
        session = [
            {'role': 'user', 'content': 'Hello, I need help'},
            {'role': 'assistant', 'content': 'Sure, what kind of help do you need?'},
            {'role': 'user', 'content': 'With authentication'},
        ]
        
        results = await replay.replay_session(session, "some context")
        
        # We should have 2 results for the 2 user messages
        assert len(results) == 2
        assert results[0]['user_message'] == 'Hello, I need help'
        assert results[0]['new_response'] == 'New response for user message'
        assert results[0]['context_length'] == 18  # len of 'Hello, I need help'
        assert results[1]['user_message'] == 'With authentication'
        assert results[1]['new_response'] == 'New response for user message'
        assert results[1]['context_length'] == 19  # len of 'With authentication'
        
        # Check that run_with_skill was called twice (for each user message)
        assert mock_skill_runner.run_with_skill.call_count == 2