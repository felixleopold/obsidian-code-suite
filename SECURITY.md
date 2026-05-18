# Security Policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately via [GitHub's private vulnerability reporting](https://github.com/felixleopold/obsidian-code-suite/security/advisories/new). You will receive a response within 72 hours.

Include as much detail as possible:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Obsidian and plugin version
- Operating system

## Scope

CodeSuite runs code **locally on your machine** using child processes. No data is sent to any remote server. The main security considerations are:

- **Environment variable injection** — `KEY=VALUE` pairs entered in settings are injected into every execution environment. Do not store secrets in plain text if your vault is synced to an untrusted location.
- **Arbitrary code execution** — the plugin executes whatever code is in a code block. Only run notes from sources you trust, as you would with any script.
