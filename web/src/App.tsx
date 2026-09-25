import { useCallback, useEffect, useState } from 'react';
import { registerDeviceKey } from './lib/api';
import { generateDeviceKey, type DeviceKey } from './lib/signer';
import { supabase } from './lib/supabase';
import { Chat } from './views/Chat';
import { SignIn } from './views/SignIn';

export interface Session {
  accessToken: string;
  sessionId: string;
  key: DeviceKey;
  bindingId: string;
}

function readSessionId(accessToken: string): string {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return '';
    const claims = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/'))) as {
      session_id?: string;
    };
    return claims.session_id ?? '';
  } catch {
    return '';
  }
}

export function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    void supabase.auth.signOut().finally(() => setBooting(false));
  }, []);

  const bind = useCallback(async (accessToken: string) => {
    const key = await generateDeviceKey();
    const { bindingId } = await registerDeviceKey(accessToken, key.publicJwk);
    setSession({ accessToken, sessionId: readSessionId(accessToken), key, bindingId });
  }, []);

  const signIn = useCallback(
    async (email: string, password: string, create: boolean) => {
      if (create) {
        const result = await supabase.auth.signUp({ email, password });
        if (result.error) throw new Error(result.error.message);
        if (result.data.session) {
          await bind(result.data.session.access_token);
          return;
        }
      }
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw new Error(result.error.message);
      await bind(result.data.session.access_token);
    },
    [bind],
  );

  const signOut = useCallback(async () => {
    setSession(null);
    await supabase.auth.signOut();
  }, []);

  if (booting) return <main className="page" aria-busy="true" />;
  if (!session) return <SignIn onSignIn={signIn} />;
  return <Chat session={session} onSignOut={signOut} />;
}
