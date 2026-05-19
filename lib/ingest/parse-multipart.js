'use strict';

/**
 * lib/ingest/parse-multipart.js
 * Signal Logic Systems LLC
 *
 * Minimal RFC 7578 multipart/form-data parser. Used by the Netlify
 * Function entry point to split an authenticated multipart POST into
 * one Buffer per attached file, which then flow into parse-csv /
 * parse-xlsx for actual content parsing.
 *
 * Why not a dependency: busboy and friends are stream-oriented and the
 * Lambda model already gives us the full body in memory. The parser
 * we need is ~120 lines of well-defined RFC work. Keeping it inline
 * means one fewer transitive dependency to vet for the path that
 * receives customer file uploads.
 *
 * Binary safety: everything runs on Buffers. Headers are decoded as
 * UTF-8 (Content-Disposition can carry non-ASCII filenames) but part
 * bodies are sliced as raw bytes — XLSX is a ZIP, mangling bytes would
 * break SheetJS.
 *
 * Scope: form-data only. No mixed/alternative multipart support, no
 * RFC 2231 encoded-filename support (parameter*=...), no chunked
 * transfer-encoding (Netlify already de-chunks). These can be added
 * if a real customer file trips them.
 */

const CR  = 0x0D;
const LF  = 0x0A;
const DASH = 0x2D;
const HEADER_SEP = Buffer.from('\r\n\r\n');

/**
 * Pull the boundary token out of a Content-Type header value.
 *
 * @param {string} contentType
 * @returns {string|null}
 */
function extractBoundary(contentType) {
  if (!contentType) return null;
  // boundary=foo  or  boundary="foo bar"
  const m = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!m) return null;
  return m[1] || m[2] || null;
}

/**
 * Find every occurrence of `needle` inside `haystack`. Used to split the
 * body on boundary markers.
 *
 * @param {Buffer} haystack
 * @param {Buffer} needle
 * @returns {number[]}  Byte offsets where each match starts.
 */
function findAll(haystack, needle) {
  const out = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    out.push(idx);
    from = idx + needle.length;
  }
  return out;
}

/**
 * Strip a single leading "\r\n" and a single trailing "\r\n" from a
 * Buffer, returning the inner bytes without copying.
 *
 * @param {Buffer} buf
 * @returns {Buffer}
 */
function trimCRLF(buf) {
  let start = 0;
  let end = buf.length;
  if (end - start >= 2 && buf[start] === CR && buf[start + 1] === LF) start += 2;
  if (end - start >= 2 && buf[end - 2] === CR && buf[end - 1] === LF) end -= 2;
  return buf.slice(start, end);
}

/**
 * Parse Content-Disposition into a flat object. Values may be quoted.
 *
 * @param {string} header
 * @returns {Object<string,string>}
 */
function parseContentDisposition(header) {
  const out = {};
  if (!header) return out;
  // header looks like:  form-data; name="matrix"; filename="receipts.xlsx"
  const parts = header.split(';');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    const eq = p.indexOf('=');
    if (eq === -1) {
      if (i === 0) out._type = p.toLowerCase();
      continue;
    }
    const key = p.slice(0, eq).trim().toLowerCase();
    let value = p.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Parse a multipart/form-data body.
 *
 * @param {Buffer} body          Raw request body bytes.
 * @param {string} contentType   The full Content-Type header value
 *                                (so the boundary can be extracted).
 * @returns {{
 *   ok: boolean,
 *   parts?: Array<{
 *     name: string,           // form field name
 *     filename: string|null,  // original filename, if file part
 *     contentType: string|null,
 *     data: Buffer,           // raw bytes of the part body
 *   }>,
 *   error?: string,
 * }}
 */
function parseMultipart(body, contentType) {
  if (!Buffer.isBuffer(body)) {
    return { ok: false, error: 'Multipart body must be a Buffer' };
  }
  const boundary = extractBoundary(contentType);
  if (!boundary) {
    return { ok: false, error: 'No boundary found in Content-Type' };
  }

  const delim     = Buffer.from('--' + boundary);
  const positions = findAll(body, delim);
  if (positions.length < 2) {
    // Need at least an opening boundary and a closing boundary.
    return { ok: false, error: 'Multipart body has no recognizable parts' };
  }

  const parts = [];
  for (let i = 0; i < positions.length - 1; i++) {
    const startAfterDelim = positions[i] + delim.length;

    // Closing boundary is "--<boundary>--". Detect and stop.
    if (body.length - startAfterDelim >= 2 &&
        body[startAfterDelim] === DASH && body[startAfterDelim + 1] === DASH) {
      break;
    }

    const partRaw = body.slice(startAfterDelim, positions[i + 1]);
    const part    = trimCRLF(partRaw);
    if (part.length === 0) continue;

    const sepIdx = part.indexOf(HEADER_SEP);
    if (sepIdx === -1) continue;

    const headerBlock = part.slice(0, sepIdx).toString('utf8');
    const bodyBlock   = part.slice(sepIdx + HEADER_SEP.length);

    const headers = {};
    for (const line of headerBlock.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }

    const disp = parseContentDisposition(headers['content-disposition'] || '');
    if (!disp.name) continue;  // not a form-data part

    parts.push({
      name: disp.name,
      filename: disp.filename || null,
      contentType: headers['content-type'] || null,
      data: bodyBlock,
    });
  }

  if (parts.length === 0) {
    return { ok: false, error: 'Multipart body contained no usable form-data parts' };
  }

  return { ok: true, parts };
}

module.exports = { parseMultipart, extractBoundary };
