# Bundled Windows x64 SDK runtime

Added locally on 25 October 2026 for the upcoming full Hikvision source archive.
Previously, applications used the installed iVMS SDK, while research kept binary
ZIP snapshots. This directory now contains an unpacked runtime bundle.

```text
sdk/
  windows-x64/
    OpenNetStream.dll
    HCNetSDK.dll
    PlayCtrl.dll
    HCNetSDKCom/
    PlayCtrl/
    Microsoft.VC90.MFC/
    ... runtime and dependency DLLs
  licenses/installed-open-source-notices.txt
  runtime-files.json
  MANIFEST.json
  package-runtime.py
  verify-runtime.py
```

The bundle has 57 files totaling 100,053,636 bytes (about 95.4 MiB). The largest
individual file is 8,335,872 bytes. Its initial selection follows the existing
core/MFC runtime archives; files were copied from the current installed client.
Local dependencies discovered through PE import/delay-import tables and the SDK
plugin directories are included. Files preserve their installed names/layout.
This is an observed runtime subset, not the complete iVMS desktop application.

DLLs are third-party compiled binaries, not application source. The installed
open-source notices are preserved under licenses/. The bundle does not contain
client logs, passwords, account tokens, recorded clips or provider state. SDK
application identity and account/playback authorization remain separate inputs.

## Git inclusion

Commit this directory, its DLL/manifest files, inventory and notices to the
forthcoming full Hikvision repository. The root ignore rules explicitly allow
the SDK bundle's DLLs and manifests. Root attributes mark DLLs as binary.
Research ZIP archives, logs, captures, local databases and secrets stay ignored.
No new repository or remote push was performed while adding this bundle.

## Verify

From the Hikvision folder:

```powershell
python sdk/verify-runtime.py
python sdk/verify-runtime.py --load
```

The first verifies every filename, size and SHA-256 hash. The second also loads
the three main DLLs on Windows and resolves the observed OpenSDK entry points.
It does not initialize SDK sessions or call account/cloud/playback APIs. Both
checks passed on this machine. Fresh camera playback against the bundle and
Linux/Wine loading have not been tested in this step.

## Runtime integration remains unchanged

This packaging step does not change any app's SDK path or login behavior. Existing
apps continue using their configured/installed SDK. In particular, Windows
helpers still consult installed-client logs for SDK identity and playback
authorization. Pointing HIK_SDK_DIRECTORY to this bundle alone would not supply
those missing inputs; do not copy the logs here to work around that dependency.

The full archive has this one SDK bundle to avoid repeating roughly 95 MiB in
every version. Independent application folders still require a separately
provided SDK runtime. Future split repositories/deployments must explicitly
provide this bundle or an equivalent installed runtime. The Windows binaries
remain PE files; Linux still requires the documented Wine-based runtime.

## Recreate from the installed runtime

```powershell
python sdk/package-runtime.py
# Or use another existing installed SDK root:
python sdk/package-runtime.py --source 'C:\path\to\installed\Client'
```

This copies only selected DLLs/manifests and their local PE dependencies, writes
the integrity inventory and copies the installed open-source notices. It does
not read or export client logs or account configuration. No versions were
downloaded or upgraded.
