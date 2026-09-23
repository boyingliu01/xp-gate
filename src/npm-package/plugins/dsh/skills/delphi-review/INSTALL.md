# Installing and Configuring Delphi Review

This guide walks you through setting up the Delphi consensus review skill in your OpenCode environment.

## Prerequisites

- OpenCode installed and configured
- Exactly **3 callable expert model configurations** are required.
- The three configurations must use distinct trimmed executable model IDs. They may share one provider and token plan.

> Provider, vendor, gateway, and model nationality are unrestricted. The enforced diversity boundary is three distinct requested model IDs, not provider diversity.

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
"model": "bailian-tp/qwen-plus"
// The other two role model fields must be different trimmed IDs.
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

The skill requires exactly three experts for every mode. Choose three models that are callable through your configured provider.

| Expert Role | Recommended | Alternatives |
|-------------|-------------|-------------|
| **Architecture (Expert A)** | Claude Sonnet 4 | GPT-4o, Qwen-Plus, Gemini 2.5 Pro |
| **Technical (Expert B)** | Claude Haiku | Qwen-Coder, DeepSeek-Coder, GPT-4o-mini |
| **Feasibility (Expert C)** | Claude Opus | GPT-4, Gemini 2.5 Pro, Qwen-Max |

**Minimum viable setup**:
- Expert A: architecture model
- Expert B: technical model
- Expert C: feasibility model
- All three requested model IDs must be distinct. A `provider: local` fallback does not count.

## Configuration File Reference

### `.delphi-config.json`

| Field | Description | Default |
|-------|-------------|---------|
| `num_experts` | Number of experts to use | 3, fixed |
| `experts.architecture` | Architecture reviewer configuration | Required |
| `experts.technical` | Technical reviewer configuration | Required |
| `experts.feasibility` | Feasibility reviewer configuration | Required for 3-expert mode |
    | `consensus.threshold_percent` | Agreement threshold | 90 |
| `consensus.max_review_rounds` | Maximum review rounds | 5 |
| `consensus.cross_provider_required` | Deprecated and ignored; emits `cross_provider_required_ignored` | false or omitted |

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

Shared providers are allowed. Configure three distinct executable model IDs and verify all three calls succeed.

### Review takes too long / costs too much

Do not reduce the expert count. Use three callable models and keep the threshold and round bounds unchanged.

## Advanced: JSON Schema Validation

For IDE autocompletion and validation, reference the schema in your `.delphi-config.json`:

```json
{
  "$schema": "https://example.com/delphi-config.schema.json"
}
```

The schema file is available at `.delphi-config.schema.json` in this directory.
