import { projectLocationLabel, workspaceHandleFromLocation } from "@t3tools/shared/workspace";

import type { Project, Thread } from "../types";

export function workspaceHandleForProject(project: Project): string {
  return workspaceHandleFromLocation(project.location, project.cwd);
}

export function workspaceHandleForThread(project: Project, thread: Thread): string {
  return workspaceHandleFromLocation(project.location, thread.worktreePath ?? project.cwd);
}

export function labelForProjectLocation(project: Project): string {
  return projectLocationLabel(project.location);
}
