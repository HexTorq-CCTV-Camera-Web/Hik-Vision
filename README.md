# Hikvision standalone versions

Separated locally on 25 October 2026. This change organizes the existing
applications and copies their former sibling dependencies. No features, SDK
behavior, package versions, database schema or deployment have been upgraded.
The VPS was not contacted or changed.

Repository: https://github.com/HexTorq-CCTV-Camera-Web/Hik-Vision

The full archive now includes [sdk/](sdk/README.md): an unpacked Windows x64
vendor runtime bundle with dependency DLLs, notices and a SHA-256 manifest.
This packaging does not change application SDK paths or authorization behavior.

| Folder | Existing application | Platform | Default port |
| --- | --- | --- | --- |
| [v1](v1/STANDALONE.md) | Original Chrome-connected prototype | Windows playback | 8003 |
| [v2](v2/STANDALONE.md) | Single-owner viewer | Windows | 8004 |
| [v3](v3/STANDALONE.md) | PostgreSQL SaaS with roles/workspaces | Current local Windows integration | 8006 |
| [linux](linux/STANDALONE.md) | Existing single-owner Linux/Wine pilot | Linux + Wine | 21000 |
| research/ | Earlier API/Wine experiments and historical artifacts | Research only | None |

Each application owns its source dependencies. Copy one complete version folder
when archiving it. v3 no longer imports v2: its frozen local engine copy is under
`v3/vendor/windows-sdk/`. Linux also owns its operator helper and runtime-build
Dockerfiles. Editing one version does not update another.

Standalone **source** still requires its documented external runtime: Node,
Python media packages, the installed vendor SDK, and PostgreSQL for v3 or Wine for
Linux. Account credentials and local databases are not part of a normal Git checkout.
The full repository includes the shared SDK bundle under sdk/; the applications
retain their existing SDK configuration and do not automatically switch to it. No existing production limitations were removed by moving
folders. Recorded-footage playback and other deferred features remain deferred.

## Verification

From this directory run `node tools/verify-standalone.mjs` (or append a version
name). It copies apps individually to unrelated temporary directories, verifies
relative source dependencies and runs their existing tests. v3 tests require the
same-user protected local fixture credential and the private PostgreSQL server
on port 55432. They use disposable test databases, not real workspace data.
On Windows the Linux run uses portable tests; full POSIX/Wine tests require Linux.
See [STANDALONE-VERIFICATION.md](STANDALONE-VERIFICATION.md).

The existing local private PostgreSQL directory moved with v3. Its encrypted
runtime config was updated only to the new recordings/data path. A protected
pre-move config copy remains under v3/.local for rollback. Existing viewer accounts,
keys, recordings and external Windows v2 account storage were preserved.

Do not commit `.local/`, account stores, captures, logs, environment secrets or
research SDK ZIP archives. The reviewed unpacked `sdk/windows-x64` runtime is
intended for inclusion in the forthcoming full bundle. Ignore files distinguish
these categories. The source baseline is maintained at
https://github.com/HexTorq-CCTV-Camera-Web/Hik-Vision. No server deployment is
performed by publishing this repository.
