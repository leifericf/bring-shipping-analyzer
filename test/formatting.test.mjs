import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nicePrice, fmtNok, fmtWeight, esc, fmtStatus, fmtZoneLabel, formatShippingDate, computeDateRange } from '../src/core/formatting.mjs';

describe('nicePrice', () => {
  it('rounds 50 up to 59', () => {
    assert.equal(nicePrice(50), 59);
  });

  it('rounds 59 to 59 (already nice)', () => {
    assert.equal(nicePrice(59), 59);
  });

  it('rounds 60 up to 69', () => {
    assert.equal(nicePrice(60), 69);
  });

  it('rounds 1 up to 9', () => {
    assert.equal(nicePrice(1), 9);
  });

  it('rounds 140 up to 149', () => {
    assert.equal(nicePrice(140), 149);
  });

  it('rounds 0 up to 9', () => {
    assert.equal(nicePrice(0), 9);
  });

  it('rounds 9 to 9 (already nice)', () => {
    assert.equal(nicePrice(9), 9);
  });

  it('is monotonic: higher input never produces lower output', () => {
    const inputs = [10, 20, 30, 50, 75, 100, 150, 200, 500, 999];
    const outputs = inputs.map(nicePrice);
    for (let i = 1; i < outputs.length; i++) {
      assert.ok(outputs[i] >= outputs[i - 1], `nicePrice(${inputs[i]})=${outputs[i]} < nicePrice(${inputs[i-1]})=${outputs[i-1]}`);
    }
  });

  it('always ends in 9', () => {
    const inputs = [1, 7, 10, 33, 47, 100, 255, 999];
    for (const n of inputs) {
      assert.equal(nicePrice(n) % 10, 9, `nicePrice(${n}) = ${nicePrice(n)} does not end in 9`);
    }
  });
});

describe('fmtNok', () => {
  it('formats with 2 decimal places and kr suffix', () => {
    assert.equal(fmtNok(123.4), '123.40 kr');
  });

  it('formats zero', () => {
    assert.equal(fmtNok(0), '0.00 kr');
  });

  it('formats negative values', () => {
    assert.equal(fmtNok(-5.1), '-5.10 kr');
  });
});

describe('fmtWeight', () => {
  it('formats grams under 1000', () => {
    assert.equal(fmtWeight(250), '250g');
  });

  it('formats 1000g as kg', () => {
    assert.equal(fmtWeight(1000), '1 kg');
  });

  it('formats larger weights as kg', () => {
    assert.equal(fmtWeight(5000), '5 kg');
  });

  it('handles string input', () => {
    assert.equal(fmtWeight('750'), '750g');
  });
});

describe('esc', () => {
  it('escapes ampersands', () => {
    assert.equal(esc('a & b'), 'a &amp; b');
  });

  it('escapes angle brackets', () => {
    assert.equal(esc('<script>'), '&lt;script&gt;');
  });

  it('passes through safe strings unchanged', () => {
    assert.equal(esc('hello world'), 'hello world');
  });

  it('handles numbers', () => {
    assert.equal(esc(42), '42');
  });
});

describe('fmtStatus', () => {
  it('replaces underscores with spaces', () => {
    assert.equal(fmtStatus('fetching_rates'), 'fetching rates');
  });

  it('passes through single-word statuses', () => {
    assert.equal(fmtStatus('completed'), 'completed');
  });
});

describe('fmtZoneLabel', () => {
  it('maps country codes to names and joins', () => {
    const zone = { codes: ['SE', 'DK'] };
    const names = { SE: 'Sweden', DK: 'Denmark' };
    assert.equal(fmtZoneLabel(zone, names), 'Sweden, Denmark');
  });

  it('filters out unknown country codes', () => {
    const zone = { codes: ['SE', 'XX'] };
    const names = { SE: 'Sweden' };
    assert.equal(fmtZoneLabel(zone, names), 'Sweden');
  });
});

describe('formatShippingDate', () => {
  it('formats date with zero-padded month and day', () => {
    const result = formatShippingDate(new Date(2025, 0, 5)); // Jan 5
    assert.deepEqual(result, { year: '2025', month: '01', day: '05' });
  });

  it('formats double-digit month and day', () => {
    const result = formatShippingDate(new Date(2025, 11, 25)); // Dec 25
    assert.deepEqual(result, { year: '2025', month: '12', day: '25' });
  });
});

describe('computeDateRange', () => {
  it('computes correct lookback', () => {
    const now = new Date(2025, 5, 15); // June 15
    const { fromDate, toDate } = computeDateRange(now, 30);
    assert.equal(fromDate.getDate(), 16); // May 16
    assert.equal(fromDate.getMonth(), 4); // May
    assert.equal(toDate.getTime(), now.getTime());
  });

  it('handles year boundary', () => {
    const now = new Date(2025, 0, 10); // Jan 10
    const { fromDate } = computeDateRange(now, 30);
    assert.equal(fromDate.getFullYear(), 2024);
    assert.equal(fromDate.getMonth(), 11); // December
  });
});
