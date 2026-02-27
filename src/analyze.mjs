import fs from 'fs';
import { join } from 'path';
import { DATA_DIR, parseCsv } from './lib.mjs';

/**
 * Round up to the next "nice" price ending in 9 (e.g. 59, 79, 149, 999).
 */
function nicePrice(value) {
  return Math.ceil((value - 9) / 10) * 10 + 9;
}

function findLatestDataDir() {
  const dirs = fs.readdirSync(DATA_DIR)
    .filter(name => fs.statSync(join(DATA_DIR, name)).isDirectory())
    .sort()
    .reverse();

  if (dirs.length === 0) {
    console.error('No data directories found. Run fetch_rates.mjs and fetch_invoices.mjs first.');
    process.exit(1);
  }

  return join(DATA_DIR, dirs[0]);
}

/**
 * Analyze invoice line items.
 * Excludes road toll and surcharge lines to count only actual shipments.
 */
function analyzeInvoices(lineItems) {
  const byProduct = {};
  const roadTolls = [];

  for (const item of lineItems) {
    const desc = item.description || '';

    // Collect road toll values separately
    if (desc.includes('Road toll')) {
      const price = parseFloat(item.agreement_price) || 0;
      if (price > 0) roadTolls.push(price);
      continue;
    }

    // Skip surcharge lines
    if (desc.includes('Surcharge')) continue;

    const key = `${item.product_code} - ${item.product}`;
    if (!byProduct[key]) {
      byProduct[key] = { count: 0, totalAgreement: 0, weights: [] };
    }

    byProduct[key].count++;
    byProduct[key].totalAgreement += parseFloat(item.agreement_price) || 0;
    if (item.weight_kg) {
      byProduct[key].weights.push(parseFloat(item.weight_kg));
    }
  }

  const avgRoadToll = roadTolls.length > 0
    ? roadTolls.reduce((a, b) => a + b, 0) / roadTolls.length
    : 0;

  return { byProduct, avgRoadToll };
}

/**
 * Generate the RESULTS.md markdown report.
 */
