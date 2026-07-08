const fs = require('fs');
const path = require('path');

const GATE_TOOLS = {
  PLATFORM: ['jscpd', 'lizard', 'semgrep', 'gitleaks', 'npx'],
  IAC: ['checkov', 'hadolint', 'kube-score', 'tflint'],

  LANG_MAP: {
    ts: 'typescript', py: 'python', go: 'go', java: 'java',
    kt: 'kotlin', cpp: 'cpp', swift: 'swift', dart: 'dart',
    flutter: 'flutter', sh: 'shell', ps: 'powershell', objc: 'objectivec',
  },

  LINT: {
    typescript: ['biome', 'eslint', 'tsc'],
    python: ['ruff', 'flake8', 'mypy', 'black', 'isort'],
    go: ['golangci-lint', 'go'],
    java: ['checkstyle', 'pmd'],
    kotlin: ['ktlint', 'detekt'],
    cpp: ['clang-tidy', 'cppcheck', 'cmake'],
    swift: ['swiftlint', 'swift'],
    dart: ['dart'],
    flutter: ['flutter'],
    shell: ['shellcheck'],
    powershell: ['pwsh'],
    objectivec: ['oclint'],
  },

  TEST: {
    typescript: ['vitest', 'jest'],
    python: ['pytest'],
    go: ['go'],
    java: ['mvn', 'gradle'],
    kotlin: ['mvn', 'gradle'],
    swift: ['swift'],
    cpp: ['ctest', 'gcovr'],
    dart: ['dart'],
    flutter: ['flutter'],
  },

  MUTATION: {
    typescript: ['stryker'],
    python: ['mutmut'],
    go: ['gomutants'],
    java: ['pitest'],
  },

  SPECIAL: {
    jq: { gate: 'MW', desc: 'code-walkthrough JSON parser (mandatory)' },
    tsx: { gate: 'M/M3/4/6', desc: 'TypeScript executor (via npx)' },
    node: { gate: '0/4/6/M/M3', desc: 'All TypeScript gate runtime' },
  },
};

const LANG_MARKERS = [
  { file: 'tsconfig.json', lang: 'typescript' },
  { file: 'package.json', check: (p) => {
    try {
      const json = JSON.parse(fs.readFileSync(p, 'utf8'));
      return !!(json.devDependencies && json.devDependencies.typescript)
        || !!(json.dependencies && json.dependencies.typescript);
    } catch { return false; }
  }, lang: 'typescript' },
  { file: 'go.mod', lang: 'go' },
  { file: 'pyproject.toml', lang: 'python' },
  { file: 'manage.py', lang: 'python' },
  { file: 'requirements.txt', lang: 'python' },
  { file: 'pom.xml', lang: 'java' },
  { file: 'build.gradle', lang: 'java' },
  { file: 'build.gradle.kts', lang: 'kotlin' },
  { file: 'pubspec.yaml', lang: 'flutter' },
  { file: 'CMakeLists.txt', lang: 'cpp' },
  { file: 'Package.swift', lang: 'swift' },
];

function detectProjectLang(projectRoot) {
  const found = new Set();
  const exists = (f) => fs.existsSync(path.join(projectRoot, f));
  for (const marker of LANG_MARKERS) {
    if (!exists(marker.file)) continue;
    if (marker.check && !marker.check(path.join(projectRoot, marker.file))) continue;
    found.add(marker.lang);
  }
  return [...found];
}

module.exports = { GATE_TOOLS, detectProjectLang };
