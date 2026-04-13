# .principlesrc Configuration Guide

## Overview

`.principlesrc` is a JSON configuration file for customizing the Principles Checker behavior. Place it in your project root directory.

## File Location

```
your-project/
├── .principlesrc         ← Configuration file
├── src/
└── package.json
```

## Configuration Structure

```json
{
  "rules": {
    "clean-code": { ... },
    "solid": { ... }
  },
  "output": { ... },
  "performance": { ... }
}
```

---

## Clean Code Rules

### long-function

Detects functions exceeding line threshold.

```json
{
  "rules": {
    "clean-code": {
      "long-function": {
        "enabled": true,
        "threshold": 50,
        "severity": "warning"
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable this rule |
| `threshold` | number | `50` | Maximum function lines |
| `severity` | string | `"warning"` | Violation severity |

### large-file

Detects files exceeding line threshold.

```json
{
  "large-file": {
    "enabled": true,
    "threshold": 500,
    "severity": "warning"
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | number | `500` | Maximum file lines |

### god-class

Detects classes with too many methods.

```json
{
  "god-class": {
    "enabled": true,
    "threshold": 15,
    "severity": "warning"
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | number | `15` | Maximum methods per class |

### deep-nesting

Detects deeply nested control structures.

```json
{
  "deep-nesting": {
    "enabled": true,
    "threshold": 4,
    "severity": "warning"
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | number | `4` | Maximum nesting depth |

### too-many-params

Detects functions with excessive parameters.

```json
{
  "too-many-params": {
    "enabled": true,
    "threshold": 7,
    "severity": "info"
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | number | `7` | Maximum parameter count |

### magic-numbers

Detects hardcoded numeric literals.

```json
{
  "magic-numbers": {
    "enabled": true,
    "exclude": [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024],
    "severity": "info"
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `exclude` | array | `[0, 1, -1, ...]` | Numbers to ignore |

### missing-error-handling

Detects I/O operations without try-catch.

```json
{
  "missing-error-handling": {
    "enabled": true,
    "severity": "warning"
  }
}
```

### unused-imports

Detects imported modules not used in file.

```json
{
  "unused-imports": {
    "enabled": true,
    "severity": "info"
  }
}
```

### code-duplication

Detects duplicated code blocks (requires jscpd).

```json
{
  "code-duplication": {
    "enabled": true,
    "threshold": 15,
    "severity": "warning"
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | number | `15` | Minimum duplicate token count |

---

## SOLID Rules

### srp (Single Responsibility Principle)

Detects classes with mixed responsibilities.

```json
{
  "solid": {
    "srp": {
      "enabled": true,
      "methodThreshold": 15,
      "severity": "warning"
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `methodThreshold` | number | `15` | Methods indicating SRP violation |

### ocp (Open/Closed Principle)

Detects modification patterns requiring extension.

```json
{
  "ocp": {
    "enabled": true,
    "severity": "info"
  }
}
```

### lsp (Liskov Substitution Principle)

Detects subclass behavior inconsistencies.

```json
{
  "lsp": {
    "enabled": true,
    "severity": "info"
  }
}
```

### isp (Interface Segregation Principle)

Detects "fat" interfaces.

```json
{
  "isp": {
    "enabled": true,
    "methodThreshold": 10,
    "severity": "info"
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `methodThreshold` | number | `10` | Methods indicating ISP violation |

### dip (Dependency Inversion Principle)

Detects concrete class dependencies.

```json
{
  "dip": {
    "enabled": true,
    "exclude": ["Date", "Map", "Set", "Error", "Array", "Object", "Promise"],
    "severity": "warning"
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `exclude` | array | Built-in types | Types to ignore |

---

## Output Configuration

```json
{
  "output": {
    "format": "console",
    "show-score": true,
    "colorize": true
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `format` | string | `"console"` | Output format: `console`, `json`, `sarif` |
| `show-score` | boolean | `true` | Show quality score |
| `colorize` | boolean | `true` | Enable colored output |

---

## Performance Configuration

```json
{
  "performance": {
    "mode": "changed-files-only",
    "mediumProjectDefinition": "10000 lines / 500 files"
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | string | `"changed-files-only"` | Analysis mode |
| `mediumProjectDefinition` | string | `"10000 lines..."` | Medium project threshold |

---

## Severity Levels

| Level | Description | Git Hook Behavior |
|-------|-------------|-------------------|
| `error` | Critical violation | **Blocks commit** |
| `warning` | Significant issue | Blocks commit (configurable) |
| `info` | Minor concern | Logged only, doesn't block |

---

## Complete Example

```json
{
  "rules": {
    "clean-code": {
      "long-function": { "enabled": true, "threshold": 50, "severity": "warning" },
      "large-file": { "enabled": true, "threshold": 500, "severity": "warning" },
      "god-class": { "enabled": true, "threshold": 15, "severity": "warning" },
      "deep-nesting": { "enabled": true, "threshold": 4, "severity": "warning" },
      "too-many-params": { "enabled": true, "threshold": 7, "severity": "info" },
      "magic-numbers": {
        "enabled": true,
        "exclude": [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024],
        "severity": "info"
      },
      "missing-error-handling": { "enabled": true, "severity": "warning" },
      "unused-imports": { "enabled": true, "severity": "info" },
      "code-duplication": { "enabled": true, "threshold": 15, "severity": "warning" }
    },
    "solid": {
      "srp": { "enabled": true, "methodThreshold": 15, "severity": "warning" },
      "ocp": { "enabled": true, "severity": "info" },
      "lsp": { "enabled": true, "severity": "info" },
      "isp": { "enabled": true, "methodThreshold": 10, "severity": "info" },
      "dip": {
        "enabled": true,
        "exclude": ["Date", "Map", "Set", "Error", "Array", "Object", "Promise"],
        "severity": "warning"
      }
    }
  },
  "output": {
    "format": "console",
    "show-score": true,
    "colorize": true
  },
  "performance": {
    "mode": "changed-files-only",
    "mediumProjectDefinition": "10000 lines / 500 files"
  }
}
```

---

## Legacy Code Adjustments

For projects with existing code that can't be refactored immediately:

```json
{
  "rules": {
    "clean-code": {
      "long-function": { "threshold": 80 },
      "god-class": { "threshold": 25 },
      "deep-nesting": { "threshold": 6 }
    }
  }
}
```

---

## Disabling Specific Rules

```json
{
  "rules": {
    "clean-code": {
      "magic-numbers": { "enabled": false }
    },
    "solid": {
      "isp": { "enabled": false },
      "lsp": { "enabled": false }
    }
  }
}
```

---

## CI/CD Integration

For GitHub Actions with SARIF upload:

```json
{
  "output": {
    "format": "sarif",
    "show-score": false
  }
}
```

Then upload:

```yaml
- name: Run Principles Checker
  run: npx tsx src/principles/index.ts --files "src/**/*.ts" --format sarif > results.sarif

- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v2
  with:
    sarif_file: results.sarif
```

---

## See Also

- [Performance Benchmark](performance-benchmark.md)
- [Gate Validation Guide](gate-validation-guide.md)
- [Clean Code & SOLID Checker Design](clean-code-solid-checker-design-APPROVED-v1.0.md)