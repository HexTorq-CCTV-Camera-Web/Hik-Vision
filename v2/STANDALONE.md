# Hikvision Windows v2 standalone

Renamed from `hikvision/windows-v2` to `hikvision/v2`.
Default URL: http://localhost:8004/.

```powershell
cd K:\2026-SHOP\Playground\Camera\hikvision\v2
npm start
```

Requires Windows, Node 22.9+, installed iVMS/vendor SDK and Python dependencies
from `native/requirements.txt`. No npm installation/build or PostgreSQL is needed.
Run `npm test`, `npm run test:audio` and `npm run test:video`.
The default private account directory is unchanged:
`%LOCALAPPDATA%/HikvisionCameraProductV2` (or HIK_PRODUCT_DATA_DIR).
Copying source does not copy the existing account store. Protected keys remain
bound to their Windows account. Existing scripts resolve this folder dynamically.
If you previously installed an external shortcut/startup task using the old
absolute path, that external launcher needs the new folder path.


This is a source separation only. Existing behavior, package versions, features
and limitations are preserved. It has no source imports from another version.
No VPS changes were made. Use this folder's README for the existing feature and
operational details; historical paths in investigation documents describe the
pre-separation layout.
