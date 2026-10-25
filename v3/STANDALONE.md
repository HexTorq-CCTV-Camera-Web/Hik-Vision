# Hikvision SaaS v3 standalone

Renamed from `hikvision/saas-v3` to `hikvision/v3`.
Default URL: http://localhost:8006/.

```powershell
cd K:\2026-SHOP\Playground\Camera\hikvision\v3
# Restore locked Node dependencies after a fresh checkout:
npm ci
# Existing local Windows setup/startup procedure:
npm run setup:local
npm start
```

The setup helper expects PostgreSQL binaries under `.local/postgresql/pgsql`;
it does not download them. The existing private installation and database moved
with this local folder. PostgreSQL remains a separate process on port 55432.
Read README.md for environment-based configuration and setup prerequisites.

Node 22.9+, PostgreSQL, Windows credential protection and the installed vendor
SDK/Python media runtime remain required for the current complete local path.
`vendor/windows-sdk/` contains the frozen local source formerly imported from
Windows v2. Its native worker resolves its own native files inside this folder.
No sibling v2 folder is needed at runtime, during Node tests or by the synthetic
browser fixture. Optional browser QA still needs its own Playwright installation
under `.local/browser-qa`; this private dev dependency is excluded from Git.

Run `npm test` with the private local PostgreSQL fixture configuration available.
A source-only checkout must provision its own database/configuration; `.local`,
recordings/data and keys are private, not Git source. Moving to another Windows
account or Linux requires deliberate key/data migration. This separation does
not complete the Linux SaaS integration or SDK authorization renewal.


This is a source separation only. Existing behavior, package versions, features
and limitations are preserved. It has no source imports from another version.
No VPS changes were made. Use this folder's README for the existing feature and
operational details; historical paths in investigation documents describe the
pre-separation layout.
