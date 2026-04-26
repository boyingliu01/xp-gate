import os
import tempfile
from unittest.mock import patch, MagicMock
import pytest
from engine.config import SkillCertConfig, ModelConfig


def test_default_config_values():
    """Test that default configuration values are correctly set."""
    config = SkillCertConfig()
    
    assert config.max_concurrency == 5
    assert config.rate_limit_rpm == 60
    assert config.request_timeout == 120
    assert config.judge_temperature == 0.0
    assert config.max_testgen_rounds == 3
    assert config.max_gapfill_rounds == 3
    assert config.max_total_time == 3600
    assert config.models == []


def test_config_from_env_vars():
    """Test loading configuration from environment variables."""
    with patch.dict(os.environ, {
        "SKILL_CERT_MAX_CONCURRENCY": "10",
        "SKILL_CERT_RATE_LIMIT_RPM": "120",
        "SKILL_CERT_TIMEOUT": "180",
        "SKILL_CERT_JUDGE_TEMP": "0.1",
        "SKILL_CERT_MAX_TESTGEN_ROUNDS": "5",
        "SKILL_CERT_MAX_GAPFILL_ROUNDS": "4",
        "SKILL_CERT_MAX_TOTAL_TIME": "7200"
    }):
        config = SkillCertConfig.load()
        
        assert config.max_concurrency == 10
        assert config.rate_limit_rpm == 120
        assert config.request_timeout == 180
        assert config.judge_temperature == 0.1
        assert config.max_testgen_rounds == 5
        assert config.max_gapfill_rounds == 4
        assert config.max_total_time == 7200


def test_config_from_cli_args():
    """Test loading configuration from CLI arguments."""
    class MockArgs:
        max_concurrency = 8
        rate_limit_rpm = 100
        request_timeout = 200
        judge_temperature = 0.2
        max_testgen_rounds = 6
        max_gapfill_rounds = 5
        max_total_time = 5400
        models = None
    
    config = SkillCertConfig.load(cli_args=MockArgs())
    
    assert config.max_concurrency == 8
    assert config.rate_limit_rpm == 100
    assert config.request_timeout == 200
    assert config.judge_temperature == 0.2
    assert config.max_testgen_rounds == 6
    assert config.max_gapfill_rounds == 5
    assert config.max_total_time == 5400


def test_config_priority_order():
    """Test that CLI args override env vars, which override defaults."""
    with patch.dict(os.environ, {
        "SKILL_CERT_MAX_CONCURRENCY": "10",
        "SKILL_CERT_RATE_LIMIT_RPM": "120"
    }):
        class MockArgs:
            max_concurrency = 15
            rate_limit_rpm = None
            request_timeout = 200
            judge_temperature = None
            max_testgen_rounds = None
            max_gapfill_rounds = None
            max_total_time = None
            models = None
        
        config = SkillCertConfig.load(cli_args=MockArgs())
        
        assert config.max_concurrency == 15
        assert config.rate_limit_rpm == 120
        assert config.request_timeout == 200


def test_parse_models_from_env():
    """Test parsing models from environment variable."""
    models_env = "gpt-4=https://api.openai.com,v1.secret.key,fallback|claude-3=https://api.anthropic.com,v2.secret.key"
    
    models = SkillCertConfig._parse_models_from_env(models_env)
    
    assert len(models) == 2
    
    assert models[0].model_name == "gpt-4"
    assert models[0].base_url == "https://api.openai.com"
    assert models[0].api_key == "v1.secret.key"
    assert models[0].fallback_model == "fallback"
    
    assert models[1].model_name == "claude-3"
    assert models[1].base_url == "https://api.anthropic.com"
    assert models[1].api_key == "v2.secret.key"
    assert models[1].fallback_model is None


def test_parse_models_from_cli():
    """Test parsing models from CLI arguments."""
    models_cli = ["gpt-4=https://api.openai.com,v1.secret.key,fallback", 
                  "claude-3=https://api.anthropic.com,v2.secret.key"]
    
    models = SkillCertConfig._parse_models_from_cli(models_cli)
    
    assert len(models) == 2
    
    assert models[0].model_name == "gpt-4"
    assert models[0].base_url == "https://api.openai.com"
    assert models[0].api_key == "v1.secret.key"
    assert models[0].fallback_model == "fallback"
    
    assert models[1].model_name == "claude-3"
    assert models[1].base_url == "https://api.anthropic.com"
    assert models[1].api_key == "v2.secret.key"
    assert models[1].fallback_model is None


def test_config_from_file():
    """Test loading configuration from file."""
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.yaml') as f:
        f.write("""
max_concurrency: 7
rate_limit_rpm: 80
models:
  - model_name: test-model
    base_url: https://test.api.com
    api_key: test-key
    fallback_model: fallback-model
""")
        temp_config_path = f.name
    
    import shutil
    from pathlib import Path as RealPath
    
    config_dir = RealPath(tempfile.gettempdir()) / ".skill-cert"
    config_dir.mkdir(exist_ok=True)
    target_path = config_dir / "models.yaml"
    
    shutil.move(temp_config_path, target_path)
    
    original_expanduser = os.path.expanduser
    def mock_expanduser(path):
        if path == "~":
            return tempfile.gettempdir()
        return original_expanduser(path)
    
    with patch('os.path.expanduser', side_effect=mock_expanduser):
        config = SkillCertConfig.load()
        
        assert config.max_concurrency == 7
        assert config.rate_limit_rpm == 80
        assert len(config.models) == 1
        assert config.models[0].model_name == "test-model"
        assert config.models[0].base_url == "https://test.api.com"
        assert config.models[0].api_key == "test-key"
        assert config.models[0].fallback_model == "fallback-model"
    
    os.remove(target_path)


def test_model_config_creation():
    """Test ModelConfig creation."""
    model_config = ModelConfig(
        base_url="https://api.openai.com",
        api_key="test-key",
        model_name="gpt-4",
        fallback_model="gpt-3.5"
    )
    
    assert model_config.base_url == "https://api.openai.com"
    assert model_config.api_key == "test-key"
    assert model_config.model_name == "gpt-4"
    assert model_config.fallback_model == "gpt-3.5"


if __name__ == "__main__":
    pytest.main([__file__])