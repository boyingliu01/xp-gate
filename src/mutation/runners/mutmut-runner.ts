import { spawn, execSync } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import type {
  MutationRunner,
  RunMutationOptions,
  MutationRunOutcome,
  MutationRunResult,
} from './types';

/**
 * mutmut mutation runner for Python files.
 *
 * Uses `mutmut run` to generate mutants and parses emoji progress output.
 * Supports mutmut v3.x (primary) with fallback to v2.x behavior.
 *
 * v3.x changes (GitHub issue #339):
 * - Removed `--paths-to-mutate` CLI flag
 * - Uses `source_paths` in `[tool.mutmut]` section of pyproject.toml
 * - Results stored in SQLite; `mutmut results` outputs per-mutant status lines
 * - `mutmut run` stdout shows emoji progress: 🎉 N 🫥 N ⏰ N 🤔 N 🙁 N
 */
export class MutmutRunner implements MutationRunner {
  readonly name = 'mutmut';
  readonly extensions = ['py'];

  async isAvailable(): Promise<boolean> {
    try {
      execSync('mutmut --version', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async run(options: RunMutationOptions): Promise<MutationRunOutcome> {
    // Extract unique directories from file list
    const sourceDirs = this.extractUniqueDirs(options.files);

    const pyprojectPath = join(options.cwd, 'pyproject.toml');
    const backupPath = join(options.cwd, 'pyproject.toml.xp-gate-backup');
    let hadExisting = false;

    try {
      if (existsSync(pyprojectPath)) {
        hadExisting = true;
        const existing = readFileSync(pyprojectPath, 'utf-8');
        writeFileSync(backupPath, existing, { encoding: 'utf-8' });
      }
      this.writeMutmutConfig(pyprojectPath, sourceDirs);

      return await this.runMutmut(options);
    } finally {
      try {
        if (hadExisting && existsSync(backupPath)) {
          const backup = readFileSync(backupPath, 'utf-8');
          writeFileSync(pyprojectPath, backup, { encoding: 'utf-8' });
          unlinkSync(backupPath);
        } else if (!hadExisting && existsSync(pyprojectPath)) {
          unlinkSync(pyprojectPath);
        }
      } catch {
        // Best effort cleanup
      }
    }
  }

  private async runMutmut(options: RunMutationOptions): Promise<MutationRunOutcome> {
    return new Promise((resolve) => {
      const child = spawn('mutmut', ['run'], {
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

        // Parse results from mutmut run stdout (v3.x emoji progress)
        const report = this.parseEmojiProgress(stdout);
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

  /**
   * Parse v3.x emoji progress line from mutmut run stdout.
   *
   * mutmut v3.x prints a progress summary like:
   *   38/38  🎉 9 🫥 29  ⏰ 0  🤔 0  🙁 0  🔇 0  🧙 0
   *
   * Emoji mapping:
   *   🎉 = killed
   *   🫥 = not checked (untested)
   *   ⏰ = timeout
   *   🤔 = suspicious
   *   🙁 = survived
   *   🔇 = unknown (counted as survived)
   *   🧙 = unknown (counted as survived)
   */
  private parseEmojiProgress(stdout: string): MutationRunResult | null {
    // Find the last progress line (contains 🎉)
    const lines = stdout.split('\n');
    let progressLine = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('🎉')) {
        progressLine = lines[i];
        break;
      }
    }
    if (!progressLine) return null;

    // Parse emoji counts: 🎉 N 🫥 N ⏰ N 🤔 N 🙁 N 🔇 N 🧙 N
    const killed = this.extractEmojiCount(progressLine, '🎉');
    const untested = this.extractEmojiCount(progressLine, '🫥');
    const timeout = this.extractEmojiCount(progressLine, '⏰');
    const suspicious = this.extractEmojiCount(progressLine, '🤔');
    const survived = this.extractEmojiCount(progressLine, '🙁');
    const unknown1 = this.extractEmojiCount(progressLine, '🔇');
    const unknown2 = this.extractEmojiCount(progressLine, '🧙');

    const nrOfKilledMutants = killed;
    const nrOfSurvivedMutants =
      survived + timeout + suspicious + untested + unknown1 + unknown2;
    const nrOfMutants = nrOfKilledMutants + nrOfSurvivedMutants;

    if (nrOfMutants === 0) return null;

    return {
      mutationScore: (nrOfKilledMutants / nrOfMutants) * 100,
      nrOfMutants,
      nrOfKilledMutants,
      nrOfSurvivedMutants,
    };
  }

  /**
   * Extract count after an emoji in a progress line.
   * e.g., "🎉 9" → 9
   */
  private extractEmojiCount(line: string, emoji: string): number {
    const escapedEmoji = emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = line.match(new RegExp(`${escapedEmoji}\\s*(\\d+)`));
    return parseInt(match?.[1] ?? '0', 10);
  }

  /**
   * Extract unique directories from file paths.
   * e.g., ['src/foo.py', 'src/bar.py', 'tests/baz.py'] → ['src', 'tests']
   */
  private extractUniqueDirs(files: string[]): string[] {
    const dirs = new Set<string>();
    for (const file of files) {
      const dir = dirname(file);
      if (dir && dir !== '.') {
        dirs.add(dir);
      }
    }
    // If no directories found, use current directory
    return dirs.size > 0 ? Array.from(dirs) : ['.'];
  }

  private writeMutmutConfig(pyprojectPath: string, sourceDirs: string[]): void {
    const sourcePaths = sourceDirs.map((d) => `"${d}"`).join(', ');
    const sourcePathsLine = `source_paths = [${sourcePaths}]`;

    let content = '';
    if (existsSync(pyprojectPath)) {
      content = readFileSync(pyprojectPath, 'utf-8');
      if (content.includes('[tool.mutmut]')) {
        const sourcePathsRegex = /source_paths\s*=\s*\[.*?\]/;
        if (sourcePathsRegex.test(content)) {
          content = content.replace(sourcePathsRegex, sourcePathsLine);
        } else {
          content = content.replace(
            '[tool.mutmut]',
            `[tool.mutmut]\n${sourcePathsLine}`,
          );
        }
      } else {
        content = content.trimEnd() + `\n\n[tool.mutmut]\n${sourcePathsLine}\n`;
      }
    } else {
      content = `[tool.mutmut]\n${sourcePathsLine}\n`;
    }
    writeFileSync(pyprojectPath, content, { encoding: 'utf-8' });
  }
}