function generateResultsMd(rates, invoiceAnalysis) {
  const { byProduct, avgRoadToll } = invoiceAnalysis;
  const roadToll = Math.round(avgRoadToll * 100) / 100;

  let md = `# Shipping Rate Analysis

Generated: ${new Date().toISOString()}

## Key Findings

1. **Main service used**: \`3584\` (Home Mailbox Parcel) - cheapest domestic option
2. **3584 is Norway-only** - not available for international shipping
3. **International shipping** uses \`PICKUP_PARCEL\` - cheapest option
4. **Road toll**: ~${roadToll} NOK per shipment (Norway only, derived from invoice data)

`;

  // Invoice summary — show top products by shipment count
  const sortedProducts = Object.entries(byProduct)
    .filter(([, stats]) => stats.count > 0)
    .sort((a, b) => b[1].count - a[1].count);

  if (sortedProducts.length > 0) {
    md += `## Actual Shipment Data (from invoices)\n\n`;

    for (const [product, stats] of sortedProducts) {
      const avgPrice = (stats.totalAgreement / stats.count).toFixed(2);
      const avgWeight = stats.weights.length > 0
        ? (stats.weights.reduce((a, b) => a + b, 0) / stats.weights.length).toFixed(2)
        : 'N/A';

      md += `### ${product}\n\n`;
      md += `- **Total shipments**: ${stats.count}\n`;
      md += `- **Total paid**: ${stats.totalAgreement.toFixed(2)} NOK\n`;
      md += `- **Average per shipment**: ${avgPrice} NOK\n`;
      md += `- **Average weight**: ${avgWeight} kg\n\n`;
    }
  }

  // Norway rate recommendations
  const norway3584 = rates.filter(r => r.country_code === 'NO' && r.service_id === '3584');

  const weightTiers = [
    { name: '0-250g', key: '250' },
    { name: '250-750g', key: '750' },
    { name: '750g-1kg', key: '1000' },
    { name: '1-5kg', key: '5000' },
  ];

  md += `## Recommended Shipping Rates

### Norway (includes 25% VAT)

**Zone 1 (Oslo area) — optimistic pricing:**

| Weight Tier | Cost ex VAT | + Road Toll | With 25% VAT |
|-------------|-------------|-------------|---------------|
`;

  for (const tier of weightTiers) {
    const zone1Rate = norway3584.find(r => r.zone === '1' && r.weight_g === tier.key);
    if (zone1Rate) {
      const price = parseFloat(zone1Rate.price_nok);
      const withToll = price + roadToll;
      const withVat = Math.ceil(withToll * 1.25);
      md += `| ${tier.name} | ${price.toFixed(2)} NOK | ${withToll.toFixed(2)} NOK | ${withVat} NOK |\n`;
    }
  }

  md += `\n**Zone 3 (Bergen/mid-Norway) — safer, covers most of Norway:**

| Weight Tier | Cost ex VAT | + Road Toll | With 25% VAT |
|-------------|-------------|-------------|---------------|
`;

  for (const tier of weightTiers) {
    const zone3Rate = norway3584.find(r => r.zone === '3' && r.weight_g === tier.key);
    if (zone3Rate) {
      const price = parseFloat(zone3Rate.price_nok);
      const withToll = price + roadToll;
      const withVat = Math.ceil(withToll * 1.25);
      md += `| ${tier.name} | ${price.toFixed(2)} NOK | ${withToll.toFixed(2)} NOK | ${withVat} NOK |\n`;
    }
  }

  // International recommendations
  md += `\n### International (no VAT)

| Country | 250g | 750g | 1kg | 5kg | 10kg | 20kg |
|---------|------|------|-----|-----|------|------|
`;

  const countryNames = {
    'SE': 'Sweden',
    'DK': 'Denmark',
    'FI': 'Finland',
    'IS': 'Iceland',
    'GL': 'Greenland',
    'FO': 'Faroe Islands',
  };

  const intlWeights = ['250', '750', '1000', '5000', '10000', '20000'];

  for (const [code, name] of Object.entries(countryNames)) {
    const cells = intlWeights.map(w => {
      const rate = rates.find(r =>
        r.country_code === code &&
        r.service_id === 'PICKUP_PARCEL' &&
        r.weight_g === w
      );
      return rate ? `${Math.ceil(parseFloat(rate.price_nok))} NOK` : 'N/A';
    });
    md += `| ${name} | ${cells.join(' | ')} |\n`;
  }

  // Full zone pricing table for service 3584
  md += `\n## Norway Zone Pricing (Service 3584)

| Zone | 250g | 750g | 1kg | 5kg |
|------|------|------|-----|-----|
`;

  for (let zone = 1; zone <= 7; zone++) {
    const zoneStr = String(zone);
    const cells = ['250', '750', '1000', '5000'].map(w => {
      const rate = norway3584.find(r => r.zone === zoneStr && r.weight_g === w);
      return rate ? `${parseFloat(rate.price_nok).toFixed(2)} NOK` : 'N/A';
    });
    md += `| ${zone} | ${cells.join(' | ')} |\n`;
  }

  // Suggested Shopify rates — simplified tiers
  const shopifyBrackets = [
    { name: '0–0.5 kg', weight: '250' },
    { name: '0.5–1 kg', weight: '1000' },
    { name: '1 kg+', weight: '5000' },
  ];

  md += `\n## Suggested Shopify Rates

Prices rounded up to the next "nice" price ending in 9.

### Norway — Service 3584 (incl. road toll + 25% VAT)

| Weight | Zone 1 (Oslo) | Zone 3 (Bergen) | Zone 7 (Finnmark) |
|--------|--------------|-----------------|-------------------|
`;

  for (const bracket of shopifyBrackets) {
    const cells = ['1', '3', '7'].map(zone => {
      const rate = norway3584.find(r => r.zone === zone && r.weight_g === bracket.weight);
      if (!rate) return 'N/A';
      return `${nicePrice(Math.ceil((parseFloat(rate.price_nok) + roadToll) * 1.25))} kr`;
    });
    md += `| ${bracket.name} | ${cells.join(' | ')} |\n`;
  }

  md += `\n### International — PICKUP_PARCEL (no VAT)

| Country | 0–0.5 kg | 0.5–1 kg | 1 kg+ |
|---------|----------|----------|-------|
`;

  const intlBracketWeights = ['250', '1000', '5000'];

  for (const [code, name] of Object.entries(countryNames)) {
    const cells = intlBracketWeights.map(w => {
      const rate = rates.find(r =>
        r.country_code === code &&
        r.service_id === 'PICKUP_PARCEL' &&
        r.weight_g === w
      );
      return rate ? `${nicePrice(Math.ceil(parseFloat(rate.price_nok)))} kr` : 'N/A';
    });
    md += `| ${name} | ${cells.join(' | ')} |\n`;
  }

  // Simplified recommendation
  // Group Nordics (SE/DK/FI) and remote (IS/GL/FO) — use the highest price in each group
  const nordicMax = {};
  const remoteMax = {};
  for (const w of intlBracketWeights) {
    const nordicPrices = ['SE', 'DK', 'FI'].map(code => {
      const r = rates.find(r => r.country_code === code && r.service_id === 'PICKUP_PARCEL' && r.weight_g === w);
      return r ? Math.ceil(parseFloat(r.price_nok)) : 0;
    });
    nordicMax[w] = nicePrice(Math.max(...nordicPrices));

    const remotePrices = ['IS', 'GL', 'FO'].map(code => {
      const r = rates.find(r => r.country_code === code && r.service_id === 'PICKUP_PARCEL' && r.weight_g === w);
      return r ? Math.ceil(parseFloat(r.price_nok)) : 0;
    });
    remoteMax[w] = nicePrice(Math.max(...remotePrices));
  }

  // Norway Zone 3 as safe default
  const norwaySimple = shopifyBrackets.map(b => {
    const rate = norway3584.find(r => r.zone === '3' && r.weight_g === b.weight);
    return rate ? `${nicePrice(Math.ceil((parseFloat(rate.price_nok) + roadToll) * 1.25))} kr` : 'N/A';
  });

  md += `\n### Simplified recommendation

| Destination | 0–0.5 kg | 0.5–1 kg | 1 kg+ |
|-------------|----------|----------|-------|
| Norway | ${norwaySimple.join(' | ')} |
| Sweden / Denmark / Finland | ${intlBracketWeights.map(w => `${nordicMax[w]} kr`).join(' | ')} |
| Iceland / Greenland / Faroes | ${intlBracketWeights.map(w => `${remoteMax[w]} kr`).join(' | ')} |

Norway uses Zone 3 pricing (covers most of the country). Nordic and remote groups use the highest price in each group so you never lose money.

`;

  md += `## Notes

- **Zone risk**: Zone 1 prices are cheapest. Shipping to Zone 7 (Finnmark) costs roughly 2x Zone 1.
- **Weight limits**: 3584 max 5kg, PickUp Parcel max 20kg
- **Road toll**: ~${roadToll} NOK per Norway shipment (avg from invoices, included in recommendations above)
- **Zone numbers can differ per service** for the same postal code — the zone table above is for service 3584 only
`;

  return md;
}

