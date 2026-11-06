/**
 * @test REQ-468
 * @intent detectProjectLanguages() 只按 configFiles 判定语言，而 shell/powershell 两条
 *         注册表项的 configFiles 为空数组 —— 这两种没有包管理器配置的语言因此永远检不出，
 *         doctor/check-tools 对 147 个 .sh + 27 个 .ps1 的仓库视而不见（#468）
 * @covers AC-468-01, AC-468-02, AC-468-03, AC-468-04, AC-468-05
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function makeFixture(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-lang-'));
  for (const [rel, content] of Object.entries(spec)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

describe('detectProjectLanguages extension fallback (#468)', () => {
  let loadModule;

  beforeEach(() => {
    vi.resetModules();
    for (const mod of ['../language-tools']) {
      delete require.cache[require.resolve(mod)];
    }
    loadModule = () => require('../language-tools');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function detectedIn(spec) {
    const root = makeFixture(spec);
    try {
      return loadModule().detectProjectLanguages(root).detected;
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  it('detects Shell from .sh files with no shell config file present', () => {
    expect(detectedIn({ 'scripts/build.sh': '#!/bin/sh\necho hi\n' })).toContain('shell');
  });

  it('detects PowerShell from .ps1 files with no config file present', () => {
    expect(detectedIn({ 'tools/audit.ps1': 'Write-Host hi\n' })).toContain('powershell');
  });

  it('does not report Shell for a project that has no shell script', () => {
    const detected = detectedIn({ 'package.json': '{}' });
    expect(detected).not.toContain('shell');
    expect(detected).not.toContain('powershell');
  });

  // node_modules ships .sh files, so scanning it would label every Node project a
  // Shell project and make check-tools demand shellcheck forever.
  it('ignores dependency and VCS directories when scanning extensions', () => {
    const detected = detectedIn({
      'package.json': '{}',
      'node_modules/left-pad/build.sh': '#!/bin/sh\n',
      '.git/hooks/pre-commit.ps1': 'x\n',
    });
    expect(detected).not.toContain('shell');
    expect(detected).not.toContain('powershell');
  });

  // The fallback is only for languages that have no config-file signal. Extensions
  // are registered for every language, and IaC lists yaml/yml — applying them
  // across the board would make any repo with a CI YAML an IaC project.
  it('does not turn an unrelated YAML file into an IaC project', () => {
    const detected = detectedIn({
      'package.json': '{}',
      '.github/workflows/ci.yml': 'name: ci\n',
    });
    expect(detected).not.toContain('iac');
  });

  it('keeps config-file detection for the languages that already had it', () => {
    const root = makeFixture({
      'package.json': '{"name":"x"}',
      'tsconfig.json': '{}',
    });
    let result;
    try {
      result = loadModule().detectProjectLanguages(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    expect(result.detected).toContain('typescript');
    expect(result.configFiles.typescript).toContain('tsconfig.json');
  });
});

describe('check-tools language selection (#468)', () => {
  let fixtureRoot;

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[require.resolve('../language-tools')];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    fixtureRoot = makeFixture({ 'scripts/build.sh': '#!/bin/sh\necho hi\n' });
    // vitest workers forbid process.chdir(), and the command resolves the project
    // root through process.cwd().
    vi.spyOn(process, 'cwd').mockReturnValue(fixtureRoot);
  });

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('--languages <lang> with a space is not silently ignored', async () => {
    const { handleCheckTools } = require('../language-tools');
    const code = await handleCheckTools(['--languages', 'shell', '--json']);

    expect(code).toBe(0);
    const reported = JSON.parse(console.log.mock.calls.at(-1)[0]);
    expect(Object.keys(reported)).toEqual(['shell']);
    expect(reported.shell.map((t) => t.name)).toContain('shellcheck');
  });

  it('--languages=<lang> keeps working', async () => {
    const { handleCheckTools } = require('../language-tools');
    const code = await handleCheckTools(['--languages=shell', '--json']);

    expect(code).toBe(0);
    const reported = JSON.parse(console.log.mock.calls.at(-1)[0]);
    expect(Object.keys(reported)).toEqual(['shell']);
  });

  it('auto-detection reaches Shell, so check-tools with no flag lists shellcheck', async () => {
    const { handleCheckTools } = require('../language-tools');
    const code = await handleCheckTools(['--json']);

    expect(code).toBe(0);
    const reported = JSON.parse(console.log.mock.calls.at(-1)[0]);
    expect(Object.keys(reported)).toContain('shell');
  });

  // Round 1 review (architecture MI-02): `--languages=` split into [''], which
  // was treated as an explicit selection and reported a language named '' instead
  // of falling back to detection like the bare flag does.
  it('--languages= with an empty value falls back to auto-detection', async () => {
    const { handleCheckTools } = require('../language-tools');
    const code = await handleCheckTools(['--languages=', '--json']);

    expect(code).toBe(0);
    const reported = JSON.parse(console.log.mock.calls.at(-1)[0]);
    expect(Object.keys(reported)).not.toContain('');
    expect(Object.keys(reported)).toContain('shell');
  });
});

/**
 * @test REQ-717
 * @intent C# 有完整的门禁支持（adapter、principles 引擎、Gate 4/5/6/10/13），却从未进入
 *         LANGUAGE_REGISTRY：detect-languages 生成的配置里没有 csharp，而读配置的 hook
 *         不会回退到扩展名嗅探，于是 C# 在任何混合 .NET+JS 仓库里都不会被路由(#730)
 * @covers AC-717-01, AC-717-02, AC-717-03
 */
describe('detectProjectLanguages C# registry membership (#730)', () => {
  let loadModule;

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[require.resolve('../language-tools')];
    loadModule = () => require('../language-tools');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function detectIn(spec) {
    const root = makeFixture(spec);
    try {
      return loadModule().detectProjectLanguages(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  // The .csproj name is project-specific, so detection must glob it. A registry
  // entry listing the literal '.csproj' would stat a file of that exact name and
  // never match -- the config would look corrected while detection stayed broken.
  it('detects csharp from a project-specific .csproj filename', () => {
    const { detected, configFiles } = detectIn({ 'DshAotRunner.csproj': '<Project/>' });
    expect(detected).toContain('csharp');
    expect(configFiles.csharp).toContain('DshAotRunner.csproj');
  });

  it('detects csharp from a .sln in a solution-only repo', () => {
    expect(detectIn({ 'App.sln': 'Microsoft Visual Studio Solution File' }).detected).toContain('csharp');
  });

  // The bug's actual shape: a .NET repo that also has package.json for its JS
  // tooling. Before the fix this reported typescript alone, so the hook took the
  // TypeScript path for a C# codebase.
  it('reports csharp alongside typescript in a mixed .NET + JS repo', () => {
    const { detected } = detectIn({
      'Runner.csproj': '<Project/>',
      'Program.cs': 'class P { static void Main() {} }',
      'package.json': '{"name":"runner"}',
    });
    expect(detected).toEqual(expect.arrayContaining(['csharp', 'typescript']));
  });

  it('does not report csharp for a repo with no .NET artifact', () => {
    const { detected } = detectIn({ 'package.json': '{}', 'index.js': '' });
    expect(detected).not.toContain('csharp');
  });
});
