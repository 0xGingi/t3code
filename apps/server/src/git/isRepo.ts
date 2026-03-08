import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { decodeWorkspaceHandle } from "@t3tools/shared/workspace";

import { buildRemoteExecScript, buildRemoteShellCommand, buildSshArgs } from "../ssh";

export function isGitRepository(cwd: string): boolean {
  const workspaceTarget = decodeWorkspaceHandle(cwd);
  if (workspaceTarget?.kind === "ssh") {
    const result = spawnSync(
      "ssh",
      buildSshArgs({
        hostAlias: workspaceTarget.hostAlias,
        stateDir: process.env.T3CODE_STATE_DIR ?? process.cwd(),
        remoteCommand: buildRemoteShellCommand(
          buildRemoteExecScript({
            cwd: workspaceTarget.cwd,
            command: "git",
            args: ["rev-parse", "--is-inside-work-tree"],
          }),
        ),
      }),
      {
        encoding: "utf8",
        shell: process.platform === "win32",
      },
    );
    return result.status === 0 && result.stdout.trim() === "true";
  }

  return existsSync(join(cwd, ".git"));
}
