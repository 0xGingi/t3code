import {
  CheckpointRef,
  OrchestrationGetTurnDiffResult,
  ThreadId,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationGetTurnDiffResult as OrchestrationGetTurnDiffResultType,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { CheckpointInvariantError, CheckpointUnavailableError } from "../Errors.ts";
import { checkpointRefForThreadTurn, resolveThreadWorkspaceCwd } from "../Utils.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import {
  CheckpointDiffQuery,
  type CheckpointDiffQueryShape,
} from "../Services/CheckpointDiffQuery.ts";

const isTurnDiffResult = Schema.is(OrchestrationGetTurnDiffResult);

function buildProjectedDiffFallback(input: {
  readonly thread: {
    readonly checkpoints: ReadonlyArray<{
      readonly checkpointTurnCount: number;
      readonly diff?: string | undefined;
    }>;
  };
  readonly fromTurnCount: number;
  readonly toTurnCount: number;
}) {
  if (input.toTurnCount <= input.fromTurnCount) {
    return null;
  }

  if (input.fromTurnCount + 1 === input.toTurnCount) {
    const exactCheckpoint = input.thread.checkpoints.find(
      (checkpoint) => checkpoint.checkpointTurnCount === input.toTurnCount,
    );
    const exactSourceDiff = exactCheckpoint?.diff;
    const exactDiff = exactSourceDiff?.trim();
    return exactDiff && exactDiff.length > 0 ? exactSourceDiff ?? null : null;
  }

  if (input.fromTurnCount !== 0) {
    return null;
  }

  const diffs: string[] = [];
  for (let turnCount = 1; turnCount <= input.toTurnCount; turnCount += 1) {
    const checkpoint = input.thread.checkpoints.find(
      (entry) => entry.checkpointTurnCount === turnCount,
    );
    const sourceDiff = checkpoint?.diff;
    const diff = sourceDiff?.trim();
    if (!diff || diff.length === 0) {
      continue;
    }
    diffs.push(sourceDiff ?? diff);
  }

  return diffs.length > 0 ? diffs.join("\n") : null;
}

