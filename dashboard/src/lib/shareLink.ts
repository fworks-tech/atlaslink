export interface SharePayload {
  p?: string;
  s?: string;
  n?: string;
  m?: string;
}

function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = typeof globalThis.btoa === "function" ? globalThis.btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecode(b64url: string): string {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const binary = typeof globalThis.atob === "function" ? globalThis.atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeShareLink(payload: SharePayload): string {
  return b64urlEncode(JSON.stringify(payload));
}
export function decodeShareLink(q: string): SharePayload | null {
  try {
    return JSON.parse(b64urlDecode(q)) as SharePayload;
  } catch {
    return null;
  }
}
export function canonicalUrl(projectId: string, sessionId: string): string {
  return `/project/${encodeURIComponent(projectId)}/session/${encodeURIComponent(sessionId)}`;
}
