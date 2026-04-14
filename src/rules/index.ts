import { Rule } from '../principles/types';

interface Config {
  rules: Record<string, Record<string, { enabled: boolean; threshold?: number; severity?: string }>>;
}

/**
 * Load the appropriate rules for analysis
 * This function simply returns all rules for now, but could be expanded
 * to dynamically load rules based on the config
 */
export async function loadRules(config: Config): Promise<Rule[]> {
  // In the actual implementation, we'll load rules dynamically
  // For now we're returning an empty array to ensure the build works
  // The actual rule implementations will go in src/rules/ directory
  return [];
}