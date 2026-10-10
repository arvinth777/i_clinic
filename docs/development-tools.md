# Development tools

2026-10-10. Approved lean workflow; routing is in `AGENTS.md`.

## Installed and retained

| Tool / skill | Source | Scope |
|---|---|---|
| Ponytail 5.1.0 | `DietrichGebert/ponytail` marketplace | Installed/enabled local Codex plugin; default coding constraint |
| Playwright | `openai/skills` | Project skill, copied with its scripts/references |
| Security Best Practices | `openai/skills` | Project skill; supplements the clinic checklist and database advisor |
| Verification Before Completion | `obra/superpowers` | Project skill; fresh evidence before completion claims |
| Diagnosing Bugs, TDD, Code Review | Existing `mattpocock/skills` installation | Reused; no second debugging workflow installed |
| Codebase Design, Improve Codebase Architecture, Grilling | Existing `mattpocock/skills` installation | Manual architecture/planning workflows; Grilling supports the audit |
| GitNexus 1.6.12 | `abhigyanpatwari/GitNexus` / npm `gitnexus` | Optional local index and read-only Codex MCP |

The selected project skill directories are versioned under `.agents/skills/`,
so GitHub/cloud checkouts receive their instructions and supporting files.
Other local skills, secrets, generated indexes, and credentials stay ignored.
System Design, Principal Architect, a duplicate Systematic Debugging workflow,
and Blast Radius are deferred. An installed skill is not a required workflow.

## Activation

User authorized automatic selection of the relevant skills on 2026-10-10.
Ponytail is enabled locally and governs coding in full mode. `AGENTS.md` routes
debugging, TDD, security, browser checks, code review, and completion verification
without asking the user to activate each one. Read the selected skill's full
instructions before applying it. Architecture/planning audits remain manual.

The six routine project skills are present and have no implicit-invocation block
or disabled local configuration. GitNexus MCP is enabled read-only and responds
in this session. These tools guide development; activating them does not run an
application audit or certify clinical workflows.

Discovery/invocation reference: [official skill documentation](https://learn.chatgpt.com/docs/build-skills).

## GitNexus

Uses the already-installed Node 24.19.0 on this Mac. Version 1.6.12 requires
Node `^22.18.0 || >=24.11.0`; the shell's default Node 20 is insufficient.
Indexing succeeded with 1,771 nodes, 3,484 edges, and 101 flows. These are
navigation results, not proof that the application works. The analyzer warned
that some TypeScript properties refer to fields defined in another language;
an empty graph result for those fields does not establish that they are unused.

With a supported Node runtime selected, refresh the local index with:

```sh
npx --yes gitnexus@1.6.12 analyze --index-only
```

`--index-only` preserves the curated AGENTS.md and skips generated skill/hook
injection. Do not add `--skills` or auto-commit flags. The local index is ignored.
Codex's local MCP is registered with `GITNEXUS_MCP_READ_ONLY=1` and the explicit
Node 24 executable. No `gitnexus setup` or GitNexus plugin was installed, so no
GitNexus hooks were added. MCP discovery is now confirmed in this session.

On another machine, select a supported Node runtime and register it with:

```sh
codex mcp add gitnexus --env GITNEXUS_MCP_READ_ONLY=1 -- npx --yes gitnexus@1.6.12 mcp
```

A Mac's global MCP registration does not transfer through GitHub. Index the
actual checkout before relying on graph results; never index patient exports,
credentials, or production database dumps. Use migrations and database checks
for SQL/RLS behaviour, and browser/regression tests for offline and billing.

## Reproducing the new skill installation

The versioned files are the reviewed snapshot; these commands fetch upstream
versions and should be reviewed before updating that snapshot:

```sh
npx --yes skills add openai/skills --skill playwright --skill security-best-practices --agent codex --copy --yes
npx --yes skills add obra/superpowers --skill verification-before-completion --agent codex --copy --yes
codex plugin marketplace add DietrichGebert/ponytail
codex plugin add ponytail@ponytail
```

The Playwright skill's example script path assumes a user-level installation.
For this project use `.agents/skills/playwright/scripts/playwright_cli.sh`.
Existing `scripts/*-test.mjs` remain the application's regression checks;
the browser skill does not automatically turn manual checks into a test suite.

Architecture audit metadata already disables implicit invocation. Keep it
manual when refreshing upstream files. Review requests should specify the
comparison ref and the originating spec; do not let skill setup prerequisites
turn a simple task into an unrelated project-wide installation.
