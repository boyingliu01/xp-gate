# Design: `xp-gate update-hooks` Command

**Issue**: #265 — Git hooks do not auto-update: projects use stale hook versions  
**Date**: 2026-07-01  
**Status**: APPROVED (with fixes)

## Problem

When `xp-gate init` installs hooks into a project's `.git/` directory, it copies the files. When upstream hooks are updated, existing projects continue using old versions.

**Evidence**: skill-cert project `.git/pre-commit` (2043 lines) was 72 lines behind upstream `~/.config/opencode/xp-gate/hooks/pre-commit` (2115 lines).

## Solution

Add `xp-gate update-hooks` command that syncs the latest hook versions from the xp-gate package to the project's hooks directory.

### Source of Truth

**Hooks source**: The installed npm package location (`node_modules/@boyingliu01/xp-gate/` or global npm prefix). The npm package ships hooks at publish time via `sync-package-content.js` (prepack hook). When a user runs `npm install -g @boyingliu01/xp-gate@latest`, the package includes the latest hooks.

**Key distinction from existing commands**:
- `xp-gate upgrade` — Updates the entire npm package (dependencies, hooks, everything)
- `xp-gate init --global` — One-time setup of global hooks
- `xp-gate update-hooks` — **Targeted sync** of only hook-related files from installed package to project, without updating the package itself

**Use case**: User has a working xp-gate installation but wants to refresh hooks in a specific project without running a full package upgrade.

## Command Interface

```bash
xp-gate update-hooks [options]
```

| Option | Description |
|--------|-------------|
| `--global` | Update global hooks (`~/.config/xp-gate/adapters/`) |
| `--force` | Skip confirmation prompt, overwrite directly |
| `--dry-run` | Show files that would be updated without executing |
| `--no-backup` | Skip creating backup files before overwrite |
| `--scope <hooks\|adapters\|all>` | Selectively update only specific file categories |

**Default behavior**: 
- Update current project's `.git/hooks/` directory (local mode)
- Create `.bak` backup files before overwriting (unless `--no-backup`)
- Update all categories: hooks + adapters + gate scripts

**Local vs Global**:
- **Local (default)**: Updates `.git/hooks/` in the current project
- **Global (`--global`)**: Updates `~/.config/xp-gate/adapters/` (used by all projects)

## Implementation

### New File: `src/npm-package/lib/update-hooks.js`

