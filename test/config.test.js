'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PRESET,
  configPath,
  statePath,
  formatStatusLine,
  install,
  uninstall,
  doctor
} = require('../lib/codex-config');

function tempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxline-codex-'));
  return { CODEX_HOME: dir, PATH: process.env.PATH || '' };
}

function readConfig(env) {
  return fs.readFileSync(configPath(env), 'utf8');
}

test('install creates a Codex config with the ctxline preset', () => {
  const env = tempEnv();
  const result = install({ env });

  assert.equal(result.changed, true);
  assert.equal(result.backupPath, null);

  const config = readConfig(env);
  assert.equal(config.startsWith('[tui]'), true);
  assert.match(config, /\[tui]/);
  assert.ok(config.includes(`status_line = ${formatStatusLine(PRESET)}`));
  assert.match(config, /status_line_use_colors = true/);
});

test('uninstall removes the tui section when install created it from scratch', () => {
  const env = tempEnv();
  install({ env });
  uninstall({ env });

  assert.equal(readConfig(env), '');
});

test('install preserves non-tui config and uninstall restores previous values', () => {
  const env = tempEnv();
  fs.mkdirSync(env.CODEX_HOME, { recursive: true });
  fs.writeFileSync(configPath(env), [
    'model = "gpt-5.5"',
    '',
    '[tui]',
    'animations = true',
    'status_line = ["current-dir"]',
    'status_line_use_colors = false',
    '',
    '[features]',
    'memories = true',
    ''
  ].join('\n'));

  const installResult = install({ env });
  assert.ok(installResult.backupPath);
  assert.match(readConfig(env), /status_line_use_colors = true/);
  assert.match(readConfig(env), /animations = true/);
  assert.match(readConfig(env), /\[features]/);

  const uninstallResult = uninstall({ env });
  assert.ok(uninstallResult.backupPath);
  assert.equal(fs.existsSync(statePath(env)), false);

  const restored = readConfig(env);
  assert.match(restored, /status_line = \["current-dir"]/);
  assert.match(restored, /status_line_use_colors = false/);
  assert.match(restored, /model = "gpt-5.5"/);
});

test('reinstall keeps the original previous values for uninstall', () => {
  const env = tempEnv();
  fs.mkdirSync(env.CODEX_HOME, { recursive: true });
  fs.writeFileSync(configPath(env), '[tui]\nstatus_line = ["thread-title"]\n');

  install({ env });
  install({ env });
  uninstall({ env });

  assert.match(readConfig(env), /status_line = \["thread-title"]/);
});

test('uninstall refuses to overwrite a user-edited status line unless forced', () => {
  const env = tempEnv();
  install({ env });

  fs.writeFileSync(configPath(env), '[tui]\nstatus_line = ["current-dir", "codex-version"]\n');
  const skipped = uninstall({ env });

  assert.equal(skipped.skipped, true);
  assert.match(skipped.reason, /--force/);
  assert.match(readConfig(env), /codex-version/);

  const forced = uninstall({ env, force: true });
  assert.equal(forced.skipped, undefined);
  assert.doesNotMatch(readConfig(env), /codex-version/);
});

test('doctor reports preset match', () => {
  const env = tempEnv();
  install({ env });
  const result = doctor({ env });

  assert.equal(result.matchesPreset, true);
  assert.equal(result.preset.join('|'), PRESET.join('|'));
});
