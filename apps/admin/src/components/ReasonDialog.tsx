import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { FormField, Textarea } from './FormField';
import { Modal } from './Modal';
import { Button, Kbd, cx } from './ui';

/** Moderation presets (stored verbatim — the owner sees them in Azerbaijani). */
export const REJECT_PRESETS = [
  'Şəkillər uyğun deyil',
  'Qiymət real deyil',
  'Təkrar elan',
  'Əlaqə məlumatı təsvirdə',
  'Agentlik sahibi kimi göstərilib',
];
export const BLOCK_PRESETS = ['Saxtakarlıq (fırıldaqçılıq)', 'Spam / kütləvi elan', 'Qaydaların təkrar pozulması', 'Mövcud olmayan əmlak'];

/**
 * Keyboard-first reason picker: 1–N picks a preset, the last number focuses "custom",
 * Enter submits, Esc cancels.
 */
export function ReasonDialog({
  open,
  title,
  presets,
  confirmLabel,
  tone = 'danger',
  busy,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  title: string;
  presets: string[];
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const { t } = useT();
  const [choice, setChoice] = useState<number>(0);
  const [custom, setCustom] = useState('');
  const customRef = useRef<HTMLTextAreaElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const isCustom = choice === presets.length;
  const reason = isCustom ? custom.trim() : presets[choice];
  const valid = !!reason && reason.length >= 3;

  useEffect(() => {
    if (open) {
      setChoice(0);
      setCustom('');
    }
  }, [open]);

  // keyboard focus follows the selected preset so the focus ring and the selection never disagree
  useEffect(() => {
    if (open && choice < presets.length) optionRefs.current[choice]?.focus();
  }, [open, choice, presets.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'TEXTAREA';
      if (!typing && /^[1-9]$/.test(e.key)) {
        const n = Number(e.key) - 1;
        if (n <= presets.length) {
          e.preventDefault();
          setChoice(n);
          if (n === presets.length) setTimeout(() => customRef.current?.focus(), 0);
        }
      } else if (!typing && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        setChoice((c) => (c + (e.key === 'ArrowDown' ? 1 : presets.length)) % (presets.length + 1));
      } else if (e.key === 'Enter' && (!typing || e.metaKey || e.ctrlKey) && valid && !busy) {
        e.preventDefault();
        onSubmit(reason);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, presets.length, valid, reason, busy, onSubmit]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t('Cancel')} <Kbd>Esc</Kbd>
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} disabled={!valid} loading={busy} onClick={() => onSubmit(reason)}>
            {confirmLabel} <kbd className="!border-white/40 !bg-transparent !text-white/90">↵</kbd>
          </Button>
        </>
      }
    >
      <div role="radiogroup" className="space-y-1.5">
        {presets.map((p, i) => (
          <button
            key={p}
            ref={(el) => {
              optionRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={choice === i}
            data-autofocus={i === 0 ? true : undefined}
            onClick={() => setChoice(i)}
            className={cx(
              'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm',
              choice === i ? 'border-brand bg-brand-soft' : 'border-line hover:bg-hover',
            )}
          >
            <Kbd>{i + 1}</Kbd>
            {p}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={isCustom}
          onClick={() => {
            setChoice(presets.length);
            setTimeout(() => customRef.current?.focus(), 0);
          }}
          className={cx('flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm', isCustom ? 'border-brand bg-brand-soft' : 'border-line hover:bg-hover')}
        >
          <Kbd>{presets.length + 1}</Kbd>
          {t('Custom reason…')}
        </button>
        {isCustom && (
          <FormField className="pt-1" hint={t('At least {n} characters. Ctrl+Enter to submit.', { n: 3 })}>
            <Textarea ref={customRef} value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={500} placeholder={t('Explain what the owner must fix')} />
          </FormField>
        )}
      </div>
    </Modal>
  );
}
