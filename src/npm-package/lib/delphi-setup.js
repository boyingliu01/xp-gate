'use strict';

// xp-gate delphi-setup (#414 REQ-4) — the repair path for Qoder Delphi agent
// bindings. `xp-gate init` deploys the bundled templates but deliberately
// never overwrites an existing file, which is the right safety default for
// installs and exactly the wrong behavior once a binding has drifted or the
// platform retired a model id. This command exists to rebind on purpose.

const fs = require('fs');
const path = require('path');
const { HOME_DIR } = require('./shared-paths.js');

const DELPHI_ROLES = ['architecture', 'technical', 'feasibility'];
// Mirrors QODER_MODEL_BINDING in init.js: the model id must survive
// `"[DisplayName](modelId)"`, so the platform-visible charset is enforced here
// rather than discovered as a silently-ignored binding later.
const MODEL_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

function parseSetupArgs(args) {
  const models = {};
  let scope = 'global';
  let projectDir;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model') {
      const spec = args[++i];
      const eq = typeof spec === 'string' ? spec.indexOf('=') : -1;
      if (eq === -1) {
        console.error(`[delphi-setup] ERROR: --model expects <role>=<modelId>, got "${spec}".`);
        return { error: true };
      }
      const role = spec.slice(0, eq).trim();
      const modelId = spec.slice(eq + 1).trim();
      if (!DELPHI_ROLES.includes(role)) {
        console.error(`[delphi-setup] ERROR: unknown expert role "${role}". Must be one of: ${DELPHI_ROLES.join(', ')}.`);
        return { error: true };
      }
      if (modelId === '' || !MODEL_ID_PATTERN.test(modelId)) {
        console.error(`[delphi-setup] ERROR: model id for ${role} must match [A-Za-z0-9_.-]+ (it becomes "[id](id)" in the agent frontmatter).`);
        return { error: true };
      }
      models[role] = modelId;
    } else if (args[i] === '--local') {
      scope = 'local';
    } else if (args[i] === '--global') {
      scope = 'global';
    } else if (args[i] === '--project') {
      projectDir = args[++i];
      if (typeof projectDir !== 'string' || projectDir.trim() === '') {
        console.error('[delphi-setup] ERROR: --project expects a directory path.');
        return { error: true };
      }
    } else {
      console.error(`[delphi-setup] ERROR: unknown argument "${args[i]}".`);
      return { error: true };
    }
  }

  const missing = DELPHI_ROLES.filter((role) => !models[role]);
  if (missing.length > 0) {
    console.error(`[delphi-setup] ERROR: missing --model for: ${missing.join(', ')}.`);
    console.error('Usage: xp-gate delphi-setup --model architecture=<id> --model technical=<id> --model feasibility=<id> [--global|--local [--project <dir>]]');
    return { error: true };
  }
  if (scope === 'local' && projectDir === undefined) {
    console.error('[delphi-setup] ERROR: --local requires --project <dir> (the CLI process may not run inside the project).');
    return { error: true };
  }
  const duplicates = Object.entries(models)
    .filter(([role, id]) => Object.entries(models).some(([other, otherId]) => other !== role && otherId === id));
  if (duplicates.length > 0) {
    console.error('[delphi-setup] ERROR: the three experts must bind three DISTINCT model ids — a duplicate defeats the multi-model invariant before any review starts.');
    return { error: true };
  }
  return { models, scope, projectDir };
}

// Rebind only the model line; the rest of the bundled template (persona,
// tools, skills) stays authoritative from this version of xp-gate.
function rebindTemplate(templateBody, modelId) {
  const bindingLine = `model: "[${modelId}](${modelId})"`;
  const lines = templateBody.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === '---');
  if (start !== 0) return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const bindingIndex = lines.findIndex((l, idx) => idx > start && idx < end && /^model:[ \t]/.test(l));
  if (bindingIndex === -1) return null;
  lines[bindingIndex] = bindingLine;
  return lines.join('\n');
}

async function delphiSetup(args) {
  const parsed = parseSetupArgs(args || []);
  if (parsed.error) return 1;
  const { models, scope, projectDir } = parsed;

  const templatesDir = path.join(__dirname, '..', 'plugins', 'qoder', 'agents');
  const targetDir = scope === 'local'
    ? path.join(projectDir, '.qoder', 'agents')
    : path.join(HOME_DIR, '.qoder', 'agents');

  // Validate every template BEFORE writing anything: a half-rebound set would
  // leave the registry with a mix of old and new bindings on next session load.
  const rebound = {};
  for (const role of DELPHI_ROLES) {
    const templatePath = path.join(templatesDir, `delphi-${role}.md`);
    if (!fs.existsSync(templatePath)) {
      console.error(`[delphi-setup] ERROR: bundled template missing: ${templatePath} — reinstall xp-gate.`);
      return 1;
    }
    const body = rebindTemplate(fs.readFileSync(templatePath, 'utf8'), models[role]);
    if (body === null) {
      console.error(`[delphi-setup] ERROR: bundled template for ${role} has no model binding line to replace.`);
      return 1;
    }
    rebound[role] = body;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  for (const role of DELPHI_ROLES) {
    const targetPath = path.join(targetDir, `delphi-${role}.md`);
    fs.writeFileSync(targetPath, rebound[role]);
    console.log(`  delphi-${role} -> ${targetPath} (model: ${models[role]})`);
  }

  console.log('');
  console.log('✓ Delphi agents rebound. NOW RELOAD: Qoder loads agent definitions only at');
  console.log('  session start — 重开 Qoder 会话（或重启 IDE）后新绑定才生效，否则看起来像没修好。');
  return 0;
}

module.exports = { delphiSetup, parseSetupArgs, rebindTemplate };
