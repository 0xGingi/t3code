import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { runProcess, type ProcessRunOptions, type ProcessRunResult } from "./processRunner";

const SSH_CONTROL_DIR = "ssh-control";

export function quotePosixShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function sshControlPath(stateDir: string, hostAlias: string): string {
  const digest = createHash("sha256").update(hostAlias).digest("hex").slice(0, 24);
  const controlDir = path.join(stateDir, SSH_CONTROL_DIR);
  fs.mkdirSync(controlDir, { recursive: true });
  return path.join(controlDir, `${digest}.sock`);
}

export function buildSshArgs(input: {
  hostAlias: string;
  stateDir: string;
  allocateTty?: boolean;
  remoteCommand: string;
}): ReadonlyArray<string> {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ControlMaster=auto",
    "-o",
    "ControlPersist=10m",
    "-o",
    `ControlPath=${sshControlPath(input.stateDir, input.hostAlias)}`,
  ];
  if (input.allocateTty) {
    args.push("-tt");
  }
  args.push(input.hostAlias, "--", input.remoteCommand);
  return args;
}

export function buildRemoteShellCommand(
  script: string,
  options?: {
    preferLoginShell?: boolean;
  }
): string {
  const shellFlag = options?.preferLoginShell === false ? "-c" : "-lc";
  return [
    'if [ -n "${SHELL:-}" ] && [ -x "${SHELL}" ]; then',
    '  case "${SHELL##*/}" in',
    options?.preferLoginShell === false
      ? `    *) exec "$SHELL" ${shellFlag} ${quotePosixShellArg(script)} ;;`
      : `    zsh|bash) exec "$SHELL" -ilc ${quotePosixShellArg(script)} ;;`,
    options?.preferLoginShell === false
      ? ""
      : `    *) exec "$SHELL" ${shellFlag} ${quotePosixShellArg(script)} ;;`,
    "  esac",
    "else",
    `  exec /bin/sh -c ${quotePosixShellArg(script)}`,
    "fi",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function buildRemoteExecScript(input: {
  cwd?: string;
  command: string;
  args: ReadonlyArray<string>;
  env?: NodeJS.ProcessEnv;
}): string {
  const setupParts: string[] = [];
  if (input.cwd) {
    setupParts.push(`cd ${quotePosixShellArg(input.cwd)}`);
  }
  if (input.env) {
    for (const [key, value] of Object.entries(input.env)) {
      if (value === undefined) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      setupParts.push(`export ${key}=${quotePosixShellArg(value)}`);
    }
  }
  const commandPart = [
    "exec",
    quotePosixShellArg(input.command),
    ...input.args.map((value) => quotePosixShellArg(value)),
  ].join(" ");
  return setupParts.length > 0 ? `${setupParts.join(" && ")} && ${commandPart}` : commandPart;
}

export function buildRemoteInteractiveShellScript(input: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const parts: string[] = [];
  if (input.cwd) {
    parts.push(`cd ${quotePosixShellArg(input.cwd)}`);
  }
  if (input.env) {
    for (const [key, value] of Object.entries(input.env)) {
      if (!value || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      parts.push(`export ${key}=${quotePosixShellArg(value)}`);
    }
  }
  parts.push('exec "${SHELL:-/bin/bash}" -l');
  return parts.join(" && ");
}

export async function runSshCommand(
  input: {
    hostAlias: string;
    stateDir: string;
    script: string;
  } & ProcessRunOptions,
): Promise<ProcessRunResult> {
  return runProcess(
    "ssh",
    buildSshArgs({
      hostAlias: input.hostAlias,
      stateDir: input.stateDir,
      remoteCommand: buildRemoteShellCommand(input.script),
    }),
    input,
  );
}
