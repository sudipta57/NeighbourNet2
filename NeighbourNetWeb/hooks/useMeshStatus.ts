/**
 * useMeshStatus — polls the Prometheus /metrics endpoint every 60 seconds
 * to extract active node count and queue depth.
 *
 * Gateway data does not come from the backend API (the backend tracks
 * active nodes at DB level, not individual gateway health).  The MeshStatus
 * object returned here uses the Prometheus-sourced numbers for active_nodes
 * and queue_depth, while gateways remains a generated structure based on
 * unique sender_ids from the messages list (passed from the parent).
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchMetrics } from '../lib/metricsClient';
import type { MeshStatus } from '../lib/types';

const POLL_INTERVAL_MS = 60_000;

const DEFAULT_MESH_STATUS: MeshStatus = {
  active_nodes: 0,
  queue_depth: 0,
  gateways: [],
  last_sync_at: new Date().toISOString(),
  has_active_gateways: false,
};

export function useMeshStatus(): MeshStatus {
  const [status, setStatus] = useState<MeshStatus>(DEFAULT_MESH_STATUS);

  const poll = useCallback(async () => {
    const metrics = await fetchMetrics();
    setStatus((prev) => ({
      ...prev,
      active_nodes: metrics.active_nodes,
      queue_depth: metrics.queue_depth,
      last_sync_at: new Date().toISOString(),
      has_active_gateways: metrics.active_nodes > 0,
    }));
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  return status;
}
