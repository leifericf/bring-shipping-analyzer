import https from 'https';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = join(__dirname, '..');
export const DATA_DIR = join(ROOT_DIR, 'data');
export const DEFAULT_ORIGIN_POSTAL_CODE = '0174';

/**
 * Read and validate a required RUN_ID from env. Exits on failure.
 * @returns {number}
 */
export function requireRunId() {
  const id = Number(process.env.RUN_ID);
  if (!id) {
    console.error('Error: RUN_ID environment variable is required. Use "npm start" or the web UI.');
    process.exit(1);
  }
  return id;
}

/**
 * Read and validate Bring API credentials from env. Exits on failure.
 * @returns {{ apiUid: string, apiKey: string, customerNumber: string, authHeaders: object }}
 */
export function requireBringCredentials() {
  const apiUid = process.env.BRING_API_UID;
  const apiKey = process.env.BRING_API_KEY;
  const customerNumber = process.env.BRING_CUSTOMER_NUMBER;

  for (const [name, value] of [['BRING_API_UID', apiUid], ['BRING_API_KEY', apiKey], ['BRING_CUSTOMER_NUMBER', customerNumber]]) {
    if (!value) {
      console.error(`Error: ${name} environment variable is required.`);
      process.exit(1);
    }
  }

  return {
    apiUid,
    apiKey,
    customerNumber,
    authHeaders: getAuthHeaders({ BRING_API_UID: apiUid, BRING_API_KEY: apiKey }),
  };
}

/**
 * Wrap an async main function with top-level error handling.
 * @param {Function} fn - async function to run
 */
export function runMain(fn) {
  fn().catch(err => { console.error(err); process.exit(1); });
}

/**
 * Returns the common authentication headers for Bring APIs.
 */
function getAuthHeaders(env) {
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
 *
 * @param {string} url
 * @param {object} [options]
 * @param {number} [retries=3]
 * @param {Function} [log=console.log] - Logging function for retry messages
 */
export async function fetchWithRetry(url, options = {}, retries = 3, log = console.log) {
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
        log(`  Server error ${response.status}, retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      if (attempt < retries) {
        const delay = 1000 * Math.pow(2, attempt);
        log(`  Network error, retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Make an HTTPS GET request using node:https.
 * Some Mybring API endpoints (e.g. XML report downloads) reject Node.js
 * fetch()/undici requests with 406, but work fine with node:https.
 * This helper provides a compatible alternative for those endpoints.
 */
export function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}
