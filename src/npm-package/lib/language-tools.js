/**
 * Language-specific tool registry for quality gates.
 * Maps each language to its required/optional tools and config files.
 * 
 * @module language-tools
 * @covers Sprint Multi-Language Support
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
// The audit lives in its own module: check-tools and doctor both need the same
// completeness/validity/uniqueness rules, and a rule kept in two files drifts.
const {
  collectGateTools,
  auditAllTools,
  summarizeAudit,
  resolveLatestVersion,
  resolveToolViaShell,
} = require('./tool-audit.js');
// Reuse doctor's own cross-language list so the two commands cannot disagree
// about what "the gate CLI tools" are.
const { GATE_CLI_TOOLS } = require('./detect-deps.js');

/**
 * Tool definition for quality gate language tools.
 * @typedef {Object} ToolDef
 * @property {string} name - Tool name (executable)
 * @property {string} checkCmd - Command to check version
 * @property {Object.<string, string>} install - Install commands per platform
 * @property {boolean} optional - If true, tool is optional (SKIP if missing)
 * @property {string[]} gates - Which gates use this tool
 */

/**
 * Language definition with tools and config files.
 * @typedef {Object} LangDef
 * @property {string} name - Language identifier
 * @property {ToolDef[]} tools - Required and optional tools
 * @property {string[]} configFiles - Project config files that indicate this language
 * @property {string[]} extensions - File extensions for this language
 */

/**
 * Registry of all supported languages and their tools.
 */
