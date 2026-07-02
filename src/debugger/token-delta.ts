/**
 * Token delta tracker — tracks token usage per LLM call with delta calculation.
 * Resets per sprint_id boundary.
 *
 * @test REQ-002 Token 差分采集器
 * @intent 追踪每次 LLM 调用的 token 消耗，支持 input/output/cache 分离和差分计算
 * @covers AC-002-01, AC-002-02, AC-002-03, AC-002-04, AC-002-05
 */

import fs from 'node:fs';
import path from 'node:path';
import type { GenAITokenUsage } from './span-types';
import { readSprintState, writeSprintState } from './sprint-state-io';

export interface TokenDeltaOptions {
  projectRoot: string;
}

export interface RecordTokenDeltaOptions extends TokenDeltaOptions {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  phase?: number;
}

interface TokenRecord {
  sprint_id: string;
  timestamp: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  delta_input: number;
  delta_output: number;
  delta_total: number;
  phase?: number;
}

function readTokenHistory(root: string): TokenRecord[] {
  try {
    const historyFile = path.join(root, '.sprint-state', 'token-history.json');
    if (!fs.existsSync(historyFile)) return [];
    return JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  } catch {
    return [];
  }
}

function writeTokenHistory(root: string, records: TokenRecord[]): void {
  const historyFile = path.join(root, '.sprint-state', 'token-history.json');
  fs.writeFileSync(historyFile, JSON.stringify(records, null, 2), 'utf8');
}

/**
 * Record a token delta for the current phase.
 * Calculates delta from previous record within the same sprint.
 *
 * @test REQ-002 Token 差分采集器
 * @intent 追踪每次 LLM 调用的 token 消耗
 * @covers AC-002-01, AC-002-02, AC-002-03, AC-002-04
 */
export function recordTokenDelta(options: RecordTokenDeltaOptions): void {
  const state = readSprintState(options.projectRoot);
  if (!state?.id) return;

  const history = readTokenHistory(options.projectRoot);

  // Find the last record for this sprint (boundary reset)
  const sprintRecords = history.filter(r => r.sprint_id === state.id);
  const lastRecord = sprintRecords.length > 0 ? sprintRecords[sprintRecords.length - 1] : null;

  // Calculate deltas
  const deltaInput = lastRecord ? options.inputTokens - lastRecord.input_tokens : options.inputTokens;
  const deltaOutput = lastRecord ? options.outputTokens - lastRecord.output_tokens : options.outputTokens;
  const deltaTotal = deltaInput + deltaOutput;

  const totalTokens = options.inputTokens + options.outputTokens;

  const record: TokenRecord = {
    sprint_id: state.id,
    timestamp: new Date().toISOString(),
    input_tokens: options.inputTokens,
    output_tokens: options.outputTokens,
    cache_read_tokens: options.cacheReadTokens ?? 0,
    cache_write_tokens: options.cacheWriteTokens ?? 0,
    total_tokens: totalTokens,
    delta_input: deltaInput,
    delta_output: deltaOutput,
    delta_total: deltaTotal,
    phase: options.phase,
  };

  history.push(record);
  writeTokenHistory(options.projectRoot, history);

  // Also persist to sprint state metrics
  if (!state.metrics) state.metrics = {};
  const metrics = state.metrics as Record<string, unknown>;
  metrics.tokens_total = totalTokens;
  metrics.tokens_delta_input = deltaInput;
  metrics.tokens_delta_output = deltaOutput;
  if (options.phase !== undefined) {
    metrics[`tokens_phase_${options.phase}`] = totalTokens;
  }
  writeSprintState(options.projectRoot, state);
}

/**
 * Get the total token usage for the current sprint.
 */
export function getTotalTokens(options: TokenDeltaOptions): GenAITokenUsage | null {
  const state = readSprintState(options.projectRoot);
  if (!state?.id) return null;

  const history = readTokenHistory(options.projectRoot);
  const sprintRecords = history.filter(r => r.sprint_id === state.id);
  if (sprintRecords.length === 0) return null;

  const last = sprintRecords[sprintRecords.length - 1];
  return {
    input_tokens: last.input_tokens,
    output_tokens: last.output_tokens,
    cache_read_tokens: last.cache_read_tokens,
    cache_write_tokens: last.cache_write_tokens,
    total_tokens: last.total_tokens,
  };
}

/**
 * Get token history for the current sprint.
 */
export function getTokenHistory(options: TokenDeltaOptions): TokenRecord[] {
  const state = readSprintState(options.projectRoot);
  if (!state?.id) return [];

  const history = readTokenHistory(options.projectRoot);
  return history.filter(r => r.sprint_id === state.id);
}
