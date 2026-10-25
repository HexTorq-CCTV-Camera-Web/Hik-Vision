# Standalone separation — 25 October 2026

Only packaging, folder paths, local dependency copies, test fixture paths and
documentation changed. Existing package versions, application features, SDK
behavior, encrypted-store formats and database schema were preserved.

| Application | Node results in isolated copies | Python media results |
| --- | --- | --- |
| v1 | 25 passed | 2 passed |
| v2 | 85 passed | 6 audio + 4 video passed |
| v3 | 77 passed, including subtests | 6 audio + 4 video passed |
| linux | 61 portable tests passed | 6 audio + 4 video passed |

Each source was copied independently into an unrelated temporary directory with
no sibling source folders. Relative module/native file references were checked.
v3 used its copied, already installed Node dependencies and a same-user protected
test credential to create disposable PostgreSQL databases. No provider account,
Chrome session or live camera was used. Temporary copies were removed afterward.

The repeatable command is `node tools/verify-standalone.mjs` from this directory.
You can append `v1`, `v2`, `v3` or `linux` to check a specific version. Its optional
v3 fixture prerequisite is documented in README.md.

Actual CLI startup was additionally checked for v1 on 8003, v2 on 8004 and v3 on
8006. Each served its health endpoint and frontend assets. v2 used a disposable
account directory for this check. Test HTTP processes were stopped afterward;
the private local PostgreSQL server remains running, as it was before the move.

The original database was stopped cleanly before relocating its directory, then
restarted from v3/.local on 127.0.0.1:55432. Only the encrypted runtime data path
was changed. Its encrypted pre-move configuration is retained privately for
rollback. Existing data, keys, recordings and external Windows v2 storage were
not reset. No schema migration was applied by the separation.

Linux POSIX ownership/permission tests, container integration, pooled SDK/Wine
execution and real video/audio were **not** rerun: this Windows machine has no
usable Linux/WSL or Docker environment. Linux's existing runtime requirements,
recipes and historical deployment assumptions remain in its standalone folder.
The new folder layout does not certify Linux runtime or production readiness.

No SDK authorization/import/export helper, SSH command or deployment script was
run. The VPS was not contacted or changed. CPPlus source was not modified during
the Hikvision separation. No Git repository, commit or push was created.
