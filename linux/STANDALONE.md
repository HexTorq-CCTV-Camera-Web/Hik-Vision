# Hikvision Linux standalone pilot

Moved from `hikvision/linux-lab/standalone` to `hikvision/linux`.
This is the existing single-owner Linux pilot, not SaaS v3.
Default service port: 21000. No running server has been changed.

Use Linux, Node 22+, Wine, embedded Windows Python, Python media dependencies and
the authorized vendor SDK. Existing deployment helpers retain the historical
`/home/mohan/cam` workspace and `/work/app`, `/work/sdk` container mount contract.
Those are deployment paths, not references to sibling source folders.

```sh
# Inside its prepared Linux/container environment:
npm start
# Full existing suite requires Linux and its fixture prerequisites:
npm test
# Platform-independent subset (also checked on Windows):
npm run test:portable
```

`runtime-build/Dockerfile` and `runtime-build/Dockerfile.playback` are local copies
of the existing base-image recipes; `Dockerfile.service` remains at the app root.
See runtime-build/README.md for build order. No research folder is required to
resolve these recipes. Vendor DLLs and runtime data remain external mounts.

The optional `export-state.mjs` operator helper runs on Windows against an
existing Windows viewer vault. Its Windows vault implementation is bundled under
`operator/`; no v2 source folder is required. Its output contains credentials and
must remain in the existing private transport workflow, never Git or logs.
The pilot's other operator/deployment scripts retain their existing behavior.

Full POSIX permissions, pooled SDK/Wine execution and live playback were not
retested during this Windows-only move. Historical reports remain in this folder.
No SSH, deploy scripts or real-provider authorization helpers were run.


This is a source separation only. Existing behavior, package versions, features
and limitations are preserved. It has no source imports from another version.
No VPS changes were made. Use this folder's README for the existing feature and
operational details; historical paths in investigation documents describe the
pre-separation layout.
