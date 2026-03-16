// Pure functions for normalizing invoice data.

/**
 * Normalize raw invoice API objects into InvoiceMeta records.
 *
 * @param {object[]} rawInvoices - From Bring Invoice API
 * @returns {object[]} - Normalized invoice metadata
 */
export function normalizeInvoiceList(rawInvoices) {
  return (rawInvoices || []).map(inv => ({
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    totalAmount: inv.totalAmount,
    currency: inv.currency,
    specificationAvailable: inv.invoiceSpecificationAvailable,
  }));
}

/**
 * Build the Bring invoice list API URL for a given date range.
 * Pure: caller supplies the dates.
 *
 * @param {string} customerNumber
 * @param {Date} fromDate
 * @param {Date} toDate
 * @returns {string}
 */
export function buildInvoiceListUrl(customerNumber, fromDate, toDate) {
  const fmt = (d) =>
    `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

  return `https://www.mybring.com/invoicearchive/api/invoices/${customerNumber}.json?fromDate=${fmt(fromDate)}&toDate=${fmt(toDate)}`;
}

/**
 * Parse invoice XML into normalized line item records.
 * Filters out empty lines (no invoice or shipment number).
 *
 * @param {string} xml - Raw XML string from Bring report
 * @returns {object[]} - Parsed line items
 */
export function parseInvoiceXmlLines(xml) {
  const getText = (lineXml, tag) =>
    lineXml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim() || '';

  return [...xml.matchAll(/<Line>([\s\S]*?)<\/Line>/g)]
    .map(match => match[1])
    .filter(lineXml => getText(lineXml, 'InvoiceNumber') || getText(lineXml, 'ShipmentNumber'))
    .map(lineXml => ({
      invoiceNumber: getText(lineXml, 'InvoiceNumber'),
      invoiceDate: getText(lineXml, 'InvoiceDate'),
      shipmentNumber: getText(lineXml, 'ShipmentNumber'),
      packageNumber: getText(lineXml, 'PackageNumber'),
      productCode: getText(lineXml, 'ProductCode'),
      product: getText(lineXml, 'Product'),
      description: getText(lineXml, 'Description'),
      weightKg: parseFloat(getText(lineXml, 'WeightKg')) || null,
      grossPrice: parseFloat(getText(lineXml, 'GrossPrice')) || 0,
      discount: parseFloat(getText(lineXml, 'Discount')) || 0,
      agreementPrice: parseFloat(getText(lineXml, 'AgreementPrice')) || 0,
      currency: getText(lineXml, 'CurrencyCode'),
      fromPostalCode: getText(lineXml, 'SentFromPostalCode'),
      toPostalCode: getText(lineXml, 'SentToPostalCode'),
      toCity: getText(lineXml, 'SentToCity'),
      deliveryCountry: getText(lineXml, 'DELIVERY_COUNTRY'),
    }));
}

/**
 * Normalize a line item record loaded from the DB.
 * Ensures numeric fields have defaults.
 *
 * @param {object} r - Raw DB record (already camelCase via SQL aliases)
 * @returns {object} - Normalized line item
 */
export function normalizeDbLineItem(r) {
  return {
    ...r,
    agreementPrice: r.agreementPrice ?? 0,
    grossPrice: r.grossPrice ?? 0,
    discount: r.discount ?? 0,
  };
}
