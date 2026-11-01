/**
 * Spoiler-free public mechanical snapshot check for the FIRST world only.
 * This deliberately pins the published scene graph and synthetic causal fixture.
 * It is NOT a private-story validator, runtime guard, or import authorization.
 * Never pass private plot/NPC/answer material to this public check.
 */
const canonicalScenes = [
  ['w01.entry', 'orientation', ['w01.choice'], 'none', 'none'],
  ['w01.choice', 'meaningful_choice', ['w01.route_a', 'w01.route_b'], 'optional', 'on_commit_only'],
  ['w01.route_a', 'investigation', ['w01.discover'], 'math1920.partial-derivative', 'on_commit_only'],
  ['w01.route_b', 'alternative_method', ['w01.discover'], 'math1920.gradient', 'on_commit_only'],
  ['w01.discover', 'evidence_and_consequence', ['w01.constraint'], 'contextual', 'on_commit_only'],
  ['w01.constraint', 'conflicting_priorities', ['w01.resolve'], 'optional', 'on_commit_only'],
  ['w01.resolve', 'action_resolution', ['w01.aftermath'], 'optional_application', 'on_commit_only'],
  ['w01.aftermath', 'persistent_aftermath', [], 'none', 'on_commit_only']
];
const canonicalPaths = {
  'branch-a': ['w01.entry', 'w01.choice', 'w01.route_a', 'w01.discover', 'w01.constraint', 'w01.resolve', 'w01.aftermath'],
  'branch-b': ['w01.entry', 'w01.choice', 'w01.route_b', 'w01.discover', 'w01.constraint', 'w01.resolve', 'w01.aftermath']
};
const canonicalCommits = [
  {id:'route-a-commit',from:'w01.choice',to:'w01.route_a',cause:{type:'scene_entered',sceneId:'w01.route_a',requiresCommittedTransition:true},effect:{type:'set_flag',target:'route_trace',value:'a'},repeatPolicy:'once_per_world'},
  {id:'route-b-commit',from:'w01.choice',to:'w01.route_b',cause:{type:'scene_entered',sceneId:'w01.route_b',requiresCommittedTransition:true},effect:{type:'set_flag',target:'route_trace',value:'b'},repeatPolicy:'once_per_world'}
];
const canonicalNpc = {
  actorRef:'synthetic-actor',
  initial:{location:'w01.choice',availability:'available',relation:'neutral',claimTier:'unverified'},
  transitions:[
    {onCommitted:'route-a-commit',set:{relation:'guarded'}},
    {onCommitted:'route-b-commit',set:{relation:'open'}}
  ],
  claimPromotion:'only_authorized_fact_discovery'
};
const canonicalConvergence = {
  scene:'w01.discover',
  preserve:['route_trace','npc_relation','committed_event_ids'],
  routeOutcomes:[{routeTrace:'a',npcRelation:'guarded'},{routeTrace:'b',npcRelation:'open'}]
};
const canonicalLearning = {
  scenes:['w01.route_a','w01.route_b'],requiresPlayerConsent:true,
  allowsNonAcademicProgress:true,fabricateMeasurements:false,narrationMayCommitEffects:false
};
const canonicalProjection = {
  source:'committed_state_only',claimTierWithoutDiscovery:'unverified',
  exposeInternalIds:false,exposeUncommittedConsequences:false
};

/* Exact public authoring metadata is part of this published snapshot: a
 * mechanical green result must not silently accept unreviewed prose or fields. */
const canonicalWorldKeys=["schemaVersion","packageId","visibility","warning","ownership","nodes","authoringConstraints","acceptance"];
const canonicalCausalKeys=["schema","scope","warning","worldId","sceneContract","routeCommits","npcContinuity","convergence","learning","publicProjection"];
const canonicalWorldWarning="No plot, NPC identities, hidden truths, or player-facing scene text are included.";
const canonicalOwnership={"narrative":"ChatGPT","engineering":"Claude"};
const canonicalAuthoringConstraints=[
  "Every player-facing option has an in-world reason independent of curriculum.",
  "All nodes accept ASK without advancing world state.",
  "A player may attempt world action without accepting a lesson.",
  "Academic correctness is not randomized; fictional outcomes follow server action resolution.",
  "World consequences remain hidden until a committed action reveals them.",
  "No event or NPC secret is carried in client-visible metadata.",
  "Optional teaching pauses and resumes at the same narrative cursor.",
  "Both route branches preserve their distinct factual traces after convergence."
];
const canonicalCausalWarning="No story, NPC identity, hidden facts, solutions, or player-facing dialogue are included.";
const canonicalRequirements=[
  {
    "id": "refuse-lesson",
    "require": "progress remains possible without forced quiz"
  },
  {
    "id": "pause-resume",
    "require": "no world mutation during tutoring and original scene cursor restored"
  },
  {
    "id": "invalid-academic-reason",
    "require": "no bonus while world action remains separately adjudicable"
  },
  {
    "id": "failed-action",
    "require": "learning evidence retained; consequence comes from server"
  },
  {
    "id": "branch-memory",
    "require": "post-convergence facts can differ without revealing hidden events"
  }
];

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const same = (a,b) => {
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&
    a.length===b.length&&a.every((v,i)=>same(v,b[i]));
  if(object(a)||object(b))return object(a)&&object(b)&&
    Object.keys(a).length===Object.keys(b).length&&
    Object.keys(a).every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
  return a===b;
};
const sameIds = (actual,expected,key) => Array.isArray(actual)&&actual.length===expected.length&&
  actual.every(x=>object(x)&&typeof x[key]==='string')&&
  new Set(actual.map(x=>x[key])).size===actual.length&&
  expected.every(x=>same(actual.find(y=>y[key]===x[key]),x));
