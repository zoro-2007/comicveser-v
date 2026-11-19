export interface SavedChapter {
  id: string;
  comicId: string;
  comicTitle: string;
  number: number;
  label: string;
  title: string;
  token: string;
  coverIndex: "cover" | 0;
  savedAt: number;
  pages: { width: number; height: number }[];
}
export const DOWNLOADS_PATH: string;
export function chapterCacheName(token: string): string;
export function localImagePath(token: string, index: number | "cover"): string;
export function listDownloads(): Promise<SavedChapter[]>;
export function getDownload(id: string): Promise<SavedChapter | undefined>;
export function addDownload(entry: SavedChapter): Promise<IDBValidKey>;
export function deleteDownload(entry: SavedChapter): Promise<void>;
export function cleanupStaleDownloads(): Promise<void>;
export function installOfflineWorker(): Promise<ServiceWorkerRegistration>;
export function prepareOfflineStorage(signal: AbortSignal): Promise<void>;
