// S-01 Anmeldung · P1
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useFeedback } from '../app/feedback';
import { Splash, useSession } from '../app/session';
import { api, demoAvailable, setDemo } from '../data';
import { emailInputSchema } from '../shared/schema';
import { FieldError, GhostButton } from '../ui/bits';
import { IconGoogle } from '../ui/icons';
import { Sheet } from '../ui/Sheet';

export function Login() {
  const session = useSession();
  const { run } = useFeedback();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chooser, setChooser] = useState(false);
  const demo = api.demo;

  if (!session) return <Splash />;
  if (session.state === 'member') return <Navigate to="/aufgaben" replace />;
  if (session.state === 'no_access') return <Navigate to="/kein-zugriff" replace />;

  const validEmail = emailInputSchema.safeParse(email).success;

  const google = () => {
    // Schritt A kennt keine echten Konten: statt Google erscheint die Auswahl der Testkonten.
    if (demo) setChooser(true);
    else void run(() => api.signInWithGoogle());
  };

  const sendLink = async () => {
    setError(null);
    const ok = await run(() => api.requestMagicLink(email).then(() => true), {
      onInvalid: (e) => setError(e.message),
    });
    if (ok) setSent(true);
  };

  return (
    <div className="overflow-hidden">
      <div className="relative mx-auto flex min-h-dvh max-w-[480px] flex-col">
        <div
          aria-hidden="true"
          className="absolute -top-40 -left-[120px] size-[420px] rounded-full bg-[radial-gradient(circle,rgba(240,98,192,0.28),rgba(12,10,18,0)_70%)]"
        />
        <div
          aria-hidden="true"
          className="absolute top-[120px] -right-[140px] size-[380px] rounded-full bg-[radial-gradient(circle,rgba(91,127,255,0.22),rgba(12,10,18,0)_70%)]"
        />

        <div className="relative flex flex-col gap-3.5 px-7 pt-[120px]">
          <img src="/myzel-logo.png" alt="Myzel" className="h-20 w-[120px] self-start object-contain" />
          <h1 className="m-0 text-[40px] leading-[1.1] font-bold tracking-[-1.5px]">Myzel</h1>
          <p className="m-0 text-[16px] leading-normal text-weich">
            Unsere Aufgaben, Termine und Dokumente an einem Ort.
          </p>
        </div>

        <div className="relative mt-auto flex flex-col gap-3.5 px-7 pt-10 pb-10">
          {!sent ? (
            <form
              className="flex flex-col gap-3.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (validEmail) void sendLink();
              }}
            >
              <button
                type="button"
                data-wf="WF-LOG-01"
                onClick={google}
                className="flex h-[54px] items-center justify-center gap-2.5 rounded-[27px] bg-text text-[16px] font-semibold text-grund"
              >
                <IconGoogle />
                Mit Google anmelden
              </button>
              <div className="flex items-center gap-3 font-mono text-[11px] text-leise">
                <span className="h-px flex-1 bg-linie" />
                ODER PER MAIL
                <span className="h-px flex-1 bg-linie" />
              </div>
              <label htmlFor="mail" className="sr-only">
                E-Mail-Adresse
              </label>
              <input
                id="mail"
                type="email"
                autoComplete="email"
                placeholder="deine@mail.de"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                className="h-[50px] rounded-[25px] border border-rand bg-flaeche px-[18px] text-[16px] text-text"
              />
              <FieldError>{error}</FieldError>
              <button
                type="submit"
                data-wf="WF-LOG-02"
                disabled={!validEmail}
                className="h-[50px] rounded-[25px] border border-rand-stark bg-transparent text-[15px] font-semibold text-text disabled:border-linie disabled:text-leise"
              >
                Link per Mail schicken
              </button>
              {demoAvailable && (
                <button
                  type="button"
                  data-demo="start"
                  onClick={() => setDemo(true)}
                  className="h-11 text-[14px] text-weich underline underline-offset-4"
                >
                  Demo ansehen – mit Testdaten, ohne Konto
                </button>
              )}
            </form>
          ) : (
            <div className="flex flex-col gap-3.5 rounded-[18px] border border-linie bg-flaeche p-[18px]">
              <span className="font-mono text-[11px] text-gruen">MAIL UNTERWEGS</span>
              <span className="text-[15px] leading-normal text-weich">
                Wenn die Adresse bekannt ist, kommt gleich ein Link. Schau auch im Spam-Ordner nach.
              </span>
              {demo && (
                <button
                  type="button"
                  data-demo="magic-link"
                  onClick={() => void run(() => demo.openMagicLink())}
                  className="h-11 rounded-[22px] border border-dashed border-rand-stark text-[14px] text-weich"
                >
                  Testdaten: Link aus der Mail öffnen
                </button>
              )}
              <GhostButton className="h-11 text-[14px]" onClick={() => setSent(false)}>
                Zurück
              </GhostButton>
            </div>
          )}
          <Link to="/datenschutz" className="hit self-center font-mono text-[11px] text-leise no-underline">
            DATENSCHUTZ
          </Link>
        </div>

        {chooser && demo && (
          <Sheet title="Testkonto wählen" onClose={() => setChooser(false)} closeButton>
            <span className="text-[14px] leading-normal text-weich">
              Vorschau mit Testdaten: Hier erscheint später die Kontoauswahl von Google. Zum Ausprobieren
              stehen diese erfundenen Konten bereit.
            </span>
            <div className="flex flex-col gap-1.5">
              {demo.accounts().map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => void run(() => demo.signInAs(account.email))}
                  className="flex min-h-[52px] flex-col justify-center gap-0.5 rounded-xl border border-linie bg-grund px-3.5 py-2 text-left"
                >
                  <span className="text-[15px] font-semibold">
                    {account.label} <span className="font-normal text-leise">· {account.hint}</span>
                  </span>
                  <span className="font-mono text-[11px] text-leise">{account.email}</span>
                </button>
              ))}
            </div>
          </Sheet>
        )}
      </div>
    </div>
  );
}
