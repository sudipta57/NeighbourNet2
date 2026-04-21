import { NativeModules } from 'react-native';
import { PriorityTier } from '../types/message';
import { PRIORITY_THRESHOLDS } from '../constants/priorities';

interface TriageResult {
  tier: PriorityTier;
  priority_score: number;
  similarity_scores: Record<PriorityTier, number>;
}

interface NativeOnnxResult {
  priority_tier: PriorityTier;
  priority_score: number;
  embedding?: number[];
}

interface OnnxTriageModule {
  classifyMessage(text: string): Promise<NativeOnnxResult>;
}

const { OnnxTriage } = NativeModules as {
  OnnxTriage?: OnnxTriageModule;
};

function tokenize(text: string): number[] {
  const tokens = text
    .toLowerCase()
    .split(/[\s.,!?;:()\[\]{}"'`~@#$%^&*+=|\\/<>-]+/)
    .filter(Boolean)
    .slice(0, 128);

  return tokens.map((token) => {
    let charCodeSum = 0;
    for (let index = 0; index < token.length; index += 1) {
      charCodeSum += token.charCodeAt(index);
    }
    return charCodeSum;
  });
}

function textToSimpleVector(text: string): number[] {
  const vector = Array.from({ length: 384 }, () => 0);
  const lowerText = text.toLowerCase();

  const criticalKeywords = [
    'trapped',
    'rescue',
    'emergency',
    'unconscious',
    'critical',
  ];

  const highKeywords = [
    'stranded',
    'food',
    'water',
    'family',
    'children',
    'rising',
  ];

  const lowKeywords = ['safe', 'okay', 'fine', 'checking'];

  criticalKeywords.forEach((keyword) => {
    if (lowerText.includes(keyword)) {
      for (let index = 0; index <= 10; index += 1) {
        vector[index] += 1.0;
      }
    }
  });

  highKeywords.forEach((keyword) => {
    if (lowerText.includes(keyword)) {
      for (let index = 11; index <= 20; index += 1) {
        vector[index] += 0.7;
      }
    }
  });

  lowKeywords.forEach((keyword) => {
    if (lowerText.includes(keyword)) {
      for (let index = 370; index <= 380; index += 1) {
        vector[index] += 1.0;
      }
    }
  });

  const tokenValues = tokenize(text);
  tokenValues.forEach((value, index) => {
    const targetIndex = 32 + (index % 320);
    vector[targetIndex] += value / 1000;
  });

  let magnitudeSquared = 0;
  for (let index = 0; index < vector.length; index += 1) {
    magnitudeSquared += vector[index] * vector[index];
  }

  const magnitude = Math.sqrt(magnitudeSquared);
  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

function getDefaultSimilarityScores(): Record<PriorityTier, number> {
  return {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };
}

function getThresholdAwareTier(
  bestTier: PriorityTier,
  similarityScores: Record<PriorityTier, number>
): PriorityTier {
  if (similarityScores.CRITICAL >= PRIORITY_THRESHOLDS.CRITICAL) {
    return 'CRITICAL';
  }

  if (similarityScores.HIGH >= PRIORITY_THRESHOLDS.HIGH) {
    return 'HIGH';
  }

  if (similarityScores.MEDIUM >= PRIORITY_THRESHOLDS.MEDIUM) {
    return 'MEDIUM';
  }

  return bestTier;
}

function scoreFromKeywordFallbackVector(messageVector: number[]): TriageResult {
  const similarity_scores = getDefaultSimilarityScores();
  const criticalHit = messageVector.slice(0, 11).reduce((sum, value) => sum + value, 0);
  const highHit = messageVector.slice(11, 21).reduce((sum, value) => sum + value, 0);
  const lowHit = messageVector.slice(370, 381).reduce((sum, value) => sum + value, 0);

  similarity_scores.CRITICAL = Math.min(1, Math.max(0, criticalHit));
  similarity_scores.HIGH = Math.min(1, Math.max(0, highHit));
  similarity_scores.LOW = Math.min(1, Math.max(0, lowHit));

  let tier: PriorityTier = 'LOW';
  let bestScore = similarity_scores.LOW;

  (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as PriorityTier[]).forEach((candidateTier) => {
    const candidateScore = similarity_scores[candidateTier];
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      tier = candidateTier;
    }
  });

  const thresholdAwareTier = getThresholdAwareTier(tier, similarity_scores);
  const unclamped = similarity_scores.CRITICAL + 0.7 * similarity_scores.HIGH;
  const priority_score = Math.min(1, Math.max(0, unclamped));

  return {
    tier: thresholdAwareTier,
    priority_score,
    similarity_scores,
  };
}

export async function triageMessage(text: string): Promise<TriageResult> {
  if (OnnxTriage?.classifyMessage) {
    try {
      const nativeResult = await OnnxTriage.classifyMessage(text);
      const tier = nativeResult?.priority_tier;
      const priority_score = nativeResult?.priority_score;

      if (
        (tier === 'CRITICAL' || tier === 'HIGH' || tier === 'MEDIUM' || tier === 'LOW') &&
        typeof priority_score === 'number'
      ) {
        return {
          tier,
          priority_score: Math.min(1, Math.max(0, priority_score)),
          similarity_scores: getDefaultSimilarityScores(),
        };
      }
    } catch (_error) {
      // Fall back to existing local scorer.
    }
  }

  return getKeywordFallbackScore(text);
}

export function getKeywordFallbackScore(text: string): TriageResult {
  return scoreFromKeywordFallbackVector(textToSimpleVector(text));
}

export function describeTriage(result: TriageResult): string {
  const format = (value: number) => value.toFixed(2);
  return `${result.tier} (score: ${format(result.priority_score)}) — similarity: CRITICAL=${format(
    result.similarity_scores.CRITICAL
  )}, HIGH=${format(result.similarity_scores.HIGH)}, MEDIUM=${format(
    result.similarity_scores.MEDIUM
  )}, LOW=${format(result.similarity_scores.LOW)}`;
}