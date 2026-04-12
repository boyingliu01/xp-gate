import fs from 'fs/promises';
import path from 'path';
import { Config } from './types.js';

/**
 * Clean Code & SOLID Principles Checker
 * Configuration loader module.
 * 
 * This module handles loading and validating configuration for the analysis engine,
 * including default values that match the approved design specification.
 */

/**
 * Loads configuration from a file or uses defaults if not found.
 * @param configPath Path to the configuration file
 * @returns Configuration object with resolved settings
 */
export async function loadConfig(configPath: string): Promise<Config> {
  const defaultConfig: Config = {
    thresholds: {
      maxParams: 5,
      maxLinesOfCode: 50,
      maxCyclomaticComplexity: 10,
      maxClassesPerFile: 20,
      maxMethodsPerClass: 20,
      maxNestingDepth: 4,
      minIdentifierLength: 3,
      maxInstanceVariables: 10,
      maxLiteralsPerFunction: 5
    },
    enabledRules: {
      complexity: true,
      coupling: true,
      naming: true,
      solid: true,
      documentation: true
    },
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.kt', '.dart', '.swift'],
    excludePatterns: ['node_modules/', 'dist/', 'build/', '*.test.', '*.spec.', '.git/']
  };

  try {
    const configExists = await fs.access(configPath).then(() => true).catch(() => false);
    
    if (!configExists) {
      return defaultConfig;
    }

    const configFileContent = await fs.readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(configFileContent);
    
    // Merge user config with defaults
    return mergeConfigs(defaultConfig, userConfig);
  } catch (err) {
    console.warn(`Could not load config file at ${configPath}:`, err);
    return defaultConfig;
  }
}

/**
 * Merges user configuration with default configuration
 * @param defaultConfig The default configuration
 * @param userConfig The user-provided configuration
 * @returns The combined configuration
 */
function mergeConfigs(defaultConfig: Config, userConfig: Partial<Config>): Config {
  const result: Config = { ...defaultConfig };

  if (userConfig.thresholds) {
    result.thresholds = { ...result.thresholds, ...userConfig.thresholds };
  }

  if (userConfig.enabledRules) {
    result.enabledRules = { ...result.enabledRules, ...userConfig.enabledRules };
  }

  if (userConfig.fileExtensions !== undefined) {
    result.fileExtensions = userConfig.fileExtensions;
  }

  if (userConfig.excludePatterns !== undefined) {
    result.excludePatterns = userConfig.excludePatterns;
  }

  return result;
}