async function main() {
  const outputDir = process.env.OUTPUT_DIR || findLatestDataDir();
  console.log(`Analyzing data from: ${outputDir}\n`);

  // Check for required files
  const ratesPath = join(outputDir, 'shipping_rates.csv');
  const invoicesPath = join(outputDir, 'invoice_line_items.csv');

  if (!fs.existsSync(ratesPath)) {
    console.error('shipping_rates.csv not found. Run fetch_rates.mjs first.');
    process.exit(1);
  }

  if (!fs.existsSync(invoicesPath)) {
    console.error('invoice_line_items.csv not found. Run fetch_invoices.mjs first.');
    process.exit(1);
  }

  // Read and parse data
  const rates = parseCsv(fs.readFileSync(ratesPath, 'utf8'));
  const lineItems = parseCsv(fs.readFileSync(invoicesPath, 'utf8'));

  console.log(`Loaded ${rates.length} shipping rates`);
  console.log(`Loaded ${lineItems.length} invoice line items\n`);

  // Analyze
  const invoiceAnalysis = analyzeInvoices(lineItems);

  // Generate RESULTS.md
  const resultsMd = generateResultsMd(rates, invoiceAnalysis);
  fs.writeFileSync(join(outputDir, 'RESULTS.md'), resultsMd);

  console.log(`Generated ${outputDir}/RESULTS.md`);
}

main().catch(console.error);
