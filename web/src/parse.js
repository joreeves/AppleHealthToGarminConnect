/* Streaming helpers for Apple Health export.xml.
 *
 * The export is one <Record .../> per line for the metrics we care about
 * (verified: all 425k target records are single-line self-closing), so a line
 * splitter plus a per-attribute regex is enough — no full XML parser needed.
 */

/** TransformStream: string chunks -> individual lines (newline stripped). */
export function lineSplitter() {
  let buf = "";
  return new TransformStream({
    transform(chunk, controller) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        // strip a trailing \r too, so CRLF exports behave like LF ones
        let line = buf.slice(0, i);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        controller.enqueue(line);
        buf = buf.slice(i + 1);
      }
    },
    flush(controller) {
      if (buf.length) controller.enqueue(buf.endsWith("\r") ? buf.slice(0, -1) : buf);
    },
  });
}

const RE_TYPE = /\btype="([^"]*)"/;
const RE_SOURCE = /\bsourceName="([^"]*)"/;
const RE_START = /\bstartDate="([^"]*)"/;
const RE_END = /\bendDate="([^"]*)"/;
const RE_VALUE = /\bvalue="([^"]*)"/;

/**
 * Extract {type, sourceName, startDate, endDate, value} from one line, or null
 * if the line isn't a Record with the fields we need. Per-attribute regexes mean
 * attribute order / extra attributes don't matter.
 */
export function recordAttrs(line) {
  if (line.indexOf("<Record") === -1) return null;
  const t = RE_TYPE.exec(line);
  if (!t) return null;
  const s = RE_START.exec(line);
  const e = RE_END.exec(line);
  const v = RE_VALUE.exec(line);
  if (!s || !e || !v) return null;
  const src = RE_SOURCE.exec(line);
  return {
    type: t[1],
    sourceName: src ? src[1] : "",
    startDate: s[1],
    endDate: e[1],
    value: v[1],
  };
}
