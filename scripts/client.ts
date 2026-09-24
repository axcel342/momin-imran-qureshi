import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from './lib/signer';

if (existsSync('.env')) process.loadEnvFile('.env');
const SESSION_FILE = '.ggi-session.json';
const API = process.env.API_BASE_URL ?? 'http://localhost:3000';

interface Session {
  accessToken: string;
  privateKeyPem: string;
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

async function bind(accessToken: string): Promise<void> {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const res = await fetch(`${API}/v1/auth/device-keys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } }),
  });
  console.log(res.status, await res.text());
  if (!res.ok) process.exit(1);
  const session: Session = {
    accessToken,
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  };
  writeFileSync(SESSION_FILE, JSON.stringify(session));
  chmodSync(SESSION_FILE, 0o600);
  console.log(`Key bound. Session saved to ${SESSION_FILE}`);
}

async function call(method: string, path: string, body?: unknown): Promise<void> {
  if (!existsSync(SESSION_FILE))
    throw new Error('Not logged in: run `npm run client -- login <email> <password>`');
  const s = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as Session;
  const rawBody = body === undefined ? '' : JSON.stringify(body);
  const headers = signRequest({
    method,
    url: path,
    rawBody,
    token: s.accessToken,
    privateKey: createPrivateKey(s.privateKeyPem),
  });
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: rawBody }),
  });
  const text = await res.text();
  console.log(res.status, text ? JSON.stringify(JSON.parse(text), null, 2) : '');
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const supabase = () =>
    createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  switch (cmd) {
    case 'signup': {
      const { error } = await supabase().auth.signUp({ email: args[0] ?? '', password: args[1] ?? '' });
      console.log(
        error
          ? `Error: ${error.message}`
          : 'Signed up. Confirm your email if confirmation is enabled, then log in.',
      );
      return;
    }
    case 'login': {
      const { data, error } = await supabase().auth.signInWithPassword({
        email: args[0] ?? '',
        password: args[1] ?? '',
      });
      if (error) throw new Error(error.message);
      return bind(data.session.access_token);
    }
    case 'login-token':
      return bind(args[0] ?? '');
    case 'me':
      return call('GET', '/v1/auth/me');
    case 'ask':
      return call('POST', '/v1/chat/messages', { question: args.join(' ') });
    case 'chats':
      return call('GET', '/v1/chat/messages');
    case 'subscribe':
      return call('POST', '/v1/subscriptions', {
        tier: args[0],
        billingCycle: args[1],
        autoRenew: (args[2] ?? 'true') === 'true',
      });
    case 'subs':
      return call('GET', '/v1/subscriptions');
    case 'auto-renew':
      return call('PATCH', `/v1/subscriptions/${args[0] ?? ''}`, { autoRenew: args[1] === 'true' });
    case 'cancel':
      return call('POST', `/v1/subscriptions/${args[0] ?? ''}/cancel`);
    case 'metrics':
      return call('GET', '/v1/admin/metrics');
    case 'billing-run':
      return call('POST', '/v1/admin/billing/run');
    default:
      console.log(
        'Commands: signup|login <email> <pw> · login-token <jwt> · me · ask <q> · chats · subscribe <TIER> <CYCLE> [autoRenew] · subs · auto-renew <id> <bool> · cancel <id> · metrics · billing-run',
      );
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
