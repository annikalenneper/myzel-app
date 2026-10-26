// Phase 9: Jedes Artefakt lässt sich löschen – mit Rückfrage. Löschen ist Archivieren: Der Eintrag verschwindet aus
// den Listen, bleibt aber erhalten und lässt sich gleich danach rückgängig machen (WF-ALL-09, Aufgaben WF-AUF-14).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActions } from '../../app/useActions';
import { api } from '../../data';
import type { ArchiveTarget } from '../../shared/schema';
import { GhostButton } from '../../ui/bits';
import { IconMore } from '../../ui/icons';
import { ConfirmDialog } from '../knowledge/DetailParts';

/** Rückfrage vor dem Löschen */
export function DeleteDialog({
  noun,
  consequence,
  wf = 'WF-ALL-09',
  onConfirm,
  onClose,
}: {
  /** „Veranstaltung“, „Termin“, „Fakt“ … */
  noun: string;
  /** was mit Verknüpftem passiert, z. B. „Die Aufgaben bleiben erhalten.“ */
  consequence?: string;
  wf?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog label={`${noun} löschen`} wf={wf} onClose={onClose}>
      <h2 className="m-0 text-[20px] leading-[1.25] font-bold">{noun} löschen?</h2>
      <span className="text-[15px] leading-normal text-weich">
        Verschwindet aus allen Listen und wird archiviert – gleich danach lässt es sich rückgängig machen.
        {consequence && ` ${consequence}`}
      </span>
      <button
        type="button"
        data-wf={wf}
        onClick={() => {
          onClose();
          onConfirm();
        }}
        className="h-12 rounded-3xl bg-rot text-[15px] font-bold text-grund"
      >
        Löschen
      </button>
      <GhostButton onClick={onClose}>Doch nicht</GhostButton>
    </ConfirmDialog>
  );
}

/** Löschen über WF-ALL-09, danach zurück zur Liste – „Rückgängig“ bleibt in der Leiste */
export function useDeleteArtifact(
  type: ArchiveTarget,
  id: string,
  version: () => number,
  backTo: string | null,
) {
  const act = useActions();
  const navigate = useNavigate();
  return async () => {
    const ok = await act(() => api.archiveArtifact(type, id, version()), {
      success: 'Gelöscht',
      undo: (r) => r.undo_token,
    });
    if (ok && backTo) navigate(backTo);
  };
}

/** „…“ mit „Löschen …“ und Rückfrage – für die Kopfzeilen der Detailansichten */
export function DeleteAction({
  noun,
  consequence,
  wf = 'WF-ALL-09',
  onConfirm,
}: {
  noun: string;
  consequence?: string;
  wf?: string;
  onConfirm: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        data-wf={wf}
        onClick={() => setMenu(!menu)}
        aria-label="Weitere Aktionen"
        aria-expanded={menu}
        className="flex size-11 items-center justify-center text-text"
      >
        <IconMore />
      </button>
      {menu && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Menü schließen"
            onClick={() => setMenu(false)}
            className="fixed inset-0 z-[5] cursor-default"
          />
          <div className="absolute top-full right-1 z-[6] flex w-[200px] flex-col gap-0.5 rounded-[14px] border border-rand bg-erhoeht p-1.5 shadow-[0_12px_28px_rgba(0,0,0,0.5)]">
            <button
              type="button"
              data-wf={wf}
              onClick={() => {
                setMenu(false);
                setAsking(true);
              }}
              className="flex min-h-11 items-center rounded-[10px] px-3 text-left text-[15px] text-rot-hell"
            >
              Löschen …
            </button>
          </div>
        </>
      )}
      {asking && (
        <DeleteDialog
          noun={noun}
          consequence={consequence}
          wf={wf}
          onConfirm={onConfirm}
          onClose={() => setAsking(false)}
        />
      )}
    </div>
  );
}
