/**
 * @test REQ-MUT-010 Mutation runner registry and resolution
 * @intent Verify registerAllRunners populates the registry, resolveRunner routes by extension,
 *         and re-exports expose the expected types and classes.
 * @covers AC-MUT-010, AC-MUT-011
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  runnerRegistry,
  registerAllRunners,
  resolveRunner,
  StrykerRunner,
  MutmutRunner,
  GoMutantRunner,
  PitestRunner,
} from '../runners/index';
import type {
  MutationFileReport,
  MutationRunResult,
  MutationRunOutcome,
  RunMutationOptions,
  MutationRunner,
} from '../runners/index';

describe('runners/index', () => {
  beforeEach(() => {
    runnerRegistry.clear();
  });

  it('exposes runnerRegistry as a Map instance', () => {
    expect(runnerRegistry).toBeInstanceOf(Map);
  });

  it('registerAllRunners() registers all 4 runners', () => {
    registerAllRunners();

    expect(runnerRegistry.size).toBe(4);
    expect(runnerRegistry.has('Stryker')).toBe(true);
    expect(runnerRegistry.has('mutmut')).toBe(true);
    expect(runnerRegistry.has('gomutants')).toBe(true);
    expect(runnerRegistry.has('pitest')).toBe(true);
  });

  it('registerAllRunners() stores correct runner class instances', () => {
    registerAllRunners();

    expect(runnerRegistry.get('Stryker')).toBeInstanceOf(StrykerRunner);
    expect(runnerRegistry.get('mutmut')).toBeInstanceOf(MutmutRunner);
    expect(runnerRegistry.get('gomutants')).toBeInstanceOf(GoMutantRunner);
    expect(runnerRegistry.get('pitest')).toBeInstanceOf(PitestRunner);
  });

  describe('resolveRunner()', () => {
    beforeEach(() => {
      registerAllRunners();
    });

    it.each([
      ['ts', 'Stryker'],
      ['tsx', 'Stryker'],
      ['py', 'mutmut'],
      ['go', 'gomutants'],
      ['java', 'pitest'],
      ['kt', 'pitest'],
      ['kts', 'pitest'],
    ])('returns %s runner for extension "%s"', (ext, expectedName) => {
      const runner = resolveRunner(ext);
      expect(runner).toBeDefined();
      expect(runner!.name).toBe(expectedName);
    });

    it('handles dot-prefixed extensions', () => {
      const runner = resolveRunner('.ts');
      expect(runner).toBeDefined();
      expect(runner!.name).toBe('Stryker');
    });

    it('returns undefined for unknown extensions', () => {
      expect(resolveRunner('rb')).toBeUndefined();
      expect(resolveRunner('swift')).toBeUndefined();
      expect(resolveRunner('')).toBeUndefined();
    });
  });

  describe('re-exports', () => {
    it('re-exports all runner classes', () => {
      expect(StrykerRunner).toBeDefined();
      expect(MutmutRunner).toBeDefined();
      expect(GoMutantRunner).toBeDefined();
      expect(PitestRunner).toBeDefined();
    });

    it('re-exports types as usable type aliases', () => {
      // Type-only imports are verified at compile time.
      // This test ensures the module shape is importable without runtime error.
      const report: MutationFileReport = {
        mutationScore: 80,
        nrOfMutants: 10,
        nrOfKilledMutants: 8,
        nrOfSurvivedMutants: 2,
      };
      const result: MutationRunResult = {
        mutationScore: 80,
        nrOfMutants: 10,
        nrOfKilledMutants: 8,
        nrOfSurvivedMutants: 2,
      };
      const outcome: MutationRunOutcome = {
        report: result,
        timedOut: false,
      };
      const options: RunMutationOptions = {
        files: ['src/foo.ts'],
        timeoutMs: 30000,
        cwd: '/tmp',
      };

      expect(report.mutationScore).toBe(80);
      expect(result.nrOfMutants).toBe(10);
      expect(outcome.timedOut).toBe(false);
      expect(options.files).toEqual(['src/foo.ts']);

      // MutationRunner is an interface — verify it can be used as a type constraint
      const fakeRunner: MutationRunner = {
        name: 'fake',
        extensions: ['fake'],
        isAvailable: async () => true,
        run: async () => ({ report: null, timedOut: false }),
      };
      expect(fakeRunner.name).toBe('fake');
    });
  });
});
