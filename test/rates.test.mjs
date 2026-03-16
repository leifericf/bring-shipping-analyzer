import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRateFetchPlan, toBringRequestBody } from '../src/core/rates/plan.mjs';
import { parseBringProductResponse, outcomeToRateRecord, normalizeDbRate } from '../src/core/rates/normalize.mjs';
import { deriveZones, buildRateLookup } from '../src/core/rates/aggregate.mjs';
import { isWeightWithinServiceLimit, isDomesticDestination, isSuccessfulOutcome, isErrorOutcome } from '../src/core/rates/predicates.mjs';

// ── Predicates ───────────────────────────────────────────────────────────────

describe('rate predicates', () => {
  const service = { id: '3584', name: 'Test', maxWeight: 5000 };

  it('isWeightWithinServiceLimit returns true for weight at limit', () => {
    assert.equal(isWeightWithinServiceLimit(service)(5000), true);
  });

  it('isWeightWithinServiceLimit returns false for weight above limit', () => {
    assert.equal(isWeightWithinServiceLimit(service)(5001), false);
  });

  it('isDomesticDestination matches same country', () => {
    assert.equal(isDomesticDestination('NO')({ code: 'NO' }), true);
    assert.equal(isDomesticDestination('NO')({ code: 'SE' }), false);
  });

  it('isSuccessfulOutcome checks for kind ok', () => {
    assert.equal(isSuccessfulOutcome({ kind: 'ok', priceNok: 100 }), true);
    assert.equal(isSuccessfulOutcome({ kind: 'skip' }), false);
    assert.equal(isSuccessfulOutcome({ kind: 'error' }), false);
    assert.equal(isSuccessfulOutcome(null), false);
  });

  it('isErrorOutcome checks for kind error', () => {
    assert.equal(isErrorOutcome({ kind: 'error', reason: 'fail' }), true);
    assert.equal(isErrorOutcome({ kind: 'ok' }), false);
    assert.equal(isErrorOutcome(null), false);
  });
});

// ── Plan ─────────────────────────────────────────────────────────────────────

describe('buildRateFetchPlan', () => {
  const config = {
    originCountry: 'NO',
    destinations: [
      { country: 'Norway', code: 'NO', postalCode: '0150' },
      { country: 'Sweden', code: 'SE', postalCode: '11122' },
    ],
    domesticServices: [
      { id: '3584', name: 'Mailbox', maxWeight: 5000 },
    ],
    internationalServices: [
      { id: 'PICKUP_PARCEL', name: 'PickUp', maxWeight: 20000 },
    ],
    weightTiersGrams: [250, 1000, 5000, 10000],
  };

  it('produces flat list of (destination, service, weight) tuples', () => {
    const plan = buildRateFetchPlan(config);
    assert.ok(Array.isArray(plan));
    assert.ok(plan.length > 0);
    assert.ok(plan.every(p => p.destination && p.service && p.weightG));
  });

  it('uses domestic services for domestic destinations', () => {
    const plan = buildRateFetchPlan(config);
    const noPlan = plan.filter(p => p.destination.code === 'NO');
    assert.ok(noPlan.every(p => p.service.id === '3584'));
  });

  it('uses international services for foreign destinations', () => {
    const plan = buildRateFetchPlan(config);
    const sePlan = plan.filter(p => p.destination.code === 'SE');
    assert.ok(sePlan.every(p => p.service.id === 'PICKUP_PARCEL'));
  });

  it('filters out weights above service maxWeight', () => {
    const plan = buildRateFetchPlan(config);
    // Domestic maxWeight is 5000, so 10000 should not appear
    const domesticWeights = plan.filter(p => p.destination.code === 'NO').map(p => p.weightG);
    assert.ok(!domesticWeights.includes(10000));
    assert.ok(domesticWeights.includes(5000));
  });

  it('includes weights up to international maxWeight', () => {
    const plan = buildRateFetchPlan(config);
    const intlWeights = plan.filter(p => p.destination.code === 'SE').map(p => p.weightG);
    assert.ok(intlWeights.includes(10000));
  });
});

describe('toBringRequestBody', () => {
  it('builds correct API body', () => {
    const request = {
      destination: { code: 'NO', postalCode: '0150' },
      service: { id: '3584' },
      weightG: 1000,
    };
    const ctx = {
      originCountry: 'NO',
      originPostalCode: '0174',
      customerNumber: '123',
      shippingDate: { year: '2025', month: '03', day: '15' },
    };

    const body = toBringRequestBody(request, ctx);
    const consignment = body.consignments[0];

    assert.equal(consignment.fromCountryCode, 'NO');
    assert.equal(consignment.toCountryCode, 'NO');
    assert.equal(consignment.toPostalCode, '0150');
    assert.equal(consignment.products[0].id, '3584');
    assert.equal(consignment.packages[0].grossWeight, 1000);
    assert.equal(body.withPrice, true);
  });
});

// ── Normalize ────────────────────────────────────────────────────────────────

