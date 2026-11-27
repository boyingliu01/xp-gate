// @no-test-required: Go mutation wrapper — tested via gate-m integration + pre-push Gate M
import { spawnSync } from 'child_process';
import { runMutationCommand } from './spawn-with-capture';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  MutationRunner,
  RunMutationOptions,
  MutationRunOutcome,
  MutationRunResult,
} from './types';

const GOMUTANTS_REPORT_PATH = '.gomutants-report.json';

/**
 * gomutants mutation runner for Go files.
 *
 * Tool: https://github.com/szhekpisov/gomutants
 *
 * Uses `gomutants run --output <json>` to generate mutants and parse report.
 * Exit codes: 0=pass, 10=below threshold, 11=below coverage.
 */
export class GoMutantRunner implements MutationRunner {
  readonly name = 'gomutants';
  readonly extensions = ['go'];

  async isAvailable(): Promise<boolean> {
    try {
      const result = spawnSync('gomutants', ['--version'], {
        stdio: 'pipe',
        timeout: 5000,
      });
      return result.status !== null && result.status === 0;
    } catch {
      return false;
    }
  }

  async run(options: RunMutationOptions): Promise<MutationRunOutcome> {
      const reportPath = join(options.cwd, GOMUTANTS_REPORT_PATH);

      const args = [
        '--output',
        reportPath,
        '--quiet',
      ];

      return runMutationCommand('gomutants', args, {
      timeoutMs: options.timeoutMs,
      cwd: options.cwd,
      shell: true,
    }, () => this.parseReport(reportPath));
  }

  private parseReport(reportPath: string): MutationRunResult | null {
    try {
      if (!existsSync(reportPath)) return null;
      const content = readFileSync(reportPath, 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return this.normalizeReport(parsed);
    } catch {
      return null;
    }
  }

/**
 * Normalize gomutants JSON into the shared MutationRunResult format.
 *
 * gomutants v0.4.0 output:
 *   test_efficacy: number (0-100) — KILLED/(KILLED+LIVED)
 *   mutations_coverage: number (0-100) — (KILLED+LIVED)/(KILLED+LIVED+NOT_COVERED)
 *   mutants_total: number
 *   mutants_killed: number
 *   mutants_lived: number
 *   mutants_not_viable: number
 *   mutants_not_covered: number
 *   files: [{ file_name: string, mutations: [{ status: "KILLED"|"LIVED"|... }] }]
 */
  private normalizeReport(parsed: Record<string, unknown>): MutationRunResult | null {
    const mutationScore = asNumber(parsed.test_efficacy, NaN);
    const nrOfMutants = asNumber(parsed.mutants_total, NaN);
    const nrOfKilledMutants = asNumber(parsed.mutants_killed, 0);
    const nrOfSurvivedMutants = asNumber(parsed.mutants_lived, 0) + asNumber(parsed.mutants_not_covered, 0);

    if (isNaN(mutationScore) || isNaN(nrOfMutants)) return null;

    const result: MutationRunResult = {
      mutationScore,
      nrOfMutants,
      nrOfKilledMutants,
      nrOfSurvivedMutants,
    };

    if (parsed.files && Array.isArray(parsed.files)) {
      result.files = parseFilesArray(parsed.files as Array<Record<string, unknown>>);
    }

    return result;
  }
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function parseFilesArray(
  filesArr: Array<Record<string, unknown>>
): Record<string, { mutationScore: number; nrOfMutants: number; nrOfKilledMutants: number; nrOfSurvivedMutants: number }> {
  const files: Record<string, { mutationScore: number; nrOfMutants: number; nrOfKilledMutants: number; nrOfSurvivedMutants: number }> = {};
  for (const entry of filesArr) {
    const fileName = asString(entry.file_name);
    if (!fileName) continue;
    const mutations = Array.isArray(entry.mutations)
      ? entry.mutations as Array<Record<string, unknown>>
      : [];
    const killed = mutations.filter(m => m.status === 'KILLED').length;
    const lived = mutations.filter(m => m.status === 'LIVED').length;
    const notCovered = mutations.filter(m => m.status === 'NOT_COVERED').length;
    const total = mutations.length;

    files[fileName] = {
      mutationScore: total > 0 ? (killed / total) * 100 : 0,
      nrOfMutants: total,
      nrOfKilledMutants: killed,
      nrOfSurvivedMutants: lived + notCovered,
    };
  }
  return files;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
