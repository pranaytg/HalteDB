/**
 * Normalises Indian state / UT names that come in with wildly inconsistent
 * casing, punctuation, and common typos (e.g. "CHANDIGARH,", "chandigarh",
 * "CHANDIAGRH", "ANDHRA PARDESH").
 *
 * - `canonicalState(raw)` → human-readable canonical name.
 * - `normalizeStateKey(raw)` → stable JS key (lowercase, alphabetic-only).
 * - `stateNormalizeSqlExpr(col)` → equivalent SQL expression for the same key.
 * - `stateMatchKeys(canonical)` → every raw key that maps to the canonical name,
 *    for use in `WHERE normalized_key IN (...)` filters.
 */

const CANONICAL_STATES: string[] = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman & Nicobar Islands",
  "Chandigarh",
  "Dadra & Nagar Haveli and Daman & Diu",
  "Delhi",
  "Jammu & Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
];

const ALIAS_SOURCES: Record<string, string[]> = {
  "Andhra Pradesh": ["Andhra Pardesh", "AndhraPradesh", "AP"],
  "Arunachal Pradesh": ["ArunachalPradesh", "Arunachal"],
  "Assam": ["AS"],
  "Bihar": ["BH", "BR"],
  "Chhattisgarh": [
    "Chattisgarh",
    "Chattishgarh",
    "Chhatisgarh",
    "Chhatishgarh",
    "CG",
  ],
  "Goa": ["GA"],
  "Gujarat": [
    "Gujrat",
    "GJ",
    "Ahmedabad",
    "Surat",
    "Vadodara",
    "Baroda",
    "Rajkot",
    "Halol",
    "Gandhinagar",
  ],
  "Haryana": [
    "Hariyana",
    "HR",
    "Gurgaon",
    "Gurgoan",
    "Gurugram",
    "Faridabad",
    "Panipat",
    "Ambala",
    "Karnal",
    "Hisar",
    "Rohtak",
  ],
  "Himachal Pradesh": [
    "HimachalPradesh",
    "Himachal Pardesh",
    "Himachal",
    "HP",
    "Shimla",
    "Manali",
    "Dharamshala",
    "Kullu",
    "Solan",
    "Mandi",
  ],
  "Jharkhand": ["Jharkand", "JH"],
  "Karnataka": ["Karnatak", "KA", "Bangalore", "Bengaluru", "Mysore", "Mysuru"],
  "Kerala": ["KL", "Kochi", "Cochin", "Thiruvananthapuram", "Trivandrum"],
  "Madhya Pradesh": ["MadhyaPradesh", "MP", "Indore", "Bhopal"],
  "Maharashtra": [
    "Maharastra",
    "Maharashtr",
    "MH",
    "Mumbai",
    "Pune",
    "Nagpur",
    "Nashik",
    "Thane",
  ],
  "Manipur": ["MN"],
  "Meghalaya": ["ML"],
  "Mizoram": ["MZ"],
  "Nagaland": ["NL"],
  "Odisha": ["Orissa", "OD", "OR"],
  "Punjab": [
    "PB",
    "Amritsar",
    "Ludhiana",
    "Jalandhar",
    "Mohali",
    "Patiala",
    "Bathinda",
    "Zirakpur",
    "Hoshiarpur",
    "Pathankot",
    "Firozpur",
    "Moga",
  ],
  "Rajasthan": ["Rajastan", "RJ", "Jaipur", "Jodhpur", "Udaipur"],
  "Sikkim": ["SK"],
  "Tamil Nadu": [
    "Tamilnadu",
    "TamilNadu",
    "Tamil Naadu",
    "TN",
    "Chennai",
    "Madras",
    "Coimbatore",
  ],
  "Telangana": ["Telengana", "Telagana", "Telanagana", "TG", "TS", "Hyderabad"],
  "Tripura": ["TR"],
  "Uttar Pradesh": [
    "UttarPradesh",
    "Uttara Pradesh",
    "Uttarapradesh",
    "Utter Pradesh",
    "UP",
    "Lucknow",
    "Noida",
    "Ghaziabad",
    "Kanpur",
    "Varanasi",
    "Agra",
  ],
  "Uttarakhand": [
    "Uttranchal",
    "Uttaranchal",
    "Uttrakhand",
    "Utarakhand",
    "Uttarkhand",
    "UK",
    "Ut",
    "Dehradun",
    "Haridwar",
    "Rishikesh",
    "Nainital",
    "District Nainital",
    "Roorkee",
    "Mussoorie",
  ],
  "West Bengal": [
    "WestBengal",
    "Westbangal",
    "West Bangal",
    "WB",
    "Kolkata",
    "Calcutta",
    "Howrah",
  ],
  "Andaman & Nicobar Islands": [
    "Andaman and Nicobar Islands",
    "Andaman & Nicobar",
    "Andaman Nicobar Islands",
    "A&N Islands",
    "AN",
  ],
  "Chandigarh": ["Chandiagrh", "Chadigarh", "Chandigrah", "CH"],
  "Dadra & Nagar Haveli and Daman & Diu": [
    "Dadra & Nagar Haveli",
    "Dadra and Nagar Haveli",
    "Dadra And Nagar Haveli And Daman And Diu",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Daman & Diu",
    "Daman and Diu",
    "DN",
    "DD",
    "DH",
  ],
  "Delhi": [
    "New Delhi",
    "NCT of Delhi",
    "Delhi NCT",
    "National Capital Territory of Delhi",
    "DL",
    "ND",
  ],
  "Jammu & Kashmir": [
    "Jammu and Kashmir",
    "J&K",
    "JK",
    "Srinagar",
    "Jammu",
    "Kupwara",
    "Anantnag",
    "Baramulla",
    "Pulwama",
    "Kathua",
    "Udhampur",
  ],
  "Ladakh": ["LA", "Leh", "Kargil"],
  "Lakshadweep": ["LD"],
  "Puducherry": ["Pondicherry", "Pondichery", "Pudhucherry", "Pondy", "Py", "PY"],
};

export function normalizeStateKey(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).toLowerCase().replace(/[^a-z]/g, "");
}

const KEY_TO_CANONICAL: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const canonical of CANONICAL_STATES) {
    m[normalizeStateKey(canonical)] = canonical;
  }
  for (const [canonical, aliases] of Object.entries(ALIAS_SOURCES)) {
    for (const alias of aliases) {
      m[normalizeStateKey(alias)] = canonical;
    }
  }
  return m;
})();

export function canonicalState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = normalizeStateKey(raw);
  if (!key) return null;
  return KEY_TO_CANONICAL[key] ?? null;
}

/**
 * PostgreSQL expression that produces the same key as `normalizeStateKey`:
 * lowercase the column and strip every non-alphabetic character.
 */
export function stateNormalizeSqlExpr(col: string): string {
  return `LOWER(REGEXP_REPLACE(COALESCE(${col}, ''), '[^A-Za-z]', '', 'g'))`;
}

/**
 * All normalized keys whose canonical state matches `canonical`.
 * Use this to translate a user-selected canonical filter value back into
 * every raw-key variant stored in the DB.
 */
export function stateMatchKeys(canonical: string): string[] {
  const target = canonicalState(canonical);
  if (!target) return [];
  const keys = new Set<string>();
  keys.add(normalizeStateKey(target));
  for (const [key, c] of Object.entries(KEY_TO_CANONICAL)) {
    if (c === target) keys.add(key);
  }
  return Array.from(keys).filter(Boolean);
}
