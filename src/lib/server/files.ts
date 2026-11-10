import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';

/** Content-addressed file storage: one copy per distinct file, named by its sha256. */
export interface FileStore {
  root: string;
  put(bytes: Uint8Array, name: string): { sha: string; path: string; size: number };
  pathOf(sha: string, name: string): string;
  thumbPath(sha: string): string;
  remove(sha: string, name: string): void;
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function extensionOf(name: string): string {
  const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return ext.length > 1 && ext.length <= 6 ? ext : '';
}

export function createFileStore(root: string): FileStore {
  mkdirSync(join(root, 'files'), { recursive: true });
  mkdirSync(join(root, 'thumbs'), { recursive: true });
  const pathOf = (sha: string, name: string) => join(root, 'files', sha.slice(0, 2), sha + extensionOf(name));
  return {
    root,
    pathOf,
    thumbPath: (sha) => join(root, 'thumbs', `${sha}.webp`),
    put(bytes, name) {
      const sha = sha256(bytes);
      const path = pathOf(sha, name);
      if (!existsSync(path)) {
        mkdirSync(join(root, 'files', sha.slice(0, 2)), { recursive: true });
        writeFileSync(path, bytes);
      }
      return { sha, path, size: bytes.byteLength };
    },
    remove(sha, name) {
      rmSync(pathOf(sha, name), { force: true });
      rmSync(join(root, 'thumbs', `${sha}.webp`), { force: true });
    },
  };
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.heic': 'image/heic', '.pdf': 'application/pdf', '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function mimeOf(name: string, given?: string | null): string {
  if (given && given !== 'application/octet-stream') return given;
  return MIME[extensionOf(name)] ?? 'application/octet-stream';
}

export type FileKind = 'image' | 'pdf' | 'audio' | 'clip' | 'file';

export function fileKind(mime: string): FileKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'clip';
  return 'file';
}
