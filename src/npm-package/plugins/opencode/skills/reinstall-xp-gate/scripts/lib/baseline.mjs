import fs from 'node:fs';
import path from 'node:path';
import { HOME, packageDir, runNpm, gitConfig, xpJson } from './proc.mjs';
import { discoverSkillRoots, nativeDelphiAgents } from './agents.mjs';
import { bundledSkills } from './skills.mjs';
import { isFile, readJson, stamp, writeJson } from './util.mjs';

/** Files in `~/.config/xp-gate` that are USER configuration, not install state. */
const USER_CONFIG_FILES = ['.delphi-config.json', 'xp-gate.json'];

export function cfgDir() {
  return path.join(HOME, '.config', 'xp-gate');
}

export function runsRoot() {
  return path.join(HOME, '.local', 'share', 'xp-gate', 'reinstall-runs');
}

export function makeRunDir() {
  const dir = path.join(runsRoot(), stamp());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 只复制用户配置，不复制 xp-gate 生成的安装状态。 */
export function snapshotConfig(runDir) {
  const copied = [];
  for (const name of USER_CONFIG_FILES) {
    const src = path.join(cfgDir(), name);
    if (!isFile(src)) continue;
    fs.copyFileSync(src, path.join(runDir, name));
    copied.push(name);
  }
  return copied;
}

/** xp-gate 包与版本；未安装时两者都为空。 */
export function xpGateInfo(pkg = packageDir()) {
  return {
    packageDir: pkg,
    version: (pkg && readJson(path.join(pkg, 'package.json'))?.version) || '',
  };
}

/** 用户配置面：mode/templateDir 来自 xp-gate.json，hooksPath 来自 git 全局配置。 */
export function configInfo(appConfig) {
  return {
    mode: appConfig?.mode || '',
    templateDir: appConfig?.templateDir || '',
    hooksPath: gitConfig('core.hooksPath'),
  };
}

/**
 * Delphi 外部三席配置。三者都用 `?? null` 而非 `|| null`：空数组是合法值，
 * 用 `||` 会把它误判成“未配置”。
 */
export function delphiInfo(delphi) {
  return {
    channels: delphi?.channels ?? null,
    pinned_models: delphi?.pinned_models ?? null,
    active_profile: delphi?.active_profile ?? null,
  };
}

/** doctor 结果：能解析出 JSON 就投影关键字段，否则记下 stderr 便于排障。 */
export function doctorInfo(doctor) {
  if (!doctor.json) return { error: String(doctor.stderr || '').slice(0, 500) };
  return { ok: doctor.json.ok, issues: doctor.json.issues, checks: doctor.json.checks };
}

function npmVersion() {
  return String(runNpm(['-v'], { timeout: 20000 }).stdout || '').trim();
}

/**
 * 卸载前的只读基线。每一步都必须在 purge 之前拿到，因为 purge 之后版本、
 * 配置、hooksPath 都会消失，没有基线就无法判断重装是否真的成功。
 */
export function collectBaseline() {
  const pkg = packageDir();
  return {
    createdAt: new Date().toISOString(),
    platform: process.platform,
    home: HOME,
    node: process.version,
    nodePath: process.execPath,
    npm: npmVersion(),
    xpGate: xpGateInfo(pkg),
    config: configInfo(readJson(path.join(cfgDir(), 'xp-gate.json'))),
    delphi: delphiInfo(readJson(path.join(cfgDir(), '.delphi-config.json'))),
    doctor: doctorInfo(xpJson(['doctor', '--json'])),
    agents: discoverSkillRoots(),
    bundledSkills: bundledSkills(pkg),
    nativeAgents: nativeDelphiAgents(),
  };
}

export function writeBaseline(runDir, baseline) {
  writeJson(path.join(runDir, 'baseline.json'), baseline);
}
