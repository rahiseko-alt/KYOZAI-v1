import type { RenderedSlideImage } from "./image-types";
import type { TeachingPackage } from "./types";

const DATABASE_NAME = "kyozai-personal-pwa";
const STORE_NAME = "packages";
const PACKAGE_KEY = "latest";

type StoredPackage = {
  key: typeof PACKAGE_KEY;
  savedAt: number;
  package: TeachingPackage;
  images: RenderedSlideImage[];
};

function openDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けませんでした。"));
  });
}

export async function savePersonalPackage(packageValue: TeachingPackage, images: RenderedSlideImage[]) {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ key: PACKAGE_KEY, savedAt: Date.now(), package: packageValue, images } satisfies StoredPackage);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("教材を保存できませんでした。"));
  }).finally(() => database.close());
}

export async function loadPersonalPackage(): Promise<{ package: TeachingPackage; images: RenderedSlideImage[] } | undefined> {
  const database = await openDatabase();
  if (!database) return undefined;
  return await new Promise<StoredPackage | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(PACKAGE_KEY);
    request.onsuccess = () => resolve(request.result as StoredPackage | undefined);
    request.onerror = () => reject(request.error ?? new Error("保存済み教材を読み込めませんでした。"));
  }).finally(() => database.close()).then((stored) => stored ? { package: stored.package, images: stored.images } : undefined);
}

export async function clearPersonalPackage() {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(PACKAGE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("保存済み教材を削除できませんでした。"));
  }).finally(() => database.close());
}