const LANGUAGE_REGISTRY = {
  typescript: {
    name: 'TypeScript/JavaScript',
    extensions: ['ts', 'tsx', 'js', 'jsx', 'mjs'],
    configFiles: ['package.json', 'tsconfig.json'],
    tools: [
      {
        name: 'eslint',
        checkCmd: 'eslint --version',
        install: {
          darwin: 'npm install -g eslint',
          linux: 'npm install -g eslint',
          win32: 'npm install -g eslint',
        },
        optional: false,
        gates: ['Gate 1 (Code Quality)'],
      },
      {
        name: '@archlinter/cli',
        checkCmd: 'npx --no-install archlint --version',
        install: {
          darwin: 'npm install --save-dev @archlinter/cli',
          linux: 'npm install --save-dev @archlinter/cli',
          win32: 'npm install --save-dev @archlinter/cli',
        },
        optional: true,
        gates: ['Gate 4 (Architecture)'],
      },
      {
        name: 'dependency-cruiser',
        checkCmd: 'npx --no-install depcruise --version',
        install: {
          darwin: 'npm install --save-dev dependency-cruiser',
          linux: 'npm install --save-dev dependency-cruiser',
          win32: 'npm install --save-dev dependency-cruiser',
        },
        optional: true,
        gates: ['Gate 4 (Architecture)'],
      },
    ],
  },

  python: {
    name: 'Python',
    extensions: ['py'],
    configFiles: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'],
    tools: [
      {
        name: 'mypy',
        checkCmd: 'mypy --version',
        install: {
          darwin: 'pip install mypy',
          linux: 'pip install mypy',
          win32: 'pip install mypy',
        },
        optional: false,
        gates: ['Gate 1 (Code Quality)'],
      },
      {
        name: 'ruff',
        checkCmd: 'ruff --version',
        install: {
          darwin: 'pip install ruff',
          linux: 'pip install ruff',
          win32: 'pip install ruff',
        },
        optional: true, // fallback to flake8
        gates: ['Gate 1 (Code Quality)'],
      },
      {
        name: 'flake8',
        checkCmd: 'flake8 --version',
        install: {
          darwin: 'pip install flake8',
          linux: 'pip install flake8',
          win32: 'pip install flake8',
        },
        optional: true, // fallback if no ruff
        gates: ['Gate 1 (Code Quality)'],
      },
      {
        name: 'pytest',
        checkCmd: 'pytest --version',
        install: {
          darwin: 'pip install pytest',
          linux: 'pip install pytest',
          win32: 'pip install pytest',
        },
        optional: false,
        gates: ['Gate 5 (Tests + Coverage)'],
      },
      {
        name: 'black',
        checkCmd: 'black --version',
        install: {
          darwin: 'pip install black',
          linux: 'pip install black',
          win32: 'pip install black',
        },
        optional: true,
        gates: ['Gate 1 (Code Formatting)'],
      },
      {
        name: 'import-linter',
        checkCmd: 'lint-imports --version',
        install: {
          darwin: 'pip install import-linter',
          linux: 'pip install import-linter',
          win32: 'pip install import-linter',
        },
        optional: true,
        gates: ['Gate 4 (Architecture)'],
      },
    ],
  },

  java: {
    name: 'Java',
    extensions: ['java'],
    configFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    tools: [
      {
        name: 'mvn',
        checkCmd: 'mvn --version',
        install: {
          darwin: 'brew install maven',
          linux: 'apt-get install maven || yum install maven',
          win32: 'winget install Apache.Maven',
        },
        optional: true, // only if Maven project
        gates: ['Gate 1 (Build)'],
      },
      {
        name: 'gradle',
        checkCmd: 'gradle --version',
        install: {
          darwin: 'brew install gradle',
          linux: 'apt-get install gradle || yum install gradle',
          win32: 'winget install Gradle.Gradle',
        },
        optional: true, // only if Gradle project
        gates: ['Gate 1 (Build)'],
      },
      {
        name: 'checkstyle',
        checkCmd: 'checkstyle --version',
        install: {
          darwin: 'brew install checkstyle',
          linux: 'apt-get install checkstyle',
          win32: 'choco install checkstyle',
        },
        optional: true,
        gates: ['Gate 1 (Code Quality)'],
      },
      {
        name: 'pmd',
        checkCmd: 'pmd --version',
        install: {
          darwin: 'brew install pmd',
          linux: 'apt-get install pmd',
          win32: 'choco install pmd',
        },
        optional: true,
        gates: ['Gate 1 (Code Quality)'],
      },
      {
        // A BUILD dependency, not a CLI: there is no `archunit` binary to probe,
        // so checkCmd cannot work here. Detected by scanning the build files.
        name: 'archunit',
        detectBy: 'build-file',
        install: {
          darwin: 'add "com.tngtech.archunit:archunit-junit5" to pom.xml / build.gradle',
          linux: 'add "com.tngtech.archunit:archunit-junit5" to pom.xml / build.gradle',
          win32: 'add "com.tngtech.archunit:archunit-junit5" to pom.xml / build.gradle',
        },
        optional: true,
        gates: ['Gate 4 (Architecture)'],
      },
    ],
  },

  go: {
    name: 'Go',
    extensions: ['go'],
    configFiles: ['go.mod', 'go.sum'],
    tools: [
      {
        name: 'go',
        checkCmd: 'go version',
        install: {
          darwin: 'brew install go',
          linux: 'apt-get install golang || yum install golang',
          win32: 'winget install GoLang.Go',
        },
        optional: false,
        gates: ['Gate 1 (Build + Quality)'],
      },
      {
        name: 'golangci-lint',
        checkCmd: 'golangci-lint --version',
        install: {
          darwin: 'brew install golangci-lint',
          linux: 'go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest',
          win32: 'go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest',
        },
        optional: true,
        gates: ['Gate 1 (Code Quality)'],
      },
      {
        name: 'arch-go',
        checkCmd: 'arch-go --version',
        install: {
          darwin: 'go install github.com/fdaines/arch-go@latest',
          linux: 'go install github.com/fdaines/arch-go@latest',
          win32: 'go install github.com/fdaines/arch-go@latest',
        },
        optional: true,
        gates: ['Gate 4 (Architecture)'],
      },
    ],
  },

  kotlin: {
    name: 'Kotlin',
    extensions: ['kt', 'kts'],
    configFiles: ['build.gradle', 'build.gradle.kts', 'pom.xml'],
    tools: [
      {
        name: 'gradle',
        checkCmd: 'gradle --version',
        install: {
          darwin: 'brew install gradle',
          linux: 'apt-get install gradle',
          win32: 'winget install Gradle.Gradle',
        },
        optional: true,
        gates: ['Gate 1 (Build)'],
      },
      {
        name: 'ktlint',
        checkCmd: 'ktlint --version',
        install: {
          darwin: 'brew install ktlint',
          linux: 'curl -sSLO https://github.com/pinterest/ktlint/releases/latest/download/ktlint && chmod +x ktlint',
          win32: 'choco install ktlint',
        },
        optional: true,
        gates: ['Gate 1 (Code Quality)'],
      },
      {
        // Konsist is a build dependency too -- see the Java ArchUnit note above.
        name: 'konsist',
        detectBy: 'build-file',
        install: {
          darwin: 'add "com.lemonappdev:konsist" to build.gradle(.kts)',
          linux: 'add "com.lemonappdev:konsist" to build.gradle(.kts)',
          win32: 'add "com.lemonappdev:konsist" to build.gradle(.kts)',
        },
        optional: true,
        gates: ['Gate 4 (Architecture)'],
      },
    ],
  },

  // #730: C# was supported by every gate (adapter, principles engine, Gate 4/5/6/10/13
  // arms) but absent here, so `detect-languages` produced a config WITHOUT csharp.
  // A hook that reads the generated config trusts it and does not fall back to
  // extension sniffing, so C# was never routed — the whole feature was invisible in
  // exactly the mixed .NET+JS repos it targets (the dsh-aot-runner shape: .csproj plus
  // ~900 lines of JS). Registry membership is what makes detection emit the entry.
  csharp: {
    name: 'C#/.NET',
    extensions: ['cs', 'csx'],
    // `.csproj`/`.sln` are SUFFIXES of project-specific filenames (Foo.csproj), so
    // they must be written as globs — the matcher only globs entries containing '*'
    // and otherwise stats the exact name, which would never find DshAotRunner.csproj.
    // Directory.Build.props carries repo-wide MSBuild settings; global.json pins the
    // SDK, so a repo with only that plus sources still deserves the C# arm.
    configFiles: ['*.csproj', '*.sln', '*.csproj.user', 'Directory.Build.props', 'global.json'],
    tools: [
      {
        // The adapter drives everything through the SDK: `dotnet format` for Gate 1,
        // `dotnet build -warnaserror` for Gate 13, `dotnet test` for Gate 5.
        name: 'dotnet',
        checkCmd: 'dotnet --version',
        install: {
          darwin: 'brew install --cask dotnet-sdk',
          linux: 'See https://learn.microsoft.com/dotnet/core/install/linux',
          win32: 'winget install Microsoft.DotNet.SDK.8',
        },
        optional: false,
        gates: ['Gate 1 (Code Quality)', 'Gate 5 (Tests + Coverage)', 'Gate 13 (Compiler Strictness)'],
      },
      // No second C# entry for coverage. `dotnet test --collect` supplies it, and
      // the only project-provided detector this module implements is
      // `detectBy: 'build-file'`, which reads ARCH_DEPENDENCY_COORDINATES — a table
      // with no C# entry. Listing coverlet under a detectBy value nothing consumes
      // would make check-tools probe a tool with no checkCmd and report a
      // permanently-missing entry for a dependency that is already satisfied.
    ],
  },

  swift: {
    name: 'Swift',
    extensions: ['swift'],
    configFiles: ['Package.swift', 'project.xcodeproj', 'project.pbxproj'],
    tools: [
      {
        name: 'swift',
        checkCmd: 'swift --version',
        install: {
          darwin: 'xcode-select --install',
          linux: 'See https://swift.org/download/',
          win32: 'See https://swift.org/download/',
        },
        optional: false,
        gates: ['Gate 1 (Build + Quality)'],
      },
      {
        name: 'swiftlint',
        checkCmd: 'swiftlint --version',
        install: {
          darwin: 'brew install swiftlint',
          linux: 'See https://github.com/realm/SwiftLint',
          win32: 'See https://github.com/realm/SwiftLint',
        },
        optional: true,
        gates: ['Gate 1 (Code Quality)'],
      },
    ],
  },

  // #846: Objective-C had a full runtime (githooks/adapters/objectivec.sh) and
  // was recognised by every GATE-layer list -- Gate 1's short-circuit, Gate 3's
  // lizard population, Gate 4's PRINCIPLES_FILES, Gate 5's CODE_EXTENSIONS,
  // Gate 10's SEMGREP_FILES, lib/docs-only.sh -- yet was absent HERE. That is
  // #730's shape exactly: `detect-languages` writes a config without it, the
  // hook trusts that config and does NOT fall back to extension sniffing, so an
  // Objective-C repo was never routed. Registry membership, not gate support, is
  // what makes a language reachable.
  //
  // Detection keys off Xcode manifests and NOT off the `.m`/`.mm` extension.
  // `.m` is also MATLAB's, and `configFiles` is non-empty here on purpose:
  // detectProjectLanguages only consults the extension fallback when
  // `configFiles.length === 0`, so listing a manifest both enables detection and
  // structurally prevents a MATLAB checkout from being reported as Objective-C.
  // `*.pbxproj` is globbed because the project file lives inside
  // `<name>.xcodeproj/`, not at the repo root.
  objectivec: {
    name: 'Objective-C',
    extensions: ['m', 'mm'],
    configFiles: ['Podfile', 'Package.swift', '*.xcodeproj', '*.pbxproj'],
    tools: [
      {
        name: 'clang',
        checkCmd: 'clang --version',
        install: {
          darwin: 'xcode-select --install',
          linux: 'apt install clang',
          win32: 'See https://clang.llvm.org/get_started.html',
        },
        optional: false,
        gates: ['Gate 1 (Build + Quality)'],
      },
    ],
  },

  // #731: PHP. `configFiles` is non-empty on purpose, for the same structural
  // reason as objectivec below -- detectProjectLanguages only consults the
  // extension fallback when `configFiles.length === 0`, so a manifest keeps the
  // signal anchored to a real project rather than to a stray .php file.
  // composer.json is listed first but is NOT treated as exclusive: unlike a
  // .csproj, it coexists happily with package.json in JS repos that shell out for
  // one build step. The Gate 0 detection arm keys off `.php` extensions instead.
  php: {
    name: 'PHP',
    extensions: ['php', 'phtml'],
    configFiles: ['composer.json', 'phpunit.xml', 'phpunit.xml.dist', 'phpstan.neon'],
    tools: [
      {
        name: 'php',
        checkCmd: 'php --version',
        install: {
          darwin: 'brew install php',
          linux: 'sudo apt install php-cli composer',
          win32: 'scoop install php composer',
        },
        optional: false,
        gates: ['Gate 1 (Build + Quality)', 'Gate 5 (Coverage)'],
      },
      {
        name: 'composer',
        checkCmd: 'composer --version',
        install: {
          darwin: 'brew install composer',
          linux: 'See https://getcomposer.org/download/',
          win32: 'scoop install composer',
        },
        optional: false,
        gates: ['Gate 1 (Build + Quality)'],
      },
      {
        name: 'phpstan',
        checkCmd: 'php vendor/bin/phpstan --version',
        install: {
          darwin: 'composer require --dev phpstan/phpstan',
          linux: 'composer require --dev phpstan/phpstan',
          win32: 'composer require --dev phpstan/phpstan',
        },
        optional: false,
        gates: ['Gate 1 (Build + Quality)'],
      },
      {
        name: 'phpcs',
        checkCmd: 'php vendor/bin/phpcs --version',
        install: {
          darwin: 'composer require --dev squizlabs/php_codesniffer',
          linux: 'composer require --dev squizlabs/php_codesniffer',
          win32: 'composer require --dev squizlabs/php_codesniffer',
        },
        optional: false,
        gates: ['Gate 1 (Build + Quality)'],
      },
      {
        name: 'pcov',
        checkCmd: 'php -r "exit(extension_loaded(\'pcov\')?0:1);"',
        install: {
          darwin: 'pecl install pcov',
          linux: 'pecl install pcov',
          win32: 'php_pcov.dll from https://windows.php.net/downloads/pecl/releases/pcov/ (must match the PHP build: ts vs nts)',
        },
        // Coverage is Gate 5's business; a missing driver makes coverage
        // unmeasurable, which the adapter reports as BLOCK rather than 0%.
        optional: true,
        gates: ['Gate 5 (Coverage)'],
      },
    ],
  },

  dart: {
    name: 'Dart',
    extensions: ['dart'],
    configFiles: ['pubspec.yaml'],
    tools: [
      {
        name: 'dart',
        checkCmd: 'dart --version',
        install: {
          darwin: 'brew tap dart-lang/dart && brew install dart',
          linux: 'See https://dart.dev/get-dart',
          win32: 'winget install Dart-Dart.dart',
        },
        optional: false,
        gates: ['Gate 1 (Build + Quality)'],
      },
    ],
  },

  flutter: {
    name: 'Flutter',
    extensions: ['dart'],
    configFiles: ['pubspec.yaml'],
    tools: [
      {
        name: 'flutter',
        checkCmd: 'flutter --version',
        install: {
          darwin: 'brew install --cask flutter',
          linux: 'See https://flutter.dev/docs/get-started/install',
          win32: 'winget install Flutter.Flutter',
        },
        optional: false,
        gates: ['Gate 1 (Build + Quality)'],
      },
    ],
  },

  cpp: {
    name: 'C/C++',
    extensions: ['cpp', 'cxx', 'cc', 'c', 'hpp', 'h'],
    configFiles: ['CMakeLists.txt', 'Makefile', 'conanfile.txt', 'vcpkg.json'],
    tools: [
      {
        name: 'cmake',
        checkCmd: 'cmake --version',
        install: {
          darwin: 'brew install cmake',
          linux: 'apt-get install cmake || yum install cmake',
          win32: 'winget install Kitware.CMake',
        },
        optional: true,
        gates: ['Gate 1 (Build)'],
      },
      {
        name: 'clang-tidy',
        checkCmd: 'clang-tidy --version',
        install: {
          darwin: 'brew install llvm',
          linux: 'apt-get install clang-tidy',
          win32: 'See LLVM installer',
        },
        optional: true,
        gates: ['Gate 1 (Code Quality)'],
      },
    ],
  },

  shell: {
    name: 'Shell',
    extensions: ['sh', 'bash'],
    configFiles: [],
    tools: [
      {
        name: 'shellcheck',
        checkCmd: 'shellcheck --version',
        install: {
          darwin: 'brew install shellcheck',
          linux: 'apt-get install shellcheck || yum install shellcheck',
          win32: 'winget install ShellCheck.ShellCheck',
        },
        optional: true,
        gates: ['Gate 1 (Code Quality)'],
      },
    ],
  },

  powershell: {
    name: 'PowerShell',
    extensions: ['ps1', 'psm1', 'psd1'],
    configFiles: [],
    tools: [
      {
        name: 'pwsh',
        checkCmd: 'pwsh --version',
        install: {
          darwin: 'brew install --cask powershell',
          linux: 'apt-get install powershell || yum install powershell',
          win32: 'winget install Microsoft.PowerShell',
        },
        optional: false,
        gates: ['Gate 1 (Build + Quality)'],
      },
      {
        name: 'psscriptanalyzer',
        checkCmd: 'pwsh -Command "Get-Module -List PSScriptAnalyzer"',
        install: {
          darwin: 'pwsh -Command "Install-Module -Name PSScriptAnalyzer -Force"',
          linux: 'pwsh -Command "Install-Module -Name PSScriptAnalyzer -Force"',
          win32: 'pwsh -Command "Install-Module -Name PSScriptAnalyzer -Force"',
        },
        optional: true,
        gates: ['Gate 1 (Code Quality)'],
      },
    ],
  },

  iac: {
    name: 'Infrastructure as Code',
    extensions: ['tf', 'tfvars', 'yaml', 'yml'],
    configFiles: ['*.tf', 'docker-compose*.yaml', 'k8s/*.yaml'],
    tools: [
      {
        name: 'terraform',
        checkCmd: 'terraform --version',
        install: {
          darwin: 'brew install terraform',
          linux: 'See https://developer.hashicorp.com/terraform/downloads',
          win32: 'winget install Hashicorp.Terraform',
        },
        optional: true,
        gates: ['Gate 7 (IaC Security)'],
      },
      {
        name: 'tflint',
        checkCmd: 'tflint --version',
        install: {
          darwin: 'brew install tflint',
          linux: 'See https://github.com/terraform-linters/tflint',
          win32: 'See https://github.com/terraform-linters/tflint',
        },
        optional: true,
        gates: ['Gate 7 (IaC Security)'],
      },
    ],
  },
};

