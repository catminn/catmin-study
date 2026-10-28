// 跨课程稳定的 application 词表（来自 content/contracts/application-taxonomy-v1.json，revision 2026-10-28.r1）。只含结构标识，无剧情。
export const APPLICATION_TAXONOMY_REVISION = "2026-10-28.r1";
export const APPLICATION_TAGS: ReadonlySet<string> = new Set(["change.estimate-rate", "change.optimize-under-constraints", "terrain.infer-change-direction", "geometry.reconstruct-orientation", "geometry.estimate-volume", "evidence.reconcile-measurements", "systems.solve-constraints", "systems.transform-coordinates", "systems.identify-modes", "dynamics.analyze-load", "dynamics.predict-motion", "energy.track-transfer", "fields.infer-interaction", "chemistry.balance-material", "chemistry.predict-structure", "chemistry.infer-energetics", "networks.trace-reachability", "networks.optimize-routing", "algorithms.choose-representation", "algorithms.evaluate-efficiency", "logic.check-consistency", "logic.construct-proof", "counting.evaluate-possibilities", "data.assess-uncertainty", "data.detect-pattern"]);
export const APPLICATION_ALIASES: Readonly<Record<string, string>> = {"infer-slope": "terrain.infer-change-direction", "reconcile-measurements": "evidence.reconcile-measurements", "principal-direction": "systems.identify-modes", "analyze-load": "dynamics.analyze-load"};
// 旧标签经别名迁移为规范 id；词表外的值返回 null（失败关闭，不猜）。
export function canonicalApplication(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const v = APPLICATION_ALIASES[x] ?? x;
  return APPLICATION_TAGS.has(v) ? v : null;
}
