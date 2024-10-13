import {
  defineQueue,
  defineWorker,
  JobStatus,
  ScheduledJobStatus,
} from "../src/plainjob";
import type { Job } from "../src/plainjob";
import { processAll } from "../src/worker";
import type { Connection } from "../src/queue";
import type { Expect } from "bun:test";

type Describe = (name: string, fn: () => void) => void;
type BeforeEach = (fn: () => void) => void;
type It = (name: string, fn: () => void) => void;

export function getTestSuite(
  describe: Describe,
  beforeEach: BeforeEach,
  it: It,
  expect: Expect,
  getConnection: () => Connection
) {
  describe("queue", async () => {
    let connection: Connection;

    beforeEach(() => {
      connection = getConnection();
    });

    it("should add a job to the queue", async () => {
      const queue = defineQueue({ connection });
      queue.add("paint", { color: "red" });
      const jobId = queue.getAndMarkJobAsProcessing("paint");
      if (!jobId) throw new Error("Job not found");
      const job = queue.getJobById(jobId.id);
      if (!job) throw new Error("Job not found");
      expect(JSON.parse(job.data)).toEqual({ color: "red" });
      queue.close();
    });

    it("should add multiple jobs of the same type to the queue", async () => {
      const queue = defineQueue({ connection });

      const jobData = [{ color: "red" }, { color: "green" }, { color: "blue" }];

      const { ids } = queue.addMany("paint", jobData);

      expect(ids).toHaveLength(3);

      for (let i = 0; i < ids.length; i++) {
        const job = queue.getJobById(ids[i]!);
        if (!job) throw new Error(`Job ${ids[i]} not found`);
        expect(job.type).toBe("paint");
        expect(JSON.parse(job.data)).toEqual(jobData[i]);
        expect(job.status).toBe(JobStatus.Pending);
      }

      expect(queue.countJobs({ type: "paint" })).toBe(3);

      queue.close();
    });

    it("should add a job to the queue with a custom serializer", async () => {
      const customSerializer = (data: unknown) => {
        if (typeof data === "object" && data !== null) {
          return JSON.stringify(Object.entries(data).sort());
        }
        return JSON.stringify(data);
      };

      const queue = defineQueue({
        connection,
        serializer: customSerializer,
      });

      queue.add("customSerialize", { b: 2, a: 1, c: 3 });

      const jobId = queue.getAndMarkJobAsProcessing("customSerialize");
      if (!jobId) throw new Error("Job not found");
      const job = queue.getJobById(jobId.id);
      if (!job) throw new Error("Job not found");

      expect(job.data).toBe('[["a",1],["b",2],["c",3]]');

      const parsedData = JSON.parse(job.data);
      expect(Object.fromEntries(parsedData)).toEqual({ a: 1, b: 2, c: 3 });

      queue.close();
    });

    it("should mark jobs as done or failed", async () => {
      const queue = defineQueue({ connection });
      queue.add("test", { step: 1 });
      const jobId = queue.getAndMarkJobAsProcessing("test");
      if (!jobId) throw new Error("Job not found");
      const job = queue.getJobById(jobId.id);
      if (!job) throw new Error("job not found");
      expect(job.status).toBe(JobStatus.Processing);

      queue.markJobAsDone(job.id);

      queue.add("test", { step: 2 });
      const failedJob = queue.getAndMarkJobAsProcessing("test");
      if (!failedJob) throw new Error("job not found");
      queue.markJobAsFailed(failedJob.id, "test error");
      const found = queue.getJobById(failedJob.id);
      expect(found?.status).toBe(JobStatus.Failed);
      expect(found?.error).toBe("test error");
    });

    it("should throw an error when adding a job with an invalid cron expression", () => {
      const queue = defineQueue({ connection });

      expect(() => {
        queue.schedule("invalid", { cron: "invalid cron expression" });
      }).toThrow("invalid cron expression provided");
    });

    it("should get and mark scheduled job as processing", async () => {
      const queue = defineQueue({ connection });

      queue.schedule("scheduled", { cron: "* * * * *" });

      const job = queue.getAndMarkScheduledJobAsProcessing();
      if (!job) throw new Error("Job not found");
      expect(job).toBeDefined();
      expect(job?.status).toBe(ScheduledJobStatus.Processing);

      const updatedJob = queue.getScheduledJobById(job.id);
      expect(updatedJob?.status).toBe(ScheduledJobStatus.Processing);

      queue.close();
    });

    it("should mark scheduled job as idle with next run time", async () => {
      const queue = defineQueue({ connection });

      const { id } = queue.schedule("scheduled", { cron: "* * * * * *" });

      const job = queue.getAndMarkScheduledJobAsProcessing();
      expect(job).toBeDefined();

      const nextRunAt = Date.now() + 60000; // 1 minute from now
      queue.markScheduledJobAsIdle(id, nextRunAt);

      const updatedJob = queue.getScheduledJobById(id);
      expect(updatedJob?.status).toBe(ScheduledJobStatus.Idle);
      expect(updatedJob?.nextRunAt).toBe(nextRunAt);

      queue.close();
    });

    it("should requeue timed out jobs", async () => {
      const queue = defineQueue({
        connection,
        timeout: 25,
        maintenanceInterval: 20,
      });

      const { id } = queue.add("test", { value: "timeout test" });

      const jobId = queue.getAndMarkJobAsProcessing("test");
      if (!jobId) throw new Error("Job not found");
      const job = queue.getJobById(jobId.id);
      expect(job).toBeDefined();
      expect(job?.id).toBe(id);
      expect(job?.status).toBe(JobStatus.Processing);

      await new Promise((resolve) => setTimeout(resolve, 80));

      const requeuedJob = queue.getJobById(id);
      expect(requeuedJob?.status).toBe(JobStatus.Pending);

      queue.close();
    });

    it("should remove done jobs older than specified time", async () => {
      const queue = defineQueue({
        connection,
        removeDoneJobsOlderThan: 20,
      });

      const { id: oldJobId } = queue.add("test", { value: "old job" });
      const oldJob = queue.getAndMarkJobAsProcessing("test");
      if (oldJob) queue.markJobAsDone(oldJob.id);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const { id: newJobId } = queue.add("test", { value: "new job" });
      const newJob = queue.getAndMarkJobAsProcessing("test");
      if (newJob) queue.markJobAsDone(newJob.id);

      queue.removeDoneJobs(20);

      expect(queue.getJobById(oldJobId)).toBeUndefined();
      expect(queue.getJobById(newJobId)).toBeDefined();

      queue.close();
    });

    it("should remove failed jobs older than specified time", async () => {
      const queue = defineQueue({
        connection,
        removeFailedJobsOlderThan: 20,
      });

      const { id: oldJobId } = queue.add("test", { value: "old job" });
      const oldJob = queue.getAndMarkJobAsProcessing("test");
      if (oldJob) queue.markJobAsFailed(oldJob.id, "Test error");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const { id: newJobId } = queue.add("test", { value: "new job" });
      const newJob = queue.getAndMarkJobAsProcessing("test");
      if (newJob) queue.markJobAsFailed(newJob.id, "Test error");

      queue.removeFailedJobs(20);

      expect(queue.getJobById(oldJobId)).toBeUndefined();
      expect(queue.getJobById(newJobId)).toBeDefined();

      queue.close();
    });

    it("should count jobs by type and status", async () => {
      const queue = defineQueue({ connection });

      queue.add("test1", { value: 1 });
      queue.add("test1", { value: 2 });
      queue.add("test2", { value: 3 });
      queue.add("test3", { value: 3 });

      expect(
        queue.countJobs({ type: "test1", status: JobStatus.Pending })
      ).toBe(2);
      expect(
        queue.countJobs({ type: "test2", status: JobStatus.Pending })
      ).toBe(1);
      expect(
        queue.countJobs({ type: "test1", status: JobStatus.Processing })
      ).toBe(0);
      expect(queue.countJobs({ type: "test3" })).toBe(1);
      expect(queue.countJobs({ status: JobStatus.Pending })).toBe(4);
      expect(queue.countJobs()).toBe(4);

      const job = queue.getAndMarkJobAsProcessing("test1");

      expect(
        queue.countJobs({ type: "test1", status: JobStatus.Processing })
      ).toBe(1);
      expect(
        queue.countJobs({ type: "test1", status: JobStatus.Pending })
      ).toBe(1);
      expect(queue.countJobs({ status: JobStatus.Pending })).toBe(3);

      if (job) queue.markJobAsDone(job.id);
      expect(queue.countJobs({ type: "test1", status: JobStatus.Done })).toBe(
        1
      );
      expect(queue.countJobs({ status: JobStatus.Done })).toBe(1);
      expect(queue.countJobs({ type: "test5" })).toBe(0);
      expect(queue.countJobs()).toBe(4);

      queue.close();
    });

    it("should return all scheduled jobs", async () => {
      const queue = defineQueue({ connection });

      queue.schedule("job1", { cron: "* * * * *" });
      queue.schedule("job2", { cron: "0 0 * * *" });
      queue.schedule("job3", { cron: "0 12 * * MON-FRI" });

      const scheduledJobs = queue.getScheduledJobs();

      expect(scheduledJobs).toHaveLength(3);
      expect(scheduledJobs[0]?.type).toBe("job1");
      expect(scheduledJobs[1]?.type).toBe("job2");
      expect(scheduledJobs[2]?.type).toBe("job3");
      expect(scheduledJobs[0]?.cronExpression).toBe("* * * * *");
      expect(scheduledJobs[1]?.cronExpression).toBe("0 0 * * *");
      expect(scheduledJobs[2]?.cronExpression).toBe("0 12 * * MON-FRI");

      queue.close();
    });

    it("should return an empty array when no scheduled jobs exist", async () => {
      const queue = defineQueue({ connection });

      const scheduledJobs = queue.getScheduledJobs();

      expect(scheduledJobs).toHaveLength(0);
      expect(scheduledJobs).toEqual([]);

      queue.close();
    });

    it("should return all unique job types", async () => {
      const queue = defineQueue({ connection });

      queue.add("type1", { data: "job1" });
      queue.add("type2", { data: "job2" });
      queue.add("type1", { data: "job3" });
      queue.add("type3", { data: "job4" });

      const jobTypes = queue.getJobTypes();

      expect(jobTypes).toHaveLength(3);
      expect(jobTypes).toContain("type1");
      expect(jobTypes).toContain("type2");
      expect(jobTypes).toContain("type3");

      queue.close();
    });

    it("should return an empty array when no jobs exist", async () => {
      const queue = defineQueue({ connection });

      const jobTypes = queue.getJobTypes();

      expect(jobTypes).toHaveLength(0);
      expect(jobTypes).toEqual([]);

      queue.close();
    });

    it("should call onDoneJobsRemoved when done jobs are removed", async () => {
      let removedJobs = 0;

      const queue = defineQueue({
        connection,
        removeDoneJobsOlderThan: 10,
        onDoneJobsRemoved: (n) => {
          removedJobs = n;
        },
      });

      queue.add("test", { value: "old job" });
      const job = queue.getAndMarkJobAsProcessing("test");
      if (job) queue.markJobAsDone(job.id);

      await new Promise((resolve) => setTimeout(resolve, 20));

      queue.removeDoneJobs(10);

      expect(removedJobs).toBe(1);

      queue.close();
    });

    it("should call onFailedJobsRemoved when failed jobs are removed", async () => {
      let removedJobs = 0;

      const queue = defineQueue({
        connection,
        removeFailedJobsOlderThan: 10,
        onFailedJobsRemoved: (n) => {
          removedJobs = n;
        },
      });

      queue.add("test", { value: "old job" });
      const job = queue.getAndMarkJobAsProcessing("test");
      if (job) queue.markJobAsFailed(job.id, "Test error");

      await new Promise((resolve) => setTimeout(resolve, 20));

      queue.removeFailedJobs(10);

      expect(removedJobs).toBe(1);

      queue.close();
    });

    it("should call onProcessingJobsRequeued when processing jobs are requeued", async () => {
      let requeuedJobs = 0;

      const queue = defineQueue({
        connection,
        timeout: 10,
        onProcessingJobsRequeued: (n) => {
          requeuedJobs = n;
        },
      });

      queue.add("test", { value: "timeout test" });
      queue.getAndMarkJobAsProcessing("test");

      await new Promise((resolve) => setTimeout(resolve, 20));

      queue.requeueTimedOutJobs(10);

      expect(requeuedJobs).toBe(1);

      queue.close();
    });

    it("should update an existing scheduled job when adding the same type with a different cron expression", async () => {
      const queue = defineQueue({ connection });

      const { id: initialId } = queue.schedule("updateTest", {
        cron: "0 * * * *",
      });

      const initialJob = queue.getScheduledJobById(initialId);
      expect(initialJob).toBeDefined();
      expect(initialJob?.cronExpression).toBe("0 * * * *");

      const { id: updatedId } = queue.schedule("updateTest", {
        cron: "*/30 * * * *",
      });

      expect(updatedId).toBe(initialId);

      const updatedJob = queue.getScheduledJobById(updatedId);
      expect(updatedJob).toBeDefined();
      expect(updatedJob?.cronExpression).toBe("*/30 * * * *");

      const allJobs = queue.getScheduledJobs();
      const updateTestJobs = allJobs.filter((job) => job.type === "updateTest");
      expect(updateTestJobs).toHaveLength(1);

      queue.close();
    });
  });

  describe("process (queue and worker", async () => {
    let connection: Connection;

    beforeEach(() => {
      connection = getConnection();
    });

    it("should process jobs with a worker", async () => {
      const queue = defineQueue({ connection });
      const results: unknown[] = [];
      const worker = defineWorker(
        "test",
        async (job: Job) => {
          results.push(JSON.parse(job.data));
        },
        { queue }
      );

      queue.add("test", { value: 1 });
      queue.add("test", { value: 2 });

      await processAll(queue, worker);

      expect(results).toEqual([{ value: 1 }, { value: 2 }]);
    });

    it("should process scheduled jobs", async () => {
      const queue = defineQueue({ connection });
      const results: unknown[] = [];
      const worker = defineWorker(
        "scheduled",
        async (job: Job) => {
          results.push(JSON.parse(job.data));
        },
        { queue }
      );

      queue.schedule("scheduled", { cron: "* * * * *" });

      worker.start();
      await worker.stop();

      expect(results[0]).toEqual({});
    });

    it("should add a job with id and retrieve it", async () => {
      const queue = defineQueue({ connection });

      const { id } = queue.add("paint", { color: "blue" });
      expect(id).toBeDefined();

      const job = queue.getJobById(id);
      expect(job).toBeDefined();
      expect(job?.type).toBe("paint");
      expect(JSON.parse(job?.data as string)).toEqual({ color: "blue" });

      const worker = defineWorker("paint", async (job: Job) => {}, { queue });

      await processAll(queue, worker);

      const processedJob = queue.getJobById(id);
      expect(processedJob?.status).toBe(JobStatus.Done);
      expect(processedJob?.type).toBe("paint");
    });

    it("should reprocess a job that has been stuck in processing for too long", async () => {
      const queue = defineQueue({
        connection,
        timeout: 10,
        maintenanceInterval: 40,
      });

      const { id } = queue.add("test", { value: "timeout test" });

      // simulate worker dying
      const jobId = queue.getAndMarkJobAsProcessing("test");
      if (!jobId) throw new Error("Job not found");
      const job = queue.getJobById(jobId.id);
      expect(job).toBeDefined();
      expect(job?.id).toBe(id);
      expect(job?.status).toBe(JobStatus.Processing);

      await new Promise((resolve) => setTimeout(resolve, 70));

      const results: unknown[] = [];
      const worker = defineWorker(
        "test",
        async (job: Job) => {
          results.push(JSON.parse(job.data));
        },
        { queue }
      );

      await processAll(queue, worker);

      expect(results).toEqual([{ value: "timeout test" }]);
    });

    it("should store error information when a job fails", async () => {
      const queue = defineQueue({ connection });

      const { id } = queue.add("test", { value: "error test" });

      const worker = defineWorker(
        "test",
        async (job: Job) => {
          throw new Error("test error");
        },
        { queue }
      );

      await processAll(queue, worker);

      const failedJob = queue.getJobById(id);
      expect(failedJob).toBeDefined();
      expect(failedJob?.status).toBe(JobStatus.Failed);
      expect(failedJob?.failedAt).toBeDefined();
      expect(failedJob?.failedAt).not.toBeNull();
      expect(failedJob?.error).toContain("test error");
    });

    it("should store error information when a scheduled job fails", async () => {
      const queue = defineQueue({ connection });

      const { id } = queue.schedule("paint", { cron: "* * * * * *" });

      const worker = defineWorker(
        "paint",
        async (job: Job) => {
          throw new Error("test error");
        },
        { queue }
      );

      worker.start();
      await worker.stop();

      const failedJob = queue.getJobById(id);
      expect(failedJob).toBeDefined();
      expect(failedJob?.status).toBe(JobStatus.Failed);
      expect(failedJob?.failedAt).toBeDefined();
      expect(failedJob?.error).toContain("test error");
      expect(failedJob?.failedAt).not.toBeNull();
    });

    it("should call onProcessing when a job starts processing", async () => {
      const queue = defineQueue({ connection });
      let processingCalled = false;

      const worker = defineWorker("test", async (job: Job) => {}, {
        queue,
        onProcessing: (job: Job) => {
          processingCalled = true;
        },
      });

      queue.add("test", { value: "processing test" });
      await processAll(queue, worker);

      expect(processingCalled).toBe(true);
    });

    it("should call onCompleted when a job is completed", async () => {
      const queue = defineQueue({ connection });
      let completedJob!: Job;

      const worker = defineWorker("test", async (job: Job) => {}, {
        queue,
        onCompleted: (job: Job) => {
          completedJob = job;
        },
      });

      queue.add("test", { value: "completed test" });
      await processAll(queue, worker);

      expect(JSON.parse(completedJob.data)).toEqual({
        value: "completed test",
      });
    });

    it("should call onFailed when a job fails", async () => {
      const queue = defineQueue({ connection });
      let failedJob!: Job;
      let failedError!: string;

      const worker = defineWorker(
        "test",
        async (job: Job) => {
          throw new Error("Test error");
        },
        {
          queue,
          onFailed: (job: Job, error: string) => {
            failedJob = job;
            failedError = error;
          },
        }
      );

      queue.add("test", { value: "failed test" });
      await processAll(queue, worker);

      expect(JSON.parse(failedJob.data)).toEqual({ value: "failed test" });
      expect(failedError).toContain("Test error");
    });

    it("should delay job execution", async () => {
      const queue = defineQueue({ connection });
      const results: unknown[] = [];
      const worker = defineWorker(
        "delayed",
        async (job: Job) => {
          results.push(JSON.parse(job.data));
        },
        { queue }
      );

      const delay = 20;
      const startTime = Date.now();

      queue.add("delayed", { value: "instant job" });
      queue.add("delayed", { value: "delayed job" }, { delay });

      // we have to await here for vitest
      await expect(processAll(queue, worker, { timeout: 10 })).rejects.toThrow(
        "timeout while waiting for all jobs the be processed"
      );

      expect(results.length).toBe(1);
      expect(results[0]).toEqual({ value: "instant job" });

      await new Promise((resolve) => setTimeout(resolve, delay + 40));

      await processAll(queue, worker);

      const endTime = Date.now();

      expect(results).toEqual([
        { value: "instant job" },
        {
          value: "delayed job",
        },
      ]);

      expect(endTime - startTime).toBeGreaterThanOrEqual(delay);
    });
  });
}
