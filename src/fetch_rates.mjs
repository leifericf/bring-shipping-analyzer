import fs from 'fs';
import { join } from 'path';
import { loadEnv, getOutputDir, getAuthHeaders, sleep, fetchWithRetry, csvRow } from './lib.mjs';

const env = loadEnv();

const API_UID = env.BRING_API_UID;
const API_KEY = env.BRING_API_KEY;
const CUSTOMER_NUMBER = env.BRING_CUSTOMER_NUMBER;
const ORIGIN_POSTAL_CODE = env.BRING_ORIGIN_POSTAL_CODE || '0174';
const ORIGIN_COUNTRY = 'NO';
const OUTPUT_DIR = getOutputDir(CUSTOMER_NUMBER);

const DESTINATIONS = [
  { country: 'Norway', code: 'NO', postalCode: '0150', zone: 1, desc: 'Oslo' },
  { country: 'Norway', code: 'NO', postalCode: '1613', zone: 2, desc: 'Østlandet' },
  { country: 'Norway', code: 'NO', postalCode: '5015', zone: 3, desc: 'Bergen' },
  { country: 'Norway', code: 'NO', postalCode: '7020', zone: 4, desc: 'Trondheim' },
  { country: 'Norway', code: 'NO', postalCode: '9405', zone: 5, desc: 'Harstad' },
  { country: 'Norway', code: 'NO', postalCode: '8100', zone: 6, desc: 'Bodø' },
  { country: 'Norway', code: 'NO', postalCode: '9700', zone: 7, desc: 'Vadsø' },
  { country: 'Sweden', code: 'SE', postalCode: '11122', zone: 1, desc: 'Stockholm' },
  { country: 'Denmark', code: 'DK', postalCode: '1050', zone: 1, desc: 'Copenhagen' },
  { country: 'Finland', code: 'FI', postalCode: '00100', zone: 1, desc: 'Helsinki' },
  { country: 'Iceland', code: 'IS', postalCode: '101', zone: 6, desc: 'Reykjavik' },
  { country: 'Greenland', code: 'GL', postalCode: '3900', zone: 7, desc: 'Nuuk' },
  { country: 'Faroe Islands', code: 'FO', postalCode: '100', zone: 7, desc: 'Tórshavn' },
  { country: 'Japan', code: 'JP', postalCode: '1000001', zone: null, desc: 'Tokyo' },
];

const DOMESTIC_SERVICES = [
  { id: '3584', name: 'Home mailbox parcel', maxWeight: 5000 },
  { id: '3570', name: 'Home mailbox parcel RFID', maxWeight: 5000 },
  { id: '5800', name: 'Pickup parcel', maxWeight: 35000 },
  { id: '5000', name: 'Business parcel', maxWeight: 35000 },
  { id: '5600', name: 'Parcel home plus', maxWeight: 35000 },
];

const INTERNATIONAL_SERVICES = [
  { id: 'PICKUP_PARCEL', name: 'PickUp Parcel', maxWeight: 20000 },
  { id: 'BUSINESS_PARCEL', name: 'Business Parcel', maxWeight: 35000 },
  { id: 'HOME_DELIVERY_PARCEL', name: 'Home Delivery Parcel', maxWeight: 35000 },
  { id: '3639', name: 'Letter parcel International', maxWeight: 2000 },
];

const WEIGHTS_GRAMS = [250, 750, 1000, 5000, 10000, 20000, 35000];
const API_URL = 'https://api.bring.com/shippingguide/api/v2/products';

