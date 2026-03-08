import type { ProjectLocation } from "@t3tools/contracts";

const SSH_WORKSPACE_HANDLE_PREFIX = "t3ssh://";

export interface LocalWorkspaceTarget {
  readonly kind: "local";
  readonly cwd: string;
}

export interface SshWorkspaceTarget {
  readonly kind: "ssh";
  readonly hostAlias: string;
  readonly cwd: string;
}

export type WorkspaceTarget = LocalWorkspaceTarget | SshWorkspaceTarget;

export function localProjectLocation(rootPath: string): ProjectLocation {
  return {
    kind: "local",
    rootPath,
  };
}

export function projectRootPath(location: ProjectLocation): string {
  return location.rootPath;
}

export function projectLocationLabel(location: ProjectLocation): string {
  return location.kind === "ssh" ? `${location.hostAlias}:${location.rootPath}` : location.rootPath;
}

export function workspaceHandleFromLocation(
  location: ProjectLocation,
  cwd: string = location.rootPath,
): string {
  return encodeWorkspaceHandle(
    location.kind === "ssh"
      ? { kind: "ssh", hostAlias: location.hostAlias, cwd }
      : { kind: "local", cwd },
  );
}

export function encodeWorkspaceHandle(target: WorkspaceTarget): string {
  if (target.kind === "local") {
    return target.cwd;
  }
  return `${SSH_WORKSPACE_HANDLE_PREFIX}${encodeURIComponent(target.hostAlias)}${target.cwd}`;
}

export function decodeWorkspaceHandle(handle: string): WorkspaceTarget | null {
  if (!handle.startsWith(SSH_WORKSPACE_HANDLE_PREFIX)) {
    return handle.trim().length > 0 ? { kind: "local", cwd: handle } : null;
  }

  const encoded = handle.slice(SSH_WORKSPACE_HANDLE_PREFIX.length);
  const separatorIndex = encoded.indexOf("/");
  if (separatorIndex <= 0) {
    return null;
  }

  const hostAlias = decodeURIComponent(encoded.slice(0, separatorIndex));
  const cwd = encoded.slice(separatorIndex);
  if (hostAlias.trim().length === 0 || cwd.trim().length === 0 || !cwd.startsWith("/")) {
    return null;
  }

  return {
    kind: "ssh",
    hostAlias,
    cwd,
  };
}

export function isSshWorkspaceHandle(handle: string): boolean {
  return handle.startsWith(SSH_WORKSPACE_HANDLE_PREFIX);
}
