import atsMap from "../ats.json";

/**
 * Friendly ATS name -> hostname for the Google `site:` filter.
 * Loaded from ats.json — add new providers there, no code change needed.
 */
export const ATS_MAP: Record<string, string> = atsMap;

export interface AtsTarget {
  name: string;
  host: string;
}

/**
 * Every ATS to search, de-duplicated by hostname (first name wins) so a
 * repeated host in ats.json doesn't trigger duplicate searches.
 */
export function allAtsTargets(): AtsTarget[] {
  const seen = new Set<string>();
  const targets: AtsTarget[] = [];
  for (const [name, host] of Object.entries(ATS_MAP)) {
    if (seen.has(host)) continue;
    seen.add(host);
    targets.push({ name, host });
  }
  return targets;
}
