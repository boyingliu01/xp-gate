#!/usr/bin/env python3
"""
Skill-Cert UAT 验证脚本
评测 4 个 skill：delphi-review, sprint-flow, test-specification-alignment, plan-eng-review
"""

import os
import sys
import json
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent))

from engine.config import SkillCertConfig, ModelConfig
from engine.analyzer import parse_skill_md
from engine.grader import Grader
from engine.metrics import MetricsCalculator
from engine.drift import DriftDetector
from engine.reporter import Reporter


def main():
    # 1. 验证 API 配置
    api_key = os.environ.get("SKILL_CERT_API_KEY", "")
    base_url = os.environ.get("SKILL_CERT_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    model = os.environ.get("SKILL_CERT_MODEL", "qwen-coder-plus-latest")
    
    if not api_key:
        print("❌ SKILL_CERT_API_KEY 未设置")
        print("请设置环境变量：")
        print(f'  export SKILL_CERT_API_KEY="sk-你的密钥"')
        print(f'  export SKILL_CERT_BASE_URL="{base_url}"')
        print(f'  export SKILL_CERT_MODEL="{model}"')
        sys.exit(1)
    
    print(f"✅ API 配置验证通过: model={model}, base_url={base_url}")
    
    # 2. 要评测的 skill 列表
    project_root = Path(__file__).parent.parent.parent.parent
    skills_to_test = [
        ("delphi-review", str(project_root / "skills" / "delphi-review" / "SKILL.md")),
        ("sprint-flow", str(project_root / "skills" / "sprint-flow" / "SKILL.md")),
        ("test-specification-alignment", str(project_root / "skills" / "test-specification-alignment" / "SKILL.md")),
    ]
    
    # 检查 plan-eng-review
    gstack_skill = Path.home() / ".config" / "opencode" / "skills" / "gstack" / "skills" / "plan-eng-review" / "SKILL.md"
    if gstack_skill.exists():
        skills_to_test.append(("plan-eng-review", str(gstack_skill)))
    else:
        print(f"⚠️  plan-eng-review 未安装，跳过")
    
    print(f"\n📋 待评测 skill 列表：")
    for name, path in skills_to_test:
        print(f"  - {name}: {path}")
    
    # 3. Phase 0: 解析每个 skill
    print("\n=== Phase 0: Skill 解析 ===")
    specs = {}
    for name, path in skills_to_test:
        try:
            spec = parse_skill_md(path)
            specs[name] = spec
            print(f"  ✅ {name}: {spec['parse_method']}, confidence={spec['parse_confidence']:.2f}, "
                  f"steps={len(spec['workflow_steps'])}, patterns={len(spec['anti_patterns'])}")
        except Exception as e:
            print(f"  ❌ {name}: {e}")
    
    # 4. 输出配置模板
    config_template = f"""
# 将以下内容保存到 ~/.skill-cert/models.yaml
models:
  - name: bailian-coder
    base_url: {base_url}
    api_key: $SKILL_CERT_API_KEY
    model: {model}
"""
    print(f"\n📝 配置模板：")
    print(config_template)
    print("\n🚀 UAT 准备完成！设置环境变量后即可运行完整评测。")
    print(f"   skill-cert --skill <SKILL.md路径> --models {model}")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
