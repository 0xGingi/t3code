import {
  CheckpointRef,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { checkpointRefForThreadTurn } from "../Utils.ts";
import { CheckpointDiffQueryLive } from "./CheckpointDiffQuery.ts";
import { CheckpointStore, type CheckpointStoreShape } from "../Services/CheckpointStore.ts";
import { CheckpointDiffQuery } from "../Services/CheckpointDiffQuery.ts";

function makeSnapshot(input: {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly checkpoints: ReadonlyArray<{
    readonly checkpointTurnCount: number;
    readonly checkpointRef: CheckpointRef;
    readonly diff?: string;
  }>;
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    projects: [
      {
        id: input.projectId,
        title: "Project",
        workspaceRoot: input.workspaceRoot,
        location: { kind: "local", rootPath: input.workspaceRoot },
        defaultModel: null,
        scripts: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: input.threadId,
        projectId: input.projectId,
        title: "Thread",
        model: "gpt-5-codex",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: input.worktreePath,
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:00.000Z",
          assistantMessageId: null,
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
        messages: [],
        activities: [],
        proposedPlans: [],
        checkpoints: input.checkpoints.map((checkpoint, index) => ({
          turnId: TurnId.makeUnsafe(`turn-${index + 1}`),
          checkpointTurnCount: checkpoint.checkpointTurnCount,
          checkpointRef: checkpoint.checkpointRef,
          status: "ready" as const,
          files: [],
          ...(checkpoint.diff !== undefined ? { diff: checkpoint.diff } : {}),
          assistantMessageId: null,
          completedAt: "2026-01-01T00:00:00.000Z",
        })),
        session: null,
      },
    ],
  };
}

describe("CheckpointDiffQueryLive", () => {
  it("computes diffs using canonical turn-0 checkpoint refs", async () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const threadId = ThreadId.makeUnsafe("thread-1");
    const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
    const hasCheckpointRefCalls: Array<CheckpointRef> = [];
    const diffCheckpointsCalls: Array<{
      readonly fromCheckpointRef: CheckpointRef;
      readonly toCheckpointRef: CheckpointRef;
      readonly cwd: string;
    }> = [];

    const snapshot = makeSnapshot({
      projectId,
      threadId,
      workspaceRoot: "/tmp/workspace",
      worktreePath: null,
      checkpoints: [
        {
          checkpointTurnCount: 1,
          checkpointRef: toCheckpointRef,
        },
      ],
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: ({ checkpointRef }) =>
        Effect.sync(() => {
          hasCheckpointRefCalls.push(checkpointRef);
          return true;
        }),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd }) =>
        Effect.sync(() => {
          diffCheckpointsCalls.push({ fromCheckpointRef, toCheckpointRef, cwd });
          return "diff patch";
        }),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getSnapshot: () => Effect.succeed(snapshot),
        }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer)),
    );

    const expectedFromRef = checkpointRefForThreadTurn(threadId, 0);
    expect(hasCheckpointRefCalls).toEqual([expectedFromRef, toCheckpointRef]);
    expect(diffCheckpointsCalls).toEqual([
      {
        cwd: "/tmp/workspace",
        fromCheckpointRef: expectedFromRef,
        toCheckpointRef,
      },
    ]);
    expect(result).toEqual({
      threadId,
      fromTurnCount: 0,
      toTurnCount: 1,
      diff: "diff patch",
    });
  });

  it("fails when the thread is missing from the snapshot", async () => {
    const threadId = ThreadId.makeUnsafe("thread-missing");

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(true),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.succeed(""),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getSnapshot: () =>
            Effect.succeed({
              snapshotSequence: 0,
              projects: [],
              threads: [],
              updatedAt: "2026-01-01T00:00:00.000Z",
            } satisfies OrchestrationReadModel),
        }),
      ),
    );

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const query = yield* CheckpointDiffQuery;
          return yield* query.getTurnDiff({
            threadId,
            fromTurnCount: 0,
            toTurnCount: 1,
          });
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow("Thread 'thread-missing' not found.");
  });

  it("falls back to concatenated projected diffs for full-thread diffs when checkpoint refs are unavailable", async () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const threadId = ThreadId.makeUnsafe("thread-1");

    const snapshot = makeSnapshot({
      projectId,
      threadId,
      workspaceRoot: "/tmp/workspace",
      worktreePath: null,
      checkpoints: [
        {
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.makeUnsafe("provider-diff:turn-1"),
          diff: "diff --git a/README.md b/README.md\n+turn1\n",
        },
        {
          checkpointTurnCount: 2,
          checkpointRef: CheckpointRef.makeUnsafe("provider-diff:turn-2"),
          diff: "diff --git a/README.md b/README.md\n+turn2\n",
        },
      ],
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(false),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.succeed(""),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getSnapshot: () => Effect.succeed(snapshot),
        }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getFullThreadDiff({
          threadId,
          toTurnCount: 2,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({
      threadId,
      fromTurnCount: 0,
      toTurnCount: 2,
      diff: "diff --git a/README.md b/README.md\n+turn1\n\ndiff --git a/README.md b/README.md\n+turn2\n",
    });
  });

  it("uses available projected diffs for full-thread diffs when earlier projected diffs are missing", async () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const threadId = ThreadId.makeUnsafe("thread-1");

    const snapshot = makeSnapshot({
      projectId,
      threadId,
      workspaceRoot: "/tmp/workspace",
      worktreePath: null,
      checkpoints: [
        {
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.makeUnsafe("provider-diff:turn-1"),
        },
        {
          checkpointTurnCount: 2,
          checkpointRef: CheckpointRef.makeUnsafe("provider-diff:turn-2"),
          diff: "diff --git a/README.md b/README.md\n+turn2\n",
        },
      ],
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(false),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.succeed(""),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getSnapshot: () => Effect.succeed(snapshot),
        }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getFullThreadDiff({
          threadId,
          toTurnCount: 2,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({
      threadId,
      fromTurnCount: 0,
      toTurnCount: 2,
      diff: "diff --git a/README.md b/README.md\n+turn2\n",
    });
  });
});
