/* Web Worker: turn a picked File (export.zip or export.xml) into yearly CSVs,
 * entirely in-browser and streaming (the ~300 MB export.xml is never buffered
 * whole). Posts {type:'progress'} updates and a final {type:'done'}.
 */
import { configure, ZipReader, BlobReader } from "../vendor/zipjs/zip.js";
import { lineSplitter } from "./parse.js";
import { aggregate, buildYearlyCsvs, summarize } from "./convert.js";

configure({ useWebWorkers: false }); // we're already in a worker; no nested/blob workers (CSP-safe)

self.onmessage = async (e) => {
  const { file, skipExisting } = e.data;
  try {
    const { stream, total } = await openXmlStream(file);

    let bytes = 0;
    let lastPost = 0;
    const counter = new TransformStream({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes - lastPost >= 4 << 20) { // throttle: every ~4 MB
          lastPost = bytes;
          self.postMessage({ type: "progress", bytes, total });
        }
        controller.enqueue(chunk);
      },
    });

    const lineStream = stream
      .pipeThrough(counter)
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(lineSplitter());

    const result = await aggregate(streamLines(lineStream));
    self.postMessage({ type: "progress", bytes: total || bytes, total });

    const built = buildYearlyCsvs(result, { skipGarminDays: skipExisting });
    self.postMessage({
      type: "done",
      files: Object.fromEntries(built.files),
      perYear: built.perYear,
      skipped: built.skipped,
      summary: summarize(result),
    });
  } catch (err) {
    self.postMessage({ type: "error", message: String((err && err.message) || err) });
  }
};

/** Return a decompressed export.xml byte stream + its total size (for progress). */
async function openXmlStream(file) {
  const isZip =
    file.name.toLowerCase().endsWith(".zip") || (await sniffZip(file));

  if (!isZip) {
    return { stream: file.stream(), total: file.size };
  }

  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();
  const entry =
    entries.find((en) => en.filename.toLowerCase().endsWith("export.xml")) ||
    entries.find((en) => en.filename.toLowerCase().endsWith(".xml"));
  if (!entry) {
    await reader.close();
    throw new Error("No export.xml found inside the zip.");
  }

  // Stream the entry's decompressed bytes into a TransformStream we hand back.
  const ts = new TransformStream();
  entry
    .getData(ts.writable)
    .then(() => reader.close())
    .catch(() => {});
  return { stream: ts.readable, total: entry.uncompressedSize || 0 };
}

async function sniffZip(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b; // "PK"
}

/** Async generator over a ReadableStream via an explicit reader (Safari-safe). */
async function* streamLines(stream) {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
