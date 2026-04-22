# Installing and Configuring Delphi Review

This guide walks you through setting up the Delphi consensus review skill in your OpenCode environment.

## Prerequisites

- OpenCode installed and configured
- At least **2 different model providers** available (cross-provider requirement prevents homogenized blind spots)
- Access to at least 3 different models (for 3-expert mode) or 2 models (for 2-expert mode)

> **Why cross-provider?** Using models from the same vendor (e.g., all OpenAI) means they share training data and biases, defeating the purpose of multi-expert consensus.

## Quick Setup (3 steps)

### Step 1: Copy the configuration template

```bash
# From your project root (where opencode.json lives):
cp skills/delphi-review/.delphi-config.json.example .delphi-config.json
```

This file maps abstract expert roles to agent names. You typically don't need to edit this unless you want custom agent names.

### Step 2: Add agent definitions to opencode.json

Copy the `agent` block from `skills/delphi-review/opencode.json.delphi.example` into your `opencode.json`.

Then replace the provider/model placeholders:

```json
// Before (template):
"model": "YOUR_PROVIDER/YOUR_MODEL_A"

// After (your config):
"model": "openai/gpt-4o"
// or
"model": "anthropic/claude-sonnet-4-20250514"
// or
"model": "bailian-coding-plan/qwen3.6-plus"
```

### Step 3: Ensure provider configuration exists

Your `opencode.json` must have the provider definitions. If you're using OpenCode's built-in providers (OpenAI, Anthropic, etc.), you just need API keys set in your environment.

For custom providers (like Ali Bailian), add a provider entry:

```json
"provider": {
  "my-custom-provider": {
    "npm": "@ai-sdk/anthropic",
    "name": "My Custom Provider",
    "options": {
      "baseURL": "https://your-api-endpoint.com/v1",
      "apiKey": "your-api-key"
    },
    "models": {
      "my-model-name": {
        "name": "My Model Name",
        "modalities": {
          "input": ["text"],
          "output": ["text"]
        },
        "limit": {
          "context": 128000,
          "output": 8192
        }
      }
    }
  }
}
```

## Model Recommendations

The skill requires at least 2 experts for code changes, 3 for architecture decisions. Here are recommended model selections:

| Expert Role | Recommended | Alternatives |
|-------------|-------------|-------------|
| **Architecture (Expert A)** | Claude Sonnet 4 | GPT-4o, Qwen-Plus, Gemini 2.5 Pro |
| **Technical (Expert B)** | Claude Haiku | Qwen-Coder, DeepSeek-Coder, GPT-4o-mini |
| **Feasibility (Expert C)** | Claude Opus | GPT-4, Gemini 2.5 Pro, Qwen-Max |

**Minimum viable setup** (2-expert mode):
- Expert A: Any reasoning-strong model
- Expert B: Any code-understanding-strong model
- **Must be from different providers**

## Configuration File Reference

### `.delphi-config.json`

| Field | Description | Default |
|-------|-------------|---------|
| `num_experts` | Number of experts to use (2 or 3) | 3 |
| `experts.architecture` | Architecture reviewer configuration | Required |
| `experts.technical` | Technical reviewer configuration | Required |
| `experts.feasibility` | Feasibility reviewer configuration | Required for 3-expert mode |
| `consensus.threshold_percent` | Agreement threshold | 91 |
| `consensus.max_review_rounds` | Maximum review rounds | 5 |
| `consensus.cross_provider_required` | Require different providers | true |

### `opencode.json` agent block

| Field | Description |
|-------|-------------|
| `model` | Provider/model identifier (e.g., `openai/gpt-4o`) |
| `mode` | Must be `"subagent"` |
| `prompt` | Expert role instructions |
| `tools` | Tool permissions (read: true, write: false recommended) |

## Usage

Once configured, invoke the skill via:

```bash
/delphi-review
```

Or reference it in your workflows. The skill will automatically use the agents defined in your `opencode.json`.

## Troubleshooting

### "Agent delphi-reviewer-xxx not found"

The agent definitions in `opencode.json` don't match the names in `.delphi-config.json`. Verify:
1. Agent names in `.delphi-config.json` match keys in `opencode.json` `agent` block
2. opencode.js is valid JSON (use `jq . opencode.json` to verify)

### "Model YOUR_PROVIDER/YOUR_MODEL not available"

You forgot to replace the placeholder. Search for `YOUR_PROVIDER` in your opencode.json and replace with actual values.

### Both experts gave identical feedback

Your models are from the same provider. Configure agents to use different providers.

### Review takes too long / costs too much

Reduce to 2-expert mode in `.delphi-config.json`: set `num_experts: 2`.

## Advanced: JSON Schema Validation

For IDE autocompletion and validation, reference the schema in your `.delphi-config.json`:

```json
{
  "$schema": "https://example.com/delphi-config.schema.json"
}
```

The schema file is available at `.delphi-config.schema.json` in this directory.
