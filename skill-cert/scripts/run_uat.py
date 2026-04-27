#!/usr/bin/env python3
import sys
import json
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from engine.config import SkillCertConfig
from engine.analyzer import parse_skill_md
from engine.testgen import EvalGenerator
from adapters.anthropic_compat import AnthropicCompatAdapter
from engine.grader import Grader
from engine.metrics import MetricsCalculator
from engine.reporter import Reporter

PROJECT_ROOT = Path("/mnt/e/Private/opencode优化/xgate")

def run_single_skill(skill_path, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    skill_name = Path(skill_path).parent.name
    print(f"\n{'='*60}")
    print(f"  Skill-Cert UAT: {skill_name}")
    print(f"{'='*60}")
    
    config = SkillCertConfig.load()
    if not config.models:
        print("❌ No models configured")
        return None
    mc = config.models[0]
    primary = mc.model_name
    
    print(f"\n[Phase 0] Parsing SKILL.md...")
    spec = parse_skill_md(skill_path)
    print(f"  Name: {spec['name']}, confidence={spec['parse_confidence']:.2f}")
    print(f"  Steps: {len(spec['workflow_steps'])}, Anti-patterns: {len(spec['anti_patterns'])}")
    
    print(f"\n[Phase 1] Generating eval cases...")
    adapter = AnthropicCompatAdapter(base_url=mc.base_url, api_key=mc.api_key, model=primary, fallback_model=mc.fallback_model)
    gen = EvalGenerator()
    evals = gen.generate_evals_with_convergence(spec, adapter, adapter)
    eval_cases = evals.get("eval_cases", evals.get("evals", []))
    eval_count = len(eval_cases)
    print(f"  Generated {eval_count} eval cases")
    
    if eval_count == 0:
        print("❌ No eval cases")
        return None
    
    print(f"\n[Phase 2] Evaluating with model: {primary}...")
    prompts = [{"messages": [{"role": "user", "content": e.get("input", e.get("prompt", ""))}]} for e in eval_cases]
    outputs = adapter.batch_chat(prompts)
    
    grader = Grader()
    all_gradings = []
    for eval_case, output in zip(eval_cases, outputs):
        grading = grader.grade_output(eval_case, output)
        grading["run"] = "with-skill"
        grading["model"] = primary
        all_gradings.append(grading)
        passed = sum(1 for a in grading.get("assertions", []) if a.get("passed"))
        total = len(grading.get("assertions", []))
        print(f"  {eval_case.get('name', '?')}: {passed}/{total} assertions passed")
    
    calc = MetricsCalculator()
    metrics = calc.calculate_metrics(all_gradings, spec)
    print(f"\n[Phase 4] Metrics:")
    print(f"  L1 Trigger Accuracy: {metrics.get('l1_trigger_accuracy', 0):.2%}")
    print(f"  L2 Delta: {metrics.get('l2_with_without_skill_delta', 0):.2%}")
    print(f"  L3 Step Adherence: {metrics.get('l3_step_adherence', 0):.2%}")
    print(f"  L4 Stability: {metrics.get('l4_execution_stability', 0):.2%}")
    print(f"  Overall Score: {metrics.get('overall_score', 0):.2%}")
    
    print(f"\n[Phase 6] Generating reports...")
    reporter = Reporter()
    md_report, json_report = reporter.generate_report(
        metrics,
        {"overall_drift": "none", "overall_verdict": "PASS"},
        {"total_evaluations": eval_count, "avg_pass_rate": metrics.get('l1_trigger_accuracy', 0),
         "critical_passed": 0, "critical_total": 0, "important_passed": 0, "important_total": 0,
         "normal_passed": 0, "normal_total": 0}
    )
    
    report_path = output_dir / f"{skill_name}-report.md"
    report_path.write_text(md_report, encoding="utf-8")
    json_path = output_dir / f"{skill_name}-result.json"
    json_path.write_text(json.dumps(json_report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  ✅ Report: {report_path}")
    print(f"  ✅ JSON: {json_path}")
    print(f"  Verdict: {json_report.get('verdict', 'UNKNOWN')}")
    return json_report

def main():
    skill_paths = []
    for name in ["delphi-review", "sprint-flow", "test-specification-alignment"]:
        p = PROJECT_ROOT / "skills" / name / "SKILL.md"
        if p.exists():
            skill_paths.append((name, str(p)))
    print(f"Found {len(skill_paths)} skills to evaluate")
    
    output_dir = Path("results")
    results = {}
    for name, path in skill_paths:
        try:
            result = run_single_skill(path, output_dir)
            results[name] = result
        except Exception as e:
            print(f"❌ {name} failed: {e}")
            import traceback
            traceback.print_exc()
    
    print(f"\n{'='*60}")
    print(f"  UAT Summary")
    print(f"{'='*60}")
    for name, result in results.items():
        if result:
            print(f"  {name}: {result.get('verdict', 'N/A')} (score: {result.get('overall_score', 0):.2%})")
        else:
            print(f"  {name}: FAILED")
    return 0

if __name__ == "__main__":
    sys.exit(main())
