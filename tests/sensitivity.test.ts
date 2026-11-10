import { describe, expect, it } from 'vitest';
import { checkSensitivity } from '../src/lib/server/sensitivity';

/**
 * Every kind of secret found in the real chats, re-made with invented values of the same shape. A miss here means a
 * code, key or document could reach the model.
 */
const SENSITIVE: [string, Parameters<typeof checkSensitivity>[0]][] = [
  ['Windows-style product key', { text: 'win key 4XK7M-QP2RT-9WZ8B' }],
  ['hex licence code', { text: '1A2B-C3D4-5E6F-7A8B' }],
  ['MAC address', { text: 'laptop mac 3c:22:fb:1a:9e:04' }],
  ['pairing link', { text: 'https://pair.example.app/connect#token=Zx81Qa77Kp' }],
  ['secret query', { text: 'https://example.net/join?code=AB12CD34EF' }],
  ['ssh key', { text: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleExampleExample owner@pc' }],
  ['private key', { text: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----' }],
  ['anthropic key', { text: 'sk-ant-api03-abcdefghijklmnopqrstuv' }],
  ['github token', { text: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }],
  ['IBAN', { text: 'ES91 2100 0418 4502 0005 1332' }],
  ['IBAN without spaces', { text: 'pay to ES9121000418450200051332' }],
  ['DNI', { text: 'dni 12345678Z' }],
  ['NIE', { text: 'X1234567L' }],
  ['card number', { text: '4111 1111 1111 1111' }],
  ['Spanish mobile', { text: 'call me 612 345 678' }],
  ['Spanish mobile with prefix', { text: '+34 612345678' }],
  ['home address', { text: 'Carrer de la Pau 12, 3r 2a' }],
  ['address in Spanish', { text: 'Dirección de envío: Calle Mayor 5' }],
  ['door code', { text: 'q3 0013' }],
  ['bare PIN', { text: '1834' }],
  ['PIN in a sentence', { text: 'my card PIN 4821 is what?' }],
  ['door code in Catalan', { text: 'codi porta 0013' }],
  ['password', { text: 'wifi password: hunter22' }],
  ['contraseña', { text: 'contraseña = gatos' }],
  ['backup codes', { text: 'backup codes 84721 99310 12345' }],
  ['payment link', { text: 'https://paypal.me/someone/12' }],
  ['driving permit PDF by name', { fileName: 'autorizacion_conducir.pdf' }],
  ['certificate PDF by name', { fileName: 'Certificat_matricula.pdf' }],
  ['tickets PDF by name', { fileName: 'tickets-concert-2026.pdf' }],
  ['invoice by name', { fileName: 'Factura_0042.pdf' }],
  ['identity document text in a scan', { fileName: 'scan.pdf', extracted: 'PERMISO DE CONDUCCIÓN\nApellidos…' }],
  ['phone in OCR', { fileName: 'IMG_1.jpg', extracted: 'Contacto 699 111 222' }],
  ['code in the label', { text: 'https://example.com/product', label: 'pin: 4455' }],
];

const SAFE: [string, Parameters<typeof checkSensitivity>[0]][] = [
  ['a game recipe', { text: 'Cocaine? no: OG Kush + Cuke + Banana → Energizing, Munchies. Sell 120' }],
  ['a timetable PDF', { fileName: 'GEI_1r1rSem.pdf', extracted: 'Dilluns 8:00-10:00 Càlcul\nDimarts 10:00-12:00 Física' }],
  ['a product link with an ASIN', { text: 'https://www.amazon.es/dp/B0ABC12345?th=1' }],
  ['a date', { text: 'exam on 2026-01-15' }],
  ['a price list', { text: 'G305 39,99€ / Viper Mini 29,99€' }],
  ['a YouTube link', { text: 'https://youtu.be/dQw4w9WgXcQ?si=abcdefgh' }],
  ['a Factorio note', { text: 'cargo rocket setup: 4 silos, 2 landing pads' }],
  ['a year in a sentence', { text: 'best laptops 2026' }],
  ['a model number', { text: 'Lenovo Legion 5 15ACH6H' }],
  ['a short reminder', { text: 'buy filament' }],
];

describe('checkSensitivity', () => {
  it.each(SENSITIVE)('keeps %s home', (_, input) => {
    expect(checkSensitivity(input).sensitive).toBe(true);
  });
  it.each(SAFE)('lets %s through', (_, input) => {
    expect(checkSensitivity(input)).toEqual({ sensitive: false, reasons: [] });
  });
});
