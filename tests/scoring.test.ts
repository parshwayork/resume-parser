import { describe, expect, it } from "vitest";
import { ScoringEngine } from "../src/scoring/ScoringEngine";
import { CandidateRecord, JobDescriptionSignals } from "../src/types";

const candidate = (name: string, skills: string[], embedding: number[]): CandidateRecord => ({
  parsed: {
    fileName: name,
    filePath: name,
    rawText: "Node.js PostgreSQL Redis Backend Engineer",
    sha256: name,
    wasTruncated: false,
    warnings: []
  },
  signals: {
    skills,
    titles: [],
    years_of_experience: null,
    highlights: []
  },
  embedding,
  summaryEmbedding: embedding
});

describe("scoring engine", () => {
  it("scores with full mode and orders by final score", () => {
    const engine = new ScoringEngine();
    const jdSignals: JobDescriptionSignals = {
      role_title: "Backend Engineer",
      domain: "backend",
      seniority_level: "mid",
      must_haves: ["Node.js", "PostgreSQL"],
      nice_to_haves: ["Redis"]
    };

    const result = engine.scoreCandidates({
      candidates: [
        candidate("alice.pdf", ["Node.js", "PostgreSQL", "Redis"], [1, 0]),
        candidate("bob.pdf", ["Node.js"], [0.8, 0.2])
      ],
      jdSignals,
      jdEmbedding: [1, 0],
      jdSummaryEmbedding: [1, 0],
      mode: "full"
    });

    expect(result[0].file).toBe("alice.pdf");
    expect(result[0].final_score).toBeGreaterThan(result[1].final_score);
  });

  it("uses embedding_only mode when configured", () => {
    const engine = new ScoringEngine();
    const jdSignals: JobDescriptionSignals = {
      role_title: "Engineer",
      domain: "general",
      seniority_level: "unknown",
      must_haves: [],
      nice_to_haves: []
    };

    const result = engine.scoreCandidates({
      candidates: [candidate("alice.pdf", ["Node.js"], [1, 0])],
      jdSignals,
      jdEmbedding: [1, 0],
      jdSummaryEmbedding: [1, 0],
      mode: "embedding_only"
    });

    expect(result[0].sub_scores.must_have_overlap).toBe(0);
    expect(result[0].sub_scores.nice_to_have_overlap).toBe(0);
  });

  it("matches must-haves via aliases and non-skill evidence sources", () => {
    const engine = new ScoringEngine();
    const jdSignals: JobDescriptionSignals = {
      role_title: "Platform Engineer",
      domain: "platform",
      seniority_level: "mid",
      must_haves: ["Kubernetes", "PostgreSQL"],
      nice_to_haves: []
    };

    const candidateWithAliases: CandidateRecord = {
      parsed: {
        fileName: "alias.pdf",
        filePath: "alias.pdf",
        rawText: "Built APIs on Postgres and scaled clusters.",
        sha256: "alias",
        wasTruncated: false,
        warnings: []
      },
      signals: {
        skills: [],
        titles: ["K8s Platform Engineer"],
        years_of_experience: 4,
        highlights: ["Maintained k8s production workloads"]
      },
      embedding: [1, 0],
      summaryEmbedding: [1, 0]
    };

    const result = engine.scoreCandidates({
      candidates: [candidateWithAliases],
      jdSignals,
      jdEmbedding: [1, 0],
      jdSummaryEmbedding: [1, 0],
      mode: "full"
    });

    expect(result[0].matched_must_haves).toEqual(["Kubernetes", "PostgreSQL"]);
    expect(result[0].missing_must_haves).toEqual([]);
  });

  it("applies seniority misalignment penalty when years are clearly low", () => {
    const engine = new ScoringEngine();
    const jdSignals: JobDescriptionSignals = {
      role_title: "Staff Engineer",
      domain: "backend",
      seniority_level: "staff",
      must_haves: [],
      nice_to_haves: []
    };

    const result = engine.scoreCandidates({
      candidates: [candidate("junior.pdf", ["Node.js"], [1, 0])].map((entry) => ({
        ...entry,
        signals: { ...entry.signals, years_of_experience: 2 }
      })),
      jdSignals,
      jdEmbedding: [1, 0],
      jdSummaryEmbedding: [1, 0],
      mode: "embedding_only"
    });

    expect(result[0].sub_scores.seniority_misalignment_penalty).toBeLessThan(0);
  });
});

