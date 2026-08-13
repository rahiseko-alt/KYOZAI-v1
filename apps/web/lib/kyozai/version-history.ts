import { packageHash, type RevisionMetadata } from "./revision";
import type { TeachingPackage } from "./types";

export type VersionEntry = { package: TeachingPackage; id?: string; hash?: string };
export type VersionState = { entries: VersionEntry[]; index: number };

export const EMPTY_VERSION_STATE: VersionState = { entries: [], index: -1 };

export function initialVersion(packageValue: TeachingPackage): VersionState {
  return { entries: [{ package: packageValue }], index: 0 };
}

export function moveVersion(state: VersionState, offset: -1 | 1): VersionState {
  if (!state.entries.length) return state;
  return { ...state, index: Math.min(Math.max(state.index + offset, 0), state.entries.length - 1) };
}

export function canPromoteRevision(
  state: VersionState,
  baseIndex: number,
  sentBaseVersionId: string | undefined,
  candidate: TeachingPackage,
  revision: RevisionMetadata,
) {
  const current = state.entries[state.index];
  if (!current || state.index !== baseIndex) return false;
  if (packageHash(current.package) !== revision.baseHash || packageHash(candidate) !== revision.candidateHash) return false;
  if (current.hash && current.hash !== revision.baseHash) return false;
  if (sentBaseVersionId) {
    return current.id === sentBaseVersionId && revision.baseVersionId === sentBaseVersionId;
  }
  return current.id === undefined;
}

export function promoteRevision(
  state: VersionState,
  baseIndex: number,
  packageValue: TeachingPackage,
  revision: RevisionMetadata,
): VersionState {
  const entries = state.entries.slice(0, baseIndex + 1);
  entries[baseIndex] = { ...entries[baseIndex]!, id: revision.baseVersionId, hash: revision.baseHash };
  entries.push({ package: packageValue, id: revision.candidateVersionId, hash: revision.candidateHash });
  return { entries, index: entries.length - 1 };
}
