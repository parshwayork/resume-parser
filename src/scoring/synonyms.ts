import { normalize } from "../utils/text";

const SYNONYM_GROUPS: readonly string[][] = [
  ["kubernetes", "k8s"],
  ["postgresql", "postgres", "postgre"],
  ["javascript", "js"],
  ["typescript", "ts"],
  ["node.js", "nodejs", "node"],
  ["ci/cd", "cicd", "continuous integration", "continuous delivery"],
  ["amazon web services", "aws"]
];

const aliasLookup = new Map<string, readonly string[]>(
  SYNONYM_GROUPS.flatMap((group) =>
    group.map((term) => [normalize(term), group.map((value) => normalize(value))] as const)
  )
);

export const expandWithAliases = (term: string): string[] => {
  const normalized = normalize(term);
  const aliases = aliasLookup.get(normalized);
  if (!aliases) {
    return [normalized];
  }

  return Array.from(new Set([normalized, ...aliases]));
};

