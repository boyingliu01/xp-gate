import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  MutationRunner,
  RunMutationOptions,
  MutationRunOutcome,
  MutationRunResult,
} from './types';

const STRYKER_REPORT_PATH = '.stryker-report.json';
const STRYKER_PREPUSH_CONFIG = 'stryker.prepush.conf.json';

/**
 * Stryker mutation runner for TypeScript files.
 * Extracted from gate-m.ts to follow the LangAdapter pattern.
 */
export class StrykerRunner implements MutationRunner {
  readonly name = 'Stryker';
  readonly extensions = ['ts', 'tsx'];

  async isAvailable(): Promise<boolean> {
    try {
      const { spawnSync } = await import('child_process');
      const result = spawnSync('npx', ['stryker', '--version'], {
        stdio: 'pipe',
        shell: false,
        timeout: 5000,
      });
      return result.status !== null && result.status === 0;
    } catch {
      return false;
    }
  }

  async run(options: RunMutationOptions): Promise<MutationRunOutcome> {
    return new Promise((resolve) => {
      const args = [
        'stryker',
        'run',
        '--config',
        this.resolveConfig(options.cwd),
        ...options.files.flatMap(f => ['--mutate', f]),
      ];

      const child = spawn('npx', args, {
        stdio: 'pipe',
        shell: false,
        cwd: options.cwd,
      });

      let stderr = '';
      let stdout = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
      }, options.timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeoutId);

        if (code === null) {
          resolve({ report: null, timedOut: true });
          return;
        }

        const report = this.parseReport(options.cwd);
        resolve({
          report,
          timedOut: false,
          error: code !== 0 ? stderr || stdout : undefined,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        resolve({ report: null, timedOut: false, error: err.message });
      });
    });
  }

  private resolveConfig(cwd: string): string {
    return join(cwd, STRYKER_PREPUSH_CONFIG);
  }

  private parseReport(cwd: string): MutationRunResult | null {
    try {
      const content = readFileSync(join(cwd, STRYKER_REPORT_PATH), 'utf-8');
      return this.parseReportObject(JSON.parse(content));
    } catch {
      return null;
    }
  }

  private parseReportObject(parsed: Record<string, unknown>): MutationRunResult | null {
    const mutationScore = asNumber(parsed.mutationScore);
    const nrOfMutants = asNumber(parsed.nrOfMutants);
    const nrOfKilledMutants = asNumber(parsed.nrOfKilledMutants);
    const nrOfSurvivedMutants = asNumber(parsed.nrOfSurvivedMutants);

    if (isNaN(mutationScore) || isNaN(nrOfMutants)) return null;

    const result: MutationRunResult = {
      mutationScore,
      nrOfMutants,
      nrOfKilledMutants,
      nrOfSurvivedMutants,
    };

    if (parsed.files && typeof parsed.files === 'object') {
      result.files = parseFilesObject(parsed.files as Record<string, Record<string, unknown>>);
    }

    return result;
  }
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function parseFilesObject(
  filesObj: Record<string, Record<string, unknown>>
): Record<string, { mutationScore: number; nrOfMutants: number; nrOfKilledMutants: number; nrOfSurvivedMutants: number }> {
  const files: Record<string, { mutationScore: number; nrOfMutants: number; nrOfKilledMutants: number; nrOfSurvivedMutants: number }> = {};
  for (const [file, data] of Object.entries(filesObj)) {
    files[file] = {
      mutationScore: asNumber(data.mutationScore),
      nrOfMutants: asNumber(data.nrOfMutants),
      nrOfKilledMutants: asNumber(data.nrOfKilledMutants),
      nrOfSurvivedMutants: asNumber(data.nrOfSurvivedMutants),
    };
  }
  return files;
}
