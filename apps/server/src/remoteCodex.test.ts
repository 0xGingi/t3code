import { describe, expect, it } from "vitest";

import { ensureRemoteCodexAvailable } from "./remoteCodex.ts";
import type { ProcessRunResult } from "./processRunner.ts";

function result(input: Partial<ProcessRunResult> = {}): ProcessRunResult {
  return {
    stdout: "",
    stderr: "",
    code: 0,
    signal: null,
    timedOut: false,
    ...input,
  };
}

describe("ensureRemoteCodexAvailable", () => {
  it("installs codex with bun before npm", async () => {
    let codexInstalled = false;
    const runner = async (input: {
      readonly script: string;
    }): Promise<ProcessRunResult> => {
      if (input.script.includes("command -v 'codex'")) {
        return result({ code: codexInstalled ? 0 : 1 });
      }
      if (input.script.includes("command -v 'bun'")) {
        return result({ code: 0 });
      }
      if (input.script.includes("bun i -g '@openai/codex'")) {
        codexInstalled = true;
        return result({ code: 0 });
      }
      if (input.script.includes("login status")) {
        return result({ code: 0, stdout: "Logged in\n" });
      }
      return result({ code: 1, stderr: `Unexpected script: ${input.script}` });
    };

    const setup = await ensureRemoteCodexAvailable({
      hostAlias: "devbox",
      stateDir: "/tmp/state",
      rootPath: "/workspace",
      runner,
    });

    expect(setup).toEqual({
      installed: true,
      installMethod: "bun",
      authStatus: "authenticated",
    });
  });

  it("falls back to npm when bun install fails", async () => {
    let codexInstalled = false;
    const runner = async (input: {
      readonly script: string;
    }): Promise<ProcessRunResult> => {
      if (input.script.includes("command -v 'codex'")) {
        return result({ code: codexInstalled ? 0 : 1 });
      }
      if (input.script.includes("command -v 'bun'")) {
        return result({ code: 0 });
      }
      if (input.script.includes("command -v 'npm'")) {
        return result({ code: 0 });
      }
      if (input.script.includes("bun i -g '@openai/codex'")) {
        return result({ code: 1, stderr: "bun failed" });
      }
      if (input.script.includes("npm i -g '@openai/codex'")) {
        codexInstalled = true;
        return result({ code: 0 });
      }
      if (input.script.includes("login status")) {
        return result({ code: 1, stderr: "Not logged in. Run codex login." });
      }
      return result({ code: 1, stderr: `Unexpected script: ${input.script}` });
    };

    const setup = await ensureRemoteCodexAvailable({
      hostAlias: "devbox",
      stateDir: "/tmp/state",
      rootPath: "/workspace",
      runner,
    });

    expect(setup).toEqual({
      installed: true,
      installMethod: "npm",
      authStatus: "unauthenticated",
      authMessage: "Codex CLI is not authenticated. Run `codex login` and try again.",
    });
  });
});
