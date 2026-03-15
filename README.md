# Bring Shipping Analyzer

Figure out what to charge your customers for shipping.

This tool fetches your **actual negotiated shipping rates** from the Bring (Posten) API — not the list prices, but the prices you specifically pay based on your agreement — and analyzes them alongside your invoice history to recommend what to charge in your online store.

## What It Does

- Fetches your contract rates from the Bring Shipping Guide API for all configured destinations and weight tiers
- Fetches your invoice history from Mybring, including per-shipment cost breakdowns
- Analyzes the data: compares zone pricing, calculates road toll averages, and cross-references actual shipping costs against suggested customer-facing rates
- Generates a report with recommended rates per country and weight bracket, including a profitability analysis against your real shipment history
- Auto-clusters international destinations into shipping zones based on rate similarity, minimizing the number of zones you need to configure in your eCommerce platform
- Shows shipment volume data alongside recommended rates so you can see where your actual demand is concentrated
- Includes a Mix Simulator for exploring pricing trade-offs between weight tiers
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
5. **Simulate pricing** — use the Mix Simulator to explore tier cross-subsidization scenarios
6. **Browse invoices** — list all invoices for a run and download individual PDFs on demand

### Report

The report is structured top-down for quick scanning:

- **Recommended Shipping Rates** — a single table with all zones and weight brackets, ready to copy into your eCommerce platform. Prices are rounded to "nice" values ending in 9.
- **Shipment Volume** — a matching table showing how many parcels you actually sent to each zone/weight bracket, based on invoice history.
- **KPI tiles** — shipment count, average road toll, overall margin, and loss-making percentage at a glance.
- **Drill-down sections** (collapsible) — Norway zone pricing comparison, international per-country rates, profitability analysis with per-bracket margins and worst-case shipments, invoice data breakdown, and assumptions/methodology.

### Mix Simulator

A separate tab on the run detail page for exploring pricing trade-offs:

- **Discount sliders** — reduce the price on any weight tier (e.g. offer cheaper or free shipping on light parcels).
- **Sponsor tiers** — select which tiers absorb the lost revenue, distributed proportionally to their shipment volume.
- **Target modes** — keep total margin unchanged, or simulate break-even pricing.
- **Before/after table** — shows baseline vs simulated prices, cost, revenue, and margin per bracket.
- **Warnings** — flags unrealistic scenarios like 2x price increases or zero-volume sponsor tiers.

### Configuration

Each account has its own configuration (editable from the web UI) that controls:

- **Destinations** — which countries and postal codes to check rates for, with bulk-add by region
- **Weight tiers** — which weight brackets to query from the API
- **Shipping services** — domestic and international service definitions, with per-bracket service assignment (e.g. service 3584 for 0–5 kg, service 5800 for 5–20 kg)
- **Analysis settings** — VAT rate, zone strategy, weight bracket definitions, international zone merge threshold
- **Zone merge threshold** — a slider controlling how aggressively international countries are merged into zones (default 10%; lower = more zones, higher = fewer zones)

New accounts start with the defaults from `config.json`.

## Database

All data is stored in a local SQLite database at `data/bring.db`. You can query it directly:

```bash
sqlite3 data/bring.db "SELECT id, created_at, status FROM runs"
```

The database is not backed up automatically. If you want to keep a copy, just copy the `data/bring.db` file somewhere safe. That said, the app is designed around ephemeral runs — you can always re-fetch rates and invoices from the Bring API, so losing the database is not a big deal.

## Notes

- **Norway zone system**: Bring uses 7 shipping zones based on distance from origin. Zone numbers can differ per service for the same postal code.
- **Per-bracket services**: Domestic brackets can use different Bring services (e.g. 3584 "Postkassen" up to 5 kg, 5800 "Hentested" for 5–20 kg). The report clearly labels which service each tier uses.
- **International zone clustering**: Countries are automatically grouped into shipping zones based on rate similarity. Countries whose customer-facing prices (after nicePrice rounding) are within the configured merge threshold are merged, using the highest rate in the group.
- **VAT**: Norway requires 25% VAT on shipping charged to customers. International shipping has no VAT.
- **Invoice history**: The Bring Invoice API only allows fetching invoices from the last 365 days. Older invoices are not available through the API.
- **Currency**: All prices are displayed in kr (Norwegian kroner).
- All Bring APIs used are read-only.

## License

[MIT](LICENSE)
