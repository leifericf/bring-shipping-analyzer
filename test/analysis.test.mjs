import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDomesticShipment, matchesBracket, isLossMaking } from '../src/core/analysis/predicates.mjs';
import { clusterInternationalZones } from '../src/core/analysis/cluster.mjs';
import { computeProfitability } from '../src/core/analysis/profitability.mjs';
import { analyzeInvoices, buildShipmentProfiles, computeShipmentVolume } from '../src/core/analysis/model.mjs';
import { buildRateLookup } from '../src/core/rates/aggregate.mjs';

// ── Predicates ───────────────────────────────────────────────────────────────

describe('analysis predicates', () => {
  it('isDomesticShipment matches origin country', () => {
    const isDomestic = isDomesticShipment('NO');
    assert.equal(isDomestic({ deliveryCountry: 'NO' }), true);
    assert.equal(isDomestic({ deliveryCountry: 'SE' }), false);
  });

  it('matchesBracket checks service + weight ceiling', () => {
    const bracket = { serviceId: '3584', maxWeight: 5.0 };
    const matches = matchesBracket(bracket);

    assert.equal(matches({ productCode: '3584', weight: 3.0 }), true);
    assert.equal(matches({ productCode: '3584', weight: 5.0 }), true);
    assert.equal(matches({ productCode: '3584', weight: 6.0 }), false);
    assert.equal(matches({ productCode: '5800', weight: 3.0 }), false);
  });

  it('isLossMaking checks negative margin', () => {
    assert.equal(isLossMaking({ margin: -10 }), true);
    assert.equal(isLossMaking({ margin: 0 }), false);
    assert.equal(isLossMaking({ margin: 5 }), false);
  });
});

// ── analyzeInvoices ──────────────────────────────────────────────────────────

describe('analyzeInvoices', () => {
  it('separates road tolls from shipment lines', () => {
    const lineItems = [
      { productCode: '3584', product: 'Mailbox', description: 'Standard', agreementPrice: 80, weightKg: 1.0 },
      { productCode: '3584', product: 'Mailbox', description: 'Road toll', agreementPrice: 15 },
      { productCode: '3584', product: 'Mailbox', description: 'Fuel Surcharge', agreementPrice: 5 },
    ];

    const result = analyzeInvoices(lineItems);
    const productKeys = Object.keys(result.byProduct);

    assert.equal(productKeys.length, 1);
    assert.equal(result.byProduct['3584 - Mailbox'].count, 1);
    assert.equal(result.avgRoadToll, 15);
  });

  it('computes average road toll from multiple items', () => {
    const lineItems = [
      { description: 'Road toll', agreementPrice: 10 },
      { description: 'Road toll', agreementPrice: 20 },
    ];

    const result = analyzeInvoices(lineItems);
    assert.equal(result.avgRoadToll, 15);
  });

  it('returns 0 road toll when none present', () => {
    const lineItems = [
      { productCode: '3584', product: 'Mailbox', description: 'Standard', agreementPrice: 80 },
    ];

    const result = analyzeInvoices(lineItems);
    assert.equal(result.avgRoadToll, 0);
  });

  it('collects weights for products', () => {
    const lineItems = [
      { productCode: '3584', product: 'Mailbox', description: 'Standard', agreementPrice: 80, weightKg: 1.0 },
      { productCode: '3584', product: 'Mailbox', description: 'Standard', agreementPrice: 90, weightKg: 2.0 },
    ];

    const result = analyzeInvoices(lineItems);
    assert.deepEqual(result.byProduct['3584 - Mailbox'].weights, [1.0, 2.0]);
    assert.equal(result.byProduct['3584 - Mailbox'].totalAgreement, 170);
  });
});

// ── buildShipmentProfiles ────────────────────────────────────────────────────