/**
 * Directories that must never drive language detection: dependency trees ship
 * .sh and .ps1 files of their own, which would label every Node project a Shell
 * project.
 */
const IGNORED_SCAN_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.stryker-tmp', '.next']);

// A bounded scan, not a full walk: detection only needs to know whether an
// extension occurs at all, and huge monorepos must not pay for every file.
const EXTENSION_SCAN_LIMIT = 2000;

function extensionsPresentIn(projectRoot) {
  const extensions = new Set();
  const pending = [projectRoot];
  let inspected = 0;

  while (pending.length > 0 && inspected < EXTENSION_SCAN_LIMIT) {
    const dir = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    // Sorted: readdir order is filesystem-dependent, and a bounded scan that
    // stops at an entry count must give the same answer on every machine
    // (Round 1: feasibility FC-03, architecture MI-01).
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (inspected >= EXTENSION_SCAN_LIMIT) break;
      inspected += 1;
      if (entry.isDirectory()) {
        if (!IGNORED_SCAN_DIRS.has(entry.name)) pending.push(path.join(dir, entry.name));
        continue;
      }
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (ext) extensions.add(ext);
    }
  }

  return extensions;
}

/**
 * Read the --languages selection, in either accepted form.
 * `--languages=<a,b>` and `--languages <a,b>`; a bare `--languages`, and an
 * inline `--languages=` with an empty value, both fall back to auto-detection
 * rather than selecting a language named ''.
 * @param {string[]} args
 * @returns {string[]|null}
 */
