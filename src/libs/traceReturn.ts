// Browser-side half of Monocle's HTTP trace return.
//
// Monocle appends the trace to the response body rather than sending it as a
// header, so the wire format is:
//   body    <response body><delimiter><base64(gzip(spans))>
//   header  x-monocle-traces: v1; delim=<delimiter>
//
// The server half lives in monocle2ai/traceReturn, but that package imports
// crypto/zlib/fs/http and cannot be bundled into a client component, so the few
// lines we need are reimplemented here against web APIs.

export const TRACE_RETURN_REQUEST_HEADER = 'x-monocle-retrieve-traces';
export const TRACE_RETURN_RESPONSE_HEADER = 'x-monocle-traces';

const DELIM_MARKER = 'delim=';

/** The key the browser presents to the gate. Unset => trace return not requested. */
export const traceRetrievalKey = process.env.NEXT_PUBLIC_MONOCLE_TRACE_KEY;

export function parseDelimiterFromHeader(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }
  // indexOf + slice rather than split: everything after the FIRST marker is the
  // delimiter, and split()[1] would stop at a second occurrence.
  const idx = headerValue.indexOf(DELIM_MARKER);
  if (idx === -1) {
    return null;
  }
  return headerValue.slice(idx + DELIM_MARKER.length).trim();
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0 || haystack.length < needle.length) {
    return -1;
  }
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

/**
 * Splits at the delimiter. Byte-level, not string-level, so a multibyte UTF-8
 * body (any non-ASCII character in the answer) splits without corruption.
 */
export function splitBodyAndTrailer(
  body: Uint8Array,
  delimiter: string,
): { clean: Uint8Array; payload: string | null } {
  const marker = new TextEncoder().encode(delimiter);
  const idx = indexOfBytes(body, marker);
  if (idx === -1) {
    return { clean: body, payload: null };
  }
  return {
    clean: body.subarray(0, idx),
    payload: new TextDecoder().decode(body.subarray(idx + marker.length)),
  };
}

async function gunzipBase64(payload: string): Promise<string> {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export type TraceSpan = {
  name: string;
  context?: { trace_id?: string; span_id?: string };
  parent_id?: string | null;
  attributes?: Record<string, unknown>;
  events?: { name: string; attributes?: Record<string, unknown> }[];
  [key: string]: unknown;
};

/**
 * Reads a response that may carry a trace trailer. Returns the parsed body
 * either way — `spans` is null when the server did not return a trace, which is
 * the normal path (feature off, or the request was not authorized).
 *
 * Replaces res.json(): with a trailer appended the body is no longer valid JSON.
 */
export async function readResponseWithTrace<T = any>(
  res: Response,
): Promise<{ data: T; spans: TraceSpan[] | null }> {
  const delimiter = parseDelimiterFromHeader(res.headers.get(TRACE_RETURN_RESPONSE_HEADER));
  const bytes = new Uint8Array(await res.arrayBuffer());

  if (!delimiter) {
    return { data: JSON.parse(new TextDecoder().decode(bytes)), spans: null };
  }

  const { clean, payload } = splitBodyAndTrailer(bytes, delimiter);
  const data = JSON.parse(new TextDecoder().decode(clean));

  if (!payload) {
    return { data, spans: null };
  }

  // A malformed trailer must not take the chat response down with it.
  try {
    return { data, spans: JSON.parse(await gunzipBase64(payload)) };
  } catch (error) {
    console.warn('[monocle] could not decode returned trace:', error);
    return { data, spans: null };
  }
}

/** Groups the flat span list into something readable in the browser console. */
export function logTrace(spans: TraceSpan[]): void {
  const traceId = spans[0]?.context?.trace_id ?? 'unknown';
  console.groupCollapsed(`%c[monocle] trace ${traceId} — ${spans.length} spans`, 'color:#7c3aed');
  console.table(
    spans.map(s => ({
      name: s.name,
      type: (s.attributes?.['span.type'] as string) ?? '',
      span_id: s.context?.span_id,
      parent_id: s.parent_id ?? '',
    })),
  );
  console.log('full spans:', spans);
  console.groupEnd();
}
