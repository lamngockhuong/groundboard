/// <reference lib="webworker" />
// Packs and unpacks zips off the page's thread, so a large archive does not freeze the viewer.
import { readBoardZip, unpackZip, writeBoardZip, type ZipFile } from "./zip.ts";

declare const self: DedicatedWorkerGlobalScope;

export type ZipRequestBody =
  | { op: "read"; bytes: ArrayBuffer }
  | { op: "unpack"; bytes: ArrayBuffer }
  | { op: "write"; files: ZipFile[] };
export type ZipRequest = ZipRequestBody & { id: number };

self.onmessage = (event: MessageEvent<ZipRequest>) => {
  const request = event.data;
  try {
    if (request.op === "read") {
      self.postMessage({ id: request.id, read: readBoardZip(new Uint8Array(request.bytes)) });
      return;
    }
    if (request.op === "unpack") {
      self.postMessage({ id: request.id, unpacked: unpackZip(new Uint8Array(request.bytes)) });
      return;
    }
    const zip = writeBoardZip(request.files);
    self.postMessage({ id: request.id, zip }, [zip.buffer]);
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