function parseLanguageFlag(args) {
  const inline = args.find((arg) => arg.startsWith('--languages='));
  let value;
  if (inline !== undefined) {
    value = inline.slice('--languages='.length);
  } else {
    const index = args.indexOf('--languages');
    const following = index === -1 ? undefined : args[index + 1];
    value = following && !following.startsWith('-') ? following : undefined;
  }
  if (value === undefined) return null;
  const picked = value.split(',').filter(Boolean);
  return picked.length > 0 ? picked : null;
}

/**
 * Detect languages used in the current project.
 * @param {string} projectRoot - Project root directory
 * @returns {{detected: string[], configFiles: Object.<string, string[]>}}
 */
function detectProjectLanguages(projectRoot) {
  const detected = new Set();
  const configFiles = {};

  // Scanned lazily: the extension fallback is only consulted for languages that
  // have no config file to look for, and the scan is bounded, not a full walk.
  let scannedExtensions = null;
  const extensionSeen = (ext) => {
    if (scannedExtensions === null) scannedExtensions = extensionsPresentIn(projectRoot);
    return scannedExtensions.has(ext);
  };

  for (const [lang, def] of Object.entries(LANGUAGE_REGISTRY)) {
    const foundConfigs = [];
    
    for (const configFile of def.configFiles) {
      // Handle glob patterns
      if (configFile.includes('*')) {
        // Simple glob matching
        const pattern = configFile.replace(/\*/g, '.*');
        const regex = new RegExp(pattern);
        try {
          const files = fs.readdirSync(projectRoot);
          for (const file of files) {
            if (regex.test(file)) {
              foundConfigs.push(file);
            }
          }
        } catch { /* ignore */ }
      } else {
        const configPath = path.join(projectRoot, configFile);
        if (fs.existsSync(configPath)) {
          foundConfigs.push(configFile);
        }
      }
    }

    if (foundConfigs.length > 0) {
      detected.add(lang);
      configFiles[lang] = foundConfigs;
    } else if (def.configFiles.length === 0 && def.extensions.some(extensionSeen)) {
      // Shell and PowerShell have no package-manager manifest to key off, so file
      // extensions are their only possible signal (#468). Languages that do have
      // config files keep using them: their extension lists are broad (IaC lists
      // yaml/yml), and matching on those would make every repo with a CI YAML an
      // Infrastructure-as-Code project.
      detected.add(lang);
    }
  }

  // Special case: Flutter vs Dart
  if (detected.has('flutter') && detected.has('dart')) {
    detected.delete('dart'); // Flutter implies Dart
  }

  // Check for Flutter specifically
  const pubspecPath = path.join(projectRoot, 'pubspec.yaml');
  if (fs.existsSync(pubspecPath)) {
    try {
      const content = fs.readFileSync(pubspecPath, 'utf8');
      if (content.includes('flutter:')) {
        detected.delete('dart');
        detected.add('flutter');
      }
    } catch { /* ignore */ }
  }

  return {
    detected: Array.from(detected),
    configFiles,
  };
}

/**
 * Check if a CLI tool is available.
 * @param {string} toolName - Tool name
 * @param {string} checkCmd - Command to check version
 * @returns {{available: boolean, version?: string}}
 */
function checkTool(toolName, checkCmd) {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const nullRedir = isWindows ? '2>nul' : '2>/dev/null';
  const execOpts = { 
    encoding: 'utf8', 
    stdio: ['ignore', 'pipe', 'pipe'], 
    shell, 
    timeout: 10000 
  };

  try {
    const result = execSync(`${checkCmd} ${nullRedir}`, execOpts);
    return { available: true, version: result.trim().split('\n')[0] };
  } catch {
    return { available: false };
  }
}

/**
 * Get required tools for detected languages.
 * @param {string[]} languages - Detected languages
 * @returns {Object.<string, Array<{tool: ToolDef, status: string}>>}
 */
function getToolsForLanguages(languages) {
  const result = {};

  for (const lang of languages) {
    const langDef = LANGUAGE_REGISTRY[lang];
    if (!langDef) continue;

    result[lang] = [];

    for (const tool of langDef.tools) {
      // Build-file tools have no binary to probe; running checkCmd on them
      // would report "missing" permanently (#689 AC-3).
      const status = tool.detectBy === 'build-file'
        ? detectBuildFileDependency(lang)
        : checkTool(tool.name, tool.checkCmd);
      result[lang].push({
        tool,
        status: status.available ? 'available' : 'missing',
        version: status.version,
      });
    }
  }

  return result;
}

/**
 * Install a tool using the appropriate command for the current platform.
 * @param {ToolDef} toolDef - Tool definition
 * @returns {{success: boolean, message: string}}
 */
