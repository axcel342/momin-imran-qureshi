import { useState } from 'react';
import { ApiError } from '../lib/api';

interface Props {
  onSignIn: (email: string, password: string, create: boolean) => Promise<void>;
}

export function SignIn({ onSignIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<'signin' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(create: boolean) {
    setError(null);
    setPending(create ? 'create' : 'signin');
    try {
      await onSignIn(email, password, create);
    } catch (cause) {
      setError(describe(cause));
      setPending(null);
    }
  }

  return (
    <main className="page page--signin">
      <header className="masthead masthead--signin">
        <h1>GGI assistant</h1>
        <p className="tagline">
          Sign in to ask questions. Every account gets free messages each month, then you choose a bundle.
        </p>
      </header>
      <form
        className="signin"
        onSubmit={(event) => {
          event.preventDefault();
          void run(false);
        }}
      >
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <button type="submit" disabled={pending !== null}>
            {pending === 'signin' ? 'Signing in…' : 'Sign in'}
          </button>
          <button type="button" className="ghost" disabled={pending !== null} onClick={() => void run(true)}>
            {pending === 'create' ? 'Creating account…' : 'Create account'}
          </button>
        </div>
      </form>
    </main>
  );
}

function describe(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === 'KEY_BINDING_WINDOW_CLOSED') {
    return 'Sign-in took too long. Sign in again.';
  }
  if (cause instanceof ApiError && cause.code === 'KEY_ALREADY_BOUND') {
    return 'Sign-in could not be completed. Try again.';
  }
  return cause instanceof Error ? cause.message : 'Something went wrong. Try again.';
}
