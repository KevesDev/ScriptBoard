/**
 * Script pages store TipTap JSON (or legacy HTML) in `contentBase64`.
 * `btoa` / `atob` only support Latin-1 code units; pasted Unicode makes `btoa` throw and nothing is saved.
 * These helpers use UTF-8 bytes ↔ base64, compatible with ASCII-only legacy payloads.
 */

export function utf8TextToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function base64ToUtf8Text(b64: string): string {
  const trimmed = (b64 || '').trim();
  if (!trimmed) return '';
  let binary: string;
  try {
    binary = atob(trimmed);
  } catch {
    return '';
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