async function fetchRates(destination, service, weightGrams) {
  const today = new Date();
  const shippingDate = {
    year: today.getFullYear().toString(),
    month: (today.getMonth() + 1).toString().padStart(2, '0'),
    day: today.getDate().toString().padStart(2, '0'),
  };

  const body = {
    consignments: [{
      id: '1',
      fromCountryCode: ORIGIN_COUNTRY,
      fromPostalCode: ORIGIN_POSTAL_CODE,
      toCountryCode: destination.code,
      toPostalCode: destination.postalCode,
      shippingDate: shippingDate,
      products: [{ id: service.id, customerNumber: CUSTOMER_NUMBER }],
      packages: [{ id: '1', grossWeight: weightGrams }],
    }],
    withPrice: true,
    withExpectedDelivery: false,
    withGuiInformation: true,
  };

  const response = await fetchWithRetry(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...getAuthHeaders(env),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const product = data.consignments?.[0]?.products?.[0];

  if (!product) return null;
  if (product.errors?.length > 0) return { error: product.errors[0].description };

  const netPrice = product.price?.netPrice?.priceWithoutAdditionalServices?.amountWithoutVAT;
  const listPrice = product.price?.listPrice?.priceWithoutAdditionalServices?.amountWithoutVAT;
  const price = netPrice || listPrice;
  const displayName = product.guiInformation?.displayName || service.name;
  const zone = product.price?.zones?.totalZoneCount;

  if (price === undefined || price === null) return null;

  return { price: parseFloat(price), serviceName: displayName, zone };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Fetching Bring shipping rates...\n');
  console.log(`Origin: ${ORIGIN_POSTAL_CODE}, ${ORIGIN_COUNTRY}`);
  console.log(`Customer Number: ${CUSTOMER_NUMBER}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Weight tiers: ${WEIGHTS_GRAMS.map(w => `${w}g`).join(', ')}\n`);

  const results = [];

  // Count total requests, skipping weights above service max
  let totalRequests = 0;
  for (const dest of DESTINATIONS) {
    const services = dest.code === 'NO' ? DOMESTIC_SERVICES : INTERNATIONAL_SERVICES;
    for (const service of services) {
      totalRequests += WEIGHTS_GRAMS.filter(w => w <= service.maxWeight).length;
    }
  }

  let completedRequests = 0;

  for (const destination of DESTINATIONS) {
    const services = destination.code === 'NO' ? DOMESTIC_SERVICES : INTERNATIONAL_SERVICES;
    console.log(`\nFetching rates for ${destination.country} - ${destination.desc} (Zone ${destination.zone})...`);

    for (const service of services) {
      const applicableWeights = WEIGHTS_GRAMS.filter(w => w <= service.maxWeight);

      for (const weight of applicableWeights) {
        completedRequests++;
        process.stdout.write(`  [${completedRequests}/${totalRequests}] ${service.name} @ ${weight}g... `);

        try {
          const result = await fetchRates(destination, service, weight);
          if (result === null) {
            console.log('N/A');
          } else if (result.error) {
            console.log(`Error: ${result.error}`);
          } else {
            console.log(`${result.price} NOK (Zone ${result.zone})`);
            results.push({
              country: destination.country,
              country_code: destination.code,
              postal_code: destination.postalCode,
              zone: result.zone,
              service_id: service.id,
              service_name: result.serviceName,
              weight_g: weight,
              price_nok: result.price,
            });
          }
        } catch (error) {
          console.log(`Failed: ${error.message}`);
        }
        await sleep(50);
      }
    }
  }

  // Write shipping_rates.csv
  const csvHeader = 'country,country_code,postal_code,zone,service_id,service_name,weight_g,price_nok';
  const csvRows = results.map(r =>
    csvRow([r.country, r.country_code, r.postal_code, r.zone, r.service_id, r.service_name, r.weight_g, r.price_nok])
  );
  fs.writeFileSync(join(OUTPUT_DIR, 'shipping_rates.csv'), [csvHeader, ...csvRows].join('\n'));

  // Generate zones.csv — note: zones can differ per service for the same postal code
  const zonesMap = new Map();
  for (const r of results) {
    const key = `${r.country_code}_${r.postal_code}`;
    if (!zonesMap.has(key)) {
      zonesMap.set(key, {
        country: r.country,
        country_code: r.country_code,
        postal_code: r.postal_code,
        zone: r.zone,
      });
    }
  }
  const zonesHeader = 'country,country_code,postal_code,zone';
  const zonesRows = [...zonesMap.values()]
    .sort((a, b) => a.country.localeCompare(b.country) || a.postal_code.localeCompare(b.postal_code))
    .map(z => csvRow([z.country, z.country_code, z.postal_code, z.zone]));
  fs.writeFileSync(join(OUTPUT_DIR, 'zones.csv'), [zonesHeader, ...zonesRows].join('\n'));

  console.log(`\n\nDone! Fetched ${results.length} rates.`);
  console.log(`Results saved to ${OUTPUT_DIR}/shipping_rates.csv`);
  console.log(`Zones saved to ${OUTPUT_DIR}/zones.csv`);
}

main().catch(console.error);
