# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem. While this repository is private, contact the maintainer directly. Once it is public, use GitHub's private vulnerability reporting (Security tab, "Report a vulnerability"), which must be enabled in the repository settings. Include the version or commit, what you did, what happened and what you expected.

You can expect an answer within a few days. Fixes are released as a normal commit on `main`, with the issue described once it is safe to do so.

## Scope

In scope: the `cortes-eb` command line tool and everything in this repository, including the posting queue, the credential vault and the live mode.

Out of scope: vulnerabilities in third party tools it calls (ffmpeg, yt-dlp, whisper.cpp) and in the platforms it talks to.

## Design rules the project follows

- No shell is ever used to run another program; arguments are always passed as a list.
- Paths coming from users or files are resolved inside an expected folder, and plain names are validated.
- Links must be public `https` addresses. Redirects and resolved addresses are checked against internal ranges.
- Downloaded images are checked by their content, not their extension, and have size limits.
- Secrets are read only from environment variables or standard input, stored in files with mode 600 and never printed, logged or put in error messages.
- Nothing is published without an explicit approval step. Publishing for real needs an explicit `--live` flag.
- Dependencies are pinned to exact versions and audited in CI. Workflow actions are pinned to commit hashes.

## Handling secrets

If you suspect a token was exposed, revoke it in the platform's developer console first, then remove it with `cortes-eb credentials remove` and set a new one.
