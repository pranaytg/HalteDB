/**
 * Indian City Tier Classification
 * Shared across API routes for consistent tier filtering.
 */

export const TIER_1_CITIES = new Set([
  "Mumbai", "Delhi", "New Delhi", "Bangalore", "Bengaluru",
  "Hyderabad", "Chennai", "Kolkata", "Ahmedabad", "Pune",
]);

export const TIER_2_CITIES = new Set([
  "Jaipur", "Lucknow", "Kanpur", "Nagpur", "Indore", "Bhopal",
  "Visakhapatnam", "Patna", "Vadodara", "Coimbatore", "Ludhiana",
  "Agra", "Madurai", "Nashik", "Vijayawada", "Meerut", "Rajkot",
  "Varanasi", "Srinagar", "Aurangabad", "Chhatrapati Sambhajinagar",
  "Dhanbad", "Amritsar", "Allahabad", "Prayagraj", "Ranchi",
  "Gwalior", "Jabalpur", "Jodhpur", "Raipur", "Kota", "Chandigarh",
  "Guwahati", "Surat", "Thiruvananthapuram", "Trivandrum", "Mysore",
  "Mysuru", "Noida", "Greater Noida", "Gurgaon", "Gurugram",
  "Faridabad", "Ghaziabad", "Thane", "Navi Mumbai", "Dehradun",
  "Bhubaneswar", "Mangalore", "Mangaluru", "Tiruchirappalli",
  "Trichy", "Hubli", "Salem", "Warangal", "Guntur", "Udaipur",
  "Belgaum", "Belagavi", "Jammu",
]);

export function getCityTier(city: string | null): string {
  if (!city) return "Unknown";
  const normalized = city.trim().split(/\s+/).map(
    w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(" ");
  if (TIER_1_CITIES.has(normalized)) return "Tier 1";
  if (TIER_2_CITIES.has(normalized)) return "Tier 2";
  return "Tier 3";
}

/**
 * Returns a list of cities belonging to a given tier.
 * Used to build SQL IN-clauses for tier filtering.
 */
export function getCitiesForTier(tier: string, allCityNames: string[]): string[] {
  return allCityNames.filter(c => getCityTier(c) === tier);
}
