import {
  CandidateRecord,
  JobDescriptionSignals,
  RankedCandidate,
  ScoringMode,
  SubScores
} from "../types";
import { clamp, cosineSimilarity } from "../utils/similarity";
import { normalize } from "../utils/text";
import { expandWithAliases } from "./synonyms";

const hasFuzzyMatch = (a: string, b: string): boolean => a.includes(b) || b.includes(a);

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

const matchesRequirement = (requirement: string, evidence: string[]): boolean => {
  const requirementTerms = expandWithAliases(requirement);
  for (const evidenceTerm of evidence) {
    const expandedEvidenceTerms = expandWithAliases(evidenceTerm);
    const found = requirementTerms.some((left) =>
      expandedEvidenceTerms.some((right) => hasFuzzyMatch(left, right))
    );
    if (found) {
      return true;
    }
  }
  return false;
};

const matchRequirements = (requirements: string[], evidence: string[]): string[] =>
  requirements.filter((requirement) => matchesRequirement(requirement, evidence));

const seniorityPenaltyFromYears = (
  seniorityLevel: JobDescriptionSignals["seniority_level"],
  yearsOfExperience: number | null
): number => {
  if (yearsOfExperience === null) {
    return 0;
  }

  const minimumYearsByLevel: Record<
    JobDescriptionSignals["seniority_level"],
    number
  > = {
    junior: 0,
    mid: 2,
    senior: 5,
    staff: 8,
    unknown: 0
  };

  const minimumYears = minimumYearsByLevel[seniorityLevel];
  if (seniorityLevel === "unknown" || yearsOfExperience >= minimumYears) {
    return 0;
  }

  const gap = minimumYears - yearsOfExperience;
  // Conservative penalty: small step-down by gap size to reduce false negatives.
  if (gap >= 4) {
    return -0.08;
  }
  if (gap >= 2) {
    return -0.04;
  }
  return -0.02;
};

const missingMustHavePenalty = (
  missingCount: number,
  totalMustHaves: number
): number => {
  if (missingCount === 0 || totalMustHaves === 0) {
    return 0;
  }

  const ratio = missingCount / totalMustHaves;
  // Steeper-than-linear as misses accumulate, with a strict cap.
  const curved = -0.35 * Math.pow(ratio, 1.35);
  return Math.max(curved, -0.35);
};

const createReason = (params: {
  matchedMustHaves: string[];
  missingMustHaves: string[];
  matchedNiceToHaves: string[];
  embeddingSimilarity: number;
  mode: ScoringMode;
}): string => {
  if (params.mode === "embedding_only") {
    return `Sparse JD; ranked by semantic similarity (${params.embeddingSimilarity.toFixed(2)}).`;
  }

  return `Meets ${params.matchedMustHaves.length} must-haves; missing ${params.missingMustHaves.length}. Semantic match ${params.embeddingSimilarity.toFixed(2)}. Nice-to-have matches ${params.matchedNiceToHaves.length}.`;
};

export class ScoringEngine {
  public scoreCandidates(params: {
    candidates: CandidateRecord[];
    jdSignals: JobDescriptionSignals;
    jdEmbedding: number[];
    jdSummaryEmbedding: number[];
    mode: ScoringMode;
  }): RankedCandidate[] {
    const scored = params.candidates.map((candidate) => {
      const normalizedRawResume = normalize(candidate.parsed.rawText);
      const evidence = [
        ...candidate.signals.skills.map((value) => normalize(value)),
        ...candidate.signals.titles.map((value) => normalize(value)),
        ...candidate.signals.highlights.map((value) => normalize(value)),
        normalizedRawResume
      ];

      const matchedMustHaves = matchRequirements(params.jdSignals.must_haves, evidence);
      const missingMustHaves = params.jdSignals.must_haves.filter(
        (required) => !matchedMustHaves.includes(required)
      );
      const matchedNiceToHaves = matchRequirements(
        params.jdSignals.nice_to_haves,
        evidence
      );

      const totalMustHaves = params.jdSignals.must_haves.length;
      const totalNiceToHaves = params.jdSignals.nice_to_haves.length;
      const mustHaveOverlap =
        totalMustHaves === 0 ? 0 : matchedMustHaves.length / totalMustHaves;
      const niceToHaveOverlap =
        totalNiceToHaves === 0 ? 0 : matchedNiceToHaves.length / totalNiceToHaves;
      const fullDocumentSimilarity = cosineSimilarity(
        params.jdEmbedding,
        candidate.embedding
      );
      const summarySimilarity = cosineSimilarity(
        params.jdSummaryEmbedding,
        candidate.summaryEmbedding
      );
      const embeddingSimilarity = fullDocumentSimilarity * 0.7 + summarySimilarity * 0.3;
      const mustHavePenalty = missingMustHavePenalty(
        missingMustHaves.length,
        totalMustHaves
      );
      const seniorityPenalty = seniorityPenaltyFromYears(
        params.jdSignals.seniority_level,
        candidate.signals.years_of_experience
      );

      let weightedSum = embeddingSimilarity;
      if (params.mode === "full") {
        weightedSum =
          mustHaveOverlap * 0.5 +
          embeddingSimilarity * 0.35 +
          niceToHaveOverlap * 0.15;
      }

      const finalScore = round4(
        clamp(weightedSum + mustHavePenalty + seniorityPenalty, 0, 1)
      );
      const subScores: SubScores = {
        must_have_overlap: round4(mustHaveOverlap),
        embedding_similarity: round4(embeddingSimilarity),
        nice_to_have_overlap: round4(niceToHaveOverlap),
        missing_must_have_penalty: round4(mustHavePenalty),
        seniority_misalignment_penalty: round4(seniorityPenalty)
      };

      return {
        file: candidate.parsed.fileName,
        final_score: finalScore,
        sub_scores: subScores,
        matched_must_haves: matchedMustHaves,
        missing_must_haves: missingMustHaves,
        matched_nice_to_haves: matchedNiceToHaves,
        reason: createReason({
          matchedMustHaves,
          missingMustHaves,
          matchedNiceToHaves,
          embeddingSimilarity,
          mode: params.mode
        })
      };
    });

    scored.sort((a, b) => {
      if (b.final_score !== a.final_score) {
        return b.final_score - a.final_score;
      }

      if (b.sub_scores.embedding_similarity !== a.sub_scores.embedding_similarity) {
        return b.sub_scores.embedding_similarity - a.sub_scores.embedding_similarity;
      }

      return a.file.localeCompare(b.file);
    });

    return scored.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  }
}

