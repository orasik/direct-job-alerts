/** A single organic search result from Serper. */
export interface SerperOrganic {
  title: string;
  link: string;
  snippet?: string;
  date?: string;
  position?: number;
}

/** Relevant slice of the Serper /search response. */
export interface SerperResponse {
  organic?: SerperOrganic[];
  credits?: number;
}

const SERPER_ENDPOINT = "https://google.serper.dev/search";

/**
 * Run a single Google search via the Serper.dev API.
 *
 * @param apiKey  Serper API key (X-API-KEY header).
 * @param q       The full search query, e.g. `site:myworkdayjobs.com "Outside IR35"`.
 * @param gl      Google country code, e.g. "gb".
 * @param tbs     Optional time filter, e.g. "qdr:w". Omitted for "anytime".
 */
export async function serperSearch(
  apiKey: string,
  q: string,
  gl: string,
  tbs?: string,
): Promise<SerperResponse> {
  const body: Record<string, unknown> = { q, gl };
  if (tbs) body.tbs = tbs;

  const res = await fetch(SERPER_ENDPOINT, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Serper request failed (${res.status}): ${text}`);
  }

  return (await res.json()) as SerperResponse;
}