```javascript
const fs = require('fs');
const path = require('path');

function updateHooks(options = {}) {
  const { global = false, force = false, dryRun = false, noBackup = false, scope = 'all' } = options;
  
  // 1. Determine target directory
  const destDir = global 
    ? getGlobalAdaptersDir() 
    : getProjectHooksDir();
  
  // 2. Determine source directory (xp-gate package location)
  const srcDir = getPackageRoot();
  
  // 3. Detect local modifications and warn
  if (!force && !dryRun) {
    const localMods = detectLocalModifications(srcDir, destDir);
    if (localMods.length > 0) {
      console.warn(`[WARN] Detected ${localMods.length} locally modified file(s):`);
      localMods.forEach(f => console.warn(`  - ${f}`));
      console.warn('Use --force to overwrite, or manually backup first.');
      return 1;
    }
  }
  
  // 4. Copy files based on scope
  if (scope === 'all' || scope === 'hooks') {
    copyHooks(srcDir, destDir, dryRun, noBackup);
  }
  if (scope === 'all' || scope === 'adapters') {
    copyAdapters(srcDir, destDir, dryRun, noBackup);
  }
  if (scope === 'all') {
    copyGateScripts(srcDir, destDir, dryRun, noBackup);
  }
}

function detectLocalModifications(srcDir, destDir) {
  const modified = [];
  const files = ['pre-commit', 'pre-push', 'adapter-common.sh'];
  
  // Add gate scripts
  if (fs.existsSync(srcDir)) {
    fs.readdirSync(srcDir).forEach(f => {
      if (f.startsWith('gate-') && f.endsWith('.sh')) {
        files.push(f);
      }
    });
  }
  
  // Check top-level files
  for (const file of files) {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);
    
    if (fs.existsSync(destPath) && fs.existsSync(srcPath)) {
      const srcContent = fs.readFileSync(srcPath, 'utf8');
      const destContent = fs.readFileSync(destPath, 'utf8');
      
      if (srcContent !== destContent) {
        modified.push(file);
      }
    }
  }
  
  // Also check adapters/*.sh
  const srcAdaptersDir = path.join(srcDir, 'adapters');
  if (fs.existsSync(srcAdaptersDir)) {
    fs.readdirSync(srcAdaptersDir).forEach(f => {
      if (f.endsWith('.sh')) {
        const srcPath = path.join(srcAdaptersDir, f);
        const destPath = path.join(destDir, 'adapters', f);
        
        if (fs.existsSync(destPath) && fs.existsSync(srcPath)) {
          const srcContent = fs.readFileSync(srcPath, 'utf8');
          const destContent = fs.readFileSync(destPath, 'utf8');
          
          if (srcContent !== destContent) {
            modified.push(`adapters/${f}`);
          }
        }
      }
    });
  }
  
  return modified;
}

function copyHooks(srcDir, destDir, dryRun, noBackup) {
  const hooksDir = path.join(srcDir, 'hooks');
  const files = ['pre-commit', 'pre-push'];
  
  for (const file of files) {
    const src = path.join(hooksDir, file);
    const dest = path.join(destDir, file);
    
    if (fs.existsSync(src)) {
      if (dryRun) {
        console.log(`  would update: ${file}`);
      } else {
        // Create backup if enabled
        if (!noBackup && fs.existsSync(dest)) {
          fs.copyFileSync(dest, `${dest}.bak`);
        }
        
        // Atomic write: temp file + rename
        const tmpDest = `${dest}.tmp`;
        fs.copyFileSync(src, tmpDest);
        fs.renameSync(tmpDest, dest);
        fs.chmodSync(dest, 0o755);
        console.log(`  ✓ ${file}`);
      }
    } else {
      console.warn(`  ⚠ ${file} not found, skipping`);
    }
  }
}

function copyAdapters(srcDir, destDir, dryRun, noBackup) {
  // Copy adapter-common.sh
  const adapterCommonSrc = path.join(srcDir, 'adapter-common.sh');
  if (fs.existsSync(adapterCommonSrc)) {
    if (dryRun) {
      console.log(`  would update: adapter-common.sh`);
    } else {
      const dest = path.join(destDir, 'adapter-common.sh');
      if (!noBackup && fs.existsSync(dest)) {
        fs.copyFileSync(dest, `${dest}.bak`);
      }
      const tmpDest = `${dest}.tmp`;
      fs.copyFileSync(adapterCommonSrc, tmpDest);
      fs.renameSync(tmpDest, dest);
      console.log(`  ✓ adapter-common.sh`);
    }
  }
  
  // Copy adapters/*.sh
  const adaptersDir = path.join(srcDir, 'adapters');
  if (fs.existsSync(adaptersDir)) {
    fs.readdirSync(adaptersDir).forEach(f => {
      if (f.endsWith('.sh')) {
        const src = path.join(adaptersDir, f);
        const dest = path.join(destDir, f);
        if (dryRun) {
          console.log(`  would update: adapters/${f}`);
        } else {
          if (!noBackup && fs.existsSync(dest)) {
            fs.copyFileSync(dest, `${dest}.bak`);
          }
          const tmpDest = `${dest}.tmp`;
          fs.copyFileSync(src, tmpDest);
          fs.renameSync(tmpDest, dest);
          console.log(`  ✓ adapters/${f}`);
        }
      }
    });
  }
}

function copyGateScripts(srcDir, destDir, dryRun, noBackup) {
  // Copy gate-*.sh files from package root
  fs.readdirSync(srcDir).forEach(f => {
    if (f.startsWith('gate-') && f.endsWith('.sh')) {
      const src = path.join(srcDir, f);
      const dest = path.join(destDir, f);
      if (dryRun) {
        console.log(`  would update: ${f}`);
      } else {
        if (!noBackup && fs.existsSync(dest)) {
          fs.copyFileSync(dest, `${dest}.bak`);
        }
        const tmpDest = `${dest}.tmp`;
        fs.copyFileSync(src, tmpDest);
        fs.renameSync(tmpDest, dest);
        console.log(`  ✓ ${f}`);
      }
    }
  });
}

function getProjectHooksDir() {
  const gitDir = path.join(process.cwd(), '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error('Not a Git repository: .git directory not found');
  }
  return path.join(gitDir, 'hooks');
}

function getGlobalAdaptersDir() {
  const home = process.env.HOME || process.env.USERPROFILE;
  return path.join(home, '.config', 'xp-gate', 'adapters');
}

function getPackageRoot() {
  // Resolve to the xp-gate package installation directory
  return path.resolve(__dirname, '..');
}

module.exports = { updateHooks };
```

