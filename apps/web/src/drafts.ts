/**
 * Edits made where the viewer cannot write files (an exported page, a served atlas on another
 * machine), kept in this browser's IndexedDB until downloaded as a zip. A database of their
 * own, `groundboard-drafts`, so the library's database keeps its version and an older viewer
 * still opens it. Each draft is keyed by atlas and board, so two atlases served from one origin
 * never see each other's drafts. Without IndexedDB, drafts live in memory for this page load.
 */

export interface Draft {
  /** `<atlasId>:<slug>`. */
  key: string;
  atlasId: string;
  slug: string;
  /** SHA-256 of the board file the draft was made from. */
  baseEtag: string;
  /** The layout overlay as edited. */
  overlay?: unknown;
  /** The board as edited, when its content was changed too. */
  board?: Record<string, unknown>;
  savedAt: number;
}

const DB_NAME = "groundboard-drafts";
const STORE = "drafts";
const VERSION = 1;

export const draftKey = (atlasId: string, slug: string) => `${atlasId}:${slug}`;

const memory = new Map<string, Draft>();
let opening: Promise<IDBDatabase | null> | null = null;
let unavailable = false;

function openDb(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    const fail = () => {
      unavailable = true;
      resolve(null);
    };
    try {
      if (typeof indexedDB === "undefined") {
        fail();
        return;
      }
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: "key" });
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
      request.onerror = fail;
      request.onblocked = fail;
    } catch {
      fail();
    }
  });
  return opening;
}

/** Whether drafts are kept in memory only, and are lost when the page reloads. */
export async function draftsMemoryOnly(): Promise<boolean> {
  await openDb();
  return unavailable;
}

const isDraft = (value: unknown): value is Draft => {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Partial<Draft>;
  return (
    typeof d.key === "string" &&
    typeof d.atlasId === "string" &&
    typeof d.slug === "string" &&
    typeof d.baseEtag === "string" &&
    typeof d.savedAt === "number"
  );
};

async function request<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const db = await openDb();
  if (!db) return { ok: false };
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve({ ok: true, value: req.result });
      tx.onerror = () => resolve({ ok: false });
      tx.onabort = () => resolve({ ok: false });
    });
  } catch {
    return { ok: false };
  }
}

export async function getDraft(atlasId: string, slug: string): Promise<Draft | null> {
  const key = draftKey(atlasId, slug);
  const read = await request("readonly", (store) => store.get(key));
  if (read.ok && isDraft(read.value)) memory.set(key, read.value);
  return memory.get(key) ?? null;
}

/** Every draft of one atlas. */
export async function listDrafts(atlasId: string): Promise<Draft[]> {
  const read = await request("readonly", (store) => store.getAll());
  if (read.ok) for (const value of read.value) if (isDraft(value)) memory.set(value.key, value);
  return [...memory.values()].filter((d) => d.atlasId === atlasId);
}

/** Stores a draft; false when it is kept for this page load only. */
export async function saveDraft(draft: Omit<Draft, "key" | "savedAt">): Promise<boolean> {
  const full: Draft = { ...draft, key: draftKey(draft.atlasId, draft.slug), savedAt: Date.now() };
  memory.set(full.key, full);
  return (await request("readwrite", (store) => store.put(full))).ok;
}

export async function deleteDraft(atlasId: string, slug: string): Promise<boolean> {
  const key = draftKey(atlasId, slug);
  memory.delete(key);
  return (await request("readwrite", (store) => store.delete(key))).ok;
}
