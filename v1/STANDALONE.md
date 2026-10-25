# Hikvision v1 standalone

Location: `hikvision/v1`. Default URL: http://localhost:8003/.

```powershell
cd K:\2026-SHOP\Playground\Camera\hikvision\v1
npm start
```

Requires Node 22.9+ and the existing Chrome debugging/Hik-Connect session setup.
Windows playback requires the installed iVMS SDK and Python dependencies from
`native/requirements.txt`. No npm installation/build or PostgreSQL is needed.
Run `npm test` and `npm run test:audio` for existing tests.
This remains the original prototype, including its session/restart limitations.


This is a source separation only. Existing behavior, package versions, features
and limitations are preserved. It has no source imports from another version.
No VPS changes were made. Use this folder's README for the existing feature and
operational details; historical paths in investigation documents describe the
pre-separation layout.
