export enum JobStatus {
  Pending = 0,
  Processing = 1,
  Done = 2,
  Failed = 3,
}

export type PersistedJob = {
  id: number;
  type: string;
  data: string;
  status: JobStatus;
  createdAt: number;
  nextRun?: number;
  failedAt?: number;
  error?: string;
};

export enum ScheduledJobStatus {
  Idle = 0,
  Processing = 1,
}

export type PersistedScheduledJob = {
  id: number;
  type: string;
  status: ScheduledJobStatus;
  createdAt: number;
  cronExpression: string;
  nextRun: number;
};

export type Job = {
  id: number;
  type: string;
  data: string;
};

export type Logger = {
  error(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
};
