// Faux serveur PostgREST/Supabase pour les tests e2e (aucun service réel n'est contacté).
// Il reproduit ce dont la synchro a besoin : table `batches`, vérification du JWT (HS256), isolation par `sub` (comme la RLS),
// comparaison-échange sur `rev`, refus des doublons (23505) et horodatage serveur.
import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const JWT_SECRET = 'e2e-supabase-jwt-secret';
const rows = new Map(); // `${owner}|${id}` → ligne
let clock = 0;
export const stats = { requests: 0, inserts: 0, updates: 0 };

function verify(token) {
  const [h, b, s] = (token || '').split('.');
  if (!h || !b || !s) return null;
  const exp = createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest();
  const got = Buffer.from(s, 'base64url');
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) return null;
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  return claims.exp > Date.now() / 1000 && claims.role === 'authenticated' ? claims : null;
}

const send = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

export function createMock() {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Range',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__reset') { rows.clear(); clock = 0; Object.assign(stats, { requests: 0, inserts: 0, updates: 0 }); return send(res, 200, { ok: true }, cors); }
    if (url.pathname === '/__rows') return send(res, 200, [...rows.values()], cors);
    if (url.pathname === '/__stats') return send(res, 200, stats, cors);
    stats.requests++;
    if (url.pathname !== '/rest/v1/batches') return send(res, 404, { message: 'not found' }, cors);

    const claims = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT expired or invalid' }, cors);
    const sub = claims.sub;
    const single = /vnd\.pgrst\.object/.test(req.headers.accept || '');
    const eq = (name) => { const v = url.searchParams.get(name); return v && v.startsWith('eq.') ? v.slice(3) : null; };

    if (req.method === 'GET') {
      let list = [...rows.values()].filter((r) => r.owner_id === sub); // RLS
      const owner = eq('owner_id'); if (owner) list = list.filter((r) => r.owner_id === owner);
      const id = eq('id'); if (id) list = list.filter((r) => r.id === id);
      const gte = url.searchParams.get('server_updated_at');
      if (gte?.startsWith('gte.')) list = list.filter((r) => r.server_updated_at >= gte.slice(4));
      list.sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at) || a.id.localeCompare(b.id));
      const off = Number(url.searchParams.get('offset') || 0), lim = Number(url.searchParams.get('limit') || 1000);
      list = list.slice(off, off + lim);
      if (single) return list[0] ? send(res, 200, list[0], cors) : send(res, 406, { code: 'PGRST116', message: 'no rows' }, cors);
      return send(res, 200, list, cors);
    }

    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};

    if (req.method === 'POST') {
      if (body.owner_id !== sub) return send(res, 403, { code: '42501', message: 'new row violates row-level security policy for table "batches"' }, cors);
      const key = `${body.owner_id}|${body.id}`;
      if (rows.has(key)) return send(res, 409, { code: '23505', message: 'duplicate key value violates unique constraint' }, cors);
      const row = { ...body, rev: body.rev ?? 1, server_updated_at: new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString() };
      rows.set(key, row); stats.inserts++;
      return send(res, 201, single ? row : [row], cors);
    }

    if (req.method === 'PATCH') {
      const owner = eq('owner_id'), id = eq('id'), rev = eq('rev');
      const row = rows.get(`${owner}|${id}`);
      if (!row || row.owner_id !== sub || (rev !== null && String(row.rev) !== rev)) return send(res, 200, [], cors); // 0 ligne : conflit
      if (body.rev !== undefined && body.rev <= row.rev) return send(res, 400, { code: 'P0001', message: 'La révision doit augmenter' }, cors);
      Object.assign(row, body, { owner_id: row.owner_id, id: row.id, server_updated_at: new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString() });
      stats.updates++;
      return send(res, 200, [row], cors);
    }
    return send(res, 405, { message: 'method not allowed' }, cors);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.MOCK_PORT || 3199);
  createMock().listen(port, '127.0.0.1', () => console.log(`mock supabase on ${port}`));
}
