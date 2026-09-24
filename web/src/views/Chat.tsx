import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '../App';
import {
  ApiError,
  askQuestion,
  createSubscription,
  listSubscriptions,
  type BillingCycle,
  type Subscription,
  type Tier,
} from '../lib/api';

const FREE_LIMIT_FALLBACK = 3;

const PLANS: { tier: Tier; name: string; messages: string; monthlyCents: number; yearlyCents: number }[] = [
  { tier: 'BASIC', name: 'Basic', messages: '10 messages', monthlyCents: 999, yearlyCents: 9990 },
  { tier: 'PRO', name: 'Pro', messages: '100 messages', monthlyCents: 2999, yearlyCents: 29990 },
  {
    tier: 'ENTERPRISE',
    name: 'Enterprise',
    messages: 'Unlimited messages',
    monthlyCents: 19999,
    yearlyCents: 199990,
  },
];

const TIER_NAMES: Record<Tier, string> = { BASIC: 'Basic', PRO: 'Pro', ENTERPRISE: 'Enterprise' };

interface Exchange {
  id: string;
  question: string;
  answer: string;
  source: 'FREE' | 'BUNDLE';
  freeRemaining: number;
  freeLimit: number;
  totalTokens: number;
  latencyMs: number;
}

interface MeterState {
  kind: 'free' | 'bundle';
  label: string;
  remaining: number | null;
  limit: number | null;
}

function formatReset(iso?: string): string {
  const date = iso
    ? new Date(iso)
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(date);
}

function formatPrice(cents: number, cycle: BillingCycle): string {
  return `$${(cents / 100).toFixed(2)}${cycle === 'MONTHLY' ? '/mo' : '/yr'}`;
}

function meterFromSubscription(sub: Subscription): MeterState {
  return {
    kind: 'bundle',
    label: `${TIER_NAMES[sub.tier]} bundle`,
    remaining: sub.maxMessages === null ? null : Math.max(0, sub.maxMessages - sub.usedMessages),
    limit: sub.maxMessages,
  };
}

function readResetsAt(error: ApiError): string | undefined {
  const value = error.details?.['freeResetsAt'];
  return typeof value === 'string' ? value : undefined;
}

