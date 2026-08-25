#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const REQUIRED_ROLES = ['architecture', 'technical', 'feasibility'];
const VALIDITY_MS = 60 * 60 * 1000;

function fail(message) {
  console.error(`Invalid code walkthrough evidence: ${message}`);
  process.exit(1);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseTimestamp(value, field) {
  const match = typeof value === 'string'
    ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/)
    : null;
  if (!match) fail(`${field} must be a canonical UTC ISO-8601 timestamp.`);

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const milliseconds = Number((fractionText || '').padEnd(3, '0') || 0);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, milliseconds);

  if (date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
      || date.getUTCHours() !== hour
      || date.getUTCMinutes() !== minute
      || date.getUTCSeconds() !== second
      || date.getUTCMilliseconds() !== milliseconds) {
    fail(`${field} must contain a valid UTC calendar date and time.`);
  }
  return date.getTime();
}

function validateExpert(expert, index, roles, models) {
  if (!isPlainObject(expert)) fail(`experts[${index}] must be a plain object.`);
  if (!REQUIRED_ROLES.includes(expert.role)) fail(`experts[${index}].role is invalid.`);
  if (roles.has(expert.role)) fail(`expert role ${expert.role} is duplicated.`);
  roles.add(expert.role);

  if (expert.verdict !== 'APPROVED') fail(`expert ${expert.role} must be APPROVED.`);
  if (expert.result_type !== 'delphi_expert_result') {
    fail(`expert ${expert.role} must be a successful Delphi expert result.`);
  }
  if (expert.error !== undefined || expert.fallback !== undefined) {
    fail(`expert ${expert.role} contains an error or fallback marker.`);
  }

  if (typeof expert.requested_model !== 'string' || expert.requested_model.trim() === '') {
    fail(`expert ${expert.role} requested_model must be non-empty.`);
  }
  const model = expert.requested_model.trim();
  if (models.has(model)) fail(`requested_model ${model} is duplicated.`);
  models.add(model);

  if (expert.resolved_model !== null
      && (typeof expert.resolved_model !== 'string' || expert.resolved_model.trim() === '')) {
    fail(`expert ${expert.role} resolved_model must be non-empty or null.`);
  }
}

function validateEvidence(evidence, expectedCommit, expectedBranch, now) {
  if (!isPlainObject(evidence)) fail('top level must be a plain object.');
  if (evidence.commit !== expectedCommit) fail('commit does not match HEAD.');
  if (evidence.branch !== expectedBranch) fail('branch does not match the current branch.');
  if (evidence.verdict !== 'APPROVED') fail('top-level verdict must be APPROVED.');

  const timestamp = parseTimestamp(evidence.timestamp, 'timestamp');
  const expires = parseTimestamp(evidence.expires, 'expires');
  if (timestamp > now) fail('timestamp is in the future.');
  if (expires <= now) fail('evidence has expired.');
  if (expires - timestamp !== VALIDITY_MS) {
    fail('expires must be exactly one hour after timestamp.');
  }

  if (typeof evidence.consensus_ratio !== 'number'
      || !Number.isFinite(evidence.consensus_ratio)
      || evidence.consensus_ratio < 0.90
      || evidence.consensus_ratio > 1) {
    fail('consensus_ratio must be a finite number from 0.90 through 1.');
  }

  if (!Array.isArray(evidence.experts) || evidence.experts.length !== 3) {
    fail('experts must contain exactly three records.');
  }
  const roles = new Set();
  const models = new Set();
  evidence.experts.forEach((expert, index) => {
    validateExpert(expert, index, roles, models);
  });
  if (roles.size !== REQUIRED_ROLES.length) fail('all required expert roles must be present.');
}

function main() {
  const [file, expectedCommit, expectedBranch, nowValue] = process.argv.slice(2);
  if (!file || !expectedCommit || !expectedBranch) {
    fail('usage: validate-code-walkthrough.cjs <file> <commit> <branch> [now].');
  }

  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail('file must exist and contain valid JSON.');
  }
  const now = nowValue === undefined ? Date.now() : parseTimestamp(nowValue, 'current time');
  validateEvidence(evidence, expectedCommit, expectedBranch, now);
}

main();
