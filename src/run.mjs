import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadEnv, getOutputDir } from './lib.mjs';
import { loadConfig } from './config.mjs';
import { createRun, updateRunStatus, closeDb } from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = loadEnv();
const config = loadConfig();

// When spawned by the server, RUN_ID and OUTPUT_DIR are already set.
// When run from CLI, we create them here.
const OUTPUT_DIR = process.env.OUTPUT_DIR || getOutputDir(env.BRING_CUSTOMER_NUMBER);
const ORIGIN_POSTAL_CODE = env.BRING_ORIGIN_POSTAL_CODE || '0174';

let runId;
if (process.env.RUN_ID) {
  runId = Number(process.env.RUN_ID);
} else {
  runId = createRun(env.BRING_CUSTOMER_NUMBER, ORIGIN_POSTAL_CODE, OUTPUT_DIR, config);
}

const scripts = [
  { name: 'fetch_rates.mjs', desc: 'Fetching shipping rates', status: 'fetching_rates' },
  { name: 'fetch_invoices.mjs', desc: 'Fetching invoices', status: 'fetching_invoices' },
  { name: 'analyze.mjs', desc: 'Analyzing data', status: 'analyzing' },
];

console.log('Bring Shipping Rates - Full Pipeline\n');
console.log('='.repeat(50) + '\n');
console.log(`Output directory: ${OUTPUT_DIR}`);
console.log(`Run ID: ${runId}\n`);

for (const script of scripts) {
  console.log(`\n> ${script.desc}...\n`);
  console.log('-'.repeat(50));

  updateRunStatus(runId, script.status);

  try {
    execSync(`node ${join(__dirname, script.name)}`, {
      stdio: 'inherit',
      env: { ...process.env, OUTPUT_DIR, RUN_ID: String(runId) },
    });
  } catch (error) {
    updateRunStatus(runId, 'failed');
    closeDb();
    console.error(`\nError running ${script.name}`);
    process.exit(1);
  }

  console.log('-'.repeat(50));
}

updateRunStatus(runId, 'completed');
closeDb();

console.log('\n' + '='.repeat(50));
console.log('\nComplete! Check the data/ folder for results.\n');
