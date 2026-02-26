import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = join(__dirname, '..');
export const DATA_DIR = join(ROOT_DIR, 'data');

const REQUIRED_ENV_KEYS = ['BRING_API_UID', 'BRING_API_KEY', 'BRING_CUSTOMER_NUMBER'];

/**
 * Parse a .env file into a plain object.
 * Supports # comments, blank lines, and optionally quoted values.
 */
export function loadEnv() {
  const envPath = join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('Error: .env file not found. Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};

  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  // Validate required keys
  const missing = REQUIRED_ENV_KEYS.filter(k => !env[k]);
  if (missing.length > 0) {
    console.error(`Error: Missing required .env variables: ${missing.join(', ')}`);
    console.error('Edit your .env file and fill in the missing values.');
    process.exit(1);
  }

  return env;
}

/**
 * Get the output directory for this run.
 * Respects the OUTPUT_DIR env var (set by run.mjs) so all scripts share the same directory.
 */
export function getOutputDir(customerNumber) {
  if (process.env.OUTPUT_DIR) {
    return process.env.OUTPUT_DIR;
  }
  const now = new Date();
  const dateStr = now.toISOString().substring(0, 10);
  return join(DATA_DIR, `${dateStr}_${customerNumber}`);
}

/**
 * Returns the common authentication headers for Bring APIs.
 */
export function getAuthHeaders(env) {
  return {
    'X-Mybring-API-Uid': env.BRING_API_UID,
    'X-Mybring-API-Key': env.BRING_API_KEY,
  };
}

/**
 * Sleep for the given number of milliseconds.
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry and exponential backoff.
 * Retries on 5xx errors and network failures, not 4xx.
 */
export async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Don't retry client errors (4xx)
      if (response.status >= 400 && response.status < 500) {
        return response;
      }

      // Retry server errors (5xx)
      if (!response.ok && attempt < retries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.log(`  Server error ${response.status}, retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      if (attempt < retries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.log(`  Network error, retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Escape a value for CSV output.
 * Wraps in double quotes if the value contains commas, quotes, or newlines.
 */
export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Build a CSV row from an array of values, escaping each field.
 */
export function csvRow(values) {
  return values.map(csvEscape).join(',');
}

/**
 * Parse CSV content into an array of objects.
 * Uses a state-machine approach to correctly handle quoted fields.
 */
export function parseCsv(content) {
  const rows = parseCsvRows(content);
  if (rows.length === 0) return [];

  const headers = rows[0];
  return rows.slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h.trim()] = (row[i] || '').trim();
      });
      return obj;
    });
}

/**
 * Parse CSV into a 2D array of strings, handling quoted fields.
 */
function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < content.length && content[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(field);
        field = '';
        i++;
      } else if (ch === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i++;
        // Skip \r before \n (already consumed \n, but handle \r\n)
      } else if (ch === '\r') {
        i++;
        // skip carriage return
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Push the last field/row
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
