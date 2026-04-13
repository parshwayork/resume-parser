import { JobRecord, JobStatus, RankedOutput } from "../types";

const jobs = new Map<string, JobRecord>();

export const createJob = (runId: string): JobRecord => {
  const record: JobRecord = {
    runId,
    status: "queued",
    createdAt: new Date().toISOString()
  };
  jobs.set(runId, record);
  return record;
};

export const getJob = (runId: string): JobRecord | undefined => jobs.get(runId);

export const updateJobStatus = (
  runId: string,
  status: JobStatus,
  options?: { result?: RankedOutput; error?: string }
): void => {
  const current = jobs.get(runId);
  if (!current) {
    return;
  }

  const nextRecord: JobRecord = {
    ...current,
    status,
    ...(options?.result ? { result: options.result } : {}),
    ...(options?.error ? { error: options.error } : {}),
    ...(status === "completed" || status === "failed"
      ? { completedAt: new Date().toISOString() }
      : {})
  };

  jobs.set(runId, nextRecord);
};

