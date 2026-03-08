import { parseAuthStatusFromOutput } from "./provider/Layers/ProviderHealth.ts";
import { type ProcessRunResult } from "./processRunner.ts";
import { quotePosixShellArg, runSshCommand } from "./ssh.ts";

const CODEX_NPM_PACKAGE = "@openai/codex";
const REMOTE_COMMAND_CHECK_TIMEOUT_MS = 15_000;
const REMOTE_INSTALL_TIMEOUT_MS = 120_000;

export type RemoteCodexInstallMethod = "bun" | "npm";
export type RemoteCodexAuthStatus = "authenticated" | "unauthenticated" | "unknown";

export interface RemoteCodexSetupResult {
  readonly installed: boolean;
  readonly installMethod?: RemoteCodexInstallMethod;
  readonly authStatus: RemoteCodexAuthStatus;
  readonly authMessage?: string;
}

interface RemoteCodexRunnerInput {
  readonly hostAlias: string;
  readonly stateDir: string;
  readonly script: string;
  readonly timeoutMs?: number;
  readonly allowNonZeroExit?: boolean;
}

type RemoteCodexRunner = (input: RemoteCodexRunnerInput) => Promise<ProcessRunResult>;

function detailFromRemoteResult(result: ProcessRunResult): string {
  const stderr = result.stderr.trim();
  if (stderr.length > 0) {
    return stderr;
  }

  const stdout = result.stdout.trim();
  if (stdout.length > 0) {
    return stdout;
  }

  if (result.timedOut) {
    return "Command timed out.";
  }

  return `Command exited with code ${result.code ?? "null"}.`;
}

function buildRemoteScript(input: {
  readonly rootPath?: string;
  readonly command: string;
}): string {
  return input.rootPath
    ? `cd ${quotePosixShellArg(input.rootPath)}\n${input.command}`
    : input.command;
}

async function remoteCommandExists(input: {
  readonly hostAlias: string;
  readonly stateDir: string;
  readonly command: string;
  readonly runner: RemoteCodexRunner;
}): Promise<boolean> {
  const result = await input.runner({
    hostAlias: input.hostAlias,
    stateDir: input.stateDir,
    timeoutMs: REMOTE_COMMAND_CHECK_TIMEOUT_MS,
    allowNonZeroExit: true,
    script: `command -v ${quotePosixShellArg(input.command)} >/dev/null 2>&1`,
  });
  return result.code === 0;
}

async function readRemoteCodexAuthStatus(input: {
  readonly hostAlias: string;
  readonly stateDir: string;
  readonly rootPath: string;
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly runner: RemoteCodexRunner;
}): Promise<Pick<RemoteCodexSetupResult, "authStatus" | "authMessage">> {
  const envPrefix =
    input.homePath && input.homePath.trim().length > 0
      ? `export CODEX_HOME=${quotePosixShellArg(input.homePath)}\n`
      : "";
  const result = await input.runner({
    hostAlias: input.hostAlias,
    stateDir: input.stateDir,
    timeoutMs: REMOTE_COMMAND_CHECK_TIMEOUT_MS,
    allowNonZeroExit: true,
    script: buildRemoteScript({
      rootPath: input.rootPath,
      command: `${envPrefix}${quotePosixShellArg(input.binaryPath)} login status`,
    }),
  });
  const parsed = parseAuthStatusFromOutput({
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code ?? 1,
  });
  return {
    authStatus: parsed.authStatus,
    ...(parsed.message ? { authMessage: parsed.message } : {}),
  };
}