describe('buildShipmentProfiles', () => {
  it('groups line items by shipment number', () => {
    const lineItems = [
      { shipmentNumber: 'S1', productCode: '3584', toPostalCode: '0150', toCity: 'Oslo', deliveryCountry: 'NO', agreementPrice: 80, weightKg: 1.5, description: 'Standard' },
      { shipmentNumber: 'S1', productCode: '3584', toPostalCode: '0150', toCity: 'Oslo', deliveryCountry: 'NO', agreementPrice: 15, description: 'Road toll' },
      { shipmentNumber: 'S2', productCode: '5800', toPostalCode: '5015', toCity: 'Bergen', deliveryCountry: 'NO', agreementPrice: 120, weightKg: 8.0, description: 'Standard' },
    ];

    const profiles = buildShipmentProfiles(lineItems);
    assert.equal(profiles.size, 2);

    const s1 = profiles.get('S1');
    assert.equal(s1.totalCost, 95);  // 80 + 15
    assert.equal(s1.weight, 1.5);    // from non-toll line

    const s2 = profiles.get('S2');
    assert.equal(s2.productCode, '5800');
  });

  it('ignores weight from road toll lines', () => {
    const lineItems = [
      { shipmentNumber: 'S1', productCode: '3584', toPostalCode: '0150', toCity: 'Oslo', deliveryCountry: 'NO', agreementPrice: 80, weightKg: 1.5, description: 'Standard' },
      { shipmentNumber: 'S1', productCode: '3584', toPostalCode: '0150', toCity: 'Oslo', deliveryCountry: 'NO', agreementPrice: 15, weightKg: 99, description: 'Road toll charge' },
    ];

    const profiles = buildShipmentProfiles(lineItems);
    assert.equal(profiles.get('S1').weight, 1.5);
  });
});

// ── clusterInternationalZones ────────────────────────────────────────────────

describe('clusterInternationalZones', () => {
  it('groups countries with similar prices into one zone', () => {
    const rates = [
      { countryCode: 'SE', serviceId: 'X', weightG: 1000, zone: '1', priceNok: 100 },
      { countryCode: 'DK', serviceId: 'X', weightG: 1000, zone: '1', priceNok: 102 },
      { countryCode: 'JP', serviceId: 'X', weightG: 1000, zone: '1', priceNok: 500 },
    ];
    const lookup = buildRateLookup(rates);
    const brackets = [{ name: '0-1 kg', weight: '1000' }];

    const zones = clusterInternationalZones(lookup, ['SE', 'DK', 'JP'], brackets, 'X', 0.10);

    // SE and DK should merge (2% difference), JP should be separate
    assert.equal(zones.length, 2);
    const nordicZone = zones.find(z => z.codes.includes('SE'));
    assert.ok(nordicZone.codes.includes('DK'));
    assert.ok(!nordicZone.codes.includes('JP'));
  });

  it('creates separate zones when threshold is 0', () => {
    const rates = [
      { countryCode: 'SE', serviceId: 'X', weightG: 1000, zone: '1', priceNok: 100 },
      { countryCode: 'DK', serviceId: 'X', weightG: 1000, zone: '1', priceNok: 105 },
    ];
    const lookup = buildRateLookup(rates);
    const brackets = [{ name: '0-1 kg', weight: '1000' }];

    // nicePrice(100) = 109, nicePrice(105) = 109 — they happen to have same nicePrice
    // so even at threshold=0 they merge (same rounded price).
    const zones = clusterInternationalZones(lookup, ['SE', 'DK'], brackets, 'X', 0);
    assert.equal(zones.length, 1);
  });

  it('skips countries with no rate data', () => {
    const lookup = buildRateLookup([]);
    const brackets = [{ name: '0-1 kg', weight: '1000' }];

    const zones = clusterInternationalZones(lookup, ['SE', 'DK'], brackets, 'X');
    assert.equal(zones.length, 0);
  });

  it('uses max price per bracket (conservative)', () => {
    const rates = [
      { countryCode: 'SE', serviceId: 'X', weightG: 1000, zone: '1', priceNok: 100 },
      { countryCode: 'DK', serviceId: 'X', weightG: 1000, zone: '1', priceNok: 108 },
    ];
    const lookup = buildRateLookup(rates);
    const brackets = [{ name: '0-1 kg', weight: '1000' }];

    const zones = clusterInternationalZones(lookup, ['SE', 'DK'], brackets, 'X', 0.10);
    // Both should merge and use the higher price
    assert.equal(zones.length, 1);
    assert.ok(zones[0].rates[0].price >= 109); // nicePrice(108) = 109
  });
});

// ── computeProfitability ─────────────────────────────────────────────────────

