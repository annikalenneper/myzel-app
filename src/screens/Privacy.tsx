// Kurzer Datenschutzhinweis in der App (ANFORDERUNGEN 9, 10.1). Entwurf – die Nutzerin gibt
// den Wortlaut frei und ergänzt den Namen des Vereins und die Kontaktadresse.
import { useNavigate } from 'react-router-dom';
import { IconBack } from '../ui/icons';

const SECTIONS: [title: string, text: string][] = [
  [
    'Wofür Myzel da ist',
    'Myzel ist das interne Werkzeug unseres Kollektivs für Aufgaben, Veranstaltungen und Absprachen. Zugang haben nur Personen, die auf der Mitgliederliste stehen.',
  ],
  [
    'Was gespeichert wird',
    'Dein Name, dein Kürzel und deine Mail-Adresse für die Anmeldung. Dazu das, was du in Myzel einträgst: Aufgaben, Kommentare, Zuständigkeiten und der Verlauf der Änderungen (wer hat wann was geändert). Mehr nicht.',
  ],
  [
    'Wer es sieht',
    'Alle aktiven Mitglieder sehen alle Inhalte. Nach außen wird nichts weitergegeben. Wer deaktiviert wird, kann sich nicht mehr anmelden; der Name bleibt im Verlauf früherer Änderungen sichtbar.',
  ],
  [
    'Wo die Daten liegen',
    'Die Datenbank liegt bei Supabase in der EU (Irland), die App und ihre Server-Funktionen laufen bei Netlify. Mit beiden Anbietern besteht ein Vertrag zur Auftragsverarbeitung. Die Anmeldung läuft über dein Google-Konto oder einen Link per Mail. Meldest du dich mit Google an, sieht Google diese Anmeldung.',
  ],
  [
    'Benachrichtigungen',
    'Ab der nächsten Ausbaustufe kann Myzel dich per Push und – wenn du es selbst verknüpfst – per Telegram erinnern. Telegram ist ein Anbieter außerhalb der EU; die Verknüpfung ist freiwillig und lässt sich jederzeit trennen.',
  ],
  [
    'Deine Rechte',
    'Du kannst Auskunft, Berichtigung und Löschung deiner Daten verlangen. Wende dich dafür an eine Person mit Admin-Rechten oder an den Vorstand.',
  ],
];

export function Privacy() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-[560px]">
      <div className="flex h-[60px] items-center gap-1 px-3">
        <button
          type="button"
          onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/'))}
          aria-label="Zurück"
          className="flex size-11 items-center justify-center text-text"
        >
          <IconBack />
        </button>
        <span className="font-mono text-[13px] text-leise">MYZEL</span>
      </div>
      <div className="flex flex-col gap-5 px-5 pb-10">
        <h1 className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-1px]">Datenschutz</h1>
        {SECTIONS.map(([title, text]) => (
          <section key={title} className="flex flex-col gap-1.5">
            <h2 className="label-mono m-0 font-normal">{title}</h2>
            <p className="m-0 text-[15px] leading-normal text-weich">{text}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