function installTool(toolDef) {
  // A build-file tool has no installer to run: `detectBy: 'build-file'` exists
  // because ArchUnit and Konsist are libraries with no CLI to probe, and their
  // `install` field holds an instruction written for a human. Handing that
  // prose to execSync made `doctor --fix --install-tools` print
  // `'add' is not recognized as an internal or external command` on every Java
  // machine, and on POSIX actually shell it. Report the guidance and start no
  // process (#689 review, found by Delphi Round 1).
  if (toolDef.detectBy === 'build-file') {
    const guidance = toolDef.install[process.platform] || toolDef.install.linux || '';
    return {
      success: false,
      message:
        `${toolDef.name} is a build-file library, not a CLI: no install command is runnable. ` +
        `Add it manually -- ${guidance}`,
    };
  }

  const platform = process.platform;
  const installCmd = toolDef.install[platform] || toolDef.install.linux;

  if (!installCmd) {
    return { success: false, message: `No install command for platform ${platform}` };
  }

  const isWindows = platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const execOpts = { 
    encoding: 'utf8', 
    stdio: 'inherit', 
    shell, 
    timeout: 120000 
  };

  try {
    console.log(`Installing ${toolDef.name}: ${installCmd}`);
    execSync(installCmd, execOpts);
    return { success: true, message: `${toolDef.name} installed successfully` };
  } catch (error) {
    return { success: false, message: `Failed to install ${toolDef.name}: ${error.message}` };
  }
}

/**
 * Generate project language config file.
 * @param {string} projectRoot - Project root
 * @param {string[]} languages - Detected languages
 * @param {Object} toolStatus - Tool status per language
 */
function generateProjectConfig(projectRoot, languages, toolStatus) {
  const config = {
    version: 1,
    languages: languages.reduce((acc, lang) => {
      const langDef = LANGUAGE_REGISTRY[lang];
      acc[lang] = {
        name: langDef?.name || lang,
        tools: (toolStatus[lang] || []).map(t => ({
          name: t.tool.name,
          status: t.status,
          optional: t.tool.optional,
          gates: t.tool.gates,
        })),
      };
      return acc;
    }, {}),
    lastDetected: new Date().toISOString(),
  };

  const configPath = path.join(projectRoot, '.xp-gate-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  return configPath;
}

/**
 * Read existing project config if present.
 * @param {string} projectRoot - Project root
 * @returns {Object|null}
 */
function readProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.xp-gate-config.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Files that declare a build dependency. The version catalog is included because
 * a Gradle project may describe the coordinate ONLY there, never in
 * build.gradle.kts -- checking just the build script would report a genuinely
 * installed tool as missing (AC-689-06).
 *
 * Only the ROOT of the project is scanned: a multi-module build aggregates its
 * dependencies at the root, and walking every submodule would cost a directory
 * traversal per language for no gain (AC-689-09).
 */
const BUILD_FILE_CANDIDATES = [
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'gradle/libs.versions.toml',
];

/**
 * The coordinate each language's architecture tool is declared under.
 *
 * Split per language on purpose: Konsist is a Kotlin tool, but nothing stops a
 * Java project from also depending on it. Matching a single shared list would
 * let one language's declaration turn another language's row green, so doctor
 * would stop reporting the real gap (AC-689-07).
 */
const ARCH_DEPENDENCY_COORDINATES = {
  java: 'com.tngtech.archunit',
  kotlin: 'com.lemonappdev',
};

/**
 * Whether a build-file-declared architecture tool is present.
 *
 * Tools with `detectBy: 'build-file'` have no CLI to probe -- ArchUnit and
 * Konsist are libraries. Probing them with checkCmd reports "missing" forever,
 * which is what #689 is about: doctor told Java users their architecture tool
 * was absent no matter what they did.
 *
 * @param {string} lang - Language key from LANGUAGE_REGISTRY
 * @param {string} [projectRoot] - Project root; defaults to cwd
 * @returns {{available: boolean, version: string, path: string|null}}
 */
function detectBuildFileDependency(lang, projectRoot) {
  const root = projectRoot || process.cwd();
  const coordinate = ARCH_DEPENDENCY_COORDINATES[lang];
  if (!coordinate) return { available: false, version: 'N/A', path: null };

  for (const relPath of BUILD_FILE_CANDIDATES) {
    const candidate = path.join(root, relPath);
    if (!fs.existsSync(candidate)) continue;
    let contents;
    try {
      contents = fs.readFileSync(candidate, 'utf-8');
    } catch {
      // An unreadable build file is not evidence the tool is absent, but it is
      // not evidence it is present either. Try the next candidate rather than
      // claiming either way.
      continue;
    }
    if (contents.includes(coordinate)) {
      return { available: true, version: `declared in ${relPath}`, path: candidate };
    }
  }
  return { available: false, version: 'N/A', path: null };
}

/**
 * The architecture tools registered for each language.
 *
 * "Architecture tool" is recognised by its Gate 4 label rather than by a second
 * parallel list: one source of truth means a tool cannot be registered and
 * simultaneously missing from the doctor view.
 *
 * @returns {Object<string, Array>} language -> tool definitions
 */
function getArchitectureTools() {
  const result = {};
  for (const [lang, langDef] of Object.entries(LANGUAGE_REGISTRY)) {
    const arch = langDef.tools.filter(tool =>
      tool.gates.some(gate => gate.includes('Architecture'))
    );
    if (arch.length > 0) result[lang] = arch;
  }
  return result;
}

module.exports = {
  LANGUAGE_REGISTRY,
  detectProjectLanguages,
  checkTool,
  getToolsForLanguages,
  installTool,
  generateProjectConfig,
  readProjectConfig,
  handleDetectLanguages,
  handleCheckTools,
  handleInstallTools,
  planToolRepairs,
  getArchitectureTools,
  detectBuildFileDependency,
};

/**
 * Handle detect-languages CLI command.
 * @param {string[]} args - Command arguments
 * @returns {Promise<number>} Exit code
 */
async function handleDetectLanguages(args, options = {}) {
  // Injectable like the other handle* functions in this file. It defaulted to
  // `process.cwd()` with no seam, so the only way to test it was to chdir --
  // which vitest workers do not allow, and which made the whole command
  // untestable rather than merely untested.
  const projectRoot = options.projectRoot || process.cwd();
  const jsonOutput = args.includes('--json');
  const writeConfig = args.includes('--write') || !jsonOutput;

  console.log('Detecting project languages...');
  console.log(`Project root: ${projectRoot}\n`);

  const { detected, configFiles } = detectProjectLanguages(projectRoot);

  if (detected.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({ languages: [], configFiles: {} }, null, 2));
    } else {
      console.log('No languages detected.');
    }
    return 0;
  }

  const toolStatus = getToolsForLanguages(detected);

  if (jsonOutput) {
    const result = {
      languages: detected,
      configFiles,
      tools: {},
    };
    for (const [lang, tools] of Object.entries(toolStatus)) {
      result.tools[lang] = tools.map(t => ({
        name: t.tool.name,
        status: t.status,
        optional: t.tool.optional,
        version: t.version,
      }));
    }
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('Detected languages:');
    for (const lang of detected) {
      const langDef = LANGUAGE_REGISTRY[lang];
      console.log(`  • ${langDef?.name || lang} (${lang})`);
      if (configFiles[lang]) {
        console.log(`    Config files: ${configFiles[lang].join(', ')}`);
      }
      if (toolStatus[lang]) {
        const available = toolStatus[lang].filter(t => t.status === 'available').length;
        const total = toolStatus[lang].length;
        console.log(`    Tools: ${available}/${total} available`);
        for (const t of toolStatus[lang]) {
          const statusIcon = t.status === 'available' ? '✓' : '✗';
          const optMark = t.tool.optional ? ' (optional)' : '';
          console.log(`      ${statusIcon} ${t.tool.name}${optMark}${t.version ? ` — ${t.version}` : ''}`);
        }
      }
    }
  }

  if (writeConfig) {
    const configPath = generateProjectConfig(projectRoot, detected, toolStatus);
    console.log(`\nGenerated config: ${configPath}`);
  }

  return 0;
}

