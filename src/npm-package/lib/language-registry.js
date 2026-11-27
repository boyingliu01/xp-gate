'use strict';
/**
 * The language registry: which languages xp-gate knows, and how to recognise and
 * check each one.
 *
 * Data only -- no filesystem access, no functions. It moved out of
 * `language-tools.js` so that file fits its line ceiling; the shape is unchanged, so
 * this is a move rather than a redesign.
 *
 * Each entry declares:
 *   name          display name
 *   configFiles   manifests that PROVE the language is present (glob `*` allowed)
 *   extensions    file extensions, consulted ONLY when configFiles is empty --
 *                 extension lists are broad (IaC lists yaml), so matching on them for
 *                 a config-driven language would make every CI YAML an
 *                 Infrastructure-as-Code project (#468)
 *   tools         checkers, each with `gates`, an `install` map per platform, and
 *                 `optional`
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

module.exports = { LANGUAGE_REGISTRY };
