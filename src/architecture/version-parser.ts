export interface VersionComponents {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(input: string): string | null {
  if (!input) return null;
  const match = input.match(/\d+\.\d+\.\d+/);
  return match ? match[0] : null;
}

export function parseMajorVersion(version: string): number {
  const parts = version.split('.');
  return parseInt(parts[0], 10);
}

export function parseMinorVersion(version: string): number {
  const parts = version.split('.');
  return parseInt(parts[1], 10);
}

export function isVersionCompatible(version: string, requiredMajor: number): boolean {
  const major = parseMajorVersion(version);
  return major >= requiredMajor;
}

export function isVersionCompatibleWithMinor(
  version: string,
  requiredMajor: number,
  requiredMinor: number
): boolean {
  const major = parseMajorVersion(version);
  const minor = parseMinorVersion(version);
  
  if (major > requiredMajor) return true;
  if (major < requiredMajor) return false;
  return minor >= requiredMinor;
}

export function parseVersionComponents(version: string): VersionComponents | null {
  const parsed = parseVersion(version);
  if (!parsed) return null;
  
  const parts = parsed.split('.');
  return {
    major: parseInt(parts[0], 10),
    minor: parseInt(parts[1], 10),
    patch: parseInt(parts[2], 10)
  };
}