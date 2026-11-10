/**
 * The privacy gate. Runs locally on everything Drawer knows about an item (its text, label, file name, OCR or PDF
 * text) before anything could be sent to the model. A match keeps the item home: no API call ever sees it.
 *
 * The rules lean towards flagging: a false positive costs a plainer title, a false negative leaks a code.
 */

export interface SensitivityInput {
  text?: string | null;
  label?: string | null;
  fileName?: string | null;
  /** Text read out of the file locally: OCR, PDF text, a transcript. */
  extracted?: string | null;
}

export interface Sensitivity {
  sensitive: boolean;
  reasons: string[];
}

interface Rule {
  reason: string;
  test: (text: string) => boolean;
}

const URL = /\bhttps?:\/\/\S+/gi;

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const re = (pattern: RegExp) => (text: string) => pattern.test(text);

/** Rules over free text with links removed (a code inside a URL path is usually a product id, not a secret). */
const TEXT_RULES: Rule[] = [
  { reason: 'SSH key', test: re(/\bssh-(?:ed25519|rsa|dss|ecdsa[\w-]*)\s+AAAA/) },
  { reason: 'private key', test: re(/-----BEGIN [A-Z ]*PRIVATE KEY-----/) },
  {
    reason: 'API key or token',
    test: re(/\b(?:sk-[A-Za-z0-9_-]{16,}|sk-ant-[\w-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[\w-]{10,}|AIza[\w-]{30,}|glpat-[\w-]{16,})/),
  },
  // Licence keys and recovery codes: 9622-B9FA-6B99-EA74, 7QR3D-BQE55-H2HYV.
  {
    reason: 'licence or recovery code',
    test: (text) =>
      [...text.matchAll(/\b[A-Z0-9]{4,6}(?:-[A-Z0-9]{4,6}){2,}\b/gi)].some(
        (m) => /\d/.test(m[0]) && /[A-Z]/i.test(m[0]) && !/^\d{4}-\d{2}-\d{2}/.test(m[0]),
      ),
  },
  { reason: 'MAC address', test: re(/\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/i) },
  { reason: 'password', test: re(/\b(?:password|passwd|contraseña|contrasenya|clave|pwd|pin|passcode)\s*[:=]/i) },
  // "card PIN 4821", "codi porta 0013": the word, perhaps one more, then the digits, without a colon.
  { reason: 'password', test: re(/\b(?:password|passwd|contraseña|contrasenya|clave|pwd|pin|passcode|codi|c[oó]digo)\b(?:\s+\S{1,12})?\W{0,3}\d{4,8}\b/i) },
  { reason: 'backup codes', test: re(/\b(?:backup|recovery|2fa|mfa)\s+codes?\b[\s\S]*\d{5,}/i) },
  { reason: 'IBAN', test: re(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){4,7}\b/) },
  { reason: 'ID number', test: re(/\b(?:\d{8}-?[A-HJ-NP-TV-Z]|[XYZ]-?\d{7}-?[A-Z])\b/) },
  {
    reason: 'card number',
    test: (text) =>
      [...text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)].some((m) => {
        const digits = m[0].replace(/\D/g, '');
        return digits.length >= 13 && digits.length <= 19 && luhn(digits);
      }),
  },
  { reason: 'phone number', test: re(/(?<![\d/])(?:\+34[\s-]?)?[6789]\d{2}[\s-]?\d{3}[\s-]?\d{3}(?![\d/])/) },
  {
    reason: 'home address',
    test: re(/\b(?:calle|carrer|c\/|avenida|avinguda|avda\.?|plaza|plaça|passeig|paseo|direcci[oó]n(?: de env[ií]o)?)\b[^\n]{0,60}\d/i),
  },
  // A note that is only a short code, like "q3 0013" or "1834945": door codes, PINs, lockers.
  { reason: 'PIN or short code', test: (text) => /^\s*(?:[a-z]{0,4}\d?\s*)?\d{4,8}\s*$/i.test(text) },
  {
    reason: 'identity document',
    test: re(/\b(?:documento nacional de identidad|permiso de conducci[oó]n|permís de conducció|pasaporte|passport|n[uú]mero de la seguridad social|tarjeta sanitaria)\b/i),
  },
];

/** Rules over URLs: pairing links and anything that carries a secret in the query or fragment. */
const URL_RULES: Rule[] = [
  { reason: 'pairing or secret link', test: re(/[#?&](?:token|secret|key|password|pair|auth|code|otp)=[\w-]{6,}/i) },
  { reason: 'payment link', test: re(/\b(?:paypal\.me|paypal\.com\/paypalme|book\.stripe\.com|buy\.stripe\.com|bizum)/i) },
];

const FILE_NAME = /(certificat|certificado|\bdni\b|\bnie\b|passport|pasaporte|passaport|autorizaci|n[oó]mina|t[ií]tol|contrato|contracte|extracte|extracto|factura|invoice|seguridad social|vida laboral|carnet|licencia|llicència|tickets?-)/i;

export function checkSensitivity(input: SensitivityInput): Sensitivity {
  const reasons = new Set<string>();
  const texts = [input.text, input.label, input.extracted].filter((t): t is string => !!t && t.trim().length > 0);

  for (const text of texts) {
    const urls = text.match(URL) ?? [];
    const withoutUrls = text.replace(URL, ' ');
    for (const rule of TEXT_RULES) if (rule.test(withoutUrls)) reasons.add(rule.reason);
    for (const url of urls) for (const rule of URL_RULES) if (rule.test(url)) reasons.add(rule.reason);
  }
  if (input.fileName && FILE_NAME.test(input.fileName)) reasons.add('personal document');

  return { sensitive: reasons.size > 0, reasons: [...reasons] };
}