/**
 * Handle check-tools CLI command.
 * @param {string[]} args - Command arguments
 * @returns {Promise<number>} Exit code
 */
/**
 * Render one audit row as the status the CLI contract uses.
 *
 * A row is unusable for two different reasons and they must not be merged:
 * the probe failed (missing/broken), or the probe could not be interpreted.
 * Both are "not usable", but only the first is "not installed".
 */
function statusOfRow(row) {
  return row.available ? 'available' : 'missing';
}

/** Icon for a row: present, present-but-flagged, or absent. */
function iconOfRow(row) {
  if (!row.available) return '✗';
  if (row.duplicated || row.outdated) return '⚠';
  return '✓';
}

/** Extra qualifiers appended to a human line, e.g. "duplicate ×2, 2.14.0 → 2.15.1". */
function qualifiersOfRow(row) {
  const parts = [];
  if (row.duplicated) parts.push(`DUPLICATE ×${row.distinctRealPaths.length}`);
  if (row.outdated && row.installedVersion && row.latestVersion) {
    parts.push(`${row.installedVersion} → ${row.latestVersion} available`);
  } else if (row.currency === 'unknown') {
    parts.push('version currency unknown');
  }
  // #843: say WHERE the binary was found. "Installed but not on PATH" and
  // "not installed" look identical in a pass/fail column and call for opposite
  // actions -- add it to PATH (or symlink it), versus install it.
  if (row.available && row.resolution === 'fallback' && row.resolvedPath) {
    parts.push(`found at ${row.resolvedPath} (not on PATH)`);
  }
  if (!row.available && row.validityReason) parts.push(row.validityReason);
  return parts.join('; ');
}

/**
 * Print the audit as a human-readable list.
 *
 * One list, not one section per language: the question "is my toolchain
 * complete" is about the whole set. Language attribution is kept as a column so
 * nothing is lost.
 */
function printAuditReport(rows, summary) {
  console.log('Quality Gate Tool Audit\n');
  const width = Math.max(...rows.map((r) => r.name.length), 10);
  for (const row of rows) {
    const opt = row.optional ? ' (optional)' : '';
    const version = row.installedVersion || 'N/A';
    const shown = row.npxInvoked ? `${version} (via npx)` : version;
    const q = qualifiersOfRow(row);
    console.log(`  ${iconOfRow(row)} ${row.name.padEnd(width)}${opt} — ${shown}${q ? ` [${q}]` : ''}`);
  }
  console.log('');
  console.log(
    `Summary: ${summary.total} tools — ${summary.missing} missing, ${summary.duplicated} duplicated, `
      + `${summary.outdated} outdated, ${summary.unknown} unknown`,
  );
  if (!summary.complete) {
    console.log('Run `xp-gate install-tools` to install, upgrade and de-duplicate.');
  }
}

/**
 * Handle check-tools CLI command.
 *
 * Reports completeness, validity, uniqueness and currency in ONE list. The
 * audit is injectable so tests drive every branch without touching the network
 * or the real toolchain.
 *
 * @param {string[]} args - Command arguments
 * @param {{
 *   projectRoot?: string,
 *   languages?: string[]|null,
 *   audit?: (tools: Array, deps: object) => Array,
 *   resolveLatest?: (name: string) => string|null,
 * }} [options]
 * @returns {Promise<number>} Exit code
 */
/**
 * Collect the tools the question covers, then audit each through the gate's resolver.
 *
 * Resolving through the SAME helper the gates use (#843) is the point: a binary in
 * `~/.local/bin` IS installed even when the hook's PATH omits it, and reporting it
 * missing sends the reader off to install what is already there.
 *
 * `--all` passes null languages, meaning "every registered tool" rather than "this
 * project's".
 */
function auditRequestedTools(args, selection, options) {
  const { languages, includeCrossLanguage } = selection;
const tools = collectGateTools({
  registry: LANGUAGE_REGISTRY,
  cliTools: GATE_CLI_TOOLS,
  // `--all` asks about every registered tool, not just this project's.
  languages: args.includes('--all') ? null : (languages.length ? languages : null),
}).filter((t) => includeCrossLanguage || (t.languages && t.languages.length > 0));

const audit = options.audit || ((list, deps) => auditAllTools(list, deps));
// Resolve tools through the SAME helper the gates use (#843): a binary in
// ~/.local/bin is installed even when the hook's PATH omits it, and reporting
// it missing sends the reader off to install what is already there.
const rows = audit(tools, {
  resolveLatest: options.resolveLatest || ((n) => resolveLatestVersion(n)),
  resolveTool: options.resolveTool || ((name) => resolveToolViaShell(name)),
});
const summary = summarizeAudit(rows);
  return { rows, summary };
}