const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const checkpointStore = yield* CheckpointStore;

  const resolveAvailableFromCheckpointRef = Effect.fnUntraced(function* (input: {
    readonly cwd: string;
    readonly threadId: ThreadId;
    readonly thread: {
      readonly checkpoints: ReadonlyArray<{
        readonly checkpointTurnCount: number;
        readonly checkpointRef: CheckpointRef;
      }>;
    };
    readonly fromTurnCount: number;
  }) {
    const candidateRefs =
      input.fromTurnCount === 0
        ? [checkpointRefForThreadTurn(input.threadId, 0)]
        : [
            ...input.thread.checkpoints
              .filter((checkpoint) => checkpoint.checkpointTurnCount <= input.fromTurnCount)
              .toSorted((left, right) => right.checkpointTurnCount - left.checkpointTurnCount)
              .flatMap((checkpoint) => [
                checkpoint.checkpointRef,
                checkpointRefForThreadTurn(input.threadId, checkpoint.checkpointTurnCount),
              ]),
            checkpointRefForThreadTurn(input.threadId, 0),
          ];
    const dedupedCandidateRefs = [...new Set(candidateRefs)];

    for (const checkpointRef of dedupedCandidateRefs) {
      const exists = yield* checkpointStore.hasCheckpointRef({
        cwd: input.cwd,
        checkpointRef,
      });
      if (exists) {
        return checkpointRef;
      }
    }

    return null;
  });

  const getTurnDiff: CheckpointDiffQueryShape["getTurnDiff"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointDiffQuery.getTurnDiff";

      if (input.fromTurnCount === input.toTurnCount) {
        const emptyDiff: OrchestrationGetTurnDiffResultType = {
          threadId: input.threadId,
          fromTurnCount: input.fromTurnCount,
          toTurnCount: input.toTurnCount,
          diff: "",
        };
        if (!isTurnDiffResult(emptyDiff)) {
          return yield* new CheckpointInvariantError({
            operation,
            detail: "Computed turn diff result does not satisfy contract schema.",
          });
        }
        return emptyDiff;
      }

      const snapshot = yield* projectionSnapshotQuery.getSnapshot();
      const thread = snapshot.threads.find((entry) => entry.id === input.threadId);
      if (!thread) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Thread '${input.threadId}' not found.`,
        });
      }

      const maxTurnCount = thread.checkpoints.reduce(
        (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
        0,
      );
      if (input.toTurnCount > maxTurnCount) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Turn diff range exceeds current turn count: requested ${input.toTurnCount}, current ${maxTurnCount}.`,
        });
      }

      const workspaceCwd = resolveThreadWorkspaceCwd({
        thread,
        projects: snapshot.projects,
      });
      if (!workspaceCwd) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Workspace path missing for thread '${input.threadId}' when computing turn diff.`,
        });
      }

      const fromCheckpointRef = yield* resolveAvailableFromCheckpointRef({
        cwd: workspaceCwd,
        threadId: input.threadId,
        thread,
        fromTurnCount: input.fromTurnCount,
      });
      const projectedToCheckpointRef = thread.checkpoints.find(
        (checkpoint) => checkpoint.checkpointTurnCount === input.toTurnCount,
      )?.checkpointRef;
      const candidateToCheckpointRefs = [
        ...(projectedToCheckpointRef ? [projectedToCheckpointRef] : []),
        checkpointRefForThreadTurn(input.threadId, input.toTurnCount),
      ];
      const toCheckpointRef = (
        yield* Effect.findFirst(candidateToCheckpointRefs, (checkpointRef) =>
          checkpointStore.hasCheckpointRef({
            cwd: workspaceCwd,
            checkpointRef,
          }),
        )
      ).pipe((option) => (option._tag === "Some" ? option.value : null));

      const projectedDiffFallback = buildProjectedDiffFallback({
        thread,
        fromTurnCount: input.fromTurnCount,
        toTurnCount: input.toTurnCount,
      });

      if (!fromCheckpointRef || !toCheckpointRef) {
        if (projectedDiffFallback !== null) {
          const turnDiff: OrchestrationGetTurnDiffResultType = {
            threadId: input.threadId,
            fromTurnCount: input.fromTurnCount,
            toTurnCount: input.toTurnCount,
            diff: projectedDiffFallback,
          };
          if (!isTurnDiffResult(turnDiff)) {
            return yield* new CheckpointInvariantError({
              operation,
              detail: "Projected turn diff fallback does not satisfy contract schema.",
            });
          }
          return turnDiff;
        }

        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: !fromCheckpointRef ? input.fromTurnCount : input.toTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${!fromCheckpointRef ? input.fromTurnCount : input.toTurnCount}.`,
        });
      }

      const diff = yield* checkpointStore.diffCheckpoints({
        cwd: workspaceCwd,
        fromCheckpointRef,
        toCheckpointRef,
        fallbackFromToHead: false,
      });

      const turnDiff: OrchestrationGetTurnDiffResultType = {
        threadId: input.threadId,
        fromTurnCount: input.fromTurnCount,
        toTurnCount: input.toTurnCount,
        diff,
      };
      if (!isTurnDiffResult(turnDiff)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: "Computed turn diff result does not satisfy contract schema.",
        });
      }

      return turnDiff;
    });

  const getFullThreadDiff: CheckpointDiffQueryShape["getFullThreadDiff"] = (
    input: OrchestrationGetFullThreadDiffInput,
  ) =>
    getTurnDiff({
      threadId: input.threadId,
      fromTurnCount: 0,
      toTurnCount: input.toTurnCount,
    }).pipe(Effect.map((result): OrchestrationGetFullThreadDiffResult => result));

  return {
    getTurnDiff,
    getFullThreadDiff,
  } satisfies CheckpointDiffQueryShape;
});

export const CheckpointDiffQueryLive = Layer.effect(CheckpointDiffQuery, make);
