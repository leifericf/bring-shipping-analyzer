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
 * Group invoice line items into per-shipment profiles.
 * Sums all costs (parcel + road toll + surcharge) per shipment
 * and extracts weight from the parcel line.
 */
function buildShipmentProfiles(lineItems) {
  const shipments = new Map();

  for (const item of lineItems) {
    const key = item.shipment_number;
    if (!shipments.has(key)) {
      shipments.set(key, {
        productCode: item.product_code,
        toPostalCode: item.to_postal_code,
        toCity: item.to_city,
        weight: null,
        totalCost: 0,
      });
    }

    const s = shipments.get(key);
    s.totalCost += parseFloat(item.agreement_price) || 0;

    const desc = item.description || '';
    if (!desc.includes('Road toll') && !desc.includes('Surcharge') && item.weight_kg) {
      s.weight = parseFloat(item.weight_kg);
    }
  }

  return shipments;
}

/**
 * Generate a profitability analysis section for RESULTS.md.
 * Cross-references actual invoice costs against suggested Shopify rates.
 */
function generateProfitabilitySection(lineItems, rates, roadToll) {
  const shipments = buildShipmentProfiles(lineItems);
  const norway3584 = rates.filter(r => r.country_code === 'NO' && r.service_id === '3584');

  const brackets = [
    { name: '0–0.5 kg', maxWeight: 0.5, rateWeight: '250', shipments: [] },
    { name: '0.5–1 kg', maxWeight: 1.0, rateWeight: '1000', shipments: [] },
    { name: '1 kg+', maxWeight: Infinity, rateWeight: '5000', shipments: [] },
  ];

  // Compute suggested Shopify price for each bracket from Zone 3 rates
  for (const bracket of brackets) {
    const rate = norway3584.find(r => r.zone === '3' && r.weight_g === bracket.rateWeight);
    if (rate) {
      bracket.shopifyPrice = nicePrice(Math.ceil((parseFloat(rate.price_nok) + roadToll) * 1.25));
      bracket.revenueExVat = bracket.shopifyPrice / 1.25;
    }
  }

  // Assign domestic 3584 shipments to brackets
  for (const [, s] of shipments) {
    if (s.productCode !== '3584' || s.weight === null) continue;
    const bracket = brackets.find(b => s.weight <= b.maxWeight);
    if (bracket) {
      bracket.shipments.push({
        weight: s.weight,
        totalCost: s.totalCost,
        toCity: s.toCity,
        toPostalCode: s.toPostalCode,
        revenueExVat: bracket.revenueExVat,
        margin: bracket.revenueExVat - s.totalCost,
      });
    }
  }

  const totalShipments = brackets.reduce((sum, b) => sum + b.shipments.length, 0);

  let md = `## Profitability Analysis\n\n`;
  md += `Based on ${totalShipments} domestic shipments (service 3584) from invoice data,\n`;
  md += `projected against suggested Shopify rates (Zone 3 pricing).\n`;
  md += `Cost = actual invoice cost per shipment (parcel + road toll + any surcharges).\n\n`;

  // Per-bracket summary table
  md += `### Per-Bracket Summary\n\n`;
  md += `| Bracket | Shipments | Avg Cost | Shopify Rate | Revenue ex VAT | Avg Margin | Total Margin |\n`;
  md += `|---------|-----------|----------|-------------|----------------|------------|-------------|\n`;

  let grandTotalMargin = 0;
  let grandTotalCost = 0;
  let grandTotalRevenue = 0;

  for (const bracket of brackets) {
    const n = bracket.shipments.length;
    if (n === 0) {
      md += `| ${bracket.name} | 0 | — | ${bracket.shopifyPrice} kr | ${bracket.revenueExVat.toFixed(2)} NOK | — | — |\n`;
      continue;
    }

    const totalCost = bracket.shipments.reduce((sum, s) => sum + s.totalCost, 0);
    const avgCost = totalCost / n;
    const totalMargin = bracket.shipments.reduce((sum, s) => sum + s.margin, 0);
    const avgMargin = totalMargin / n;
    const totalRevenue = bracket.revenueExVat * n;

    grandTotalMargin += totalMargin;
    grandTotalCost += totalCost;
    grandTotalRevenue += totalRevenue;

    const sign = avgMargin >= 0 ? '+' : '';
    const totalSign = totalMargin >= 0 ? '+' : '';

    md += `| ${bracket.name} | ${n} | ${avgCost.toFixed(2)} NOK | ${bracket.shopifyPrice} kr | ${bracket.revenueExVat.toFixed(2)} NOK | ${sign}${avgMargin.toFixed(2)} NOK | ${totalSign}${totalMargin.toFixed(2)} NOK |\n`;
  }

  // Total row
  const avgMarginAll = totalShipments > 0 ? grandTotalMargin / totalShipments : 0;
  const totalSign = grandTotalMargin >= 0 ? '+' : '';
  const avgSign = avgMarginAll >= 0 ? '+' : '';
  const marginPct = grandTotalRevenue > 0 ? ((grandTotalMargin / grandTotalRevenue) * 100).toFixed(1) : '0.0';
  md += `| **Total** | **${totalShipments}** | | | | **${avgSign}${avgMarginAll.toFixed(2)} NOK/parcel** | **${totalSign}${grandTotalMargin.toFixed(2)} NOK** |\n`;
  md += `\nOverall margin: ${marginPct}% of revenue ex VAT.\n\n`;

  // Loss-making shipments
  const lossMaking = [];
  for (const bracket of brackets) {
    for (const s of bracket.shipments) {
      if (s.margin < 0) {
        lossMaking.push({ ...s, bracket: bracket.name });
      }
    }
  }

  if (lossMaking.length > 0) {
    lossMaking.sort((a, b) => a.margin - b.margin); // worst first

    md += `### Loss-Making Shipments\n\n`;
    md += `${lossMaking.length} out of ${totalShipments} shipments would still lose money at Zone 3 pricing:\n\n`;
    md += `| Bracket | City | Postal Code | Weight | Cost | Revenue ex VAT | Loss |\n`;
    md += `|---------|------|------------|--------|------|----------------|------|\n`;

    for (const s of lossMaking) {
      md += `| ${s.bracket} | ${s.toCity} | ${s.toPostalCode} | ${s.weight} kg | ${s.totalCost.toFixed(2)} NOK | ${s.revenueExVat.toFixed(2)} NOK | ${s.margin.toFixed(2)} NOK |\n`;
    }

    md += `\nThese are shipments to remote zones where Zone 3 pricing doesn't fully cover costs.\n`;
    md += `Consider whether the volume to these areas justifies raising prices further.\n\n`;
  } else {
    md += `All ${totalShipments} shipments would be profitable at the suggested Zone 3 rates.\n\n`;
  }

  // Worst case per bracket
  md += `### Worst-Case Shipment per Bracket\n\n`;
  md += `The most expensive shipment in each bracket — your "floor" for margin evaluation:\n\n`;
  md += `| Bracket | City | Weight | Cost | Revenue ex VAT | Margin |\n`;
  md += `|---------|------|--------|------|----------------|--------|\n`;

  for (const bracket of brackets) {
    if (bracket.shipments.length === 0) continue;
    const worst = bracket.shipments.reduce((a, b) => a.totalCost > b.totalCost ? a : b);
    const sign = worst.margin >= 0 ? '+' : '';
    md += `| ${bracket.name} | ${worst.toCity} | ${worst.weight} kg | ${worst.totalCost.toFixed(2)} NOK | ${bracket.revenueExVat.toFixed(2)} NOK | ${sign}${worst.margin.toFixed(2)} NOK |\n`;
  }

  md += `\n`;

  return md;
}

