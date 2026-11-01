// Statuswechsel mit Rückfrage (Nutzerin, 31.10.2026): erklärt den neuen Status, bevor er gilt. „Rückgängig“ gibt es
// danach weiterhin.
import type { StatusHelp } from '../../shared/rules/statusHelp';
import { GhostButton, LightButton } from '../../ui/bits';
import { ConfirmDialog } from '../knowledge/DetailParts';

export function StatusConfirmDialog({
  help,
  wf,
  onConfirm,
  onClose,
}: {
  help: StatusHelp;
  wf: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog label={help.title} wf={wf} onClose={onClose}>
      <h2 className="m-0 text-[20px] leading-[1.25] font-bold">{help.title}</h2>
      <span className="text-[15px] leading-normal text-weich">{help.text}</span>
      <LightButton
        data-wf={wf}
        onClick={() => {
          onClose();
          onConfirm();
        }}
      >
        {help.confirm}
      </LightButton>
      <GhostButton onClick={onClose}>Abbrechen</GhostButton>
    </ConfirmDialog>
  );
}
