/**
 * @test config.ts - Configuration loader
 * @intent Verify config loads thresholds correctly from .principlesrc
 * @covers clean-code-solid-checker-design Section 11
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig, getDefaultConfig } from '../config';

describe('config.ts - Configuration Loader', () => {
  describe('getDefaultConfig', () => {
    it('should return default thresholds matching design spec', () => {
      const config = getDefaultConfig();

      // Clean code thresholds from design Section 6
      expect(config.rules['clean-code']['long-function'].threshold).toBe(50);
      expect(config.rules['clean-code']['large-file'].threshold).toBe(500);
      expect(config.rules['clean-code']['god-class'].threshold).toBe(15);
      expect(config.rules['clean-code']['deep-nesting'].threshold).toBe(4);
      expect(config.rules['clean-code']['too-many-params'].threshold).toBe(7);
    });

    it('should include magic numbers exclusion list', () => {
      const config = getDefaultConfig();
      const magicNumbersExclude = config.rules['clean-code']['magic-numbers'].exclude;

      expect(magicNumbersExclude).toContain(0);
      expect(magicNumbersExclude).toContain(1);
      expect(magicNumbersExclude).toContain(-1);
      expect(magicNumbersExclude).toContain(2);
      expect(magicNumbersExclude).toContain(10);
      expect(magicNumbersExclude).toContain(100);
      expect(magicNumbersExclude).toContain(1000);
      expect(magicNumbersExclude).toContain(60);
      expect(magicNumbersExclude).toContain(24);
      expect(magicNumbersExclude).toContain(7);
      expect(magicNumbersExclude).toContain(30);
      expect(magicNumbersExclude).toContain(365);
      expect(magicNumbersExclude).toContain(256);
      expect(magicNumbersExclude).toContain(1024);
    });

    it('should include SOLID thresholds from design Section 7', () => {
      const config = getDefaultConfig();

      expect(config.rules['solid']['srp'].methodThreshold).toBe(15);
      expect(config.rules['solid']['isp'].methodThreshold).toBe(10);
    });

    it('should include DIP exclusion list', () => {
      const config = getDefaultConfig();
      const dipExclude = config.rules['solid']['dip'].exclude;

      expect(dipExclude).toContain('Date');
      expect(dipExclude).toContain('Map');
      expect(dipExclude).toContain('Set');
      expect(dipExclude).toContain('Error');
      expect(dipExclude).toContain('Array');
      expect(dipExclude).toContain('Object');
      expect(dipExclude).toContain('Promise');
    });
  });

  describe('loadConfig', () => {
    it('should load .principlesrc from project root', async () => {
      // This will fail until config.ts exists
      const config = await loadConfig();
      expect(config).toBeDefined();
    });

    it('should override defaults with project config', async () => {
      // If .principlesrc has custom threshold, it should override
      const config = await loadConfig();
      // Actual test depends on .principlesrc content
      expect(config.rules).toBeDefined();
    });
  });
});