/**
 * Generate the RESULTS.md markdown report.
 */
function generateResultsMd(rates, invoiceAnalysis, lineItems) {
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
    'JP': 'Japan',
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

  // International: PICKUP_PARCEL has a minimum price covering up to 1kg,
  // so 0–1kg is a single bracket. Only two distinct price tiers exist.
  const intlBracketWeights = ['250', '5000'];
  const intlBracketNames = ['0–1 kg', '1 kg+'];

  md += `\n### International — PICKUP_PARCEL (no VAT)

PICKUP_PARCEL has a minimum price that covers all packages up to 1 kg, so only two weight brackets are needed.

| Country | 0–1 kg | 1 kg+ |
|---------|--------|-------|
`;

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
  // Group Nordics (SE/DK/FI) and remote (IS/GL/FO/JP) — use the highest price in each group
  const nordicMax = {};
  const remoteMax = {};
  for (const w of intlBracketWeights) {
    const nordicPrices = ['SE', 'DK', 'FI'].map(code => {
      const r = rates.find(r => r.country_code === code && r.service_id === 'PICKUP_PARCEL' && r.weight_g === w);
      return r ? Math.ceil(parseFloat(r.price_nok)) : 0;
    });
    nordicMax[w] = nicePrice(Math.max(...nordicPrices));

    const remoteCodes = Object.keys(countryNames).filter(c => !['SE', 'DK', 'FI'].includes(c));
    const remotePrices = remoteCodes.map(code => {
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

  const remoteCountryList = Object.entries(countryNames)
    .filter(([code]) => !['SE', 'DK', 'FI'].includes(code))
    .map(([, name]) => name)
    .join(' / ');

  md += `\n### Simplified recommendation

| Destination | 0–0.5 kg | 0.5–1 kg | 1 kg+ |
|-------------|----------|----------|-------|
| Norway | ${norwaySimple.join(' | ')} |
| Sweden / Denmark / Finland | ${intlBracketWeights.map(w => `${nordicMax[w]} kr`).join(' | ')} |
| ${remoteCountryList} | ${intlBracketWeights.map(w => `${remoteMax[w]} kr`).join(' | ')} |

Norway uses Zone 3 pricing (covers most of the country). Nordic and remote groups use the highest price in each group so you never lose money.
International only needs two Shopify weight brackets (0–1 kg and 1 kg+) since PICKUP_PARCEL pricing is flat up to 1 kg.

`;

  md += generateProfitabilitySection(lineItems, rates, roadToll);

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
  const resultsMd = generateResultsMd(rates, invoiceAnalysis, lineItems);
  fs.writeFileSync(join(outputDir, 'RESULTS.md'), resultsMd);

  console.log(`Generated ${outputDir}/RESULTS.md`);
}

main().catch(console.error);
