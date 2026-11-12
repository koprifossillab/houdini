// Frame mesh file "TCM1" — one frame of the scene as one triangle mesh, element id per vertex.
//   bytes 0-3   'TCM1'
//   4-7         u32 vertex count  (nv)
//   8-11        u32 triangle count (nt)
//   12-15       u32 reserved (0)
//   then        f32 positions [nv*3]  (x right, y up, z along strike; 1 u = nominal 100 m)
//   then        u8  element   [nv]    (0 pink, 1 gray, 2 blue body, 3 blue basal pieces), padded to 4 bytes
//   then        u32 indices   [nt*3]
// Little endian. The server only checks and passes the bytes through; the browser draws them.
export const ELEMENTS = ['pink', 'gray', 'blue', 'pieces'];
export const MAX_VERTS = 2_000_000;
export const MAX_TRIS = 4_000_000;

const pad4 = n => (n + 3) & ~3;

export function encodeMesh({ positions, elements, indices }) {
  const nv = elements.length, nt = indices.length / 3;
  if (positions.length !== nv * 3 || !Number.isInteger(nt)) throw new Error('mesh arrays do not match');
  const size = 16 + nv * 12 + pad4(nv) + nt * 12;
  const buf = Buffer.alloc(size);
  buf.write('TCM1', 0, 'ascii');
  buf.writeUInt32LE(nv, 4); buf.writeUInt32LE(nt, 8);
  let o = 16;
  for (const v of positions) { buf.writeFloatLE(v, o); o += 4; }
  for (const e of elements) buf[o++] = e;
  o = 16 + nv * 12 + pad4(nv);
  for (const i of indices) { buf.writeUInt32LE(i, o); o += 4; }
  return buf;
}

// returns { nv, nt } when the bytes are a well-formed mesh, otherwise null (never throws on bad input)
export function checkMesh(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16 || buf.toString('ascii', 0, 4) !== 'TCM1') return null;
  const nv = buf.readUInt32LE(4), nt = buf.readUInt32LE(8);
  if (nv > MAX_VERTS || nt > MAX_TRIS) return null;
  if (buf.length !== 16 + nv * 12 + pad4(nv) + nt * 12) return null;
  let o = 16 + nv * 12;
  for (let i = 0; i < nv; i++) if (buf[o + i] > 3) return null;
  o = 16 + nv * 12 + pad4(nv);
  for (let i = 0; i < nt * 3; i++) if (buf.readUInt32LE(o + i * 4) >= nv) return null;
  for (let i = 0; i < nv * 3; i++) if (!Number.isFinite(buf.readFloatLE(16 + i * 4))) return null;
  return { nv, nt };
}
