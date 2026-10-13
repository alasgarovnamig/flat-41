/** "50 123 45 67" formatting while typing (9 national digits after +994). */
export const formatLocalPhone = (digits: string) => {
  const d = digits.replace(/\D/g, '').slice(0, 9);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
};

/** "+994501234567" → "501234567" (national digits for the +994 input). */
export const toLocalDigits = (e164: string | null | undefined) => (e164 ?? '').replace(/^\+994/, '').replace(/\D/g, '').slice(0, 9);

/** wa.me link (digits only, no "+"). */
export const whatsappUrl = (e164: string, text: string) => `https://wa.me/${e164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