async function handleCheckTools(args, options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const jsonOutput = args.includes('--json');
  let languages = options.languages !== undefined ? options.languages : parseLanguageFlag(args);

  // Auto-detect if no languages specified
  if (languages === undefined || languages === null) {
    const detected = detectProjectLanguages(projectRoot);
    languages = detected.detected;
  }

  // The cross-language CLI tools are part of the answer even when no detected
  // language mentions them: they are what the gate SCRIPTS call directly.
  // The cross-language CLI tools belong to the answer when we are describing the
  // whole toolchain (auto-detected or --all). When the caller names languages
  // explicitly, they asked "what does THIS language need" and a cross-language
  // section would answer a different question.
  const explicitSelection = parseLanguageFlag(args);
  // An EMPTY selection is "nothing was asked for", not "ask for nothing": the
  // auto-detect path and `options.languages = []` must still describe the whole
  // toolchain, or the report silently becomes empty and reads as complete.
  const includeCrossLanguage = !explicitSelection || explicitSelection.length === 0
    || args.includes('--all');

  const { rows, summary } = auditRequestedTools(args, { languages, includeCrossLanguage }, options);

  if (jsonOutput) {
    // CONTRACT, preserved from #468: the top level is keyed by language name and
    // each value is that language's tool list. Callers parse it that way, and a
    // shape change here silently broke them once already. The audit's new facts
    // (duplicates, currency, cross-language tools) therefore ride alongside in
    // `summary` and `crossLanguage` rather than replacing the old shape.
    const byLanguage = {};
    for (const row of rows) {
      for (const lang of (row.languages && row.languages.length ? row.languages : ['(cross-language)'])) {
        if (!byLanguage[lang]) byLanguage[lang] = [];
        byLanguage[lang].push({
          name: row.name,
          status: statusOfRow(row),
          optional: row.optional,
          version: row.version,
          gates: row.gates,
          duplicated: row.duplicated,
          paths: row.paths,
          outdated: row.outdated,
          latestVersion: row.latestVersion,
          currency: row.currency,
          reason: row.validityReason || undefined,
        });
      }
    }
    // Tools the gate scripts call directly; reported once, not per language.
    // Only emitted when such tools exist: an always-present empty group would
    // add a key to a contract callers compare exactly (#468).
    const crossLanguage = rows
      .filter((r) => !r.languages || r.languages.length === 0)
      .map((r) => ({
        name: r.name,
        status: statusOfRow(r),
        optional: r.optional,
        version: r.version,
        gates: r.gates,
        duplicated: r.duplicated,
        paths: r.paths,
        outdated: r.outdated,
        latestVersion: r.latestVersion,
        currency: r.currency,
        npxInvoked: r.npxInvoked,
        reason: r.validityReason || undefined,
      }));
    if (crossLanguage.length > 0) byLanguage['(cross-language)'] = crossLanguage;

    // `summary` and the flat view are additive: they appear only when asked
    // for, so the historical shape ({ <language>: [...] }) stays byte-identical
    // for callers that parse it exactly (#468).
    const wantsAuditFields = args.includes('--audit') || args.includes('--flat');
    // The flat view uses the SAME field names as the grouped view (`status`,
    // `version`), so a consumer can switch between them without remapping.
    const flatView = rows.map((r) => ({
      name: r.name,
      status: statusOfRow(r),
      optional: r.optional,
      version: r.version,
      installedVersion: r.installedVersion,
      gates: r.gates,
      languages: r.languages,
      duplicated: r.duplicated,
      paths: r.paths,
      distinctRealPaths: r.distinctRealPaths,
      outdated: r.outdated,
      latestVersion: r.latestVersion,
      currency: r.currency,
      npxInvoked: r.npxInvoked,
      reason: r.validityReason || undefined,
    }));
    console.log(JSON.stringify({
      ...byLanguage,
      ...(wantsAuditFields ? { summary } : {}),
      ...(args.includes('--flat') ? { tools: flatView } : {}),
    }, null, 2));
  } else {
    printAuditReport(rows, summary);
  }

  return 0;
}

/**
 * Paths owned by the distribution. A copy here is the SYSTEM's copy, not a
 * duplicate install: removing it can take unrelated software with it, and the
 * user asked explicitly for distro packages to be left alone (2026-11-23).
 */
const { SYSTEM_PATH_PREFIXES } = require('./tool-audit.js');

/**
 * Build a repair plan from audit rows. Pure: no IO, no execution.
 *
 * Rules, in the order they are applied per tool:
 *   1. npx-invoked tools have no PATH entity — nothing to remove.
 *   2. A distro-owned copy is never removed; it is reported as kept.
 *   3. Duplicates: keep the FIRST path (what gates execute today) and remove the
 *      rest, so repairing does not change which binary the gates run.
 *   4. Missing REQUIRED tool -> install. Missing optional -> skipped and named.
 *   5. Outdated required tool -> upgrade.
 *
 * @param {Array} rows audit rows
 * @param {{definitions?: Array, systemPrefixes?: string[], platform?: string}} [options]
 * @returns {{actions: Array, clean: boolean}}
 */
function planToolRepairs(rows, options = {}) {
  const definitions = options.definitions || [];
  const platform = options.platform || process.platform;
  const systemPrefixes = options.systemPrefixes || SYSTEM_PATH_PREFIXES;
  const defByName = new Map(definitions.map((d) => [d.name, d]));
  const isSystemOwned = (p) => systemPrefixes.some((pre) => String(p).startsWith(pre));

  const actions = [];
  for (const row of rows || []) {
    if (row.npxInvoked) continue;

    const def = defByName.get(row.name);
    const installCmd = def && def.install
      ? (def.install[platform] || def.install.linux || def.install.npm || null)
      : null;

    // Only USER-owned duplicates are a repair. A distro copy plus a user copy is
    // coexistence (jq from apt vs a newer ~/.local/bin/jq), and removing either
    // is not a fix: the distro one can drag dependencies with it, the user one is
    // what the reader installed on purpose.
    // `distinctRealPaths` is only present on rows that were actually located on
    // disk; a row can be flagged `duplicated` by another producer (or by a
    // caller assembling rows by hand) without that list. Defaulting to [] keeps
    // the plan honest -- no copies means no duplicate to remove -- instead of
    // throwing out of a planning function.
    const userCopies = (row.userCopies || (row.distinctRealPaths || []).filter((p) => !isSystemOwned(p)));
    if (row.duplicated && userCopies.length > 1) {
      // Keep the copy the resolver actually hands to the gates, not whichever
      // path happened to come first.
      //
      // Measured 2026-11-24: with the same tool and the same two paths, listing
      // the copy the installer writes to FIRST made `writesToRemovedPath` false
      // and listing it SECOND made it true -- the self-cancelling-plan guard
      // therefore depended on the order of `distinctRealPaths`, which comes from
      // however the locator walked PATH. A guard that only fires for half the
      // callers is not a guard.
      const preferred = row.resolvedPath && userCopies.includes(row.resolvedPath)
        ? row.resolvedPath
        : userCopies[0];
      const keep = preferred;
      const rest = userCopies.filter((p) => p !== keep);
      actions.push({ kind: 'keep', tool: row.name, path: keep });
      for (const dup of rest) {
        actions.push({ kind: 'remove-duplicate', tool: row.name, path: dup, keepPath: keep });
      }
      // A tool that is duplicated but otherwise current needs no install step.
      if (row.available && !row.outdated) continue;
    }

    if (!row.available) {
      if (row.optional) {
        actions.push({ kind: 'skip-optional', tool: row.name, reason: 'optional tool not installed' });
      } else {
        actions.push({ kind: 'install', tool: row.name, command: installCmd });
      }
      continue;
    }

    if (row.outdated === true) {
      // MEASURED DEFECT (2026-11-23): hadolint was duplicated AND outdated. The
      // plan removed ~/.local/bin/hadolint, then ran an installer whose command
      // writes to that exact path — so the duplicate came straight back and the
      // repair silently achieved nothing. Detect it and say so loudly instead of
      // reporting a success that is not one.
      const removedHere = actions
        .filter((a) => a.kind === 'remove-duplicate' && a.tool === row.name)
        .map((a) => a.path);
      const writesToRemovedPath = Boolean(installCmd)
        && removedHere.some((removedPath) => String(installCmd).includes(removedPath));
      actions.push({
        kind: 'upgrade',
        tool: row.name,
        command: installCmd,
        from: row.installedVersion,
        to: row.latestVersion,
        writesToRemovedPath,
        conflictsWith: writesToRemovedPath ? removedHere : undefined,
      });
    }
  }

  return { actions, clean: actions.length === 0 };
}

