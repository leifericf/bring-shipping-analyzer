// Imperative shell for config loading.
// Reads filesystem and env, delegates validation to pure core.

import fs from 'fs';
import { join } from 'path';
import { ROOT_DIR } from './lib.mjs';
import { validateConfig } from './core/config/validate.mjs';

export const DEFAULT_CONFIG_PATH = join(ROOT_DIR, 'config.json');

/**
 * Try to load and validate a config file.
 * Returns { ok: true, value } or { ok: false, errors: string[] }.
 * Does NOT exit the process — the caller decides how to handle errors.
 *
 * @param {string} [configPath] - Path to config file (defaults to CONFIG_PATH env or config.json)
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function tryLoadConfig(configPath) {
  const path = configPath || process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(path)) {
    return { ok: false, errors: [`Config file not found at ${path}`] };
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`Config file is not valid JSON: ${err.message}`] };
  }

  return validateConfig(raw);
}

/**
 * Load and validate config, exiting on failure.
 * Convenience wrapper for CLI scripts that want fail-fast behavior.
 */
export function loadConfig() {
  const result = tryLoadConfig();

  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`Error: ${error}`);
    }
    process.exit(1);
  }

  return result.value;
}