function Digits({ value }: { value: number }) {
  return (
    <span className="digits" aria-hidden="true">
      {[...String(value)].map((char, index) => (
        <span className="digit" key={index}>
          <span className="digit-wheel" style={{ transform: `translateY(-${Number(char)}em)` }}>
            {['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <span key={digit}>{digit}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

function Meter({ state, exhausted }: { state: MeterState; exhausted: boolean }) {
  const { label, remaining, limit } = state;
  const spent = limit === null || remaining === null ? 0 : limit - remaining;
  const percent = limit ? Math.min(100, Math.max(0, (spent / limit) * 100)) : 0;
  const spoken = remaining === null ? 'unlimited' : `${remaining} of ${limit ?? '?'} left`;
  return (
    <div
      className={exhausted ? 'meter meter--exhausted' : 'meter'}
      role="status"
      aria-label={`${label}: ${spoken}`}
    >
      <span className="meter-label">{label}</span>
      <span className="meter-figures">
        {remaining === null ? (
          <span className="meter-unlimited">unlimited</span>
        ) : (
          <>
            <Digits value={remaining} />
            <span className="meter-limit"> / {limit ?? '?'}</span>
          </>
        )}
      </span>
      <span className="meter-track" aria-hidden="true">
        <span className="meter-fill" style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}

export function Chat({ session, onSignOut }: { session: Session; onSignOut: () => Promise<void> }) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [meter, setMeter] = useState<MeterState>({
    kind: 'free',
    label: 'free quota',
    remaining: FREE_LIMIT_FALLBACK,
    limit: FREE_LIMIT_FALLBACK,
  });
  const [exhausted, setExhausted] = useState(false);
  const [resetsAt, setResetsAt] = useState<string | undefined>(undefined);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [buying, setBuying] = useState<Tier | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('MONTHLY');
  const [error, setError] = useState<string | null>(null);
  const [keyLost, setKeyLost] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [exchanges.length, exhausted]);

  async function refreshBundleMeter(subscriptionId: string | null) {
    let sub: Subscription | undefined;
    try {
      const result = await listSubscriptions(session);
      sub = result.items.find((item) => item.id === subscriptionId);
    } catch {
      sub = undefined;
    }
    if (sub) {
      setMeter(meterFromSubscription(sub));
      return;
    }
    setMeter((current) =>
      current.kind === 'bundle' && current.remaining !== null
        ? { ...current, remaining: Math.max(0, current.remaining - 1) }
        : current,
    );
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setError(null);
    setBusy(true);
    const startedAt = performance.now();
    try {
      const answer = await askQuestion(session, trimmed);
      const freeLimit = meter.limit ?? FREE_LIMIT_FALLBACK;
      setExchanges((items) => [
        ...items,
        {
          id: answer.id,
          question: answer.question,
          answer: answer.answer,
          source: answer.quota.source,
          freeRemaining: answer.quota.freeRemaining,
          freeLimit,
          totalTokens: answer.usage.totalTokens,
          latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        },
      ]);
      setQuestion('');
      setExhausted(false);
      if (answer.quota.source === 'FREE') {
        setMeter((current) => ({
          ...current,
          kind: 'free',
          label: 'free quota',
          remaining: answer.quota.freeRemaining,
          limit: current.limit ?? FREE_LIMIT_FALLBACK,
        }));
        setResetsAt(answer.quota.freeResetsAt);
      } else {
        await refreshBundleMeter(answer.quota.subscriptionId);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'QUOTA_EXHAUSTED') {
        setExhausted(true);
        setMeter((current) => ({
          ...current,
          kind: 'free',
          label: 'free quota',
          remaining: 0,
          limit: current.limit ?? FREE_LIMIT_FALLBACK,
        }));
        setResetsAt(readResetsAt(cause));
      } else if (cause instanceof ApiError && cause.code === 'KEY_NOT_BOUND') {
        setKeyLost(true);
      } else {
        setError(describe(cause));
      }
    } finally {
      setBusy(false);
    }
  }

  async function buy(tier: Tier) {
    setError(null);
    setBuying(tier);
    try {
      const sub = await createSubscription(session, tier, cycle);
      setMeter(meterFromSubscription(sub));
      setExhausted(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'KEY_NOT_BOUND') setKeyLost(true);
      else if (cause instanceof ApiError && cause.code === 'PAYMENT_FAILED')
        setError('Payment was declined. Try again.');
      else setError(describe(cause));
    } finally {
      setBuying(null);
    }
  }

  const helper =
    meter.kind === 'bundle'
      ? `${meter.label}: ${meter.remaining ?? 'unlimited'}${meter.limit === null ? '' : ` of ${meter.limit}`} left.`
      : `Uses ${meter.limit === null ? 0 : meter.limit - (meter.remaining ?? 0)} of ${meter.limit ?? FREE_LIMIT_FALLBACK} free. Resets ${formatReset(resetsAt)}.`;
  const signedAs = session.sessionId || session.bindingId;

  return (
    <main className="page">
      <header className="masthead">
        <div className="masthead-titles">
          <h1>GGI assistant</h1>
          <button type="button" className="signout" onClick={() => void onSignOut()}>
            Sign out
          </button>
        </div>
        <Meter state={meter} exhausted={exhausted} />
      </header>
      <section className="exchanges">
        {exchanges.length === 0 ? <p className="empty">Ask a question to see it answered here.</p> : null}
        {exchanges.map((item) => (
          <article className="exchange" key={item.id}>
            <p className="question">{item.question}</p>
            <p className="answer">{item.answer}</p>
            <p className="meta">
              <span>
                {item.source === 'FREE'
                  ? `free quota ${item.freeRemaining}/${item.freeLimit} left`
                  : 'bundle quota'}
              </span>
              <span>{item.totalTokens} tokens</span>
              <span>{item.latencyMs} ms</span>
            </p>
          </article>
        ))}
        <div ref={endRef} />
      </section>
      <section className="composer-zone">
        {keyLost ? (
          <div className="key-lost" role="alert">
            <p>Your signing key is no longer valid. Sign in again to ask another question.</p>
            <button type="button" onClick={() => void onSignOut()}>
              Sign in again
            </button>
          </div>
        ) : exhausted ? (
          <section className="exhausted" aria-labelledby="exhausted-copy">
            <p className="exhausted-copy" id="exhausted-copy">
              No messages left this month. Resets {formatReset(resetsAt)}.
            </p>
            <div className="cycle" role="group" aria-label="Billing cycle">
              <button
                type="button"
                className={cycle === 'MONTHLY' ? 'cycle-option cycle-option--on' : 'cycle-option'}
                aria-pressed={cycle === 'MONTHLY'}
                onClick={() => setCycle('MONTHLY')}
              >
                Monthly
              </button>
              <button
                type="button"
                className={cycle === 'YEARLY' ? 'cycle-option cycle-option--on' : 'cycle-option'}
                aria-pressed={cycle === 'YEARLY'}
                onClick={() => setCycle('YEARLY')}
              >
                Yearly
              </button>
            </div>
            <table className="plans">
              <thead>
                <tr>
                  <th scope="col">Plan</th>
                  <th scope="col">Price</th>
                  <th scope="col">
                    <span className="sr-only">Buy</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {PLANS.map((plan) => (
                  <tr key={plan.tier}>
                    <th scope="row">
                      <span className="plan-name">{plan.name}</span>
                      <span className="plan-messages">{plan.messages}</span>
                    </th>
                    <td className="plan-price">
                      {formatPrice(cycle === 'MONTHLY' ? plan.monthlyCents : plan.yearlyCents, cycle)}
                    </td>
                    <td>
                      <button type="button" disabled={buying !== null} onClick={() => void buy(plan.tier)}>
                        {buying === plan.tier ? 'Buying…' : `Buy ${plan.name}`}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="plans-note">Auto-renew is on.</p>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
          </section>
        ) : (
          <>
            <form
              className="composer"
              onSubmit={(event) => {
                void ask(event);
              }}
            >
              <input
                className="composer-input"
                type="text"
                placeholder="Ask a question…"
                aria-label="Question"
                maxLength={4000}
                value={question}
                disabled={busy}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <button type="submit" disabled={busy || question.trim() === ''}>
                {busy ? 'Asking…' : 'Ask'}
              </button>
            </form>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            <p className="helper">{helper}</p>
          </>
        )}
      </section>
      <footer className="footer">
        signed as {signedAs.slice(0, 4)}…{signedAs.slice(-2)} · Supabase session
      </footer>
    </main>
  );
}

function describe(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'RATE_LIMITED') return 'Too many requests. Wait a moment and try again.';
    if (cause.code === 'REQUEST_TIMEOUT') return 'The answer took too long. Try again.';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : 'Something went wrong. Try again.';
}
