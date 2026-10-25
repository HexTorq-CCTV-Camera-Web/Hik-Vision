"""Verify SDK bundle integrity; optionally check Windows DLL loading, no SDK calls."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import tempfile

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--load', action='store_true', help='Windows loader/export check only; does not initialize SDK')
    args = parser.parse_args()
    root = HERE / 'windows-x64'
    manifest = json.loads((HERE / 'MANIFEST.json').read_text(encoding='utf-8'))
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
    expected = {entry['path'] for entry in manifest['files']}
    if actual != expected: raise ValueError('Bundle contents differ from the manifest')
    for entry in manifest['files']:
        target = (root / entry['path']).resolve()
        if not target.is_relative_to(root.resolve()): raise ValueError('Invalid manifest path')
        content = target.read_bytes()
        if len(content) != entry['bytes'] or hashlib.sha256(content).hexdigest() != entry['sha256']:
            raise ValueError('Bundle integrity check failed: ' + entry['path'])
    loaded = []
    if args.load:
        if os.name != 'nt': raise ValueError('--load needs Windows; hash verification is platform-independent')
        handles = [os.add_dll_directory(str(folder)) for folder in
                   [root, root / 'HCNetSDKCom', root / 'PlayCtrl', root / 'Microsoft.VC90.MFC'] if folder.is_dir()]
        previous = os.getcwd()
        with tempfile.TemporaryDirectory(prefix='hik-sdk-load-') as temporary:
            os.chdir(temporary)
            try:
                for name in ['OpenNetStream.dll', 'HCNetSDK.dll', 'PlayCtrl.dll']:
                    library = ctypes.WinDLL(str(root / name))
                    if name == 'OpenNetStream.dll':
                        for export in ['OpenSDK_InitLib', 'OpenSDK_SetAccessToken', 'OpenSDK_AllocSessionEx']:
                            getattr(library, export)
                    loaded.append(name)
            finally:
                os.chdir(previous)
        for handle in handles: handle.close()
    print(json.dumps({'verifiedFiles': len(expected), 'bytes': sum(f['bytes'] for f in manifest['files']),
                      'loadChecked': loaded, 'cloudApiCalled': False}))


if __name__ == '__main__':
    main()
