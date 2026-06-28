/** Shape of config.json (each field is an array of strings). */
export interface AppConfig {
  /** Google country codes, e.g. "gb", "us". Maps to Serper `gl`. */
  countries: string[];
  /**
   * Search terms, used verbatim after the `site:` filter. Include surrounding
   * double quotes for an exact-phrase match, e.g. `"\"Outside IR35\""`; omit
   * them to match keywords loosely, e.g. `"Senior Java Engineer"`.
   */
  queries: string[];
  /** Human-readable date ranges (see DATE_RANGE_MAP), e.g. "past_day". */
  date_range: string[];
}

/** A single job result, normalised from a Serper organic hit. */
export interface Job {
  title: string;
  url: string;
  snippet: string;
  date: string | null;
  query: string;
  ats: string;
  country: string;
}

/**
 * Maps the human-readable date_range values from config.json to Google's
 * `qdr:` time filter codes. `null` means "anytime" (no time filter applied).
 */
export const DATE_RANGE_MAP: Record<string, string | null> = {
  anytime: null,
  past_hour: "h",
  past_day: "d",
  past_week: "w",
  past_month: "m",
  past_year: "y",
};
