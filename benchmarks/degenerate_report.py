"""List zero-area/repeated-index triangles in a GLB primitive.
python -I degenerate_report.py <file.glb>
"""
import json, struct, sys
import numpy as np

def load(p):
 b=open(p,'rb').read(); j=json.loads(b[20:20+struct.unpack('<I',b[12:16])[0]]); return j,b

def acc(j,b,i):
 a=j['accessors'][i]; v=j['bufferViews'][a['bufferView']]; n=a['count']; c={'SCALAR':1,'VEC3':3}[a['type']]; dt={5123:np.uint16,5125:np.uint32,5126:np.float32}[a['componentType']]; off=v.get('byteOffset',0)+a.get('byteOffset',0); stride=v.get('byteStride',c*np.dtype(dt).itemsize); raw=b[12+8+struct.unpack('<I',b[12:16])[0]+8:] if False else None
 # Locate BIN chunk
 o=12; bin_=None
 while o<len(b):
  ln,ty=struct.unpack('<II',b[o:o+8]);
  if ty==0x4e4942: bin_=b[o+8:o+8+ln]
  o+=8+ln
 if stride==c*np.dtype(dt).itemsize: return np.frombuffer(bin_,dt,n*c,off).reshape(n,c)
 return np.stack([np.frombuffer(bin_,dt,c,off+k*stride) for k in range(n)])

j,b=load(sys.argv[1])
for m in j['meshes']:
 for pi,p in enumerate(m['primitives']):
  co=acc(j,b,p['attributes']['POSITION']); tri=acc(j,b,p['indices']).reshape(-1,3)
  d=[]
  for ti,t in enumerate(tri):
   repeated=len(set(t.tolist()))<3
   area=float(np.linalg.norm(np.cross(co[t[1]]-co[t[0]],co[t[2]]-co[t[0]])))*.5
   if repeated or area<1e-12: d.append((ti,t.tolist(),area,co[t[0]].round(6).tolist(),co[t[1]].round(6).tolist(),co[t[2]].round(6).tolist(),repeated))
  if d:
   print(m.get('name'), 'primitive',pi,'total',len(tri),'degenerate',len(d))
   for x in d[:8]: print(' ',x)
