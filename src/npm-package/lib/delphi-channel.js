/**
 * Delphi 通道偏好 — 这台机器上 Delphi 评审走哪条路（#646）
 *
 * ## 为什么需要这个文件
 *
 * Qoder 的 native 通道**已被实测证伪**，证据就写在自家技能里
 * （`skills/delphi-review/SKILL.md`）：subagent 派发采纳 agent 的提示词，却丢弃
 * model 绑定，三席永远跑会话模型。所以 native 只能产出"同模型三角色自查"，
 * 不构成多模型交叉验证证据，也不能用作 Gate MW 的三模型凭据。
 *
 * 但安装路径无条件部署它，doctor 强制要求它存在。于是只用外部通道的用户删掉三个
 * agent 之后，得到的是一盏红灯 + 一条会把机制重新装回来的修复提示——"关掉它"
 * 在产品层面无路可走。
 *
 * ## 为什么偏好放在机器级
 *
 * 通道选择是"这台机器上 Delphi 怎么跑"，与具体仓库无关。放进项目文件会让每个仓库
 * 各写一遍，而且换仓库时要重配一次。#541 已经把机器级 Delphi 配置收敛到
 * `~/.config/xp-gate/.delphi-config.json`，偏好作为其中的 `channels` 字段。
 *
 * ## 为什么默认是两条都开
 *
 * 默认 external-only 会悄悄改掉所有没提要求的人的行为；默认 native-only 则把已被
 * 证伪的路径摆在最前面。默认保持"两条都可用"，由用户显式关掉。
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** The channels this product knows about, in the order they are tried. */
const KNOWN_CHANNELS = ['native', 'external'];

/** Both enabled — see "为什么默认是两条都开" above. */
const DEFAULT_CHANNELS = ['native', 'external'];

/** Environment override. Beats the config file, for CI and one-off runs. */
const CHANNEL_ENV = 'XP_GATE_DELPHI_CHANNEL';

/**
 * Normalise a user-supplied channel list.
 *
 * Accepts an array or a comma/space separated string (the env var spelling).
 * Unknown names are dropped and reported rather than silently ignored: a typo that
 * quietly leaves native enabled is exactly the failure this file exists to prevent.
 *
 * @param {unknown} raw
 * @returns {{ channels: string[], unknown: string[] }}
 */
function normaliseChannels(raw) {
  let parts;
  if (Array.isArray(raw)) {
    parts = raw;
  } else if (typeof raw === 'string') {
    parts = raw.split(/[,\s]+/);
  } else {
    return { channels: [], unknown: [] };
  }

  const seen = new Set();
  const unknown = [];
  for (const part of parts) {
    if (typeof part !== 'string') continue;
    const name = part.trim().toLowerCase();
    if (name === '') continue;
    if (!KNOWN_CHANNELS.includes(name)) {
      unknown.push(part);
      continue;
    }
    seen.add(name);
  }

  // Preserve KNOWN_CHANNELS order so resolution is deterministic regardless of how
  // the user wrote the list.
  return { channels: KNOWN_CHANNELS.filter((c) => seen.has(c)), unknown };
}

/**
 * Read the machine-level Delphi config, if any.
 *
 * Deliberately tolerant: a hand-edited or corrupt file must not make `init` or
 * `doctor` crash. It returns `undefined` and the caller falls back to defaults with
 * a warning, because "I could not read your preference" and "you asked for both"
 * look identical downstream and the message is what tells them apart.
 *
 * @param {string} [home]
 * @returns {{ config?: object, error?: string }}
 */
function readMachineConfig(home) {
  const root = home || os.homedir();
  const file = path.join(root, '.config', 'xp-gate', '.delphi-config.json');
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: `${file} is not a JSON object` };
    }
    return { config: parsed };
  } catch (err) {
    return { error: `${file} is unreadable: ${err && err.message ? err.message : String(err)}` };
  }
}

/**
 * Resolve which Delphi channels are enabled on this machine.
 *
 * @param {{ home?: string }} [opts]
 * @returns {{ channels: string[], source: 'env'|'config'|'default', nativeEnabled: boolean, warning?: string }}
 */
function resolveChannels(opts = {}) {
  const envRaw = process.env[CHANNEL_ENV];
  if (envRaw !== undefined && envRaw.trim() !== '') {
    const { channels, unknown } = normaliseChannels(envRaw);
    if (channels.length > 0) {
      return {
        channels,
        source: 'env',
        nativeEnabled: channels.includes('native'),
        ...(unknown.length > 0
          ? { warning: `${CHANNEL_ENV} ignored unknown channel(s): ${unknown.join(', ')}` }
          : {}),
      };
    }
    // Every value was unknown -> fall through to the file/default rather than
    // resolving to "no channels at all", which would disable Delphi entirely on a typo.
  }

  const { config, error } = readMachineConfig(opts.home);
  if (error) {
    return { channels: DEFAULT_CHANNELS, source: 'default', nativeEnabled: true, warning: error };
  }

  if (config && Object.prototype.hasOwnProperty.call(config, 'channels')) {
    const { channels, unknown } = normaliseChannels(config.channels);
    if (channels.length > 0) {
      const notes = [];
      if (unknown.length > 0) notes.push(`ignored unknown channel(s): ${unknown.join(', ')}`);
      return {
        channels,
        source: 'config',
        nativeEnabled: channels.includes('native'),
        ...(notes.length > 0 ? { warning: notes.join('; ') } : {}),
      };
    }
    return {
      channels: DEFAULT_CHANNELS,
      source: 'default',
      nativeEnabled: true,
      warning: `config "channels" had no recognised value (got ${
        JSON.stringify(config.channels)
      }); known: ${KNOWN_CHANNELS.join(', ')} — using defaults`,
    };
  }

  return { channels: DEFAULT_CHANNELS, source: 'default', nativeEnabled: true };
}

/**
 * Should `xp-gate init` deploy the Qoder native Delphi agents?
 *
 * One named predicate rather than an inline `resolveChannels().nativeEnabled` at the
 * call site, so the decision has a single testable home and reads as a question.
 *
 * @param {{ home?: string }} [opts]
 * @returns {boolean}
 */
function nativeAgentDeploymentIsWanted(opts = {}) {
  return resolveChannels(opts).nativeEnabled;
}

module.exports = {
  CHANNEL_ENV,
  DEFAULT_CHANNELS,
  KNOWN_CHANNELS,
  nativeAgentDeploymentIsWanted,
  normaliseChannels,
  readMachineConfig,
  resolveChannels,
};
