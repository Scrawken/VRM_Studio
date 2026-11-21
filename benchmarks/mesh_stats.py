"""Source inspection: mesh stats from a .vrm/.glb (GLB2).
Usage: python -I mesh_stats.py out.json file1 [file2 ...]   (needs numpy, no Blender)
"""
import json
import struct
import sys

import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF'
    off, j, bin_ = 12, None, b''
    while off < len(b):
        ln, ty = struct.unpack('<II', b[off:off + 8])
        d = b[off + 8:off + 8 + ln]
        if ty == 0x4E4F534A:
            j = json.loads(d)
        elif ty == 0x004E4942:
            bin_ = d
        off += 8 + ln
    return j, bin_


def acc(j, bin_, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    n, c = a['count'], NC[a['type']]
    dt = np.dtype(CT[a['componentType']])
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', c * dt.itemsize)
    if stride == c * dt.itemsize:
        return np.frombuffer(bin_, dt, n * c, start).reshape(n, c)
    return np.stack([np.frombuffer(bin_, dt, c, start + k * stride) for k in range(n)])


def img_size(data):
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        w, h = struct.unpack('>II', data[16:24])
        return w, h, 'png'
    if data[:2] == b'\xff\xd8':
        i = 2
        while i < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            m = data[i + 1]
            if m in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack('>HH', data[i + 5:i + 9])
                return w, h, 'jpeg'
            i += 2 + struct.unpack('>H', data[i + 2:i + 4])[0]
    return None, None, 'unknown'


def stats(path):
    j, bin_ = load(path)
    out = {'file': path, 'bytes': len(open(path, 'rb').read())}
    tris = verts = morph = maxinf = 0
    per_mesh, inf_hist = [], {}
    for m in j['meshes']:
        for p in m['primitives']:
            at = p['attributes']
            nv = j['accessors'][at['POSITION']]['count']
            ni = j['accessors'][p['indices']]['count'] if 'indices' in p else nv
            mt = len(p.get('targets', []))
            mi = 0
            if 'WEIGHTS_0' in at:
                ct = j['accessors'][at['WEIGHTS_0']]['componentType']
                w = acc(j, bin_, at['WEIGHTS_0']).astype(np.float64)
                if ct != 5126:
                    w = w / np.iinfo(CT[ct]).max
                nz = (w > 1e-4).sum(1)
                mi = int(nz.max())
                for k, v in zip(*np.unique(nz, return_counts=True)):
                    inf_hist[int(k)] = inf_hist.get(int(k), 0) + int(v)
            tris += ni // 3
            verts += nv
            morph += mt
            maxinf = max(maxinf, mi)
            per_mesh.append({'name': m.get('name'), 'verts': nv, 'tris': ni // 3, 'morph_targets': mt,
                             'max_influences': mi,
                             'material': j['materials'][p['material']].get('name') if 'material' in p else None})
    imgs = []
    for im in j.get('images', []):
        bv = j['bufferViews'][im['bufferView']]
        d = bin_[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        w, h, f = img_size(d)
        imgs.append({'name': im.get('name'), 'w': w, 'h': h, 'fmt': f, 'bytes': len(d)})
    out.update(triangles=tris, vertices=verts, materials=len(j.get('materials', [])),
               textures=len(j.get('textures', [])), images=imgs, morph_targets_total=morph,
               nodes=len(j['nodes']), skin_joints=len(j['skins'][0]['joints']) if j.get('skins') else 0,
               max_influences=maxinf, influence_histogram=dict(sorted(inf_hist.items())), meshes=per_mesh)
    vrm = j.get('extensions', {}).get('VRM')
    if vrm:
        out['vrm'] = {'specVersion': vrm.get('specVersion'),
                      'humanoid_bones': len(vrm['humanoid']['humanBones']),
                      'blendShapeGroups': [g.get('presetName') or g.get('name')
                                           for g in vrm['blendShapeMaster']['blendShapeGroups']],
                      'springBoneGroups': len(vrm['secondaryAnimation'].get('boneGroups', [])),
                      'colliderGroups': len(vrm['secondaryAnimation'].get('colliderGroups', []))}
    return out


if __name__ == '__main__':
    res = [stats(p) for p in sys.argv[2:]]
    json.dump(res, open(sys.argv[1], 'w'), indent=1)
    for r in res:
        print(r['file'], r['triangles'], r['vertices'], r['materials'], r['textures'], r['morph_targets_total'],
              r['skin_joints'], r['max_influences'], [(i['w'], i['h']) for i in r['images']])
