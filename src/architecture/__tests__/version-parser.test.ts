/**
 * @test REQ-ARCH-001-02 Version parsing logic
 * @intent Verify version parsing handles various formats (v2.0.0, 2.0.0, archlint 2.0.0)
 * @covers AC-ARCH-001-02
 */

import { describe, it, expect } from 'vitest';
import {
  parseVersion,
  parseMajorVersion,
  parseMinorVersion,
  isVersionCompatible,
  isVersionCompatibleWithMinor,
  parseVersionComponents
} from '../version-parser';

describe('Version Parser', () => {
  
  describe('parseVersion', () => {
    it('extracts version from "v2.0.0" format', () => {
      const input = 'v2.0.0';
      const result = parseVersion(input);
      expect(result).toBe('2.0.0');
    });
    
    it('extracts version from "2.0.0" format', () => {
      const input = '2.0.0';
      const result = parseVersion(input);
      expect(result).toBe('2.0.0');
    });
    
    it('extracts version from "archlint 2.0.0" format', () => {
      const input = 'archlint 2.0.0';
      const result = parseVersion(input);
      expect(result).toBe('2.0.0');
    });
    
    it('extracts version from "archlint v2.0.0" format', () => {
      const input = 'archlint v2.0.0';
      const result = parseVersion(input);
      expect(result).toBe('2.0.0');
    });
    
    it('returns null for invalid input', () => {
      const input = 'invalid';
      const result = parseVersion(input);
      expect(result).toBeNull();
    });
    
    it('returns null for empty input', () => {
      const input = '';
      const result = parseVersion(input);
      expect(result).toBeNull();
    });
  });
  
  describe('parseMajorVersion', () => {
    it('extracts major version from "2.0.0"', () => {
      const version = '2.0.0';
      const result = parseMajorVersion(version);
      expect(result).toBe(2);
    });
    
    it('extracts major version from "1.18.0"', () => {
      const version = '1.18.0';
      const result = parseMajorVersion(version);
      expect(result).toBe(1);
    });
    
    it('extracts major version from "0.8.0"', () => {
      const version = '0.8.0';
      const result = parseMajorVersion(version);
      expect(result).toBe(0);
    });
  });
  
  describe('parseMinorVersion', () => {
    it('extracts minor version from "2.0.0"', () => {
      const version = '2.0.0';
      const result = parseMinorVersion(version);
      expect(result).toBe(0);
    });
    
    it('extracts minor version from "1.18.0"', () => {
      const version = '1.18.0';
      const result = parseMinorVersion(version);
      expect(result).toBe(18);
    });
    
    it('extracts minor version from "0.8.0"', () => {
      const version = '0.8.0';
      const result = parseMinorVersion(version);
      expect(result).toBe(8);
    });
  });
  
  describe('isVersionCompatible', () => {
    it('returns true when version >= required (archlint)', () => {
      const version = '2.0.0';
      const requiredMajor = 2;
      const result = isVersionCompatible(version, requiredMajor);
      expect(result).toBe(true);
    });
    
    it('returns true when version > required', () => {
      const version = '3.0.0';
      const requiredMajor = 2;
      const result = isVersionCompatible(version, requiredMajor);
      expect(result).toBe(true);
    });
    
    it('returns false when version < required', () => {
      const version = '1.0.0';
      const requiredMajor = 2;
      const result = isVersionCompatible(version, requiredMajor);
      expect(result).toBe(false);
    });
    
    it('returns true for Deply >= 0.8.0', () => {
      const version = '0.8.0';
      const requiredMajor = 0;
      const requiredMinor = 8;
      const result = isVersionCompatibleWithMinor(version, requiredMajor, requiredMinor);
      expect(result).toBe(true);
    });
    
    it('returns false for Deply < 0.8.0', () => {
      const version = '0.7.0';
      const requiredMajor = 0;
      const requiredMinor = 8;
      const result = isVersionCompatibleWithMinor(version, requiredMajor, requiredMinor);
      expect(result).toBe(false);
    });
    
    it('returns true for Go >= 1.18', () => {
      const version = '1.18.0';
      const requiredMajor = 1;
      const requiredMinor = 18;
      const result = isVersionCompatibleWithMinor(version, requiredMajor, requiredMinor);
      expect(result).toBe(true);
    });
    
    it('returns false for Go < 1.18', () => {
      const version = '1.17.0';
      const requiredMajor = 1;
      const requiredMinor = 18;
      const result = isVersionCompatibleWithMinor(version, requiredMajor, requiredMinor);
      expect(result).toBe(false);
    });
  });
  
  describe('parseVersionComponents', () => {
    it('parses full version components', () => {
      const version = '2.1.3';
      const result = parseVersionComponents(version);
      expect(result).toEqual({ major: 2, minor: 1, patch: 3 });
    });
    
    it('returns null for invalid version', () => {
      const result = parseVersionComponents('invalid');
      expect(result).toBeNull();
    });
  });
});