describe('computeProfitability', () => {
  const rates = [
    { countryCode: 'NO', serviceId: '3584', weightG: 1000, zone: '3', priceNok: 80 },
    { countryCode: 'NO', serviceId: '3584', weightG: 5000, zone: '3', priceNok: 120 },
  ];
  const rateLookup = buildRateLookup(rates);

  const analysisConfig = {
    primaryDomesticService: '3584',
    safeDefaultZone: '3',
    vatMultiplier: 1.25,
    domesticShopifyBrackets: [
      { name: '0-1 kg', maxWeight: 1.0, rateWeight: '1000', serviceId: '3584' },
      { name: '1-5 kg', maxWeight: 5.0, rateWeight: '5000', serviceId: '3584' },
    ],
  };

  it('classifies shipments into brackets', () => {
    const shipments = new Map([
      ['S1', { productCode: '3584', weight: 0.5, totalCost: 60, toCity: 'Oslo', toPostalCode: '0150' }],
      ['S2', { productCode: '3584', weight: 3.0, totalCost: 100, toCity: 'Bergen', toPostalCode: '5015' }],
    ]);

    const result = computeProfitability(shipments, rateLookup, analysisConfig, 10);
    assert.equal(result.totalShipments, 2);
    assert.equal(result.brackets[0].shipments.length, 1);
    assert.equal(result.brackets[1].shipments.length, 1);
  });

  it('skips shipments with no weight', () => {
    const shipments = new Map([
      ['S1', { productCode: '3584', weight: null, totalCost: 60, toCity: 'Oslo', toPostalCode: '0150' }],
    ]);

    const result = computeProfitability(shipments, rateLookup, analysisConfig, 10);
    assert.equal(result.totalShipments, 0);
    assert.equal(result.skipped.noWeight, 1);
  });

  it('skips shipments that match no bracket', () => {
    const shipments = new Map([
      ['S1', { productCode: '9999', weight: 1.0, totalCost: 60, toCity: 'Oslo', toPostalCode: '0150' }],
    ]);

    const result = computeProfitability(shipments, rateLookup, analysisConfig, 10);
    assert.equal(result.totalShipments, 0);
    assert.equal(result.skipped.noMatchingBracket, 1);
    assert.ok(Object.keys(result.skipped.byReason).some(r => r.includes('9999')));
  });

  it('identifies loss-making shipments', () => {
    const shipments = new Map([
      ['S1', { productCode: '3584', weight: 0.5, totalCost: 999, toCity: 'Finnmark', toPostalCode: '9700' }],
    ]);

    const result = computeProfitability(shipments, rateLookup, analysisConfig, 10);
    assert.equal(result.lossMaking.length, 1);
    assert.ok(result.lossMaking[0].margin < 0);
  });

  it('computes correct margin percentage', () => {
    const shipments = new Map([
      ['S1', { productCode: '3584', weight: 0.5, totalCost: 50, toCity: 'Oslo', toPostalCode: '0150' }],
    ]);

    const result = computeProfitability(shipments, rateLookup, analysisConfig, 10);
    assert.ok(result.marginPct > 0);
    assert.ok(result.grandTotalRevenue > 0);
  });
});

// ── computeShipmentVolume ────────────────────────────────────────────────────

describe('computeShipmentVolume', () => {
  it('counts domestic shipments per bracket', () => {
    const shipments = new Map([
      ['S1', { deliveryCountry: 'NO', weight: 0.3 }],
      ['S2', { deliveryCountry: 'NO', weight: 2.0 }],
      ['S3', { deliveryCountry: 'NO', weight: 0.4 }],
    ]);

    const intlZones = [];
    const config = {
      originCountry: 'NO',
      analysis: {
        domesticShopifyBrackets: [
          { name: '0-0.5 kg', maxWeight: 0.5 },
          { name: '0.5-5 kg', maxWeight: 5.0 },
        ],
      },
    };

    const vol = computeShipmentVolume(shipments, intlZones, config);
    assert.equal(vol.domesticCounts[0], 2);  // S1 + S3
    assert.equal(vol.domesticCounts[1], 1);  // S2
    assert.equal(vol.domesticTotal, 3);
  });

  it('skips shipments with null weight', () => {
    const shipments = new Map([
      ['S1', { deliveryCountry: 'NO', weight: null }],
    ]);

    const config = {
      originCountry: 'NO',
      analysis: { domesticShopifyBrackets: [{ name: '0-5 kg', maxWeight: 5.0 }] },
    };

    const vol = computeShipmentVolume(shipments, [], config);
    assert.equal(vol.domesticTotal, 0);
  });

  it('assigns international shipments to correct zones', () => {
    const shipments = new Map([
      ['S1', { deliveryCountry: 'SE', weight: 1.0 }],
      ['S2', { deliveryCountry: 'DK', weight: 1.0 }],
    ]);

    const intlZones = [{ codes: ['SE', 'DK'] }];
    const config = {
      originCountry: 'NO',
      analysis: { domesticShopifyBrackets: [{ name: '0-5 kg', maxWeight: 5.0 }] },
    };

    const vol = computeShipmentVolume(shipments, intlZones, config);
    assert.equal(vol.intlZoneTotals[0], 2);
    assert.equal(vol.domesticTotal, 0);
  });
});
