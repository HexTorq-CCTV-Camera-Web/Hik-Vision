"""Copy the observed SDK runtime and local PE dependencies, never client state.

Reads PE tables without executing DLLs. Does not copy logs, tokens, databases,
the iVMS application, or Windows system DLLs. No external Python packages needed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct

HERE = Path(__file__).resolve().parent
DEFAULT_SOURCE = Path(r"C:\Program Files (x86)\iVMS-4200 Site\iVMS-4200 Client\Client")


def pe_info(data):
    def u16(pos): return struct.unpack_from('<H', data, pos)[0]
    def u32(pos): return struct.unpack_from('<I', data, pos)[0]
    if data[:2] != b'MZ': raise ValueError('Not a PE binary')
    header = u32(0x3c)
    if data[header:header + 4] != b'PE\0\0': raise ValueError('Invalid PE header')
    count, optional_size = u16(header + 6), u16(header + 20)
    optional = header + 24
    magic = u16(optional)
    if magic not in (0x10b, 0x20b): raise ValueError('Unknown PE format')
    directories = optional + (112 if magic == 0x20b else 96)
    sections = optional + optional_size

    def offset(rva):
        for index in range(count):
            section = sections + index * 40
            size, address, raw_size, start = struct.unpack_from('<IIII', data, section + 8)
            if address <= rva < address + max(size, raw_size):
                delta = rva - address
                if delta >= raw_size: raise ValueError('Unbacked RVA')
                return start + delta
        raise ValueError('RVA outside sections')

    def string(rva):
        start = offset(rva)
        end = data.find(b'\0', start, start + 1024)
        if end < 0: raise ValueError('Unterminated import')
        return data[start:end].decode('ascii')

    imports = set()
    rva = u32(directories + 8)  # IMAGE_DIRECTORY_ENTRY_IMPORT
    if rva:
        pos = offset(rva)
        for _ in range(4096):
            values = struct.unpack_from('<IIIII', data, pos)
            if not any(values): break
            imports.add(string(values[3]))
            pos += 20
        else: raise ValueError('Unterminated import table')
    rva = u32(directories + 13 * 8)  # Delay-loaded DLLs, RVA descriptors.
    if rva:
        pos = offset(rva)
        image_base = struct.unpack_from('<Q' if magic == 0x20b else '<I', data, optional + (24 if magic == 0x20b else 28))[0]
        for _ in range(4096):
            values = struct.unpack_from('<IIIIIIII', data, pos)
            if not any(values): break
            name_rva = values[1] if values[0] & 1 else values[1] - image_base
            imports.add(string(name_rva))
            pos += 32
        else: raise ValueError('Unterminated delayed import table')
    return {'architecture': 'x64' if magic == 0x20b else 'x86', 'imports': sorted(imports, key=str.lower)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    args = parser.parse_args()
    source = args.source.resolve()
    destination = HERE / 'windows-x64'
    selection = json.loads((HERE / 'runtime-files.json').read_text(encoding='utf-8'))
    pending = [Path(name) for name in selection]
    # Include all currently installed SDK plugin DLLs, preserving their location.
    for sub in ['HCNetSDKCom', 'PlayCtrl']:
        pending.extend(p.relative_to(source) for p in (source / sub).glob('*.dll'))
    files = {}
    while pending:
        relative = pending.pop()
        requested = (source / relative).resolve()
        # PE imports use case-insensitive names. Preserve installed filename case
        # and avoid duplicate manifest entries when packaging on Windows.
        original = next(p for p in requested.parent.iterdir() if p.name.casefold() == requested.name.casefold())
        relative = original.relative_to(source)
        name = relative.as_posix()
        if name in files: continue
        if not original.is_relative_to(source) or original.suffix.lower() not in ['.dll', '.manifest']:
            raise ValueError('Runtime file outside the allowed selection')
        data = original.read_bytes()
        info = pe_info(data) if original.suffix.lower() == '.dll' else {}
        if info and info['architecture'] != 'x64': raise ValueError(f'Unexpected architecture: {name}')
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        for existing in target.parent.iterdir():
            if existing.name.casefold() == target.name.casefold() and existing.name != target.name:
                intermediate = target.with_name(target.name + '.case-tmp')
                existing.rename(intermediate)
                intermediate.rename(target)
                break
        shutil.copy2(original, target)
        files[name] = {'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), **info}
        for dependency in info.get('imports', []):
            for candidate in [original.parent / dependency, source / dependency]:
                if candidate.is_file() and candidate.suffix.lower() == '.dll':
                    pending.append(candidate.relative_to(source))
                    break
    license_source = source / 'Open Source Software Licenses/Open Source Software Licenses.txt'
    if license_source.is_file():
        licenses = HERE / 'licenses'
        licenses.mkdir(exist_ok=True)
        shutil.copy2(license_source, licenses / 'installed-open-source-notices.txt')
    manifest = {'format': 1, 'platform': 'windows-x64', 'files': sorted(files.values(), key=lambda f: f['path'].lower())}
    (HERE / 'MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(files), 'bytes': sum(f['bytes'] for f in files.values()), 'largestFileBytes': max(f['bytes'] for f in files.values())}))


if __name__ == '__main__':
    main()