describe('parseBringProductResponse', () => {
  const request = {
    destination: { country: 'Norway', code: 'NO', postalCode: '0150' },
    service: { id: '3584', name: 'Mailbox' },
    weightG: 1000,
  };

  it('returns ok for valid response with net price', () => {
    const apiJson = {
      consignments: [{
        products: [{
          price: {
            netPrice: { priceWithoutAdditionalServices: { amountWithoutVAT: '85.50' } },
            zones: { totalZoneCount: 3 },
          },
          guiInformation: { displayName: 'Home mailbox parcel' },
        }],
      }],
    };

    const result = parseBringProductResponse(apiJson, request);
    assert.equal(result.kind, 'ok');
    assert.equal(result.priceNok, 85.50);
    assert.equal(result.zone, 3);
    assert.equal(result.serviceName, 'Home mailbox parcel');
  });

  it('falls back to list price when net price is missing', () => {
    const apiJson = {
      consignments: [{
        products: [{
          price: {
            listPrice: { priceWithoutAdditionalServices: { amountWithoutVAT: '100.00' } },
            zones: { totalZoneCount: 1 },
          },
        }],
      }],
    };

    const result = parseBringProductResponse(apiJson, request);
    assert.equal(result.kind, 'ok');
    assert.equal(result.priceNok, 100.00);
  });

  it('returns skip when no product in response', () => {
    const result = parseBringProductResponse({ consignments: [{ products: [] }] }, request);
    assert.equal(result.kind, 'skip');
  });

  it('returns error when product has errors', () => {
    const apiJson = {
      consignments: [{
        products: [{ errors: [{ description: 'Invalid postal code' }] }],
      }],
    };

    const result = parseBringProductResponse(apiJson, request);
    assert.equal(result.kind, 'error');
    assert.ok(result.reason.includes('Invalid postal code'));
  });

  it('returns skip when price is null', () => {
    const apiJson = {
      consignments: [{
        products: [{ price: {}, guiInformation: {} }],
      }],
    };

    const result = parseBringProductResponse(apiJson, request);
    assert.equal(result.kind, 'skip');
  });
});

describe('outcomeToRateRecord', () => {
  it('converts ok outcome to DB record shape', () => {
    const outcome = {
      kind: 'ok',
      request: {
        destination: { country: 'Norway', code: 'NO', postalCode: '0150' },
        service: { id: '3584' },
        weightG: 1000,
      },
      priceNok: 85.50,
      serviceName: 'Home mailbox parcel',
      zone: 3,
    };

    const record = outcomeToRateRecord(outcome);
    assert.equal(record.country, 'Norway');
    assert.equal(record.countryCode, 'NO');
    assert.equal(record.serviceId, '3584');
    assert.equal(record.weightG, 1000);
    assert.equal(record.priceNok, 85.50);
    assert.equal(record.zone, 3);
  });
});

// ── Aggregate ────────────────────────────────────────────────────────────────

describe('deriveZones', () => {
  it('deduplicates by countryCode + postalCode + serviceId', () => {
    const records = [
      { countryCode: 'NO', postalCode: '0150', serviceId: '3584', zone: 1 },
      { countryCode: 'NO', postalCode: '0150', serviceId: '3584', zone: 1 },
      { countryCode: 'NO', postalCode: '5015', serviceId: '3584', zone: 3 },
    ];

    const zones = deriveZones(records);
    assert.equal(zones.length, 2);
  });

  it('sorts by countryCode then postalCode', () => {
    const records = [
      { countryCode: 'SE', postalCode: '11122', serviceId: 'X', zone: 1 },
      { countryCode: 'NO', postalCode: '5015', serviceId: 'X', zone: 3 },
      { countryCode: 'NO', postalCode: '0150', serviceId: 'X', zone: 1 },
    ];

    const zones = deriveZones(records);
    assert.equal(zones[0].countryCode, 'NO');
    assert.equal(zones[0].postalCode, '0150');
    assert.equal(zones[2].countryCode, 'SE');
  });
});

describe('buildRateLookup', () => {
  const rates = [
    { countryCode: 'NO', serviceId: '3584', weightG: 1000, zone: '3', priceNok: 85 },
    { countryCode: 'SE', serviceId: 'PICKUP_PARCEL', weightG: 5000, zone: '1', priceNok: 200 },
  ];

  it('looks up by country, service, weight', () => {
    const lookup = buildRateLookup(rates);
    const r = lookup.byCountryServiceWeight('NO', '3584', 1000);
    assert.equal(r.priceNok, 85);
  });

  it('looks up by service, zone, weight', () => {
    const lookup = buildRateLookup(rates);
    const r = lookup.byServiceZoneWeight('3584', '3', 1000);
    assert.equal(r.priceNok, 85);
  });

  it('returns undefined for missing entries', () => {
    const lookup = buildRateLookup(rates);
    assert.equal(lookup.byCountryServiceWeight('FI', '3584', 1000), undefined);
    assert.equal(lookup.byServiceZoneWeight('3584', '99', 1000), undefined);
  });
});

// ── normalizeDbRate ──────────────────────────────────────────────────────────

describe('normalizeDbRate', () => {
  it('strips trailing .0 from zone', () => {
    const r = normalizeDbRate({ zone: '3.0', priceNok: 100 });
    assert.equal(r.zone, '3');
  });

  it('converts null zone to empty string', () => {
    const r = normalizeDbRate({ zone: null, priceNok: 100 });
    assert.equal(r.zone, '');
  });

  it('passes through clean zone strings', () => {
    const r = normalizeDbRate({ zone: '3', priceNok: 100 });
    assert.equal(r.zone, '3');
  });

  it('defaults null priceNok to 0', () => {
    const r = normalizeDbRate({ zone: '1', priceNok: null });
    assert.equal(r.priceNok, 0);
  });

  it('preserves existing priceNok', () => {
    const r = normalizeDbRate({ zone: '1', priceNok: 85.5 });
    assert.equal(r.priceNok, 85.5);
  });
});
