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
 * Detect languages used in the current project.
 * @param {string} projectRoot - Project root directory
 * @returns {{detected: string[], configFiles: Object.<string, string[]>}}
 */
function detectProjectLanguages(projectRoot) {
  const detected = new Set();
  const configFiles = {};

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
      const status = checkTool(tool.name, tool.checkCmd);
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
};

/**
 * Handle detect-languages CLI command.
 * @param {string[]} args - Command arguments
 * @returns {Promise<number>} Exit code
 */
async function handleDetectLanguages(args) {
  const projectRoot = process.cwd();
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
async function handleCheckTools(args) {
  const projectRoot = process.cwd();
  const jsonOutput = args.includes('--json');
  const langsArg = args.find(a => a.startsWith('--languages='));
  let languages = langsArg ? langsArg.split('=')[1].split(',') : null;

  // Auto-detect if no languages specified
  if (!languages) {
    const detected = detectProjectLanguages(projectRoot);
    languages = detected.detected;
  }

  if (languages.length === 0) {
    console.log('No languages detected or specified. Use --languages=<langs> to specify.');
    return 1;
  }

  const toolStatus = getToolsForLanguages(languages);

  if (jsonOutput) {
    const result = {};
    for (const [lang, tools] of Object.entries(toolStatus)) {
      result[lang] = tools.map(t => ({
        name: t.tool.name,
        status: t.status,
        optional: t.tool.optional,
        version: t.version,
        gates: t.tool.gates,
      }));
    }
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('Quality Gate Tool Status:\n');
    let totalAvailable = 0;
    let totalMissing = 0;

    for (const [lang, tools] of Object.entries(toolStatus)) {
      const langDef = LANGUAGE_REGISTRY[lang];
      console.log(`${langDef?.name || lang}:`);
      
      for (const t of tools) {
        const statusIcon = t.status === 'available' ? '✓' : '✗';
        const optMark = t.tool.optional ? ' (optional)' : '';
        const version = t.version || 'N/A';
        console.log(`  ${statusIcon} ${t.tool.name}${optMark} — ${version}`);
        if (t.status === 'available') {
          totalAvailable++;
        } else {
          totalMissing++;
        }
      }
      console.log('');
    }

    console.log(`Summary: ${totalAvailable} available, ${totalMissing} missing`);
    if (totalMissing > 0) {
      console.log('Run `xp-gate install-tools` to install missing tools.');
    }
  }

  return 0;
}

/**
 * Handle install-tools CLI command.
 * @param {string[]} args - Command arguments
 * @returns {Promise<number>} Exit code
 */
async function handleInstallTools(args) {
  const projectRoot = process.cwd();
  const dryRun = args.includes('--dry-run');
  const autoYes = args.includes('--yes') || args.includes('-y');
  const langsArg = args.find(a => a.startsWith('--languages='));
  let languages = langsArg ? langsArg.split('=')[1].split(',') : null;

  // Auto-detect if no languages specified
  if (!languages) {
    const detected = detectProjectLanguages(projectRoot);
    languages = detected.detected;
  }

  if (languages.length === 0) {
    console.log('No languages detected or specified.');
    return 1;
  }

  console.log('Checking tools for languages:', languages.join(', '));
  console.log('');

  const toolStatus = getToolsForLanguages(languages);
  const missingTools = [];

  for (const [lang, tools] of Object.entries(toolStatus)) {
    for (const t of tools) {
      if (t.status === 'missing' && !t.tool.optional) {
        missingTools.push({ lang, tool: t.tool });
      }
    }
  }

  if (missingTools.length === 0) {
    console.log('All required tools are available!');
    return 0;
  }

  console.log(`Found ${missingTools.length} missing required tool(s):\n`);
  for (const { lang, tool } of missingTools) {
    const installCmd = tool.install[process.platform] || tool.install.linux || 'N/A';
    console.log(`  • ${tool.name} (${lang})`);
    console.log(`    Install: ${installCmd}`);
  }
  console.log('');

  if (dryRun) {
    console.log('Dry run — no tools installed.');
    return 0;
  }

  if (!autoYes) {
    console.log('Run with --yes to install missing tools.');
    return 0;
  }

  console.log('Installing missing tools...\n');
  let successCount = 0;
  let failCount = 0;

  for (const { lang, tool } of missingTools) {
    console.log(`Installing ${tool.name} for ${lang}...`);
    const result = installTool(tool);
    if (result.success) {
      console.log(`  ✓ ${result.message}\n`);
      successCount++;
    } else {
      console.log(`  ✗ ${result.message}\n`);
      failCount++;
    }
  }

  console.log(`Installation complete: ${successCount} succeeded, ${failCount} failed.`);
  return failCount > 0 ? 1 : 0;
}
