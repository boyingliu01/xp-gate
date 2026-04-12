#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { loadConfig } from './config.js';
import { analyzeProject } from './analyzer.js';
import { generateReport } from './reporter.js';

/**
 * Clean Code & SOLID Principles Checker
 * 
 * This tool analyzes source code against clean code and SOLID principles.
 * Supports TypeScript, Python, Go, Java, Kotlin, Dart and Swift.
 * 
 * Note: For Windows users, run this tool in WSL or Git Bash for best compatibility
 */

async function main() {
  const argv = yargs(hideBin(process.argv))
    .scriptName('clean-code-checker')
    .usage('$0 [options]')
    .options({
      'files': {
        alias: 'f',
        describe: 'List of files to analyze (comma separated)',
        type: 'string',
        demandOption: false
      },
      'changed-only': {
        alias: 'c',
        describe: 'Analyze only changed files (requires git)',
        type: 'boolean',
        default: false
      },
      'verbose': {
        alias: 'v',
        describe: 'Verbose output',
        type: 'boolean',
        default: false
      },
      'config': {
        alias: 'C',
        describe: 'Configuration file path',
        type: 'string',
        default: '.principlesrc'
      }
    })
    .help()
    .argv;

  try {
    // Load configuration
    const config = await loadConfig(argv.config);
    
    // Determine files to analyze
    let targetFiles: string[];
    
    if (argv.changedOnly) {
      // Get changed files from git
      const { execSync } = await import('child_process');
      const result = execSync('git diff --name-only --staged', { encoding: 'utf-8' });
      targetFiles = result.trim().split('\n').filter(f => f.length > 0);
    } else if (argv.files) {
      targetFiles = argv.files.split(',');
    } else {
      throw new Error('Either --files or --changed-only option must be provided');
    }

    if (argv.verbose) {
      console.log(`Analyzing ${targetFiles.length} files...`);
    }

    // Perform analysis
    const violations = await analyzeProject(targetFiles, config);
    
    // Generate report and set exit code based on violations
    const hasViolations = violations.length > 0;
    generateReport(violations, config, hasViolations);
    
    // Exit with appropriate code
    process.exit(hasViolations ? 1 : 0);
  } catch (error) {
    console.error('Error occurred during analysis:', error);
    process.exit(1);
  }
}

if (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('index.ts')) {
  main();
}

export { main };