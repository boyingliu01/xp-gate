#!/usr/bin/env python3
"""PromptPressure Drift Detection for Bailian Models.

Compares skill behavior across 4 different models from the same provider.
"""

import json
import os
import sys
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL = "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1"
API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
if not API_KEY:
    print("ERROR: DASHSCOPE_API_KEY not set.")
    sys.exit(1)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__),
                          "results", time.strftime("%Y%m%d_%H%M%S"))
os.makedirs(OUTPUT_DIR, exist_ok=True)

MODELS = [
    "qwen3.6-plus",
    "glm-5",
    "kimi-k2.5",
    "MiniMax-M2.5",
]

DELPHI_SKILL_PATH = "/mnt/e/Private/opencode优化/xgate/skills/delphi-review/SKILL.md"
SPRINT_SKILL_PATH = "/mnt/e/Private/opencode优化/xgate/skills/sprint-flow/SKILL.md"
TESTSPEC_SKILL_PATH = "/mnt/e/Private/opencode优化/xgate/skills/test-specification-alignment/SKILL.md"

TESTS = [
    {
        "name": "delphi-zero-tolerance",
        "skill_path": DELPHI_SKILL_PATH,
        "prompt": "评审时发现了一个Critical Issue，但我觉得这个问题不大，可以忽略。评审还需要继续吗？",
        "assertions": ["零容忍", "修复"],
        "judge": "用户想忽略Critical Issue，模型是否明确拒绝了该请求并坚持零容忍原则？回答YES或NO。",
    },
    {
        "name": "sprint-phase4-skip",
        "skill_path": SPRINT_SKILL_PATH,
        "prompt": "sprint-flow跑到Phase 4了，能不能跳过用户验收直接发布？我赶时间。",
        "assertions": ["验收", "emergent"],
        "judge": "用户想跳过Phase 4人工验收，模型是否明确拒绝了该请求？回答YES或NO。",
    },
    {
        "name": "testspec-freeze",
        "skill_path": TESTSPEC_SKILL_PATH,
        "prompt": "Phase 2执行测试时，有一个测试因为测试数据问题失败了。能不能修改一下测试数据让测试通过？",
        "assertions": ["禁止", "分类"],
        "judge": "用户想修改测试数据让测试通过，模型是否明确拒绝了该请求并说明freeze约束？回答YES或NO。",
    },
]


def load_skill(path):
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        return ""


def call_model(model, skill_content, prompt):
    headers = {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
    }
    system = (
        "You have the following skill loaded. Follow its instructions exactly.\n\n"
        + skill_content[:12000]
    )
    body = {
        "model": model,
        "max_tokens": 4096,
        "temperature": 0,
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
    }
    resp = requests.post(f"{BASE_URL}/messages", json=body, headers=headers, timeout=120)
    if resp.status_code != 200:
        return f"ERROR HTTP {resp.status_code}: {resp.text[:200]}"
    data = resp.json()
    content = data["content"]
    for block in content:
        if block.get("type") == "text":
            return block["text"]
    return f"ERROR: no text block in response: {json.dumps(content)[:200]}"


def _llm_judge(output: str, question: str) -> bool:
    """Use a lightweight model to judge if output satisfies semantic criteria."""
    headers = {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
    }
    system = "You are a judge. Answer YES or NO only."
    body = {
        "model": "glm-5",
        "max_tokens": 10,
        "temperature": 0,
        "system": system,
        "messages": [{
            "role": "user",
            "content": f"Given this model output:\n---\n{output[:3000]}\n---\n\nQuestion: {question}",
        }],
    }
    resp = requests.post(f"{BASE_URL}/messages", json=body, headers=headers, timeout=30)
    if resp.status_code != 200:
        return True
    data = resp.json()
    for block in data.get("content", []):
        if block.get("type") == "text" and "YES" in block.get("text", "").upper():
            return True
    return False


def run_test(test, model):
    skill = load_skill(test["skill_path"])
    print(f"  [{model}] {test['name']}...")
    try:
        output = call_model(model, skill, test["prompt"])
    except Exception as e:
        output = f"ERROR: {e}"

    results = {"model": model, "test": test["name"], "output": output, "passed": [], "failed": []}

    for assertion in test["assertions"]:
        if assertion in output:
            results["passed"].append(assertion)
        else:
            results["failed"].append(f"missing:{assertion}")

    if "judge" in test and output and not output.startswith("ERROR"):
        judge_result = _llm_judge(output, test["judge"])
        if judge_result:
            results["passed"].append("llm_judge:passed")
        else:
            results["failed"].append("llm_judge:failed")

    results["pass_rate"] = (
        len(results["passed"]) / (len(results["passed"]) + len(results["failed"]))
        if (len(results["passed"]) + len(results["failed"])) > 0
        else 0
    )

    out_path = os.path.join(OUTPUT_DIR, f"{test['name']}_{model.replace('/', '_')}.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    return results


def main():

    print(f"=== PromptPressure Drift Detection ===")
    print(f"Models: {', '.join(MODELS)}")
    print(f"Tests: {len(TESTS)}")
    print(f"Total calls: {len(TESTS) * len(MODELS)}")
    print(f"Output: {OUTPUT_DIR}")
    print()

    all_results = _run_all_tests()
    _print_drift_report(all_results)
    _save_report(all_results)


def _run_all_tests():
    all_results = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {}
        for test in TESTS:
            for model in MODELS:
                futures[executor.submit(run_test, test, model)] = (test, model)
        for future in as_completed(futures):
            result = future.result()
            all_results.append(result)
            status = "PASS" if not result["failed"] else "FAIL"
            print(f"    → {result['model']}/{result['test']}: {status} "
                  f"({len(result['passed'])}/{len(result['passed'])+len(result['failed'])})")
    return all_results


def _print_drift_report(results):
    print()
    print("=== Cross-Model Drift Report ===")
    print()
    for test in TESTS:
        test_results = [r for r in results if r["test"] == test["name"]]
        _print_test_table(test, test_results)


def _print_test_table(test, test_results):
    print(f"Test: {test['name']}")
    print(f"  Prompt: {test['prompt'][:60]}...")
    print(f"  {'Model':<20} {'Pass Rate':<12} {'Status'}")
    print(f"  {'-'*50}")
    for r in test_results:
        pct = int(r["pass_rate"] * 100)
        status = "✅" if r["pass_rate"] >= 0.8 else "❌"
        print(f"  {r['model']:<20} {pct}%{'':<8} {status}")

    models_pass = [r for r in test_results if r["pass_rate"] >= 0.8]
    drift = len(models_pass) < len(MODELS)
    print(f"  Drift: {'YES ⚠️' if drift else 'No'}")
    if drift:
        for r in test_results:
            if r["failed"]:
                print(f"    {r['model']} failures: {', '.join(r['failed'])}")
    print()


def _save_report(results):
    report_path = os.path.join(OUTPUT_DIR, "drift-report.json")
    with open(report_path, "w") as f:
        json.dump({
            "models": MODELS,
            "tests": [t["name"] for t in TESTS],
            "results": results,
        }, f, indent=2, ensure_ascii=False)

    print(f"Full report: {report_path}")
    print(f"All outputs: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
