// Spoiler-free authoring reference. NOT a production event/authorization implementation.
const ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const isId = v => typeof v === 'string' && ID.test(v);
const exact = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).sort().join('|') === [...keys].sort().join('|');
const unique = a => new Set(a).size === a.length;
const denied = () => ({ok:false,code:'not_authorized'});

// All inputs except `annotation` must be sourced from the trusted server, never the client.
// This pure reference checks causal provenance; it does not commit an action or determine its success.
export function projectAdvantageEvidence(annotation, {binding, committedEvent, trustedEvidenceRefs, publicCopyApproved} = {}) {
  try {
    if (!exact(annotation,['schema','worldId','dungeonId','manifestRevision','sessionId','commitId','eventKey','actionKey','advantage','evidenceRefs']) ||
        annotation.schema !== 'dungeon-advantage-evidence-v1' ||
        ![annotation.worldId,annotation.dungeonId,annotation.sessionId,annotation.commitId,annotation.eventKey,annotation.actionKey].every(isId) ||
        !Number.isSafeInteger(annotation.manifestRevision) || annotation.manifestRevision < 1 ||
        !['evidence_option','risk_context'].includes(annotation.advantage) ||
        !Array.isArray(annotation.evidenceRefs) || annotation.evidenceRefs.length < 1 || annotation.evidenceRefs.length > 8 ||
        !annotation.evidenceRefs.every(isId) || !unique(annotation.evidenceRefs)) return denied();
    if (!binding || !isId(binding.actionKey) || !['evidence_option','risk_context'].includes(binding.advantage) ||
        annotation.actionKey !== binding.actionKey || annotation.advantage !== binding.advantage) return denied();
    if (!committedEvent || committedEvent.status !== 'committed' ||
        !['success','failure'].includes(committedEvent.outcome) ||
        ![ 'worldId','dungeonId','manifestRevision','sessionId','commitId','eventKey','actionKey' ].every(k => committedEvent[k] === annotation[k]) ||
        !Array.isArray(trustedEvidenceRefs) || !trustedEvidenceRefs.every(isId) || !unique(trustedEvidenceRefs) ||
        !annotation.evidenceRefs.every(ref => trustedEvidenceRefs.includes(ref)) ||
        publicCopyApproved !== true || typeof committedEvent.publicOutcome !== 'string' ||
        !committedEvent.publicOutcome.trim()) return denied();
    // Player sees only reviewed text already attached to the committed world event.
    return {ok:true,public:{publicOutcome:committedEvent.publicOutcome}};
  } catch { return denied(); }
}
