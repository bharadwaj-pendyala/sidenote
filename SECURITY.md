# Security Policy

## Scope

sidenote runs a local daemon on `127.0.0.1` that shells out to a coding agent (`claude` or `codex`) with write access to your content directory, and runs `git` on your repo. It is designed for local, single-user development. Please keep that threat model in mind when reporting.

The daemon already:

- binds to loopback only and rejects cross-origin and forged-`Host` callers,
- confines agent file access to the configured `contentDir`,
- reverts any edit the agent makes outside the target file.

## Supported versions

The project is pre-1.0. Only the latest `main` is supported for security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Instead, report it privately through [GitHub Security Advisories](https://github.com/bharadwaj-pendyala/sidenote/security/advisories/new), or email the maintainer at `bharadwajpendyala@gmail.com`.

Include steps to reproduce and the impact you observed. You can expect an initial response within a few days. Once a fix is available, credit will be given in the release notes unless you prefer to remain anonymous.
