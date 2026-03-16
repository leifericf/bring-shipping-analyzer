import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/core/config/validate.mjs';

const VALID_CONFIG = {
  originCountry: 'NO',
  destinations: [
    { country: 'Norway', code: 'NO', postalCode: '0150' },
    { country: 'Sweden', code: 'SE', postalCode: '11122' },
  ],
  weightTiersGrams: [250, 1000, 5000],
  domesticServices: [{ id: '3584', name: 'Home mailbox', maxWeight: 5000 }],
  internationalServices: [{ id: 'PICKUP_PARCEL', name: 'PickUp Parcel', maxWeight: 20000 }],
  analysis: {
    vatMultiplier: 1.25,
    safeDefaultZone: '3',
    primaryDomesticService: '3584',
    cheapestInternationalService: 'PICKUP_PARCEL',
  },
};

describe('validateConfig', () => {
  it('accepts a valid config', () => {
    const result = validateConfig(VALID_CONFIG);
    assert.equal(result.ok, true);
    assert.ok(result.value.countryNames);
  });

  it('builds countryNames excluding origin country', () => {
    const result = validateConfig(VALID_CONFIG);
    assert.equal(result.value.countryNames['SE'], 'Sweden');
    assert.equal(result.value.countryNames['NO'], undefined);
  });

  it('rejects null input', () => {
    const result = validateConfig(null);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  });

  it('reports missing top-level fields', () => {
    const result = validateConfig({ originCountry: 'NO' });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('Missing required fields')));
  });

  it('rejects empty destinations', () => {
    const result = validateConfig({ ...VALID_CONFIG, destinations: [] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('destinations')));
  });

  it('rejects destinations without required fields', () => {
    const result = validateConfig({
      ...VALID_CONFIG,
      destinations: [{ country: 'Norway' }],
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('destinations[0]')));
  });

  it('rejects empty weight tiers', () => {
    const result = validateConfig({ ...VALID_CONFIG, weightTiersGrams: [] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('weightTiersGrams')));
  });

  it('rejects services without required fields', () => {
    const result = validateConfig({
      ...VALID_CONFIG,
      domesticServices: [{ id: '3584' }],
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('domesticServices')));
  });

  it('rejects missing analysis fields', () => {
    const result = validateConfig({
      ...VALID_CONFIG,
      analysis: { vatMultiplier: 1.25 },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('analysis')));
  });

  it('collects multiple errors', () => {
    const result = validateConfig({
      originCountry: 'NO',
      destinations: [],
      weightTiersGrams: [],
      domesticServices: [],
      internationalServices: [],
      analysis: {},
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.length >= 4);
  });
});
