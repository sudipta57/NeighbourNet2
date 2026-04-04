
export const PRIORITY_THRESHOLDS = {
  CRITICAL: 0.85,
  HIGH: 0.65,
  MEDIUM: 0.40,
};

export const PRIORITY_COLORS = {
  CRITICAL: '#C62828',
  HIGH: '#E65100',
  MEDIUM: '#00796B',
  LOW: '#546E7A',
};

export const PRIORITY_LABELS = {
  CRITICAL: 'Critical Emergency',
  HIGH: 'High Priority',
  MEDIUM: 'Medium Priority',
  LOW: 'Low Priority',
};

export const MAX_QUEUE_SIZE = 500;
export const INITIAL_TTL = 10;

export const API_BASE_URL = 'https://towardly-celena-unspectacled.ngrok-free.dev';
export const SYNC_CHUNK_SIZE = 50;
export const SYNC_MAX_RETRIES = 3;
