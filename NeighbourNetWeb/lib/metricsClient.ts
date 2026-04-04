/**
 * NeighbourNet — Prometheus metrics client.
 *
 * Fetches /metrics as plain text and extracts specific gauge values
 * via regex. Intentionally thin — only parses what the dashboard needs.
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:8000';

export interface ParsedMetrics {
  active_nodes: number;
  queue_depth: number;
}

/**
 * Parse a single gauge value from Prometheus exposition format.
 * Matches lines like:  neighbournet_active_nodes 12.0
 * Returns null if the metric is not found.
 */
function extractGauge(text: string, metricName: string): number | null {
  // Match the metric name followed by optional labels and a numeric value.
  // e.g.  neighbournet_active_nodes 843.0
  const re = new RegExp(`^${metricName}(?:\\{[^}]*\\})?\\s+([-\\d.e+]+)`, 'm');
  const match = text.match(re);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return isNaN(val) ? null : val;
}

/**
 * Fetch and parse the Prometheus metrics endpoint.
 * Returns sensible defaults when the endpoint is unreachable.
 */
export async function fetchMetrics(): Promise<ParsedMetrics> {
  const defaults: ParsedMetrics = { active_nodes: 0, queue_depth: 0 };

  try {
    const res = await fetch(`${BASE_URL}/metrics`, {
      // No JSON header — Prometheus returns text/plain
      cache: 'no-store',
    });

    if (!res.ok) return defaults;

    const text = await res.text();

    return {
      active_nodes: extractGauge(text, 'neighbournet_active_nodes') ?? 0,
      queue_depth: extractGauge(text, 'neighbournet_queue_depth_total') ?? 0,
    };
  } catch {
    // Network error — return defaults so the UI degrades gracefully.
    return defaults;
  }
}
