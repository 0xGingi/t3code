/**
 * CheckpointStoreLive - Filesystem checkpoint store adapter layer.
 *
 * Implements hidden Git-ref checkpoint capture/restore directly with
 * Effect-native child process execution (`effect/unstable/process`).
 *
 * This layer owns filesystem/Git interactions only; it does not persist
 * checkpoint metadata and does not coordinate provider rollback semantics.
 *
 * @module CheckpointStoreLive
 */
import { randomUUID } from "node:crypto";

import { decodeWorkspaceHandle } from "@t3tools/shared/workspace";
import { Effect, Layer, FileSystem, Path } from "effect";

import { CheckpointInvariantError } from "../Errors.ts";
import { GitCommandError } from "../../git/Errors.ts";
import { GitServiceLive } from "../../git/Layers/GitService.ts";
import { GitService } from "../../git/Services/GitService.ts";
import { CheckpointStore, type CheckpointStoreShape } from "../Services/CheckpointStore.ts";
import { CheckpointRef } from "@t3tools/contracts";
import { quotePosixShellArg, runSshCommand } from "../../ssh.ts";

const makeCheckpointStore = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitService;

  const resolveHeadCommit = (cwd: string): Effect.Effect<string | null, GitCommandError> =>
    git
      .execute({
        operation: "CheckpointStore.resolveHeadCommit",
        cwd,
        args: ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => {
          if (result.code !== 0) {
            return null;
          }
          const commit = result.stdout.trim();
          return commit.length > 0 ? commit : null;
        }),
      );

  const hasHeadCommit = (cwd: string): Effect.Effect<boolean, GitCommandError> =>
    git
      .execute({
        operation: "CheckpointStore.hasHeadCommit",
        cwd,
        args: ["rev-parse", "--verify", "HEAD"],
        allowNonZeroExit: true,
      })
      .pipe(Effect.map((result) => result.code === 0));

  const resolveCheckpointCommit = (
    cwd: string,
    checkpointRef: CheckpointRef,
  ): Effect.Effect<string | null, GitCommandError> =>
    git
      .execute({
        operation: "CheckpointStore.resolveCheckpointCommit",
        cwd,
        args: ["rev-parse", "--verify", "--quiet", `${checkpointRef}^{commit}`],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => {
          if (result.code !== 0) {
            return null;
          }
          const commit = result.stdout.trim();
          return commit.length > 0 ? commit : null;
        }),
      );

  const isGitRepository: CheckpointStoreShape["isGitRepository"] = (cwd) =>
    git
      .execute({
        operation: "CheckpointStore.isGitRepository",
        cwd,
        args: ["rev-parse", "--is-inside-work-tree"],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => result.code === 0 && result.stdout.trim() === "true"),
        Effect.catch(() => Effect.succeed(false)),
      );

  const captureCheckpoint: CheckpointStoreShape["captureCheckpoint"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.captureCheckpoint";
      const workspaceTarget = decodeWorkspaceHandle(input.cwd);

      if (workspaceTarget?.kind === "ssh") {
        const message = `t3 checkpoint ref=${input.checkpointRef}`;
        const remoteIndexName = `index-${randomUUID()}`;

        yield* Effect.tryPromise({
          try: () =>
            runSshCommand({
              hostAlias: workspaceTarget.hostAlias,
              stateDir: process.env.T3CODE_STATE_DIR ?? process.cwd(),
              script: [
                "set -e",
                `cd ${quotePosixShellArg(workspaceTarget.cwd)}`,
                'temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/t3-fs-checkpoint-XXXXXX")',
                `trap 'rm -rf "$temp_dir"' EXIT`,
                `export GIT_INDEX_FILE="$temp_dir/${remoteIndexName}"`,
                `export GIT_AUTHOR_NAME=${quotePosixShellArg("T3 Code")}`,
                `export GIT_AUTHOR_EMAIL=${quotePosixShellArg("t3code@users.noreply.github.com")}`,
                `export GIT_COMMITTER_NAME=${quotePosixShellArg("T3 Code")}`,
                `export GIT_COMMITTER_EMAIL=${quotePosixShellArg("t3code@users.noreply.github.com")}`,
                "if git rev-parse --verify HEAD >/dev/null 2>&1; then",
                "  git read-tree HEAD",
                "fi",
                "git add -A -- .",
                'tree_oid=$(git write-tree)',
                'if [ -z "$tree_oid" ]; then echo "git write-tree returned an empty tree oid." >&2; exit 1; fi',
                `commit_oid=$(git commit-tree "$tree_oid" -m ${quotePosixShellArg(message)})`,
                'if [ -z "$commit_oid" ]; then echo "git commit-tree returned an empty commit oid." >&2; exit 1; fi',
                `git update-ref ${quotePosixShellArg(input.checkpointRef)} "$commit_oid"`,
              ].join("\n"),
            }),
          catch: (cause) =>
            new GitCommandError({
              operation,
              command: "git checkpoint capture",
              cwd: input.cwd,
              detail:
                cause instanceof Error ? cause.message : "Failed to capture remote checkpoint.",
              ...(cause !== undefined ? { cause } : {}),
            }),
        });
        return;
      }

      yield* Effect.acquireUseRelease(
        fs.makeTempDirectory({ prefix: "t3-fs-checkpoint-" }),
        (tempDir) =>
          Effect.gen(function* () {
            const tempIndexPath = path.join(tempDir, `index-${randomUUID()}`);
            const commitEnv: NodeJS.ProcessEnv = {
              ...process.env,
              GIT_INDEX_FILE: tempIndexPath,
              GIT_AUTHOR_NAME: "T3 Code",
              GIT_AUTHOR_EMAIL: "t3code@users.noreply.github.com",
              GIT_COMMITTER_NAME: "T3 Code",
              GIT_COMMITTER_EMAIL: "t3code@users.noreply.github.com",
            };

            const headExists = yield* hasHeadCommit(input.cwd);
            if (headExists) {
              yield* git.execute({
                operation,
                cwd: input.cwd,
                args: ["read-tree", "HEAD"],
                env: commitEnv,
              });
            }

            yield* git.execute({
              operation,
              cwd: input.cwd,
              args: ["add", "-A", "--", "."],
              env: commitEnv,
            });

            const writeTreeResult = yield* git.execute({
              operation,
              cwd: input.cwd,
              args: ["write-tree"],
              env: commitEnv,
            });
            const treeOid = writeTreeResult.stdout.trim();
            if (treeOid.length === 0) {
              return yield* new GitCommandError({
                operation,
                command: "git write-tree",
                cwd: input.cwd,
                detail: "git write-tree returned an empty tree oid.",
              });
            }

            const message = `t3 checkpoint ref=${input.checkpointRef}`;
            const commitTreeResult = yield* git.execute({
              operation,
              cwd: input.cwd,
              args: ["commit-tree", treeOid, "-m", message],
              env: commitEnv,
            });
            const commitOid = commitTreeResult.stdout.trim();
            if (commitOid.length === 0) {
              return yield* new GitCommandError({
                operation,
                command: "git commit-tree",
                cwd: input.cwd,
                detail: "git commit-tree returned an empty commit oid.",
              });
            }

            yield* git.execute({
              operation,
              cwd: input.cwd,
              args: ["update-ref", input.checkpointRef, commitOid],
            });
          }),
        (tempDir) => fs.remove(tempDir, { recursive: true }),
      ).pipe(
        Effect.catchTags({
          PlatformError: (error) =>
            Effect.fail(
              new CheckpointInvariantError({
                operation: "CheckpointStore.captureCheckpoint",
                detail: "Failed to capture checkpoint.",
                cause: error,
              }),
            ),
        }),
      );
    });

  const hasCheckpointRef: CheckpointStoreShape["hasCheckpointRef"] = (input) =>
    resolveCheckpointCommit(input.cwd, input.checkpointRef).pipe(
      Effect.map((commit) => commit !== null),
    );

  const restoreCheckpoint: CheckpointStoreShape["restoreCheckpoint"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.restoreCheckpoint";

      let commitOid = yield* resolveCheckpointCommit(input.cwd, input.checkpointRef);

      if (!commitOid && input.fallbackToHead === true) {
        commitOid = yield* resolveHeadCommit(input.cwd);
      }

      if (!commitOid) {
        return false;
      }

      yield* git.execute({
        operation,
        cwd: input.cwd,
        args: ["restore", "--source", commitOid, "--worktree", "--staged", "--", "."],
      });
      yield* git.execute({
        operation,
        cwd: input.cwd,
        args: ["clean", "-fd", "--", "."],
      });

      const headExists = yield* hasHeadCommit(input.cwd);
      if (headExists) {
        yield* git.execute({
          operation,
          cwd: input.cwd,
          args: ["reset", "--quiet", "--", "."],
        });
      }

      return true;
    });

  const diffCheckpoints: CheckpointStoreShape["diffCheckpoints"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.diffCheckpoints";

      let fromCommitOid = yield* resolveCheckpointCommit(input.cwd, input.fromCheckpointRef);
      const toCommitOid = yield* resolveCheckpointCommit(input.cwd, input.toCheckpointRef);

      if (!fromCommitOid && input.fallbackFromToHead === true) {
        const headCommit = yield* resolveHeadCommit(input.cwd);
        if (headCommit) {
          fromCommitOid = headCommit;
        }
      }

      if (!fromCommitOid || !toCommitOid) {
        return yield* new GitCommandError({
          operation,
          command: "git diff",
          cwd: input.cwd,
          detail: "Checkpoint ref is unavailable for diff operation.",
        });
      }

      const result = yield* git.execute({
        operation,
        cwd: input.cwd,
        args: ["diff", "--patch", "--minimal", "--no-color", fromCommitOid, toCommitOid],
      });

      return result.stdout;
    });

  const deleteCheckpointRefs: CheckpointStoreShape["deleteCheckpointRefs"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.deleteCheckpointRefs";

      yield* Effect.forEach(
        input.checkpointRefs,
        (checkpointRef) =>
          git.execute({
            operation,
            cwd: input.cwd,
            args: ["update-ref", "-d", checkpointRef],
            allowNonZeroExit: true,
          }),
        { discard: true },
      );
    });

  return {
    isGitRepository,
    captureCheckpoint,
    hasCheckpointRef,
    restoreCheckpoint,
    diffCheckpoints,
    deleteCheckpointRefs,
  } satisfies CheckpointStoreShape;
});

export const CheckpointStoreLive = Layer.effect(CheckpointStore, makeCheckpointStore).pipe(
  Layer.provideMerge(GitServiceLive),
);
