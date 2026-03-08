import { Encoding } from "effect";
import { CheckpointRef, ProjectId, type ThreadId } from "@t3tools/contracts";
import { localProjectLocation, workspaceHandleFromLocation } from "@t3tools/shared/workspace";

export const CHECKPOINT_REFS_PREFIX = "refs/t3/checkpoints";

export function checkpointRefForThreadTurn(threadId: ThreadId, turnCount: number): CheckpointRef {
  return CheckpointRef.makeUnsafe(
    `${CHECKPOINT_REFS_PREFIX}/${Encoding.encodeBase64Url(threadId)}/turn/${turnCount}`,
  );
}

export function resolveThreadWorkspaceCwd(input: {
  readonly thread: {
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  };
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly workspaceRoot: string;
    readonly location?: {
      readonly kind: "local" | "ssh";
      readonly rootPath: string;
      readonly hostAlias?: string;
    };
  }>;
}): string | undefined {
  const project = input.projects.find((entry) => entry.id === input.thread.projectId);
  if (!project) {
    return undefined;
  }

  const location =
    project.location?.kind === "ssh" && project.location.hostAlias
      ? {
          kind: "ssh" as const,
          hostAlias: project.location.hostAlias,
          rootPath: project.location.rootPath,
        }
      : localProjectLocation(project.workspaceRoot);

  return workspaceHandleFromLocation(location, input.thread.worktreePath ?? project.workspaceRoot);
}
