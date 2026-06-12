'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PACKAGE_NAME = 'ctxline-codex';
const STATE_FILE = 'ctxline-codex.json';

const PRESET = [
  'current-dir',
  'git-branch',
  'model-with-reasoning',
  'context-used',
  'five-hour-limit',
  'weekly-limit',
  'task-progress'
];

const KNOWN_STATUS_ITEMS = [
  'project-name',
  'current-dir',
  'run-state',
  'thread-title',
  'git-branch',
  'context-remaining',
  'context-used',
  'five-hour-limit',
  'weekly-limit',
  'codex-version',
  'used-tokens',
  'total-input-tokens',
  'total-output-tokens',
  'thread-id',
  'fast-mode',
  'model-with-reasoning',
  'reasoning',
  'task-progress',
  'approval-mode',
  'context-window-size',
  'raw-output'
];

function codexHome(env = process.env) {
  if (env.CODEX_HOME) return path.resolve(env.CODEX_HOME);
  return path.join(os.homedir(), '.codex');
}

function configPath(env = process.env) {
  return path.join(codexHome(env), 'config.toml');
}

function statePath(env = process.env) {
  return path.join(codexHome(env), STATE_FILE);
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return '';
    throw error;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupFile(file) {
  if (!fs.existsSync(file)) return null;
  const backup = `${file}.backup.${timestamp()}`;
  fs.copyFileSync(file, backup);
  return backup;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitToml(content) {
  if (content.length === 0) return { lines: [], hadFinalNewline: false };
  const normalized = content.replace(/\r\n/g, '\n');
  const hadFinalNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (hadFinalNewline) lines.pop();
  return { lines, hadFinalNewline };
}

function joinToml(lines) {
  if (lines.length === 0) return '';
  return `${lines.join('\n')}\n`;
}

function tableName(line) {
  const match = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
  return match ? match[1].trim() : null;
}

function findSection(lines, section) {
  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    if (tableName(lines[i]) === section) {
      start = i;
      break;
    }
  }

  if (start === -1) return { start: -1, end: -1 };

  for (let i = start + 1; i < lines.length; i += 1) {
    if (tableName(lines[i])) {
      end = i;
      break;
    }
  }

  return { start, end };
}

function keyPattern(key) {
  return new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*(.*)$`);
}

function getKeyRaw(content, section, key) {
  const { lines } = splitToml(content);
  const bounds = findSection(lines, section);
  if (bounds.start === -1) return { exists: false, raw: null };

  const pattern = keyPattern(key);
  for (let i = bounds.start + 1; i < bounds.end; i += 1) {
    const match = lines[i].match(pattern);
    if (match) return { exists: true, raw: match[1].trim() };
  }

  return { exists: false, raw: null };
}

function sectionExists(content, section) {
  const { lines } = splitToml(content);
  return findSection(lines, section).start !== -1;
}

function setKeyRaw(content, section, key, rawValue) {
  const { lines } = splitToml(content);
  let bounds = findSection(lines, section);

  if (bounds.start === -1) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(`[${section}]`);
    bounds = { start: lines.length - 1, end: lines.length };
  }

  const pattern = keyPattern(key);
  for (let i = bounds.start + 1; i < bounds.end; i += 1) {
    if (pattern.test(lines[i])) {
      lines[i] = `${key} = ${rawValue}`;
      return joinToml(lines);
    }
  }

  lines.splice(bounds.end, 0, `${key} = ${rawValue}`);
  return joinToml(lines);
}

function removeKey(content, section, key) {
  const { lines } = splitToml(content);
  const bounds = findSection(lines, section);
  if (bounds.start === -1) return joinToml(lines);

  const pattern = keyPattern(key);
  for (let i = bounds.start + 1; i < bounds.end; i += 1) {
    if (pattern.test(lines[i])) {
      lines.splice(i, 1);
      return joinToml(lines);
    }
  }

  return joinToml(lines);
}

function removeSection(content, section) {
  const { lines } = splitToml(content);
  const bounds = findSection(lines, section);
  if (bounds.start === -1) return joinToml(lines);

  lines.splice(bounds.start, bounds.end - bounds.start);

  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

  return joinToml(lines);
}

function removeSectionIfEmpty(content, section) {
  const { lines } = splitToml(content);
  const bounds = findSection(lines, section);
  if (bounds.start === -1) return joinToml(lines);

  for (let i = bounds.start + 1; i < bounds.end; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed !== '' && !trimmed.startsWith('#')) return joinToml(lines);
  }

  return removeSection(content, section);
}

function restoreKey(content, section, key, previous) {
  if (previous && previous.exists) return setKeyRaw(content, section, key, previous.raw);
  return removeKey(content, section, key);
}

function formatStatusLine(items = PRESET) {
  return `[${items.map((item) => JSON.stringify(item)).join(', ')}]`;
}

function parseStatusLine(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed;
    }
  } catch (error) {
    return null;
  }
  return null;
}

function sameStatusLine(raw, items = PRESET) {
  const parsed = parseStatusLine(raw);
  if (!parsed) return raw === formatStatusLine(items);
  return parsed.length === items.length && parsed.every((item, index) => item === items[index]);
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    return null;
  }
}

function writeState(file, state) {
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

function buildState(before, env, existingState = null) {
  if (existingState && existingState.previous) {
    return {
      ...existingState,
      lastInstalledAt: new Date().toISOString(),
      preset: PRESET
    };
  }

  return {
    package: PACKAGE_NAME,
    installedAt: new Date().toISOString(),
    configPath: configPath(env),
    preset: PRESET,
    previous: {
      tui: { exists: sectionExists(before, 'tui') },
      status_line: getKeyRaw(before, 'tui', 'status_line'),
      status_line_use_colors: getKeyRaw(before, 'tui', 'status_line_use_colors')
    }
  };
}

function install(options = {}) {
  const env = options.env || process.env;
  const home = codexHome(env);
  const cfg = configPath(env);
  const state = statePath(env);
  const before = readText(cfg);
  const existingState = readState(state);
  const nextState = buildState(before, env, existingState);

  let next = setKeyRaw(before, 'tui', 'status_line', formatStatusLine(PRESET));
  next = setKeyRaw(next, 'tui', 'status_line_use_colors', 'true');

  if (options.dryRun) {
    return {
      changed: next !== before,
      dryRun: true,
      configPath: cfg,
      statePath: state,
      backupPath: null,
      preset: PRESET
    };
  }

  ensureDir(home);
  const backupPath = backupFile(cfg);
  fs.writeFileSync(cfg, next);
  writeState(state, nextState);

  return {
    changed: next !== before,
    dryRun: false,
    configPath: cfg,
    statePath: state,
    backupPath,
    preset: PRESET
  };
}

function uninstall(options = {}) {
  const env = options.env || process.env;
  const cfg = configPath(env);
  const state = statePath(env);
  const before = readText(cfg);
  const saved = readState(state);
  const current = getKeyRaw(before, 'tui', 'status_line');

  if (saved && !options.force && current.exists && !sameStatusLine(current.raw, saved.preset || PRESET)) {
    return {
      changed: false,
      skipped: true,
      reason: 'Current status_line no longer matches the ctxline-codex preset. Use --force to restore saved values.',
      configPath: cfg,
      statePath: state
    };
  }

  let next = before;
  if (saved && saved.previous) {
    next = restoreKey(next, 'tui', 'status_line', saved.previous.status_line);
    next = restoreKey(next, 'tui', 'status_line_use_colors', saved.previous.status_line_use_colors);
    if (saved.previous.tui && saved.previous.tui.exists === false) {
      next = removeSection(next, 'tui');
    }
  } else if (current.exists && sameStatusLine(current.raw, PRESET)) {
    next = removeKey(next, 'tui', 'status_line');
    next = removeKey(next, 'tui', 'status_line_use_colors');
    next = removeSectionIfEmpty(next, 'tui');
  } else {
    return {
      changed: false,
      skipped: true,
      reason: 'No ctxline-codex state found and current status_line does not match the preset.',
      configPath: cfg,
      statePath: state
    };
  }

  if (options.dryRun) {
    return {
      changed: next !== before,
      dryRun: true,
      configPath: cfg,
      statePath: state,
      backupPath: null
    };
  }

  const backupPath = backupFile(cfg);
  fs.writeFileSync(cfg, next);
  if (fs.existsSync(state)) fs.unlinkSync(state);

  return {
    changed: next !== before,
    dryRun: false,
    configPath: cfg,
    statePath: state,
    backupPath
  };
}

function findOnPath(command, env = process.env) {
  const pathValue = env.PATH || '';
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function doctor(options = {}) {
  const env = options.env || process.env;
  const cfg = configPath(env);
  const content = readText(cfg);
  const statusLine = getKeyRaw(content, 'tui', 'status_line');
  const codexBin = findOnPath('codex', env);
  const version = codexBin ? spawnSync(codexBin, ['--version'], { encoding: 'utf8', env }).stdout.trim() : null;

  return {
    codexHome: codexHome(env),
    configPath: cfg,
    statePath: statePath(env),
    codexBin,
    codexVersion: version,
    statusLine,
    matchesPreset: statusLine.exists ? sameStatusLine(statusLine.raw, PRESET) : false,
    knownStatusItems: KNOWN_STATUS_ITEMS,
    preset: PRESET
  };
}

module.exports = {
  PACKAGE_NAME,
  PRESET,
  KNOWN_STATUS_ITEMS,
  codexHome,
  configPath,
  statePath,
  formatStatusLine,
  parseStatusLine,
  sameStatusLine,
  getKeyRaw,
  setKeyRaw,
  removeKey,
  removeSection,
  install,
  uninstall,
  doctor
};
