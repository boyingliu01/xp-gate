import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

interface RuleConfig {
  enabled: boolean;
  threshold?: number;
  exclude?: (string | number)[];
  severity?: string;
  methodThreshold?: number;
}

interface PrinciplesConfig {
  rules: {
    'clean-code': {
      'long-function': RuleConfig;
      'large-file': RuleConfig;
      'god-class': RuleConfig;
      'deep-nesting': RuleConfig;
      'too-many-params': RuleConfig;
      'magic-numbers': RuleConfig;
      'missing-error-handling': RuleConfig;
      'unused-imports': RuleConfig;
      'code-duplication': RuleConfig;
    };
    'solid': {
      'srp': RuleConfig;
      'ocp': RuleConfig;
      'lsp': RuleConfig;
      'isp': RuleConfig;
      'dip': RuleConfig;
    };
  };
  output?: {
    format?: string;
    'show-score'?: boolean;
    colorize?: boolean;
  };
  performance?: {
    mode?: string;
    mediumProjectDefinition?: string;
  };
}

export function getDefaultConfig(): PrinciplesConfig {
  return {
    rules: {
      'clean-code': {
        'long-function': { enabled: true, threshold: 50, severity: 'warning' },
        'large-file': { enabled: true, threshold: 500, severity: 'warning' },
        'god-class': { enabled: true, threshold: 15, severity: 'warning' },
        'deep-nesting': { enabled: true, threshold: 4, severity: 'warning' },
        'too-many-params': { enabled: true, threshold: 7, severity: 'info' },
        'magic-numbers': {
          enabled: true,
          exclude: [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024],
          severity: 'info'
        },
        'missing-error-handling': { enabled: true, severity: 'warning' },
        'unused-imports': { enabled: true, severity: 'info' },
        'code-duplication': { enabled: true, threshold: 15, severity: 'warning' }
      },
      'solid': {
        'srp': { enabled: true, methodThreshold: 15, severity: 'warning' },
        'ocp': { enabled: true, severity: 'info' },
        'lsp': { enabled: true, severity: 'info' },
        'isp': { enabled: true, methodThreshold: 10, severity: 'info' },
        'dip': {
          enabled: true,
          exclude: ['Date', 'Map', 'Set', 'Error', 'Array', 'Object', 'Promise'],
          severity: 'warning'
        }
      }
    },
    output: {
      format: 'console',
      'show-score': true,
      colorize: true
    },
    performance: {
      mode: 'changed-files-only',
      mediumProjectDefinition: '10000 lines / 500 files'
    }
  };
}

export async function loadConfig(): Promise<PrinciplesConfig> {
  const defaultConfig = getDefaultConfig();
  const configPath = join(process.cwd(), '.principlesrc');

  if (!existsSync(configPath)) {
    return defaultConfig;
  }

  try {
    const content = await readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(content) as Partial<PrinciplesConfig>;

    return {
      ...defaultConfig,
      ...userConfig,
      rules: {
        'clean-code': {
          ...defaultConfig.rules['clean-code'],
          ...userConfig.rules?.['clean-code']
        },
        'solid': {
          ...defaultConfig.rules['solid'],
          ...userConfig.rules?.['solid']
        }
      }
    };
  } catch {
    return defaultConfig;
  }
}