from typing import List, Optional
from pydantic import BaseModel, Field
import os
import yaml
from pathlib import Path


class ModelConfig(BaseModel):
    base_url: str
    api_key: str
    model_name: str
    fallback_model: Optional[str] = None


class SkillCertConfig(BaseModel):
    """Configuration with loading priority: CLI args > env vars > config file > defaults"""
    models: List[ModelConfig] = Field(default_factory=list)
    max_concurrency: int = Field(default=5, json_schema_extra={"env": "SKILL_CERT_MAX_CONCURRENCY"})
    rate_limit_rpm: int = Field(default=60, json_schema_extra={"env": "SKILL_CERT_RATE_LIMIT_RPM"})
    request_timeout: int = Field(default=120, json_schema_extra={"env": "SKILL_CERT_TIMEOUT"})
    judge_temperature: float = Field(default=0.0, json_schema_extra={"env": "SKILL_CERT_JUDGE_TEMP"})
    max_testgen_rounds: int = Field(default=3, json_schema_extra={"env": "SKILL_CERT_MAX_TESTGEN_ROUNDS"})
    max_gapfill_rounds: int = Field(default=3, json_schema_extra={"env": "SKILL_CERT_MAX_GAPFILL_ROUNDS"})
    max_total_time: int = Field(default=3600, json_schema_extra={"env": "SKILL_CERT_MAX_TOTAL_TIME"})

    @classmethod
    def load(cls, cli_args=None) -> 'SkillCertConfig':
        """Load configuration with priority: CLI args > env vars > config file > defaults"""
        config_dict = cls._get_default_config()
        config_dict = cls._apply_config_file(config_dict)
        config_dict = cls._apply_environment_variables(config_dict)
        config_dict = cls._apply_cli_arguments(config_dict, cli_args)
        return cls(**config_dict)

    @classmethod
    def _get_default_config(cls) -> dict:
        return {
            "max_concurrency": 5,
            "rate_limit_rpm": 60,
            "request_timeout": 120,
            "judge_temperature": 0.0,
            "max_testgen_rounds": 3,
            "max_gapfill_rounds": 3,
            "max_total_time": 3600,
            "models": []
        }

    @classmethod
    def _apply_config_file(cls, config_dict: dict) -> dict:
        config_file_path = Path.home() / ".skill-cert" / "models.yaml"
        if config_file_path.exists():
            try:
                with open(config_file_path, 'r') as f:
                    file_config = yaml.safe_load(f)
                    if file_config:
                        if "models" in file_config:
                            models_from_file = cls._load_models_from_config(file_config["models"])
                            config_dict["models"] = models_from_file
                        for key, value in file_config.items():
                            if key != "models":
                                config_dict[key] = value
            except Exception:
                # If config file is malformed, continue with defaults
                pass
        return config_dict

    @classmethod
    def _apply_environment_variables(cls, config_dict: dict) -> dict:
        env_vars = {
            "max_concurrency": os.getenv("SKILL_CERT_MAX_CONCURRENCY"),
            "rate_limit_rpm": os.getenv("SKILL_CERT_RATE_LIMIT_RPM"),
            "request_timeout": os.getenv("SKILL_CERT_TIMEOUT"),
            "judge_temperature": os.getenv("SKILL_CERT_JUDGE_TEMP"),
            "max_testgen_rounds": os.getenv("SKILL_CERT_MAX_TESTGEN_ROUNDS"),
            "max_gapfill_rounds": os.getenv("SKILL_CERT_MAX_GAPFILL_ROUNDS"),
            "max_total_time": os.getenv("SKILL_CERT_MAX_TOTAL_TIME"),
        }

        for key, value in env_vars.items():
            if value is not None:
                if key in ["max_concurrency", "rate_limit_rpm", "max_testgen_rounds", 
                          "max_gapfill_rounds", "max_total_time", "request_timeout"]:
                    try:
                        config_dict[key] = int(value)
                    except ValueError:
                        pass
                elif key in ["judge_temperature"]:
                    try:
                        config_dict[key] = float(value)
                    except ValueError:
                        pass
        return config_dict

    @classmethod
    def _apply_cli_arguments(cls, config_dict: dict, cli_args) -> dict:
        if cli_args:
            for field in ["max_concurrency", "rate_limit_rpm", "request_timeout", 
                         "judge_temperature", "max_testgen_rounds", "max_gapfill_rounds", 
                         "max_total_time"]:
                if hasattr(cli_args, field) and getattr(cli_args, field) is not None:
                    config_dict[field] = getattr(cli_args, field)
            
            if hasattr(cli_args, 'models') and cli_args.models:
                config_dict['models'] = cls._parse_models_from_cli(cli_args.models)

        if not config_dict["models"]:
            models_env = os.getenv("SKILL_CERT_MODELS")
            if models_env:
                config_dict["models"] = cls._parse_models_from_env(models_env)
        return config_dict

    @staticmethod
    def _load_models_from_config(models_config: List[dict]) -> List[ModelConfig]:
        """Load models from config file with API key resolution."""
        models = []
        for model_data in models_config:
            api_key = model_data.get("api_key", "")
            if api_key.startswith("${") and api_key.endswith("}"):
                var_name = api_key[2:-1]
                resolved_key = os.getenv(var_name)
                if resolved_key:
                    model_data["api_key"] = resolved_key
                else:
                    model_data["api_key"] = api_key
            models.append(ModelConfig(**model_data))
        return models

    @staticmethod
    def _parse_models_from_env(models_env: str) -> List[ModelConfig]:
        """Parse models from environment variable in format: model1=url,key,fallback|model2=url,key,fallback"""
        models = []
        if not models_env:
            return models
        
        model_strings = models_env.split("|")
        for model_str in model_strings:
            if "=" in model_str:
                name_part, config_part = model_str.split("=", 1)
                config_parts = config_part.split(",")
                
                if len(config_parts) >= 2:
                    base_url = config_parts[0]
                    api_key = config_parts[1]
                    fallback_model = config_parts[2] if len(config_parts) > 2 else None
                    
                    models.append(ModelConfig(
                        model_name=name_part,
                        base_url=base_url,
                        api_key=api_key,
                        fallback_model=fallback_model
                    ))
        
        return models

    @staticmethod
    def _parse_models_from_cli(models_cli: List[str]) -> List[ModelConfig]:
        """Parse models from CLI args in format: model1=url,key[,fallback]"""
        models = []
        for model_arg in models_cli:
            if "=" in model_arg:
                name, config_part = model_arg.split("=", 1)
                config_parts = config_part.split(",")
                if len(config_parts) >= 2:
                    base_url = config_parts[0]
                    api_key = config_parts[1]
                    fallback_model = config_parts[2] if len(config_parts) > 2 else None
                    
                    models.append(ModelConfig(
                        model_name=name,
                        base_url=base_url,
                        api_key=api_key,
                        fallback_model=fallback_model
                    ))
        
        return models