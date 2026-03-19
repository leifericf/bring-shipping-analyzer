import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { requireRunId, requireBringCredentials } from './lib.mjs';
import { loadConfig } from './config.mjs';
import { updateRunStatus, closeDb } from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RUN_ID = requireRunId();
requireBringCredentials();
loadConfig();

const scripts = [
  { name: 'fetch-rates.mjs', desc: 'Fetching shipping rates', status: 'fetching_rates' },
  { name: 'fetch-invoices.mjs', desc: 'Fetching invoices', status: 'fetching_invoices' },
  { name: 'analyze.mjs', desc: 'Analyzing data', status: 'analyzing' },
];

console.log('Bring Shipping Advisor - Full Pipeline\n');
console.log('='.repeat(50) + '\n');
console.log(`Run ID: ${RUN_ID}\n`);

for (const script of scripts) {
  console.log(`\n> ${script.desc}...\n`);
  console.log('-'.repeat(50));

  updateRunStatus(RUN_ID, script.status);

  try {
    execFileSync(process.execPath, [join(__dirname, script.name)], {
      stdio: 'inherit',
      env: process.env,
    });
  } catch (error) {
    updateRunStatus(RUN_ID, 'failed');
    closeDb();
    console.error(`\nError running ${script.name}`);
    process.exit(1);
  }

  console.log('-'.repeat(50));
}

updateRunStatus(RUN_ID, 'completed');
closeDb();

console.log('\n' + '='.repeat(50));
console.log('\nComplete! Results saved to database.\n');
