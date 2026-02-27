import express from 'express';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { marked } from 'marked';

import { DATA_DIR } from './lib.mjs';
import { DEFAULT_CONFIG_PATH } from './config.mjs';
import {
  getDb, closeDb,
  getAllAccounts, getAccount, createAccount, updateAccount, updateAccountConfig, deleteAccount,
  createRun as dbCreateRun, getRun, getRunsForAccount, getRecentRuns, getAnalysisResult,
} from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Express setup
// ---------------------------------------------------------------------------

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(join(__dirname, 'public')));

/**
 * Render a view inside the layout.
 */
function render(res, view, locals = {}) {
  res.render(view, locals, (err, body) => {
    if (err) { console.error(err); return res.status(500).send('Render error'); }
    res.render('layout', { ...locals, body });
  });
}

/**
 * Load the default config.json as a parsed object (for new accounts).
 */
function getDefaultConfig() {
  return JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  const accounts = getAllAccounts();
  const recentRuns = getRecentRuns(20);
  render(res, 'dashboard', { title: 'Dashboard', accounts, recentRuns });
});

// ---------------------------------------------------------------------------
// Account CRUD
// ---------------------------------------------------------------------------

app.get('/accounts/new', (req, res) => {
  render(res, 'account-form', { title: 'New Account', editing: false, account: {} });
});

app.post('/accounts', (req, res) => {
  const { name, api_uid, api_key, customer_number, origin_postal_code } = req.body;
  const config = getDefaultConfig();
  const id = createAccount(name, api_uid, api_key, customer_number, origin_postal_code || '0174', config);
  res.redirect(`/accounts/${id}/runs`);
});

app.get('/accounts/:id/edit', (req, res) => {
  const account = getAccount(Number(req.params.id));
  if (!account) return res.status(404).send('Account not found');
  render(res, 'account-form', { title: 'Edit Account', editing: true, account });
});

app.post('/accounts/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, api_uid, api_key, customer_number, origin_postal_code } = req.body;
  updateAccount(id, name, api_uid, api_key, customer_number, origin_postal_code || '0174');
  res.redirect(`/accounts/${id}/runs`);
});

app.post('/accounts/:id/delete', (req, res) => {
  deleteAccount(Number(req.params.id));
  res.redirect('/');
});

// ---------------------------------------------------------------------------
// Account config
// ---------------------------------------------------------------------------

app.get('/accounts/:id/config', (req, res) => {
  const account = getAccount(Number(req.params.id));
  if (!account) return res.status(404).send('Account not found');

  const config = JSON.parse(account.config);
  const configJson = JSON.stringify(config, null, 2);
  render(res, 'account-config', { title: 'Config: ' + account.name, account, configJson });
});

app.post('/accounts/:id/config', (req, res) => {
  const id = Number(req.params.id);
  const account = getAccount(id);
  if (!account) return res.status(404).send('Account not found');

  let config;
  try {
    config = JSON.parse(req.body.config);
  } catch (err) {
    const configJson = req.body.config;
    return render(res, 'account-config', {
      title: 'Config: ' + account.name, account, configJson,
      flash: 'Invalid JSON: ' + err.message,
    });
  }

  updateAccountConfig(id, config);
  res.redirect(`/accounts/${id}/runs`);
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

app.get('/accounts/:id/runs', (req, res) => {
  const account = getAccount(Number(req.params.id));
  if (!account) return res.status(404).send('Account not found');
  const runs = getRunsForAccount(account.id);
  render(res, 'runs', { title: account.name, account, runs });
});

app.post('/accounts/:id/runs', (req, res) => {
  const account = getAccount(Number(req.params.id));
  if (!account) return res.status(404).send('Account not found');

  const config = JSON.parse(account.config);

  // Compute output directory
  const dateStr = new Date().toISOString().substring(0, 10);
  const outputDir = join(DATA_DIR, `${dateStr}_${account.customer_number}`);

  // Create run record
  const runId = dbCreateRun(account.customer_number, account.origin_postal_code, outputDir, config, account.id);

  // Write temp config file for this run
  const configPath = join(tmpdir(), `bring-config-${runId}.json`);
  fs.writeFileSync(configPath, JSON.stringify(config));

  // Spawn pipeline in background
  const child = spawn('node', [join(__dirname, 'run.mjs')], {
    env: {
      ...process.env,
      BRING_API_UID: account.api_uid,
      BRING_API_KEY: account.api_key,
      BRING_CUSTOMER_NUMBER: account.customer_number,
      BRING_ORIGIN_POSTAL_CODE: account.origin_postal_code,
      CONFIG_PATH: configPath,
      OUTPUT_DIR: outputDir,
      RUN_ID: String(runId),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Log output to console
  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));

  // Clean up temp config when done
  child.on('close', () => {
    try { fs.unlinkSync(configPath); } catch {}
  });

  res.redirect(`/runs/${runId}`);
});

// ---------------------------------------------------------------------------
// Run detail + status polling
// ---------------------------------------------------------------------------

app.get('/runs/:id', (req, res) => {
  const run = getRun(Number(req.params.id));
  if (!run) return res.status(404).send('Run not found');

  // If run has an account, get the name
  if (run.account_id) {
    const account = getAccount(run.account_id);
    run.account_name = account ? account.name : null;
  }

  let resultsHtml = null;
  if (run.status === 'completed') {
    const result = getAnalysisResult(run.id);
    if (result) {
      resultsHtml = marked(result.results_markdown);
    }
  }

  render(res, 'run-detail', { title: 'Run #' + run.id, run, resultsHtml });
});

app.get('/api/runs/:id/status', (req, res) => {
  const run = getRun(Number(req.params.id));
  if (!run) return res.status(404).json({ error: 'Not found' });
  res.json({ status: run.status });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

// Initialize DB on startup
getDb();

app.listen(PORT, () => {
  console.log(`\nBring Shipping Rates — Web UI`);
  console.log(`Running at http://localhost:${PORT}\n`);
});

// Graceful shutdown
process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
