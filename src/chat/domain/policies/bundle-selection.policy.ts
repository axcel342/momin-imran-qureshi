import type { BundleSnapshot } from '../ports';

/** Spec A1: "latest remaining quota" = the most recently created usable bundle (ties: id DESC). */
export function selectBundle(usable: readonly BundleSnapshot[]): BundleSnapshot | undefined {
  return [...usable].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  )[0];
}
