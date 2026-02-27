# Bring Shipping Analyzer

Figure out what to charge your customers for shipping.

This tool fetches your **actual negotiated shipping rates** from the Bring (Posten) API — not the list prices, but the prices you specifically pay based on your agreement — and analyzes them alongside your invoice history to recommend what to charge in your online store.

## What It Does

- Fetches your contract rates from the Bring Shipping Guide API for all configured destinations and weight tiers
- Fetches your invoice history from Mybring, including per-shipment cost breakdowns
- Analyzes the data: compares zone pricing, calculates road toll averages, and cross-references actual shipping costs against suggested customer-facing rates
- Generates a report with recommended rates per country and weight bracket, including a profitability analysis against your real shipment history
- Supports multiple Bring accounts, each with their own configuration

## Setup

### Prerequisites

- Node.js 18+
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

## Usage

```bash
npm start
```

Open http://localhost:3000. From the web UI you can:

1. **Create accounts** — add API credentials for one or more Bring/Mybring customers
2. **Edit configuration** — customize destinations, services, weight tiers, and analysis settings per account
3. **Start runs** — fetch rates and invoices with one click (runs in background)
4. **View results** — see the analysis report with recommended shipping rates
5. **Browse invoices** — list all invoices for a run and download individual PDFs on demand

### Configuration

Each account has its own configuration (editable from the web UI) that controls:

- **Destinations** — which countries and postal codes to check rates for
- **Weight tiers** — which weight brackets to query from the API
- **Shipping services** — domestic and international service definitions
- **Analysis settings** — VAT rate, zone strategy, weight bracket definitions, country groupings

New accounts start with the defaults from `config.json`.

## Database

All data is stored in a local SQLite database at `data/bring.db`. You can query it directly:

```bash
sqlite3 data/bring.db "SELECT id, created_at, status FROM runs"
```

The database is not backed up automatically. If you want to keep a copy, just copy the `data/bring.db` file somewhere safe. That said, the app is designed around ephemeral runs — you can always re-fetch rates and invoices from the Bring API, so losing the database is not a big deal.

## Notes

- **Norway zone system**: Bring uses 7 shipping zones based on distance from origin. Zone numbers can differ per service for the same postal code.
- **VAT**: Norway requires 25% VAT on shipping charged to customers. International shipping has no VAT.
- All Bring APIs used are read-only.

## License

[MIT](LICENSE)
