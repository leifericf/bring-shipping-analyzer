# Bring Shipping Advisor

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

## Getting API Credentials

You'll need Bring API credentials regardless of how you run the app:

1. Log in to [Mybring](https://www.mybring.com)
2. Go to Account Settings → API
3. Create an API key
4. Note your customer number (found on invoices or in Mybring)

## Setup

### Desktop App (recommended)

Download the installer for your platform from the [Releases](../../releases) page:

- **macOS**: `.dmg` — open it and drag the app to Applications
- **Windows**: `.exe` installer — run it and follow the prompts

Launch the app like any other application. No terminal, no dependencies to install. Close the window when you're done.

### Web Server (alternative, for developers)

If you prefer running the app as a standalone web server:

**Prerequisites:** Node.js 18+

```bash
npm install   # install dependencies (first time only)
npm start     # start the server
```

Open http://localhost:3000. Press `Ctrl+C` in the terminal to stop.

## Getting Started

Once the app is open:

1. **Create an account** — click "New Account" and enter your Bring API credentials (API UID, API key, and customer number from Mybring).
2. **Review your configuration** — the app comes with sensible defaults for destinations, weight tiers, and services. You can adjust these from the account's config page, or leave them as-is.
3. **Start a run** — click "New Run" on your account page. The app will fetch your rates and invoices from Bring in the background (this takes a minute or two).
4. **View your report** — once the run completes, you'll see recommended shipping rates for every zone and weight bracket, along with a profitability analysis based on your actual invoice history.

From there you can refine your configuration, start new runs, or use the Mix Simulator to explore pricing trade-offs.

## Usage

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

Each account has its own configuration (editable from the app) that controls:

- **Destinations** — which countries and postal codes to check rates for, with bulk-add by region. Flagged countries are highlighted with risk warnings (see below).
- **Weight tiers** — which weight brackets to query from the API
- **Shipping services** — domestic and international service definitions, with per-bracket service assignment (e.g. service 3584 for 0–5 kg, service 5800 for 5–20 kg)
- **Analysis settings** — VAT rate, zone strategy, weight bracket definitions, international zone merge threshold
- **Zone merge threshold** — a slider controlling how aggressively international countries are merged into zones (default 10%; lower = more zones, higher = fewer zones)

### Flagged Country Warnings

The app includes a built-in database of countries flagged for shipping risk. Each flagged country has a risk level and a documented reason:

| Risk | Meaning |
|------|---------|
| **Critical** | Sanctions, active war, or failed state. Do not ship. |
| **High** | Conflict, extreme corruption, collapsed systems. Strongly advised against. |
| **Medium** | Significant instability, weak postal infrastructure, or high corruption. |
| **Low** | Minor concerns: microstates, dependencies, or borderline systems. |

When editing an account's destinations:

- A **warning banner** at the top of the config page lists any flagged countries currently in the config, with their risk level and reason.
- Each flagged destination in the **destination table** shows a color-coded risk badge and the reason it was flagged.
- **Adding a flagged country** individually triggers a confirmation dialog explaining the risk.
- **Bulk-adding by region** leaves flagged countries unchecked by default, with risk badges visible so you can make an informed choice.
- **Saving** a config that contains flagged countries shows a warning (but still saves — it's a warning, not a block).

## Your Data

All data is stored locally in a SQLite database. Nothing is sent to any server other than the Bring/Mybring APIs.

- **Desktop app**: data is stored in your OS app-data folder:
  - macOS: `~/Library/Application Support/Bring Shipping Advisor/data/`
  - Windows: `%APPDATA%/Bring Shipping Advisor/data/`
- **Web server mode**: data is stored in the `data/` folder next to the app.

The database is not backed up automatically. If you want to keep a copy, just copy the `bring.db` file somewhere safe. That said, the app is designed around ephemeral runs — you can always re-fetch rates and invoices from the Bring API, so losing the database is not a big deal.

## Notes

- **Norway zone system**: Bring uses up to 8 shipping zones for domestic parcels. The total zone count for a shipment is: local sender zone + main terminal-to-terminal zone + local receiver zone. Origins near major terminals (e.g. Oslo) have local sender zone 0, so the practical max for those origins is 7. Zone numbers can differ per service for the same postal code.
- **Per-bracket services**: Domestic brackets can use different Bring services (e.g. 3584 "Postkassen" up to 5 kg, 5800 "Hentested" for 5–20 kg). The report clearly labels which service each tier uses.
- **International zone clustering**: Countries are automatically grouped into shipping zones based on rate similarity. Countries whose customer-facing prices (after nicePrice rounding) are within the configured merge threshold are merged, using the highest rate in the group.
- **VAT**: Norway requires 25% VAT on shipping charged to customers. International shipping has no VAT.
- **Invoice history**: The Bring Invoice API only allows fetching invoices from the last 365 days. Older invoices are not available through the API.
- **Currency**: All prices are displayed in kr (Norwegian kroner).
- All Bring APIs used are read-only.

## Development

### Building the Desktop App

To build the desktop app installers yourself:

```bash
npm install
npm run desktop:dist
```

Installers are output to `dist/`. By default this builds for the current platform. To build for a specific platform:

```bash
npm run desktop:dist -- --mac    # macOS .dmg
npm run desktop:dist -- --win    # Windows .exe installer
```

To run the Electron app directly during development:

```bash
npm run desktop:rebuild   # rebuild native modules for Electron (once)
npm run desktop:dev       # launch the app in dev mode
```

Note: `desktop:rebuild` compiles native modules (like better-sqlite3) for Electron's Node ABI. After running it, `npm start` (web server mode) may require a fresh `npm install` to restore the standard Node.js binaries.

### Project Structure

New accounts start with the defaults from `config.json` in the project root. The flagged country list is maintained in `src/core/flagged-countries.mjs`.

### Querying the Database Directly

In web server mode, you can query the SQLite database directly:

```bash
sqlite3 data/bring.db "SELECT id, created_at, status FROM runs"
```

## Disclaimer

This application was vibe coded. No technical support is provided. Use at your own risk.

## License

[MIT](LICENSE)