/** Human line for one planned action. */
function describeAction(action) {
  switch (action.kind) {
    case 'remove-duplicate':
      return `remove duplicate  ${action.tool}: ${action.path} (keeping ${action.keepPath})`;
    case 'keep':
      return `keep              ${action.tool}: ${action.path}`;
    case 'keep-system':
      return `keep (system)     ${action.tool}: ${action.path}`;
    case 'skip-optional':
      return `skip (optional)   ${action.tool}`;
    case 'install':
      return `install           ${action.tool}  ← ${action.command || 'no installer known'}`;
    case 'upgrade':
      return `upgrade           ${action.tool}  ${action.from} → ${action.to}  ← ${action.command || 'no installer known'}`;
    default:
      return `${action.kind} ${action.tool}`;
  }
}

/** Default command runner: returns {status}. Injectable so tests never execute. */
function defaultRunCommand(command) {
  if (!command) return { status: 1, error: 'no installer command' };
  try {
    execSync(command, { stdio: 'inherit', timeout: 600000, shell: true });
    return { status: 0 };
  } catch (err) {
    return { status: typeof err.status === 'number' ? err.status : 1, error: String(err.message || err) };
  }
}

/** Default file remover, used only for duplicate cleanup. */
function defaultRemoveFile(target) {
  try {
    fs.rmSync(target, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Handle install-tools CLI command.
 *
 * Installs missing required tools, upgrades outdated ones and removes duplicate
 * copies so each tool ends up as one current, working entity.
 *
 * Without `--yes` nothing is executed: the plan is printed and the command says
 * plainly that it changed nothing. Silence there would be indistinguishable
 * from "the repair ran and needed no work".
 *
 * @param {string[]} args - Command arguments
 * @param {{
 *   projectRoot?: string,
 *   languages?: string[],
 *   audit?: (tools: Array, deps: object) => Array,
 *   definitions?: Array,
 *   run?: (cmd: string) => {status: number},
 *   removeFile?: (p: string) => boolean,
 * }} [options]
 * @returns {Promise<number>} Exit code
 */
async function handleInstallTools(args, options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const autoYes = args.includes('--yes') || args.includes('-y');
  const run = options.run || defaultRunCommand;
  const removeFile = options.removeFile || defaultRemoveFile;

  let languages = options.languages !== undefined ? options.languages : parseLanguageFlag(args);
  if (languages === undefined || languages === null) {
    languages = detectProjectLanguages(projectRoot).detected;
  }

  const tools = collectGateTools({
    registry: LANGUAGE_REGISTRY,
    cliTools: GATE_CLI_TOOLS,
    languages: args.includes('--all') || !languages.length ? null : languages,
  });

  const audit = options.audit || ((list, deps) => auditAllTools(list, deps));
  const rows = audit(tools, { resolveLatest: options.resolveLatest || ((n) => resolveLatestVersion(n)) });

  // Installer commands come from the registry entry (language) or the CLI entry.
  const definitions = options.definitions
    || [
      ...tools,
      ...GATE_CLI_TOOLS.map((c) => ({ name: c.tool, install: c.install, optional: false })),
    ];

  const plan = planToolRepairs(rows, { definitions });
  if (plan.clean) {
    console.log('Toolchain is already up to date: nothing to install, upgrade or remove.');
    return 0;
  }

  console.log('Planned toolchain changes:\n');
  for (const action of plan.actions) console.log(`  • ${describeAction(action)}`);
  console.log('');

  // A repair whose parts undo each other is not a repair. Refuse to run it and
  // say which action conflicts, so the operator can fix the installer instead of
  // watching a duplicate survive a "successful" run.
  const conflicting = plan.actions.filter((a) => a.kind === 'upgrade' && a.writesToRemovedPath);
  if (conflicting.length) {
    for (const a of conflicting) {
      console.log(`CONFLICT ${a.tool}: its installer writes to ${(a.conflictsWith || []).join(', ')},`);
      console.log('         which this same plan removes — the duplicate would come back.');
    }
    console.log('Refusing to apply a self-cancelling plan. Fix the installer command first.');
    return 1;
  }

  const mutating = plan.actions.filter((a) =>
    a.kind === 'install' || a.kind === 'upgrade' || a.kind === 'remove-duplicate');
  if (!mutating.length) {
    console.log('No changes needed for the required tools.');
    return 0;
  }

  if (!autoYes) {
    console.log(`${mutating.length} change(s) planned. No changes were made — re-run with --yes to apply them.`);
    return 0;
  }

  let failed = 0;
  for (const action of mutating) {
    if (action.kind === 'remove-duplicate') {
      const ok = removeFile(action.path);
      if (!ok) failed += 1;
      console.log(`${ok ? 'removed' : 'FAILED to remove'} ${action.path}`);
      continue;
    }
    if (!action.command) {
      failed += 1;
      console.log(`FAILED ${action.tool}: no installer command for this platform`);
      continue;
    }
    console.log(`> ${action.command}`);
    const result = run(action.command) || { status: 1 };
    if (result.status !== 0) {
      failed += 1;
      console.log(`FAILED ${action.tool} (exit ${result.status})`);
    }
  }

  console.log('');
  if (failed > 0) {
    console.log(`${failed} of ${mutating.length} change(s) failed.`);
    return 1;
  }
  console.log(`Applied ${mutating.length} change(s) successfully.`);
  return 0;
}
