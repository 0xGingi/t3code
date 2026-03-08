# T3 Code

T3 Code is a minimal web GUI for coding agents. Currently Codex-first, with Claude Code support coming soon.

This fork adds first-class SSH-hosted projects in the desktop app, including remote worktrees, remote terminals, and remote Codex sessions.

## Highlights

- Open local projects or SSH-hosted projects from the desktop app
- Run Codex against repos on remote Linux/macOS hosts over SSH
- Create and use remote git worktrees inside the app
- Use the built-in terminal against the remote host
- Auto-install remote Codex with `bun i -g @openai/codex`, then `npm i -g @openai/codex` as a fallback
- Finish remote authentication from the desktop GUI through the built-in terminal setup flow

## How To Use

> [!WARNING]
> Local projects still require [Codex CLI](https://github.com/openai/codex) to be installed and authorized on your machine.
>
> For SSH-hosted projects, this fork can install remote Codex automatically, but the remote host still needs working SSH access plus `sh` and `git`.

```bash
npx t3
```

You can also just install the desktop app. It's cooler.

Install the [desktop app from the Releases page](https://github.com/pingdotgg/t3code/releases)

### SSH Projects In The Desktop App

When adding a project in the desktop app, choose `SSH` and enter:

- SSH host alias
- Remote absolute path

During setup, the app will:

1. Validate the SSH target
2. Check remote prerequisites
3. Install remote Codex if needed
4. Open a guided remote setup dialog if `codex login` is still required

The login step runs through the built-in terminal on the remote host, so you can complete authentication without leaving the app.

### Remote Access Vs Remote SSH Projects

This fork supports two different remote scenarios:

- SSH-hosted projects inside the desktop app
- Browser access to a T3 Code server running on another machine

The browser/server access flow is documented in [REMOTE.md](/Volumes/SSD/t3code/REMOTE.md). That is separate from SSH-hosted project support.

## Notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
