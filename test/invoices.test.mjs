import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRoadTollLine, isSurchargeLine, isShipmentLine } from '../src/core/invoices/predicates.mjs';
import { normalizeInvoiceList, buildInvoiceListUrl, parseInvoiceXmlLines, normalizeDbLineItem } from '../src/core/invoices/normalize.mjs';

// ── Predicates ───────────────────────────────────────────────────────────────

describe('invoice predicates', () => {
  it('isRoadTollLine detects road toll', () => {
    assert.equal(isRoadTollLine({ description: 'Road toll surcharge' }), true);
    assert.equal(isRoadTollLine({ description: 'Standard shipping' }), false);
    assert.equal(isRoadTollLine({ description: null }), false);
  });

  it('isSurchargeLine detects surcharges', () => {
    assert.equal(isSurchargeLine({ description: 'Fuel Surcharge' }), true);
    assert.equal(isSurchargeLine({ description: 'Standard shipping' }), false);
  });

  it('isShipmentLine excludes road tolls and surcharges', () => {
    assert.equal(isShipmentLine({ description: 'Standard shipping' }), true);
    assert.equal(isShipmentLine({ description: 'Road toll' }), false);
    assert.equal(isShipmentLine({ description: 'Fuel Surcharge' }), false);
  });
});

// ── Normalize ────────────────────────────────────────────────────────────────

describe('normalizeInvoiceList', () => {
  it('maps raw API objects to normalized records', () => {
    const raw = [
      { invoiceNumber: '123', invoiceDate: '2025-01-01', totalAmount: 500, currency: 'NOK', invoiceSpecificationAvailable: true },
    ];
    const result = normalizeInvoiceList(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].invoiceNumber, '123');
    assert.equal(result[0].specificationAvailable, true);
  });

  it('handles null input', () => {
    assert.deepEqual(normalizeInvoiceList(null), []);
  });

  it('handles empty array', () => {
    assert.deepEqual(normalizeInvoiceList([]), []);
  });
});

describe('buildInvoiceListUrl', () => {
  it('builds correct URL with formatted dates', () => {
    const from = new Date(2025, 0, 5);  // Jan 5
    const to = new Date(2025, 11, 31);  // Dec 31
    const url = buildInvoiceListUrl('CUST123', from, to);

    assert.ok(url.includes('CUST123'));
    assert.ok(url.includes('fromDate=05.01.2025'));
    assert.ok(url.includes('toDate=31.12.2025'));
    assert.ok(url.startsWith('https://'));
  });
});

describe('parseInvoiceXmlLines', () => {
  it('parses valid XML lines', () => {
    const xml = `
      <Lines>
        <Line>
          <InvoiceNumber>INV001</InvoiceNumber>
          <ShipmentNumber>SH001</ShipmentNumber>
          <ProductCode>3584</ProductCode>
          <Product>Mailbox</Product>
          <Description>Standard shipping</Description>
          <WeightKg>1.5</WeightKg>
          <GrossPrice>100</GrossPrice>
          <Discount>10</Discount>
          <AgreementPrice>90</AgreementPrice>
          <CurrencyCode>NOK</CurrencyCode>
          <SentFromPostalCode>0174</SentFromPostalCode>
          <SentToPostalCode>5015</SentToPostalCode>
          <SentToCity>Bergen</SentToCity>
          <DELIVERY_COUNTRY>NO</DELIVERY_COUNTRY>
        </Line>
      </Lines>
    `;

    const lines = parseInvoiceXmlLines(xml);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].invoiceNumber, 'INV001');
    assert.equal(lines[0].shipmentNumber, 'SH001');
    assert.equal(lines[0].productCode, '3584');
    assert.equal(lines[0].weightKg, 1.5);
    assert.equal(lines[0].agreementPrice, 90);
    assert.equal(lines[0].toCity, 'Bergen');
    assert.equal(lines[0].deliveryCountry, 'NO');
  });

  it('filters out lines with no invoice or shipment number', () => {
    const xml = `
      <Lines>
        <Line>
          <InvoiceNumber></InvoiceNumber>
          <ShipmentNumber></ShipmentNumber>
          <Description>Empty line</Description>
        </Line>
        <Line>
          <InvoiceNumber>INV001</InvoiceNumber>
          <ShipmentNumber>SH001</ShipmentNumber>
          <Description>Real line</Description>
        </Line>
      </Lines>
    `;

    const lines = parseInvoiceXmlLines(xml);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].invoiceNumber, 'INV001');
  });

  it('handles missing numeric fields gracefully', () => {
    const xml = `
      <Lines>
        <Line>
          <InvoiceNumber>INV001</InvoiceNumber>
          <ShipmentNumber>SH001</ShipmentNumber>
        </Line>
      </Lines>
    `;

    const lines = parseInvoiceXmlLines(xml);
    assert.equal(lines[0].weightKg, null);
    assert.equal(lines[0].grossPrice, 0);
    assert.equal(lines[0].agreementPrice, 0);
  });

  it('returns empty array for XML with no Line elements', () => {
    assert.deepEqual(parseInvoiceXmlLines(''), []);
    assert.deepEqual(parseInvoiceXmlLines('<root></root>'), []);
  });
});

// ── normalizeDbLineItem ──────────────────────────────────────────────────────

describe('normalizeDbLineItem', () => {
  it('defaults null agreementPrice to 0', () => {
    const r = normalizeDbLineItem({ agreementPrice: null, grossPrice: 10, discount: 5 });
    assert.equal(r.agreementPrice, 0);
  });

  it('defaults null grossPrice to 0', () => {
    const r = normalizeDbLineItem({ agreementPrice: 10, grossPrice: null, discount: 5 });
    assert.equal(r.grossPrice, 0);
  });

  it('defaults null discount to 0', () => {
    const r = normalizeDbLineItem({ agreementPrice: 10, grossPrice: 20, discount: null });
    assert.equal(r.discount, 0);
  });

  it('preserves existing values', () => {
    const r = normalizeDbLineItem({ agreementPrice: 80, grossPrice: 100, discount: 20, description: 'Test' });
    assert.equal(r.agreementPrice, 80);
    assert.equal(r.grossPrice, 100);
    assert.equal(r.discount, 20);
    assert.equal(r.description, 'Test');
  });
});
