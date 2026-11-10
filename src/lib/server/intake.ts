import type { CaptureInput } from './types';

/**
 * Turns a capture request into drawer inputs. Takes a form (text, url, file — several files allowed, lane, target,
 * private), JSON ({ text, url, lane, target, private }) or a plain text body. Shared by /api/capture (Shortcuts, the
 * companion, the app) and /share (the installed app's share target, which also sends a title).
 *
 *   lane=transit&target=pc   sends it to the PC instead of keeping it
 */
export async function inputsFromRequest(request: Request, device: string, now = new Date()): Promise<CaptureInput[] | null> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  const inputs: CaptureInput[] = [];
  // Options may also come in the address (?target=pc, ?private=1): a Shortcut that posts a raw body has nowhere else.
  const query = Object.fromEntries(new URL(request.url).searchParams);

  if (type.includes('application/json')) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return null;
    const base = options({ ...query, ...body }, device);
    inputs.push({ ...base, text: joinText(body), url: str(body.url) });
  } else if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    const fields: Record<string, unknown> = Object.fromEntries([...form.keys()].map((k) => [k, form.get(k)]));
    const base = options({ ...query, ...fields }, device);
    // An iPhone Shortcut posts whatever was shared as `file`: a real file, or plain text when a link or words were shared.
    const sharedText = form.getAll('file').filter((f): f is string => typeof f === 'string' && !!f.trim());
    const text = [joinText(fields), ...sharedText].filter(Boolean).join('\n') || null;
    const url = str(fields.url);
    const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) inputs.push({ ...base, text, url });
    for (const [i, file] of files.entries()) {
      inputs.push({
        ...base,
        // The text goes with the first file, as its caption.
        text: i === 0 ? text : null,
        url: i === 0 ? url : null,
        file: { name: file.name || 'file', mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
      });
    }
  } else if (!type || type.startsWith('text/')) {
    // A plain body: text/plain from a quick curl, or a link or words a Shortcut posted as its body.
    inputs.push({ ...options(query, device), text: await request.text() });
  } else {
    // Anything else is a file posted as the body (a Shortcut's "Request Body: File" with a photo, a PDF…).
    // Only a plain type/subtype is kept: the file route trusts it when deciding what may be shown inline.
    const essence = type.split(';')[0]!.trim();
    const mime = /^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(essence) ? essence : 'application/octet-stream';
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length) inputs.push({ ...options(query, device), text: null, url: null, file: { name: fileName(request, mime, now), mime, bytes } });
  }
  return inputs;
}

export function isEmpty(inputs: CaptureInput[]): boolean {
  return inputs.every((i) => !i.text?.trim() && !i.url?.trim() && !i.file);
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/heic': 'heic', 'image/heif': 'heic', 'image/gif': 'gif',
  'image/webp': 'webp', 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'application/zip': 'zip', 'application/octet-stream': 'bin',
};

/** The name a raw upload says it has, else "Shared 2026-11-10 09.05.png". */
function fileName(request: Request, mime: string, now: Date): string {
  const disposition = request.headers.get('content-disposition') ?? '';
  const star = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const given = request.headers.get('x-filename') ?? (star ? decoded(star) : plain);
  if (given?.trim()) return given.trim().replace(/[\\/]/g, '_');
  const p = (n: number) => String(n).padStart(2, '0'); // taste-skill-ignore: a clock time in a file name
  const ext = EXTENSIONS[mime] ?? mime.split('/')[1]?.replace(/[^a-z0-9]/g, '') ?? 'bin';
  return `Shared ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}.${p(now.getMinutes())}.${ext}`;
}

function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** What people call the devices, to the names Drawer uses. */
const TARGET_ALIASES: Record<string, string> = { laptop: 'fedora', phone: 'iphone', 'every device': 'all', everywhere: 'all' };

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** A share sheet sends a page's title apart from its text; keep the title only when it adds something. */
function joinText(fields: Record<string, unknown>): string | null {
  const text = str(fields.text);
  const title = str(fields.title);
  if (!title) return text;
  if (!text) return str(fields.url) ? null : title;
  return text.includes(title) ? text : `${title}\n${text}`;
}

function options(body: Record<string, unknown>, device: string): Omit<CaptureInput, 'text' | 'url' | 'file'> {
  const lane = body.lane === 'transit' || (typeof body.target === 'string' && body.target && body.lane !== 'keep') ? 'transit' : 'keep';
  const named = str(body.target)?.trim().toLowerCase();
  const target = lane === 'transit' ? (named ? (TARGET_ALIASES[named] ?? named) : 'all') : null;
  return {
    source: str(body.source) ?? device,
    lane,
    target,
    private: body.private === true || body.private === 'true' || body.private === 'on' || body.private === '1',
  };
}