const sameUnordered = (a,b) => Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&
  new Set(a).size===a.length&&b.every(x=>a.includes(x));
const fail = code => ({ok:false,code});

export function checkWorld01PublicContract(world,causal) {
  try {
    if(!object(world)||!object(causal)||world.packageId!=='world01'||
      world.schemaVersion!=='story-structure-0.1'||world.visibility!=='mechanics_only'||
      causal.schema!=='world01-causal-authoring-v1'||causal.scope!=='synthetic-mechanics-only'||
      causal.worldId!=='world01'||
      causal.sceneContract!=='content/contracts/world01-opening-skeleton.json')
      return fail('public_identity_drift');
    if(!sameUnordered(Object.keys(world),canonicalWorldKeys)||
      !sameUnordered(Object.keys(causal),canonicalCausalKeys)||
      !same(world.warning,canonicalWorldWarning)||
      !same(world.ownership,canonicalOwnership)||
      !sameUnordered(world.authoringConstraints,canonicalAuthoringConstraints)||
      !same(causal.warning,canonicalCausalWarning))
      return fail('public_metadata_drift');
    if(!Array.isArray(world.nodes)||world.nodes.length!==canonicalScenes.length||
      new Set(world.nodes.map(n=>n?.id)).size!==world.nodes.length||
      !canonicalScenes.every(([id,role,next,learning,worldMutation])=>{
        const n=world.nodes.find(x=>x?.id===id);
        return object(n)&&sameUnordered(n.next,next)&&
          same(n,{id,role,next:n.next,learning,worldMutation});
      }))return fail('public_scene_drift');
    const routes=Array.isArray(world.acceptance)?world.acceptance.filter(x=>object(x)&&Object.hasOwn(x,'route')):null;
    if(!routes||routes.length!==2||new Set(routes.map(x=>x.id)).size!==2||
      !Object.entries(canonicalPaths).every(([id,path])=>{
        const route=routes.find(x=>x.id===id);
        return route&&same(route,{id,route:path});
      }))return fail('public_acceptance_drift');
    const requirements=world.acceptance.filter(x=>object(x)&&Object.hasOwn(x,'require'));
    if(world.acceptance.length!==2+canonicalRequirements.length||
      !sameIds(requirements,canonicalRequirements,'id'))
      return fail('public_acceptance_drift');
    if(!sameIds(causal.routeCommits,canonicalCommits,'id')||
      !object(causal.npcContinuity)||
      !same(causal.npcContinuity.actorRef,canonicalNpc.actorRef)||
      !same(causal.npcContinuity.initial,canonicalNpc.initial)||
      !same(causal.npcContinuity.claimPromotion,canonicalNpc.claimPromotion)||
      !sameIds(causal.npcContinuity.transitions,canonicalNpc.transitions,'onCommitted')||
      !object(causal.convergence)||
      causal.convergence.scene!==canonicalConvergence.scene||
      !sameUnordered(causal.convergence.preserve,canonicalConvergence.preserve)||
      !sameIds(causal.convergence.routeOutcomes,canonicalConvergence.routeOutcomes,'routeTrace')||
      !object(causal.learning)||
      !sameUnordered(causal.learning.scenes,canonicalLearning.scenes)||
      !same({...causal.learning,scenes:canonicalLearning.scenes},canonicalLearning)||
      !same(causal.publicProjection,canonicalProjection))return fail('public_causal_drift');
    return {ok:true,boundScenes:8,boundRoutes:2};
  }catch{return fail('public_identity_drift');}
}