### Register Command: `src/npm-package/bin/xp-gate.js`

Add to CLI dispatcher:

```javascript
case 'update-hooks':
  const { updateHooks } = require('../lib/update-hooks.js');
  const updateOptions = {
    global: args.includes('--global'),
    force: args.includes('--force'),
    dryRun: args.includes('--dry-run'),
    noBackup: args.includes('--no-backup'),
    scope: args.find(a => a.startsWith('--scope='))?.split('=')[1] || 'all'
  };
  try {
    updateHooks(updateOptions);
    return 0;
  } catch (err) {
    console.error(`Error: ${err.message}`);
    return 1;
  }
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| `.git/` not found | `[ERROR] Not a Git repository: .git directory not found` |
| Hooks directory doesn't exist | Auto-create with `mkdir -p` |
| Source file not found | `[WARN] {file} not found, skipping` |
| Permission denied | `[ERROR] Permission denied: {path}` |

## Testing

### New File: `src/npm-package/lib/__tests__/update-hooks.test.js`

```javascript
const { describe, it, expect, vi, beforeEach } = require('vitest');
const fs = require('fs');
const path = require('path');
const { updateHooks } = require('../update-hooks');

describe('updateHooks', () => {
  const mockHooksDir = '/tmp/test-hooks';
  const mockPackageDir = '/tmp/test-package';
  
  beforeEach(() => {
    vi.restoreAllMocks();
    fs.mkdirSync(mockHooksDir, { recursive: true });
    fs.mkdirSync(path.join(mockPackageDir, 'hooks'), { recursive: true });
  });
  
  it('updates hooks in target directory', () => {
    // Create mock source files
    fs.writeFileSync(path.join(mockPackageDir, 'hooks', 'pre-commit'), '#!/bin/bash\necho "updated"');
    fs.writeFileSync(path.join(mockPackageDir, 'hooks', 'pre-push'), '#!/bin/bash\necho "updated"');
    
    // Mock getPackageRoot to return mock dir
    updateHooks({ destDir: mockHooksDir, srcDir: mockPackageDir });
    
    expect(fs.existsSync(path.join(mockHooksDir, 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(mockHooksDir, 'pre-push'))).toBe(true);
  });
  
  it('dry-run shows files without modifying', () => {
    fs.writeFileSync(path.join(mockPackageDir, 'hooks', 'pre-commit'), '#!/bin/bash\necho "updated"');
    
    const consoleSpy = vi.spyOn(console, 'log');
    updateHooks({ destDir: mockHooksDir, srcDir: mockPackageDir, dryRun: true });
    
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('would update'));
    expect(fs.existsSync(path.join(mockHooksDir, 'pre-commit'))).toBe(false);
  });
  
  it('creates target directory if not exists', () => {
    const newDir = '/tmp/test-new-hooks';
    fs.writeFileSync(path.join(mockPackageDir, 'hooks', 'pre-commit'), '#!/bin/bash\necho "test"');
    
    updateHooks({ destDir: newDir, srcDir: mockPackageDir });
    
    expect(fs.existsSync(newDir)).toBe(true);
  });
});
```

## Integration with CLI

Register in `src/npm-package/bin/xp-gate.js`:

```javascript
commands.set('update-hooks', {
  description: 'Update git hooks to latest version from xp-gate package',
  usage: 'xp-gate update-hooks [--global] [--force] [--dry-run]',
  handler: async (args) => {
    const { updateHooks } = require('../lib/update-hooks.js');
    const options = {
      global: args.includes('--global'),
      force: args.includes('--force'),
      dryRun: args.includes('--dry-run')
    };
    try {
      updateHooks(options);
      return 0;
    } catch (err) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
  }
});
```

## Verification

1. Run `npm test` — all tests pass
2. Run `xp-gate update-hooks --dry-run` — shows files to update
3. Run `xp-gate update-hooks` — updates local hooks
4. Run `xp-gate update-hooks --global` — updates global hooks
5. Verify updated hooks work: `git commit` triggers updated pre-commit

## Out of Scope

- Automatic update on hook execution (Option C from issue)
- Symlink-based installation (Option A from issue)
- Version comparison/diff display
