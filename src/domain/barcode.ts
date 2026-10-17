/**
 * Bottle barcodes (GTIN): the 13 digits printed under the bars on a back label. Everything here is
 * pure, so what counts as a barcode is decided in one place for the scanner, the typed entry, the
 * stored data and the spreadsheet import.
 *
 * Canonical form: 13 digits (a 12-digit UPC-A gets a leading 0, which is how it is the same product
 * everywhere else), or the 8 digits of a short EAN-8. A check digit that doesn't match is refused,
 * because that is what a misread or mistyped digit looks like.
 */

/** The sum that the last digit of a GTIN completes to a multiple of ten. */
function checkDigit(body: string): number {
  let sum = 0;
  // Counting from the right, the digit next to the check digit weighs 3, then 1, then 3…
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body[i]) * w;
  return (10 - (sum % 10)) % 10;
}

export function hasValidCheckDigit(digits: string): boolean {
  return /^\d{8,14}$/.test(digits) && checkDigit(digits.slice(0, -1)) === Number(digits.at(-1));
}

/** Why a typed or scanned number isn't a bottle barcode, in words for the person typing it; null when it is one. */
export function barcodeProblem(input: string): string | null {
  const digits = input.replace(/[\s\-.]/g, '');
  if (!digits) return 'Enter the number printed under the bars.';
  if (!/^\d+$/.test(digits)) return 'A barcode is made of digits only.';
  if (digits.length === 14) return 'This looks like a carton barcode (14 digits). Use the one on the bottle itself: 13 digits.';
  if (![8, 12, 13].includes(digits.length)) return `A bottle barcode has 13 digits (sometimes 12 or 8), not ${digits.length}.`;
  if (!hasValidCheckDigit(digits)) return 'The last digit doesn’t match the others, so one of them was misread or mistyped. Try again.';
  return null;
}

/** The canonical barcode for a number, or null when it isn't one. */
export function normalizeBarcode(input: string): string | null {
  if (barcodeProblem(input) !== null) return null;
  const digits = input.replace(/[\s\-.]/g, '');
  return digits.length === 12 ? `0${digits}` : digits;
}

/** For display: the digits grouped the way they are printed (1 + 6 + 6), or as they are for a short one. */
export function formatBarcode(code: string): string {
  return code.length === 13 ? `${code[0]} ${code.slice(1, 7)} ${code.slice(7)}` : code;
}
