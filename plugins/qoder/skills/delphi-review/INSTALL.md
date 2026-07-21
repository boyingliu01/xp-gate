# Installing and Configuring Delphi Review (Qoder)

This guide walks you through setting up the Delphi consensus review skill in your Qoder environment.

## Prerequisites

- **Node.js >= 18** (script uses built-in `fetch`)
- At least **2 different model providers** with API access (cross-provider requirement prevents homogenized blind spots)
- `@boyingliu01/xp-gate` npm package installed (for the `delphi-external-review.cjs` script)

> **Why cross-provider?** Using models from the same vendor means they share training data and biases, defeating the purpose of multi-expert consensus.

## Quick Setup (4 steps)

### Step 1: Copy the configuration template

```bash
# From your project root:
cp skills/delphi-review/.delphi-config.json.example skills/delphi-review/.delphi-config.json
```

Or if installed globally:

```bash
cp ~/.qoder/skills/delphi-review/.delphi-config.json.example ~/.qoder/skills/delphi-review/.delphi-config.json
```

### Step 2: Edit the configuration

Open `.delphi-config.json` and fill in your API keys and model preferences:

```json
{
  "active_profile": "default",
  "profiles": {
    "default": {
      "providers": {
        "deepseek": {
          "base_url": "https://api.deepseek.com/v1",
          "api_key": "sk-your-key-here"
        },
        "zhipu": {
          "base_url": "https://open.bigmodel.cn/api/paas/v4",
          "api_key": "your-key-here"
        }
      },
      "experts": {
        "architecture": { "provider": "deepseek", "model": "deepseek-chat" },
        "technical": { "provider": "zhipu", "model": "glm-5.2" },
        "feasibility": { "provider": "local" }
      }
    }
  }
}
```

### Step 3: Verify Node.js version

```bash
node --version  # Must be >= 18.0.0
```

### Step 4: Verify configuration

Test that the script can read your config and the API is reachable:

```bash
node <script-path> --expert architecture --input "Test review: verify connectivity" --round 1 --config skills/delphi-review/.delphi-config.json
```

Where `<script-path>` is located (in priority order):
1. `node_modules/@boyingliu01/xp-gate/scripts/delphi-external-review.cjs`
2. `$(npm root -g)/@boyingliu01/xp-gate/scripts/delphi-external-review.cjs`

## Configuration Reference

### `.delphi-config.json`

| Field | Required | Description |
|-------|----------|-------------|
| `active_profile` | ✅ | Name of the active configuration profile |
| `profiles` | ✅ | Named configuration profiles (for easy switching) |
| `profiles.<name>.providers` | ✅ | Provider definitions: base_url + api_key |
| `profiles.<name>.experts` | ✅ | Expert-to-provider/model mapping |
| `profiles.<name>.experts.<role>.provider` | ✅ | Provider name, or `"local"` for orchestrator fallback |
| `consensus.threshold_percent` | ❌ | Consensus threshold (default: 90) |
| `consensus.max_review_rounds` | ❌ | Max review rounds (default: 5) |

### Switching profiles

Edit `active_profile` in the config, or use the `--profile <name>` CLI argument to override temporarily.

### Mixed mode (gradual setup)

You can start with just 1 external API and use the orchestrator model for other experts:

```json
{
  "active_profile": "starter",
  "profiles": {
    "starter": {
      "providers": {
        "deepseek": { "base_url": "https://api.deepseek.com/v1", "api_key": "sk-xxx" }
      },
      "experts": {
        "architecture": { "provider": "deepseek", "model": "deepseek-chat" },
        "technical": { "provider": "local" },
        "feasibility": { "provider": "local" }
      }
    }
  }
}
```

> This works but produces a WARNING about reduced cross-model diversity. Add more external APIs over time.

## Usage

Once configured, invoke the skill via:

```
/delphi-review
```

The skill will:
1. Read `.delphi-config.json` to find expert configurations
2. Call external model APIs via `delphi-external-review.cjs` script
3. For `provider: "local"` experts, use the orchestrator model
4. Aggregate verdicts and compute consensus

## Troubleshooting

### "Config file not found"

Copy `.delphi-config.json.example` to `.delphi-config.json` and fill in your API keys.

### "Script not found"

Install the npm package: `npm install -g @boyingliu01/xp-gate`

### "Authentication failed (401)"

Check your API key in `.delphi-config.json`. Ensure the key matches the provider.

### "All experts use the same provider"

Configure at least 2 different providers, or use `provider: "local"` for mixed mode.

### "Node.js >= 18 required"

Upgrade Node.js. The script uses the built-in `fetch` API.
