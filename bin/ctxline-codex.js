#!/usr/bin/env node
'use strict';

const {
  PRESET,
  install,
  uninstall,
  doctor,
  formatStatusLine
} = require('../lib/codex-config');

const colors = {
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  reset: '\x1b[0m'
};

function useColor() {
  return process.stdout.isTTY && !process.env.NO_COLOR;
}

function color(name, text) {
  if (!useColor()) return text;
  return `${colors[name]}${text}${colors.reset}`;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function printHeader(title) {
  console.log(color('cyan', '======================================'));
  console.log(color('cyan', `  ${title}`));
  console.log(color('cyan', '======================================'));
  console.log('');
}

function printHelp() {
  console.log(`ctxline-codex

Usage:
  ctxline-codex              Install the Codex status-line preset
  ctxline-codex install      Install the Codex status-line preset
  ctxline-codex uninstall    Restore the previous Codex status-line config
  ctxline-codex doctor       Print Codex status-line diagnostics
  ctxline-codex preset       Print the preset TOML value

Options:
  --dry-run                  Show what would happen without writing files
  --force                    During uninstall, restore saved values even if edited
  -h, --help                 Show this help

Environment:
  CODEX_HOME                 Defaults to ~/.codex
`);
}

function printInstall(result) {
  printHeader('Codex Status Line Installer');
  console.log(`${color('green', '✓')} Config: ${result.configPath}`);
  if (result.backupPath) console.log(`${color('green', '✓')} Backup: ${result.backupPath}`);
  if (result.dryRun) console.log(`${color('yellow', '!')} Dry run: no files were changed`);
  console.log(`${color('green', '✓')} Preset: ${result.preset.join(' | ')}`);
  console.log('');
  console.log('Restart Codex or start a new session for the status line to refresh.');
}

function printUninstall(result) {
  printHeader('Codex Status Line Uninstaller');
  if (result.skipped) {
    console.log(`${color('yellow', '!')} ${result.reason}`);
    console.log(`Config: ${result.configPath}`);
    return;
  }
  console.log(`${color('green', '✓')} Config: ${result.configPath}`);
  if (result.backupPath) console.log(`${color('green', '✓')} Backup: ${result.backupPath}`);
  if (result.dryRun) console.log(`${color('yellow', '!')} Dry run: no files were changed`);
  console.log('');
  console.log('Restart Codex or start a new session for the status line to refresh.');
}

function printDoctor(result) {
  printHeader('Codex Status Line Doctor');
  console.log(`Codex home:    ${result.codexHome}`);
  console.log(`Config:        ${result.configPath}`);
  console.log(`State:         ${result.statePath}`);
  console.log(`Codex binary:  ${result.codexBin || 'not found on PATH'}`);
  console.log(`Codex version: ${result.codexVersion || 'unknown'}`);
  console.log(`Preset:        ${result.preset.join(' | ')}`);
  console.log(`Current:       ${result.statusLine.exists ? result.statusLine.raw : 'not configured'}`);
  console.log(`Matches:       ${result.matchesPreset ? 'yes' : 'no'}`);
}

function main() {
  const command = (process.argv[2] && !process.argv[2].startsWith('-'))
    ? process.argv[2].toLowerCase()
    : 'install';

  if (hasFlag('-h') || hasFlag('--help') || command === 'help') {
    printHelp();
    return;
  }

  if (command === 'install') {
    printInstall(install({ dryRun: hasFlag('--dry-run') }));
    return;
  }

  if (command === 'uninstall' || command === 'remove') {
    printUninstall(uninstall({ dryRun: hasFlag('--dry-run'), force: hasFlag('--force') }));
    return;
  }

  if (command === 'doctor' || command === 'status') {
    printDoctor(doctor());
    return;
  }

  if (command === 'preset') {
    console.log(formatStatusLine(PRESET));
    return;
  }

  console.error(color('red', `Unknown command: ${command}`));
  console.error('Run ctxline-codex --help for usage.');
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(color('red', `Error: ${error.message}`));
  process.exit(1);
}
