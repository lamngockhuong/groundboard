import type { Scene } from "./input.ts";

/**
 * Boards opened in the viewer without an atlas, kept in this browser's IndexedDB so the list
 * survives a reload. Nothing leaves the browser. When IndexedDB is unavailable (private mode,
 * blocked storage) the list lives in memory for this page load.
 */

export type LibraryInput =
  | { type: "board"; board: Record<string, unknown> }
  | { type: "scene"; scene: Scene; title: string };

export interface LibraryEntry {
  /** The board's address in the viewer: `#/board/<slug>`. */
  slug: string;
  input: LibraryInput;
  /** When it was last opened from a file or pasted, in ms since the epoch. */
  openedAt: number;
  /** Its layout overlay: boxes moved and notes drawn in the viewer. Removed with the entry. */
  overlay?: unknown;
}

const DB_NAME = "groundboard";
const STORE = "library";
const VERSION = 1;

const memory = new Map<string, LibraryEntry>();
let opening: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: "slug" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // A newer viewer in another tab upgrades the database: let it, and open again later.
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

/** Runs one transaction; false when storage failed, and the memory copy is then the list. */
async function write(run: (store: IDBObjectStore) => void): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch {
    return false;
  }
}

const isEntry = (value: unknown): value is LibraryEntry => {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<LibraryEntry>;
  return (
    typeof entry.slug === "string" &&
    typeof entry.openedAt === "number" &&
    typeof entry.input === "object" &&
    entry.input !== null &&
    (entry.input.type === "board" || entry.input.type === "scene")
  );
};

/** Every stored board; the in-memory copy when storage cannot be read. */
export async function listEntries(): Promise<LibraryEntry[]> {
  const db = await openDb();
  if (db) {
    try {
      const stored = await new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const entry of stored) if (isEntry(entry)) memory.set(entry.slug, entry);
    } catch {
      // Unreadable: the memory copy stands in.
    }
  }
  return [...memory.values()];
}

/** Adds or replaces boards by slug. Resolves to false when they are kept for this page load only. */
export async function saveEntries(entries: readonly LibraryEntry[]): Promise<boolean> {
  for (const entry of entries) memory.set(entry.slug, entry);
  return write((store) => {
    for (const entry of entries) store.put(entry);
  });
}

export async function removeEntry(slug: string): Promise<boolean> {
  memory.delete(slug);
  return write((store) => store.delete(slug));
}

export async function clearEntries(): Promise<boolean> {
  memory.clear();
  return write((store) => store.clear());
}