async function installRemoteCodex(input: {
  readonly hostAlias: string;
  readonly stateDir: string;
  readonly rootPath: string;
  readonly runner: RemoteCodexRunner;
}): Promise<Pick<RemoteCodexSetupResult, "installed" | "installMethod">> {
  const attempts: Array<{
    readonly method: RemoteCodexInstallMethod;
    readonly availabilityCommand: string;
    readonly installCommand: string;
  }> = [
    {
      method: "bun",
      availabilityCommand: "bun",
      installCommand: `bun i -g ${quotePosixShellArg(CODEX_NPM_PACKAGE)}`,
    },
    {
      method: "npm",
      availabilityCommand: "npm",
      installCommand: `npm i -g ${quotePosixShellArg(CODEX_NPM_PACKAGE)}`,
    },
  ];

  const failures: string[] = [];

  for (const attempt of attempts) {
    if (
      !(await remoteCommandExists({
        hostAlias: input.hostAlias,
        stateDir: input.stateDir,
        command: attempt.availabilityCommand,
        runner: input.runner,
      }))
    ) {
      failures.push(`${attempt.method}: not installed`);
      continue;
    }

    const result = await input.runner({
      hostAlias: input.hostAlias,
      stateDir: input.stateDir,
      timeoutMs: REMOTE_INSTALL_TIMEOUT_MS,
      allowNonZeroExit: true,
      script: buildRemoteScript({
        rootPath: input.rootPath,
        command: attempt.installCommand,
      }),
    });
    if (result.code === 0) {
      return {
        installed: true,
        installMethod: attempt.method,
      };
    }
    failures.push(`${attempt.method}: ${detailFromRemoteResult(result)}`);
  }

  throw new Error(
    [
      `Remote host '${input.hostAlias}' does not have 'codex' on PATH and automatic installation failed.`,
      "Tried bun i -g @openai/codex, then npm i -g @openai/codex.",
      `Details: ${failures.join(" | ")}`,
    ].join(" "),
  );
}

export async function ensureRemoteCodexAvailable(input: {
  readonly hostAlias: string;
  readonly stateDir: string;
  readonly rootPath: string;
  readonly binaryPath?: string;
  readonly homePath?: string;
  readonly checkAuthStatus?: boolean;
  readonly runner?: RemoteCodexRunner;
}): Promise<RemoteCodexSetupResult> {
  const binaryPath = input.binaryPath?.trim() || "codex";
  const runner = input.runner ?? runSshCommand;

  if (binaryPath !== "codex") {
    return input.checkAuthStatus === false
      ? { installed: false, authStatus: "unknown" }
      : {
          installed: false,
          ...(await readRemoteCodexAuthStatus({
            hostAlias: input.hostAlias,
            stateDir: input.stateDir,
            rootPath: input.rootPath,
            binaryPath,
            ...(input.homePath ? { homePath: input.homePath } : {}),
            runner,
          })),
        };
  }

  const codexPresent = await remoteCommandExists({
    hostAlias: input.hostAlias,
    stateDir: input.stateDir,
    command: "codex",
    runner,
  });

  const installation = codexPresent
    ? { installed: false }
    : await installRemoteCodex({
        hostAlias: input.hostAlias,
        stateDir: input.stateDir,
        rootPath: input.rootPath,
        runner,
      });

  const codexAvailableAfterInstall = await remoteCommandExists({
    hostAlias: input.hostAlias,
    stateDir: input.stateDir,
    command: "codex",
    runner,
  });
  if (!codexAvailableAfterInstall) {
    throw new Error(
      `Remote host '${input.hostAlias}' installed Codex but it is still not on the login shell PATH.`,
    );
  }

  if (input.checkAuthStatus === false) {
    return {
      installed: installation.installed,
      ...(installation.installMethod ? { installMethod: installation.installMethod } : {}),
      authStatus: "unknown",
    };
  }

  return {
    installed: installation.installed,
    ...(installation.installMethod ? { installMethod: installation.installMethod } : {}),
    ...(await readRemoteCodexAuthStatus({
      hostAlias: input.hostAlias,
      stateDir: input.stateDir,
      rootPath: input.rootPath,
      binaryPath,
      ...(input.homePath ? { homePath: input.homePath } : {}),
      runner,
    })),
  };
}
