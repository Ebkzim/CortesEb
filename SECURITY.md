# Security policy

CortesEb runs entirely on your own computer. It downloads videos, runs local tools and keeps your API keys, so security is treated as a feature, not an afterthought. This document explains how to report a problem and what the project does to protect its users.

## Supported versions

Only the latest commit on `main` receives security fixes. Update with `git pull` followed by `npm run instalar`.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a security problem.**

1. Open the [Security tab](https://github.com/Ebkzim/CortesEb/security) of this repository and click **Report a vulnerability**. The report stays private between you and the maintainer.
2. Include the commit you tested, your operating system, the steps to reproduce, what happened and what you expected.
3. If you have a proof of concept, attach it to the private report. Never test against other people's machines, accounts or channels.

| Step                      | Target                                          |
| ------------------------- | ----------------------------------------------- |
| First answer              | within 3 days                                   |
| Confirmation and severity | within 7 days                                   |
| Fix for critical or high  | as soon as possible, usually within 14 days     |
| Public disclosure         | after the fix is on `main`, credited if desired |

Good faith research that follows this policy will not be met with legal action.

## Scope

In scope:

- the `cortes-eb` command line tool, the local panel (`cortes-eb ui`) and the installer (`npm run instalar`);
- the credential vault, the posting queue, the live mode and the Claude Code skill in `alternativa-skills/`;
- the GitHub Actions workflows of this repository.

Out of scope:

- vulnerabilities in third party tools the project calls (FFmpeg, yt-dlp, whisper.cpp, Ollama) or in the platforms it talks to; report those upstream;
- attacks that need an attacker who already controls your user account or your machine;
- problems that only happen after you change the code or disable a protection.

## How CortesEb protects you

### Installation

- Every binary the installer downloads (FFmpeg, yt-dlp, the Windows Ollama setup) is checked against the official SHA-256 checksum published by its project. A file that does not match is deleted and never runs.
- Downloads come only from the official release pages over HTTPS.
- npm dependencies are pinned to exact versions, installed with `npm ci` from the lockfile, and only an explicit allow list of packages may run install scripts.
- Nothing is installed system wide except Ollama, which uses its official installer and asks for your permission.

### Local panel

- The panel listens only on `127.0.0.1`. It is never reachable from your network or the internet.
- Each run creates a new random 256 bit access token. It travels in the URL fragment, which browsers never send to servers or logs, and is kept in an `HttpOnly`, `SameSite=Strict` cookie.
- Requests with an unexpected `Host` header are refused, which blocks DNS rebinding. Requests that change data must come from the panel's own origin.
- Strict security headers: Content Security Policy, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, cross origin isolation and no caching of API answers.
- Uploads have size limits and are stored with owner only permissions.

### Secrets

- API keys are encrypted with AES-256-GCM. The master key lives in `~/.cortes-eb/master.key` with mode `600`, or comes from the `CORTES_EB_MASTER_KEY` environment variable.
- Secrets are read only from the panel, environment variables or standard input. They are never printed, logged, put in error messages or sent anywhere except the service they belong to.
- Nothing from your machine is committed to this repository: `.env`, databases, keys and media are ignored by git, and every push is scanned for secrets.

### Running other programs

- Other programs are always started with an argument list, never through a shell, and user input is separated with `--` so it cannot become an option.
- Paths coming from users or files are resolved inside the expected folder, and names are validated.

### Network

- Links must be public `https` addresses. The resolved address and every redirect are checked against private and internal ranges, which blocks server side request forgery.
- Downloaded images are checked by their content, not their extension, and have size limits.
- The browser cookies of the user are never used to download videos.

### Publishing

- Nothing is posted to a channel without an explicit approval step, and real publishing needs the explicit `--live` flag.

### Development process

- Every change goes through a pull request with lint, type checks, tests, a dependency audit, a full install test on Linux and Windows, and CodeQL static analysis.
- Dependabot opens updates for npm packages and GitHub Actions every week. Actions are pinned to commit hashes and run with read only permissions.

## Recommendations for users

- Install only from this repository and keep it updated.
- Do not run the panel as root or administrator.
- Do not share the access link printed by `cortes-eb ui`; it gives full control of the panel while it is open.
- If you think a key was exposed, revoke it in the provider's console first, then remove it with `cortes-eb credentials remove` and add a new one.
