/**
 * useMetrics — derives live triage distribution, message rate, and ack counts
 * from the messages state. All data is computed locally — no extra API call needed.
 *
 * If we can parse histograms from /metrics in the future, this hook is the right
 * place to add that.
 */

'use client';

import { useMemo } from 'react';
import type { Message } from '../lib/types';

export interface SparklinePoint {
  time: string;
  arrival: number;
}

export interface UseMetricsResult {
  /** Count per tier { CRITICAL: 3, HIGH: 1, ... } */
  tierCounts: Record<string, number>;
  /** Array for recharts donut */
  donutData: { name: string; value: number }[];
  /** Messages per 5-minute window for the sparkline — last 7 buckets */
  sparklineData: SparklinePoint[];
  acknowledgedCount: number;
  pendingCount: number;
}

const TIERS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function buildSparkline(messages: Message[]): SparklinePoint[] {
  const now = Date.now();
  const buckets: number[] = Array(7).fill(0);

  for (const m of messages) {
    const ageMs = now - new Date(m.last_hop_at).getTime();
    const bucketIdx = Math.floor(ageMs / (5 * 60_000));
    if (bucketIdx >= 0 && bucketIdx < 7) {
      buckets[6 - bucketIdx]++;
    }
  }

  return buckets.map((count, i) => {
    const bucketStart = new Date(now - (6 - i) * 5 * 60_000);
    const h = bucketStart.getHours().toString().padStart(2, '0');
    const min = bucketStart.getMinutes().toString().padStart(2, '0');
    return { time: `${h}:${min}`, arrival: count };
  });
}

export function useMetrics(messages: Message[]): UseMetricsResult {
  return useMemo(() => {
    const tierCounts: Record<string, number> = Object.fromEntries(
      TIERS.map((t) => [t, messages.filter((m) => m.priority_tier === t).length]),
    );

    const donutData = TIERS.map((t) => ({ name: t, value: tierCounts[t] })).filter(
      (d) => d.value > 0,
    );

    const sparklineData = buildSparkline(messages);

    const acknowledgedCount = messages.filter((m) => m.acknowledged).length;
    const pendingCount = messages.filter((m) => !m.acknowledged).length;

    return { tierCounts, donutData, sparklineData, acknowledgedCount, pendingCount };
  }, [messages]);
}
