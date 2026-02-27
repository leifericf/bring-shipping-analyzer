# Bring Shipping Rates

Tools to fetch and analyze shipping rates from Bring (Posten) for Shopify stores.

## Overview

This project fetches shipping rates and invoice data from the Bring API to help determine optimal shipping rates to charge customers.

## Project Structure

```
bring-shipping-rates/
├── README.md               # This file
├── package.json            # Project metadata and npm scripts
├── config.json             # Default business configuration (destinations, services, weights)
├── .env.example            # Environment template (for CLI usage)
├── .env                    # Your credentials for CLI usage (git-ignored)
├── src/
│   ├── lib.mjs             # Shared utilities (env, CSV, fetch helpers)
│   ├── config.mjs          # Config loader and validation
│   ├── db.mjs              # SQLite database layer
│   ├── server.mjs          # Web UI (Express server)
│   ├── run.mjs             # Pipeline entry point - runs all scripts
│   ├── fetch_rates.mjs     # Fetch shipping rates from Bring API
│   ├── fetch_invoices.mjs  # Fetch invoice data and PDFs from Bring API
│   ├── analyze.mjs         # Analyze data and generate recommendations
│   ├── views/              # EJS templates for the web UI
│   └── public/             # Static CSS for the web UI
└── data/                   # Output files (git-ignored)
    ├── bring.db            # SQLite database (all run history)
    └── <YYYY-MM-DD>_<customer>/    # One folder per day per customer
        ├── shipping_rates.csv      # All shipping rates
        ├── zones.csv               # Postal code to zone mapping
        ├── invoice_line_items.csv  # Line items from invoices
        ├── invoices/               # Downloaded PDF invoices
        └── RESULTS.md              # Analysis and recommendations
```

Each run creates a new timestamped folder in `data/` and a new record in the SQLite database, so historical data is preserved and multiple Bring customers can be analyzed.

## Setup

### Prerequisites

- Node.js 18+ (uses native `fetch`)
- Bring API credentials

### Getting API Credentials

1. Log in to [Mybring](https://www.mybring.com)
2. Go to Account Settings → API
3. Create an API key
4. Note your customer number (found on invoices or in Mybring)

### Installation

```bash
npm install
```

### Configuration

There are two configuration files:

#### 1. `.env` — Credentials (secret, git-ignored)

```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```
BRING_API_UID=your-email@example.com
BRING_API_KEY=your-api-key-here
BRING_CUSTOMER_NUMBER=your-customer-number-here
# Postal code where packages are shipped from (default: 0174)
BRING_ORIGIN_POSTAL_CODE=0562
```

**Important**: Never commit `.env` to git.

#### 2. `config.json` — Business configuration (checked into git)

This file controls everything about what data is fetched and how it's analyzed:

- **Destinations** — which countries and postal codes to check rates for
- **Weight tiers** — which weight brackets to query from the API
- **Shipping services** — domestic and international service definitions
- **Analysis settings** — VAT rate, zone strategy, Shopify bracket definitions, country groupings

Edit `config.json` to customize for your needs. For example, to add a new destination country, add an entry to the `destinations` array. To change the Shopify weight brackets, edit the `analysis.domesticShopifyBrackets` array.

## Usage

### Web UI (recommended)

Start the web server:

```bash
npm run server
```

Open http://localhost:3000 in your browser. From the web UI you can:

1. **Create accounts** — add API credentials for one or more Bring/Mybring users
2. **Edit configuration** — customize destinations, services, weight tiers, and analysis settings per account
3. **Start runs** — fetch rates and invoices with one click (runs in background)
4. **View results** — see the analysis report rendered as a web page

The web UI stores credentials in the local SQLite database. No `.env` file is needed when using the web UI.

### CLI

Run the full pipeline from the command line (uses `.env` for credentials):

```bash
npm start
```

Or directly:

```bash
node src/run.mjs
```

This runs all scripts in order: fetch rates → fetch invoices → analyze data.

### Individual Scripts

You can also run scripts individually:

```bash
npm run fetch:rates       # Fetch shipping rates
npm run fetch:invoices    # Fetch invoices and PDFs
npm run analyze           # Generate recommendations
```

When run individually, scripts still write to CSV files. The database is only populated when using the full pipeline (`npm start`) or the web UI.

### Script Details

#### fetch_rates.mjs

Fetches shipping rates for all destinations and services defined in `config.json`.

Output: `data/<timestamp>_<customer>/shipping_rates.csv`

#### fetch_invoices.mjs

Fetches:
- List of all invoices from your account
- Detailed line items per invoice
- PDF downloads of each invoice

Output:
- `data/<timestamp>_<customer>/invoice_line_items.csv`
- `data/<timestamp>_<customer>/invoices/*.pdf`

#### analyze.mjs

Analyzes the fetched data and generates:
- Recommended shipping rates per country/weight tier (with VAT for Norway)
- Summary of your actual shipping costs from invoices
- Norway zone pricing breakdown across all weight tiers
- Road toll average derived from invoice data
- Profitability analysis cross-referencing invoice costs vs. suggested rates

Output: `data/<timestamp>_<customer>/RESULTS.md`

## Database

All run data is stored in a SQLite database at `data/bring.db`. This enables:

- **Historical comparison** — compare rates across different dates
- **Querying** — use any SQLite tool to explore your data
- **Web UI** — powers the account management, run history, and results views

The database contains these tables:

| Table | Purpose |
|-------|---------|
| `accounts` | Bring API credentials and per-account config |
| `runs` | Run metadata (date, account, config snapshot, status) |
| `shipping_rates` | All fetched shipping rates per run |
| `zones` | Postal code to zone mappings per run |
| `invoice_line_items` | Invoice line items per run |
| `analysis_results` | Generated RESULTS.md content per run |

You can query it directly:

```bash
# List all runs
sqlite3 data/bring.db "SELECT id, created_at, status FROM runs"

# Compare rates between runs
sqlite3 data/bring.db "SELECT run_id, country, weight_g, price_nok FROM shipping_rates WHERE service_id='3584' AND zone='3'"
```

## Bring Services

| Service | Code | Available For | Max Weight | Description |
|---------|------|---------------|------------|-------------|
| Home Mailbox Parcel | 3584 | Norway only | 5 kg | Delivered to customer's mailbox - cheapest domestic |
| Home Mailbox Parcel RFID | 3570 | Norway only | 5 kg | Same as 3584 with RFID tracking |
| Pickup Parcel | 5800 | Norway only | 35 kg | Delivered to pickup point |
| Business Parcel | 5000 | Norway only | 35 kg | B2B delivery |
| Parcel Home Plus | 5600 | Norway only | 35 kg | Home delivery |
| PickUp Parcel | PICKUP_PARCEL | International | 20 kg | Delivered to pickup point |
| Business Parcel | BUSINESS_PARCEL | International | 35 kg | B2B delivery |

## Norway Zone System

Norway has 7 shipping zones based on distance from the origin postal code. The scripts sample postal codes from each zone to show the full price range.

Note: Zone numbers can differ per service for the same postal code (e.g., service 5600 uses different zones than 3584).

## VAT Notes

- **Norway**: Must include 25% VAT in shipping price charged to customer
- **International**: No VAT charged on shipping to customers outside Norway

## Bring APIs Used

| API | Purpose |
|-----|---------|
| Shipping Guide API | Get shipping rates |
| Invoice API | List invoices |
| Invoice PDF API | Download invoice PDFs |
| Reports API | Generate invoice specifications |

All APIs are read-only and require authentication via `X-Mybring-API-Uid` and `X-Mybring-API-Key` headers.
