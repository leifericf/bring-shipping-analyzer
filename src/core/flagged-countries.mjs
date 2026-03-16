// Countries flagged for shipping risk.
// Each entry documents the risk level and reason so the reasoning
// is preserved for future reference.
//
// This is pure data — no side effects.
//
// Risk levels:
//   critical - Sanctions, active war, or failed state. Do not ship.
//   high     - Conflict, extreme corruption, collapsed systems. Strongly advised against.
//   medium   - Significant instability, weak postal infrastructure, high corruption.
//   low      - Minor concerns: microstates, dependencies, borderline infrastructure.

/**
 * @typedef {object} FlaggedCountry
 * @property {string} code - ISO 3166-1 alpha-2
 * @property {string} country - Display name
 * @property {'critical'|'high'|'medium'|'low'} risk - Risk level
 * @property {string} reason - Human-readable explanation
 */

/** @type {FlaggedCountry[]} */
export const FLAGGED_COUNTRIES = [

  // ═══════════════════════════════════════════════════════════════════════
  // CRITICAL — sanctions, active war, failed states
  // ═══════════════════════════════════════════════════════════════════════

  // Comprehensive sanctions (EU/UN/US)
  { code: 'KP', country: 'North Korea',  risk: 'critical', reason: 'Comprehensive UN/EU/US sanctions. No carrier service.' },
  { code: 'IR', country: 'Iran',         risk: 'critical', reason: 'Comprehensive EU/US sanctions. Carrier and payment restrictions.' },
  { code: 'SY', country: 'Syria',        risk: 'critical', reason: 'Comprehensive EU/US sanctions. Active civil war, infrastructure destroyed.' },
  { code: 'CU', country: 'Cuba',         risk: 'critical', reason: 'US sanctions, EU restrictions. Severe customs and payment barriers.' },
  { code: 'RU', country: 'Russia',       risk: 'critical', reason: 'EU/Norway sanctions since 2022. Carrier restrictions, customs/payment issues.' },
  { code: 'BY', country: 'Belarus',      risk: 'critical', reason: 'EU/Norway sanctions. Carrier restrictions, routes through Russia.' },

  // Active war zones
  { code: 'UA', country: 'Ukraine',      risk: 'critical', reason: 'Active war zone. Many areas unreachable, high loss/damage risk.' },
  { code: 'YE', country: 'Yemen',        risk: 'critical', reason: 'Civil war, Houthi blockade. No reliable postal service. EU sanctions on parties.' },
  { code: 'SD', country: 'Sudan',        risk: 'critical', reason: 'Civil war since 2023. Postal system collapsed. EU sanctions.' },

  // Failed/collapsed states
  { code: 'SO', country: 'Somalia',      risk: 'critical', reason: 'Failed state. No functioning postal system. Al-Shabaab controls large areas. UN sanctions.' },
  { code: 'SS', country: 'South Sudan',  risk: 'critical', reason: 'Civil war, famine. No postal infrastructure. UN/EU sanctions.' },
  { code: 'LY', country: 'Libya',        risk: 'critical', reason: 'Civil war, two rival governments. No central postal authority. UN/EU sanctions.' },
  { code: 'AF', country: 'Afghanistan',  risk: 'critical', reason: 'Taliban government. Collapsed institutions. Sanctions on governing entities.' },

  // ═══════════════════════════════════════════════════════════════════════
  // HIGH — conflict, extreme corruption, collapsed economies/infrastructure
  // ═══════════════════════════════════════════════════════════════════════

  // Active conflict / military coups with EU sanctions
  { code: 'MM', country: 'Myanmar',                risk: 'high', reason: 'Military coup (2021), civil war. EU sanctions. Postal service severely disrupted.' },
  { code: 'ML', country: 'Mali',                   risk: 'high', reason: 'Military coup, Islamist insurgency. EU sanctions. Postal service unreliable.' },
  { code: 'BF', country: 'Burkina Faso',           risk: 'high', reason: 'Military coup, jihadist insurgency. Large areas outside government control.' },
  { code: 'NE', country: 'Niger',                  risk: 'high', reason: 'Military coup (2023). EU sanctions suspended aid. Postal service minimal.' },
  { code: 'CF', country: 'Central African Republic', risk: 'high', reason: 'Ongoing civil conflict. UN peacekeepers present. Minimal postal infrastructure.' },
  { code: 'CD', country: 'DR Congo',               risk: 'high', reason: 'Eastern conflict zones, extreme corruption. Postal system barely functional.' },
  { code: 'TD', country: 'Chad',                   risk: 'high', reason: 'Political instability, military government. Minimal postal infrastructure.' },
  { code: 'ER', country: 'Eritrea',                risk: 'high', reason: 'Authoritarian state, UN sanctions (arms). No reliable postal service, exit restrictions.' },

  // Economic collapse / extreme instability
  { code: 'VE', country: 'Venezuela',              risk: 'high', reason: 'Economic collapse. Postal system non-functional. EU/US sanctions on officials.' },
  { code: 'HT', country: 'Haiti',                  risk: 'high', reason: 'Gang-controlled areas, collapsed state. No functioning postal service in most areas.' },
  { code: 'LB', country: 'Lebanon',                risk: 'high', reason: 'Economic collapse, political paralysis. Postal service severely degraded since 2020.' },
  { code: 'ZW', country: 'Zimbabwe',               risk: 'high', reason: 'Economic instability, high corruption. EU sanctions (partial). Postal service unreliable.' },
  { code: 'NI', country: 'Nicaragua',              risk: 'high', reason: 'Authoritarian crackdown. EU sanctions. Customs/import restrictions increasing.' },

  // Conflict + extreme corruption
  { code: 'IQ', country: 'Iraq',                   risk: 'high', reason: 'Ongoing instability, militia-controlled areas. High theft/loss. Customs unpredictable.' },
  { code: 'ET', country: 'Ethiopia',               risk: 'high', reason: 'Tigray war aftermath, ethnic conflicts. Postal service disrupted in conflict areas.' },
  { code: 'NG', country: 'Nigeria',                risk: 'high', reason: 'High corruption, Boko Haram (north), postal theft endemic. Customs extremely slow.' },
  { code: 'PK', country: 'Pakistan',               risk: 'high', reason: 'Security issues, postal infrastructure weak outside major cities. High loss rates.' },
  { code: 'CM', country: 'Cameroon',               risk: 'high', reason: 'Anglophone crisis (civil conflict). Postal service disrupted in affected regions.' },

  // European high-risk
  { code: 'AL', country: 'Albania',                risk: 'high', reason: 'Weak postal infrastructure, high corruption index.' },
  { code: 'BA', country: 'Bosnia and Herzegovina',  risk: 'high', reason: 'Fragmented postal system, complex customs.' },
  { code: 'XK', country: 'Kosovo',                 risk: 'high', reason: 'Disputed territory, limited carrier support.' },
  { code: 'MD', country: 'Moldova',                risk: 'high', reason: 'Weakest postal infrastructure in Europe. Transnistria breakaway region.' },

  // ═══════════════════════════════════════════════════════════════════════
  // MEDIUM — significant instability, weak postal, high corruption
  // ═══════════════════════════════════════════════════════════════════════

  // Africa — weak postal infrastructure + corruption
  { code: 'DZ', country: 'Algeria',                risk: 'medium', reason: 'Bureaucratic customs, postal delays. Corruption concerns.' },
  { code: 'AO', country: 'Angola',                 risk: 'medium', reason: 'High corruption, weak postal infrastructure. Customs unpredictable.' },
  { code: 'BJ', country: 'Benin',                  risk: 'medium', reason: 'Limited postal infrastructure. Customs delays.' },
  { code: 'BW', country: 'Botswana',               risk: 'medium', reason: 'Functional but slow postal service. Remote areas underserved.' },
  { code: 'BI', country: 'Burundi',                risk: 'medium', reason: 'Political instability, minimal postal infrastructure.' },
  { code: 'CV', country: 'Cape Verde',             risk: 'medium', reason: 'Island nation, limited postal service. Long transit times.' },
  { code: 'KM', country: 'Comoros',                risk: 'medium', reason: 'Remote island nation. Minimal postal infrastructure.' },
  { code: 'CG', country: 'Congo (Brazzaville)',    risk: 'medium', reason: 'Weak postal infrastructure, high corruption.' },
  { code: 'CI', country: "Cote d'Ivoire",          risk: 'medium', reason: 'Post-conflict recovery. Postal service improving but unreliable.' },
  { code: 'DJ', country: 'Djibouti',               risk: 'medium', reason: 'Tiny country, minimal postal infrastructure.' },
  { code: 'GQ', country: 'Equatorial Guinea',      risk: 'medium', reason: 'Authoritarian state, high corruption. No reliable postal system.' },
  { code: 'SZ', country: 'Eswatini',               risk: 'medium', reason: 'Political unrest, limited postal service.' },
  { code: 'GA', country: 'Gabon',                  risk: 'medium', reason: 'Military coup (2023). Postal service limited.' },
  { code: 'GM', country: 'Gambia',                 risk: 'medium', reason: 'Tiny country, minimal postal infrastructure.' },
  { code: 'GH', country: 'Ghana',                  risk: 'medium', reason: 'Functional post but customs slow and corruption present. Higher loss rates.' },
  { code: 'GN', country: 'Guinea',                 risk: 'medium', reason: 'Military coup, political instability. Postal service minimal.' },
  { code: 'GW', country: 'Guinea-Bissau',          risk: 'medium', reason: 'Political instability, drug trafficking hub. No reliable postal system.' },
  { code: 'KE', country: 'Kenya',                  risk: 'medium', reason: 'Functional postal service in cities, but high theft rates and customs corruption.' },
  { code: 'LS', country: 'Lesotho',                risk: 'medium', reason: 'Landlocked, limited postal infrastructure. Routes through South Africa.' },
  { code: 'LR', country: 'Liberia',                risk: 'medium', reason: 'Post-conflict, minimal postal infrastructure. No street addressing.' },
  { code: 'MG', country: 'Madagascar',             risk: 'medium', reason: 'Political instability. Postal service very slow and unreliable.' },
  { code: 'MW', country: 'Malawi',                 risk: 'medium', reason: 'Limited postal infrastructure. Long transit and customs delays.' },
  { code: 'MR', country: 'Mauritania',             risk: 'medium', reason: 'Sparse infrastructure, desert country. Minimal postal service.' },
  { code: 'MZ', country: 'Mozambique',             risk: 'medium', reason: 'Insurgency in north. Postal service weak. Customs slow.' },
  { code: 'NA', country: 'Namibia',                risk: 'medium', reason: 'Functional but slow postal service. Remote areas underserved.' },
  { code: 'RW', country: 'Rwanda',                 risk: 'medium', reason: 'Improving infrastructure but landlocked, customs delays. Regional conflict involvement.' },
  { code: 'ST', country: 'Sao Tome and Principe',  risk: 'medium', reason: 'Remote island microstate. Minimal postal infrastructure.' },
  { code: 'SN', country: 'Senegal',                risk: 'medium', reason: 'Functional post in Dakar but weak outside capital. Political tensions.' },
  { code: 'SL', country: 'Sierra Leone',           risk: 'medium', reason: 'Post-conflict, weak postal infrastructure. Corruption.' },
  { code: 'TG', country: 'Togo',                   risk: 'medium', reason: 'Authoritarian government, limited postal infrastructure.' },
  { code: 'TZ', country: 'Tanzania',               risk: 'medium', reason: 'Postal service functional in cities but slow. Customs delays and corruption.' },
  { code: 'UG', country: 'Uganda',                 risk: 'medium', reason: 'Postal service limited outside Kampala. Customs corruption.' },
  { code: 'ZM', country: 'Zambia',                 risk: 'medium', reason: 'Limited postal infrastructure. Customs slow.' },
  { code: 'EG', country: 'Egypt',                  risk: 'medium', reason: 'Customs bureaucracy, high import duties. Postal service slow outside Cairo.' },
  { code: 'TN', country: 'Tunisia',                risk: 'medium', reason: 'Postal service functional but customs delays and political instability.' },
  { code: 'MA', country: 'Morocco',                risk: 'medium', reason: 'Customs bureaucracy and delays. Postal service adequate in cities only.' },
  { code: 'MU', country: 'Mauritius',              risk: 'medium', reason: 'Island nation, generally functional but customs delays on imports.' },
  { code: 'SC', country: 'Seychelles',             risk: 'medium', reason: 'Remote island nation. Limited postal capacity, long transit.' },
  { code: 'ZA', country: 'South Africa',           risk: 'medium', reason: 'SAPO has severe backlogs and theft problems. Private courier recommended over postal.' },

  // Middle East — customs friction, instability
  { code: 'PS', country: 'Palestine',              risk: 'medium', reason: 'Israeli restrictions on imports. Postal service depends on Israeli cooperation. Conflict zone.' },
  { code: 'JO', country: 'Jordan',                 risk: 'medium', reason: 'Functional postal service but slow customs clearance. Import restrictions.' },
  { code: 'TR', country: 'Turkey',                 risk: 'medium', reason: 'Customs complex, high import duties. Claims and returns difficult. Currency instability.' },

  // Central Asia — authoritarian, weak postal
  { code: 'TM', country: 'Turkmenistan',           risk: 'medium', reason: 'Authoritarian, isolated. No reliable postal service. Import restrictions.' },
  { code: 'TJ', country: 'Tajikistan',             risk: 'medium', reason: 'Poorest Central Asian state. Minimal postal infrastructure.' },
  { code: 'KG', country: 'Kyrgyzstan',             risk: 'medium', reason: 'Political instability, weak postal infrastructure. Customs slow.' },
  { code: 'UZ', country: 'Uzbekistan',             risk: 'medium', reason: 'Authoritarian, import restrictions. Postal service slow and unreliable.' },
  { code: 'KZ', country: 'Kazakhstan',             risk: 'medium', reason: 'Vast distances, postal slow outside cities. Customs bureaucracy. Russia-adjacent risk.' },
  { code: 'GE', country: 'Georgia',                risk: 'medium', reason: 'Occupied territories (South Ossetia, Abkhazia). Postal otherwise functional.' },
  { code: 'AM', country: 'Armenia',                risk: 'medium', reason: 'Nagorno-Karabakh aftermath. Landlocked, routes through Georgia. Postal slow.' },
  { code: 'AZ', country: 'Azerbaijan',             risk: 'medium', reason: 'Authoritarian, import restrictions. Postal slow. Regional conflict history.' },
  { code: 'MN', country: 'Mongolia',               risk: 'medium', reason: 'Vast distances, nomadic population. Postal infrastructure very limited outside Ulaanbaatar.' },

  // South/Southeast Asia — weak postal, corruption
  { code: 'BD', country: 'Bangladesh',             risk: 'medium', reason: 'Customs corruption, slow clearance. Postal service unreliable. Flooding disruptions.' },
  { code: 'NP', country: 'Nepal',                  risk: 'medium', reason: 'Mountainous terrain, weak postal infrastructure. Customs slow at Kathmandu.' },
  { code: 'LK', country: 'Sri Lanka',              risk: 'medium', reason: 'Economic crisis aftermath. Postal functional but customs delays. Import restrictions.' },
  { code: 'KH', country: 'Cambodia',               risk: 'medium', reason: 'Weak postal infrastructure. No street addressing in many areas. Corruption.' },
  { code: 'LA', country: 'Laos',                   risk: 'medium', reason: 'Authoritarian, minimal postal infrastructure. Landlocked, routes through Thailand.' },
  { code: 'TL', country: 'Timor-Leste',            risk: 'medium', reason: 'One of youngest nations. Minimal postal infrastructure.' },
  { code: 'PG', country: 'Papua New Guinea',       risk: 'medium', reason: 'Extreme terrain, tribal conflicts. No postal delivery outside Port Moresby.' },
  { code: 'IN', country: 'India',                  risk: 'medium', reason: 'Customs notoriously slow and bureaucratic. High import duties. Losses in transit.' },
  { code: 'PH', country: 'Philippines',            risk: 'medium', reason: 'PHLPost unreliable. Island logistics complex. Customs delays and corruption.' },
  { code: 'ID', country: 'Indonesia',              risk: 'medium', reason: 'Archipelago logistics. Customs slow and duties high. Postal unreliable outside Java.' },

  // Caribbean / Central America — weak systems
  { code: 'HN', country: 'Honduras',               risk: 'medium', reason: 'High crime, corruption. Postal service unreliable. Parcels frequently stolen.' },
  { code: 'GT', country: 'Guatemala',              risk: 'medium', reason: 'High crime, corruption. Postal service slow and unreliable.' },
  { code: 'SV', country: 'El Salvador',            risk: 'medium', reason: 'Gang-related crime. Postal service limited. Customs slow.' },
  { code: 'BZ', country: 'Belize',                 risk: 'medium', reason: 'Small postal system, limited infrastructure. Customs delays.' },
  { code: 'GY', country: 'Guyana',                 risk: 'medium', reason: 'Limited postal infrastructure. Customs slow.' },
  { code: 'SR', country: 'Suriname',               risk: 'medium', reason: 'Limited postal infrastructure. Customs unpredictable.' },
  { code: 'JM', country: 'Jamaica',                risk: 'medium', reason: 'High crime, customs corruption. Postal service slow. Parcels go missing.' },
  { code: 'TT', country: 'Trinidad and Tobago',    risk: 'medium', reason: 'Customs delays, theft concerns. Postal service inconsistent.' },
  { code: 'BO', country: 'Bolivia',                risk: 'medium', reason: 'Landlocked, customs slow. Postal service weak outside La Paz.' },
  { code: 'PY', country: 'Paraguay',               risk: 'medium', reason: 'Landlocked, high corruption. Postal service limited. Customs unpredictable.' },
  { code: 'EC', country: 'Ecuador',                risk: 'medium', reason: 'Rising crime and instability. Customs slow. Import restrictions.' },
  { code: 'PE', country: 'Peru',                   risk: 'medium', reason: 'Political instability. Postal service slow, especially outside Lima. Customs delays.' },
  { code: 'CO', country: 'Colombia',               risk: 'medium', reason: 'Improving, but postal theft still a problem. Customs slow. Security concerns in some areas.' },

  // Pacific islands — remote, minimal infrastructure
  { code: 'FJ', country: 'Fiji',                   risk: 'medium', reason: 'Remote Pacific island. Limited postal capacity. Long transit times.' },
  { code: 'WS', country: 'Samoa',                  risk: 'medium', reason: 'Remote Pacific island. Minimal postal infrastructure.' },
  { code: 'TO', country: 'Tonga',                  risk: 'medium', reason: 'Remote Pacific island. Minimal postal infrastructure.' },
  { code: 'VU', country: 'Vanuatu',                risk: 'medium', reason: 'Remote Pacific archipelago. Minimal postal infrastructure.' },
  { code: 'SB', country: 'Solomon Islands',        risk: 'medium', reason: 'Remote, ethnic tensions. Minimal postal infrastructure.' },
  { code: 'MH', country: 'Marshall Islands',       risk: 'medium', reason: 'Remote Pacific. USPS routes only. Minimal infrastructure.' },
  { code: 'FM', country: 'Micronesia',             risk: 'medium', reason: 'Remote Pacific. USPS routes only. Minimal infrastructure.' },
  { code: 'PW', country: 'Palau',                  risk: 'medium', reason: 'Remote Pacific. USPS routes only. Minimal infrastructure.' },
  { code: 'KI', country: 'Kiribati',               risk: 'medium', reason: 'Most remote inhabited islands on Earth. Transit measured in weeks.' },
  { code: 'NR', country: 'Nauru',                  risk: 'medium', reason: 'Smallest republic. Minimal postal infrastructure.' },
  { code: 'TV', country: 'Tuvalu',                 risk: 'medium', reason: 'One of smallest/most remote nations. Postal service barely exists.' },

  // European — elevated risk
  { code: 'BG', country: 'Bulgaria',               risk: 'medium', reason: 'Higher loss rates, corruption concerns within the EU.' },
  { code: 'ME', country: 'Montenegro',             risk: 'medium', reason: 'Small postal system, limited tracking reliability.' },
  { code: 'MK', country: 'North Macedonia',        risk: 'medium', reason: 'Higher customs friction, postal reliability concerns.' },
  { code: 'RS', country: 'Serbia',                 risk: 'medium', reason: 'Customs complexity, Russia-adjacent politically.' },
  { code: 'RO', country: 'Romania',                risk: 'medium', reason: 'Rural delivery gaps, higher claims friction.' },
  { code: 'GR', country: 'Greece',                 risk: 'medium', reason: 'ELTA has poor reliability reputation, frequent strikes, customs delays.' },
  { code: 'CY', country: 'Cyprus',                 risk: 'medium', reason: 'Split island (Northern Cyprus undeliverable), postal service weaker than mainland EU.' },

  // ═══════════════════════════════════════════════════════════════════════
  // LOW — minor concerns: microstates, dependencies, borderline systems
  // ═══════════════════════════════════════════════════════════════════════

  // European microstates and dependencies
  { code: 'VA', country: 'Vatican City',           risk: 'low', reason: 'No real parcel delivery infrastructure; routes through Italian post.' },
  { code: 'SM', country: 'San Marino',             risk: 'low', reason: 'Routes through Italian post, address resolution issues.' },
  { code: 'MC', country: 'Monaco',                 risk: 'low', reason: 'Microstate, routes through French post with address confusion. Near-zero volume.' },
  { code: 'LI', country: 'Liechtenstein',          risk: 'low', reason: 'Microstate, routes through Swiss post. Near-zero volume.' },
  { code: 'AD', country: 'Andorra',                risk: 'low', reason: 'No national postal carrier; relies on French/Spanish post with handoff gaps.' },
  { code: 'GI', country: 'Gibraltar',              risk: 'low', reason: 'Tiny territory, Royal Mail with customs friction post-Brexit.' },
  { code: 'MT', country: 'Malta',                  risk: 'low', reason: 'Small island postal system, higher delays on international parcels.' },
  { code: 'IM', country: 'Isle of Man',            risk: 'low', reason: 'Crown dependency, separate customs territory. VAT complexity.' },
  { code: 'GG', country: 'Guernsey',              risk: 'low', reason: 'Crown dependency, separate customs, VAT-free zone causes import duty surprises.' },
  { code: 'JE', country: 'Jersey',                risk: 'low', reason: 'Crown dependency, separate customs, VAT-free zone causes import duty surprises.' },
  { code: 'AX', country: 'Åland Islands',         risk: 'low', reason: 'Autonomous Finnish territory with separate customs status. Unexpected duty/VAT.' },
  { code: 'FO', country: 'Faroe Islands',         risk: 'low', reason: 'Outside EU, separate customs territory. Remote, limited infrastructure.' },
  { code: 'GL', country: 'Greenland',             risk: 'low', reason: 'Extremely remote, sparse infrastructure, long transit times.' },
  { code: 'SJ', country: 'Svalbard and Jan Mayen', risk: 'low', reason: 'Arctic territory, very limited postal service, seasonal disruptions.' },
  { code: 'HR', country: 'Croatia',               risk: 'low', reason: 'Postal service (HP) noticeably below Western European standards.' },
  { code: 'LV', country: 'Latvia',                risk: 'low', reason: 'Latvijas Pasts has weaker reputation than Estonian or Lithuanian post.' },
  { code: 'HU', country: 'Hungary',               risk: 'low', reason: 'EU member with functional post, but political drift and rule-of-law concerns.' },

  // Latin American borderline
  { code: 'MX', country: 'Mexico',                risk: 'low', reason: 'Postal service (Correos) unreliable. Theft common. Private courier strongly preferred.' },
  { code: 'BR', country: 'Brazil',                risk: 'low', reason: 'Correios functional but slow. High import taxes (60%+). Customs delays weeks-months.' },
  { code: 'AR', country: 'Argentina',             risk: 'low', reason: 'Customs extremely slow, import taxes high. Correo Argentino unreliable. Currency controls.' },
  { code: 'CL', country: 'Chile',                 risk: 'low', reason: 'Generally reliable, but customs delays on imports and high duties.' },
  { code: 'CR', country: 'Costa Rica',            risk: 'low', reason: 'Postal service functional but slow. Customs delays. No street delivery in many areas.' },
  { code: 'PA', country: 'Panama',                risk: 'low', reason: 'No home delivery by national post. PO box required. Customs delays.' },
  { code: 'UY', country: 'Uruguay',               risk: 'low', reason: 'Postal service functional but slow. High import taxes.' },
  { code: 'DO', country: 'Dominican Republic',    risk: 'low', reason: 'Postal service unreliable. No home delivery in many areas. Customs slow.' },
  { code: 'CW', country: 'Curacao',               risk: 'low', reason: 'Small island territory. Limited postal capacity.' },
  { code: 'AW', country: 'Aruba',                 risk: 'low', reason: 'Small island territory. Limited postal capacity.' },

  // Asia borderline
  { code: 'TH', country: 'Thailand',              risk: 'low', reason: 'Postal service functional but customs slow. Import duties and taxes add complexity.' },
  { code: 'VN', country: 'Vietnam',               risk: 'low', reason: 'Improving postal service, but customs bureaucratic. Import restrictions on some goods.' },
  { code: 'MY', country: 'Malaysia',              risk: 'low', reason: 'Pos Malaysia functional but slow. Customs delays. East Malaysia underserved.' },
  { code: 'CN', country: 'China',                 risk: 'low', reason: 'Customs unpredictable. Import restrictions. Postal functional but claims/returns near-impossible.' },
  { code: 'TW', country: 'Taiwan',                risk: 'low', reason: 'Reliable postal service, but geopolitical risk and some carrier routing complexity.' },

  // Middle East / North Africa borderline
  { code: 'SA', country: 'Saudi Arabia',          risk: 'low', reason: 'Functional postal service in cities. Import restrictions (content censorship). Customs slow.' },
  { code: 'AE', country: 'United Arab Emirates',  risk: 'low', reason: 'Generally reliable, but import duties and content restrictions. Returns difficult.' },
  { code: 'QA', country: 'Qatar',                 risk: 'low', reason: 'Functional postal service. Import restrictions and content censorship.' },
  { code: 'KW', country: 'Kuwait',                risk: 'low', reason: 'Functional postal service. Import restrictions and slow customs.' },
  { code: 'BH', country: 'Bahrain',               risk: 'low', reason: 'Small island state. Functional post but import restrictions.' },
  { code: 'OM', country: 'Oman',                  risk: 'low', reason: 'Functional postal service. Import restrictions. Remote areas underserved.' },
  { code: 'IL', country: 'Israel',                risk: 'low', reason: 'Reliable postal service, but security-related delays and import inspections. Regional conflict.' },

  // Oceania borderline
  { code: 'NZ', country: 'New Zealand',           risk: 'low', reason: 'Reliable postal service, but very remote from Europe. Long transit. Strict biosecurity customs.' },
  { code: 'AU', country: 'Australia',             risk: 'low', reason: 'Reliable postal service, but very remote. Strict customs (biosecurity). Long transit times.' },
  { code: 'NC', country: 'New Caledonia',         risk: 'low', reason: 'French territory in Pacific. Remote, limited postal capacity.' },
  { code: 'PF', country: 'French Polynesia',      risk: 'low', reason: 'French territory in Pacific. Extremely remote. Long transit times.' },
];

/**
 * O(1) lookup set of flagged country codes.
 */
export const FLAGGED_CODES = new Set(FLAGGED_COUNTRIES.map(f => f.code));

/**
 * O(1) lookup map: code -> FlaggedCountry.
 */
export const FLAGGED_BY_CODE = new Map(FLAGGED_COUNTRIES.map(f => [f.code, f]));

/**
 * Risk levels in descending severity order.
 */
export const RISK_LEVELS = ['critical', 'high', 'medium', 'low'];

/**
 * Human-readable labels for risk levels.
 */
export const RISK_LABELS = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * Check a list of destination codes against flagged countries.
 * Returns matches grouped by risk level.
 *
 * @param {string[]} codes - ISO country codes to check
 * @returns {FlaggedCountry[]}
 */
export function checkForFlaggedCountries(codes) {
  return codes
    .filter(code => FLAGGED_CODES.has(code))
    .map(code => FLAGGED_BY_CODE.get(code))
    .sort((a, b) => RISK_LEVELS.indexOf(a.risk) - RISK_LEVELS.indexOf(b.risk));
}
