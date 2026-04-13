export const jobDescriptionPrompt = `You extract structured hiring signals from a job description.
Return strict JSON with this exact schema:
{
  "must_haves": string[],
  "nice_to_haves": string[],
  "seniority_level": "junior" | "mid" | "senior" | "staff" | "unknown",
  "domain": string,
  "role_title": string
}
Rules:
- must_haves must include only hard requirements.
- nice_to_haves must include optional or bonus requirements.
- Keep arrays concise and deduplicated.
- Return JSON only.`;

export const resumePrompt = `You extract structured candidate signals from a resume.
Return strict JSON with this exact schema:
{
  "skills": string[],
  "titles": string[],
  "years_of_experience": number | null,
  "highlights": string[]
}
Rules:
- highlights max length is 3 entries.
- skills and titles must be deduplicated.
- years_of_experience should be null if not confidently inferable.
- Return JSON only.`;

