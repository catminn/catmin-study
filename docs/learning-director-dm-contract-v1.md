# Learning Director ↔ DM Coordination Contract v1

Scope: behavior semantics for the learning-first RPG. No plots, NPCs or hidden world content. ChatGPT owns DM/teaching experience; Claude owns implementation, thresholds, persistence, budget, tests and UI.

## Authority boundaries

The learning director chooses teaching priorities and intensity, never world facts, DCs, random outcomes or mandatory story branches. The world engine owns committed rules and consequences. The academic evaluator determines correctness and degree of independent evidence, never fictional RNG. The DM writes player-visible prose only after authoritative results. The tutor sees course records and an explicitly player-visible scene summary, not any private facts.

Priority order on any user turn:
1. Explicit player instruction and consent, including "no story" or "no lesson".
2. Existing world constraints and safety of irreversible actions.
3. Correct academic instruction grounded in provided sources or verified mathematics.
4. Continuity of an active learning session.
5. Director suggestions drawn from verified deadlines, prerequisites and knowledge gaps.

The director's suggested topic must not override a direct user goal. A calendar item with unverified date cannot be treated as an exam deadline.

## Arbitration states

- STORY: player explores or acts; director normally silent.
- LIGHT: a relevant educational opportunity arises naturally. The director may offer a brief optional clue; it cannot compel a test.
- TEACH: the player requests explanation or shows a knowledge gap. Fictional time is paused. ResumeCursor stores the exact point.
- PRACTICE: explicit practice request; direct problems, feedback and evidence, no forced narration.
- RESUME: restore most recent eligible suspended session or world position; ambiguous resumptions ask one clarifying question.
- HOLD: an explicit action proposal awaits valid academic checking or confirmation. It must not commit from an AI-generated guess.

Transitions must be driven by user utterance plus committed state, not only keywords. Multiple intents in one message are decomposed in order. If the user expressly says "stop", cancellation wins over any pending narrative action.

## Learning opportunity selection

Input signals: verified course/topic map and provenance, time zone aware due dates, current weak evidence, prerequisite edges, session progress, player-stated goal, and **only public** in-world affordances. Compute a candidate list and rank priorities behind the scenes; a candidate is eligible for immersion only when established world rules admit that knowledge application.

Decision outcomes:
- NATURAL: brief instruction may be woven into an existing valid situation.
- PAUSED: if the player asks for a concept whose topic has no legitimate world application, enter tutor mode without altering world.
- SKIP: if the player wants story or has just rejected a prompt, refrain from further nudges for a configurable cooldown.
- DIRECT: if the player requests full chapter or exam practice, teach directly; narrative density may drop to zero.

Do not retrofit hidden world facts or fabricate obstacles to improve educational coverage. No automatic disclosure of how a hidden future event might require a concept.

## Anti-interruption rules

1. Never interrupt a player mid-derivation simply because a high-priority calendar task arrived.
2. A nudge is an invitation, not a quiz gate. A simple "skip" means skip without penalty.
3. Repeated refusals suppress repeated prompts for that topic until a meaningful context change, explicit request, or the user re-enables suggestions.
4. Do not switch subjects during a committed teaching goal unless the learner asks or a necessary prerequisite is identified; explain the prerequisite briefly.
5. When asked "I want to think", reply minimally; do not reveal the answer or give an automatic next hint.
6. A real exam approaching can justify an unobtrusive suggestion in the learning hub, not secretly cause the world to become harder.

Cadence, cooldowns, thresholds and costs are configurable by Claude, not hard-coded as previously unconfirmed suggestions.

## Teaching-level behavior

A query for one definition gets the core meaning and a compact example. "Teach the whole chapter" establishes a tracked coverage target; teach concepts in connected blocks with optional understanding checks. "Give me a hint" gives the smallest helpful clue. When the learner says a method makes no sense, change representation (numeric, symbolic, geometric) instead of repeating wording. "Directly quiz me, no story" enters PRACTICE; all real-world study evidence remains eligible for academic tracking.

A correct final value with wrong reasoning is assessed separately. Correctly applying previously independently validated material need not involve being quizzed again to receive a stable mastery modifier. A fresh independent, causally relevant idea can change the legal action options or offer an advantage according to the rule engine; the director cannot guarantee success.

## Formal input/output suggestion

DirectorInput: {userIntent, activeLearningSession, verifiedAcademicSignals, evidenceSummary, topicPrerequisites, publicWorldAffordances, recentPromptHistory}
DirectorDecision: {chosenTopicId|null, mode, rationaleCategory, promptPermission, interventionLevel, requestedAcademicAction|null, worldMutation:false}
DMInput: {publicWorldProjection, allowedActions, validatedAcademicFindings, authoritativeGameOutcome|null, directorDecision}
DMOutput: {visibleText, teachingSessionDelta, proposedAction|null, userVisibleJudgment|null}

The director output must **never** include privateWorldState, secretTriggers, privateNPCData or speculative facts. The DM may propose an action; the rules service alone commits it. This document is a semantic contract; Claude can adapt field names and wire format.

## Math 1920 acceptance suite

1. Player: "I want to work out the gradient myself" → reply with room to think; no extra answer, no dice, no world advance.
2. Player: "What is a partial derivative?" → brief explanation; world time unchanged.
3. Player: "Please teach the full gradient unit" → coverage goal, sustained lesson; no artificial in-world obstacle.
4. Player: "Give me one hint only" → exactly one limited hint; no completed solution unless requested.
5. Player: "I need five problems with no story" → practice mode, no forced fictional prose.
6. Player gives correct result but flawed explanation → acknowledge result, mark reasoning separately; don't declare long-term mastery.
7. Player gives an independently valid alternative derivation → accept it and record evidence.
8. Player: "I'd rather continue exploring" → suppress director prompts for a configurable interval; no penalty.
9. Player pauses mid-lesson for an unrelated question → nested query returns accurately to prior cursor; no world commit.
10. Player uses a verified concept in an explicitly committed action → evaluation precedes rule engine; game may fail without erasing academic evidence.
11. Calendar signal updated while in a lesson → new priority cached for later, does not hijack current instruction.
12. No legitimate math/world fit → director chooses paused direct teaching or skips, never invents world rules.

## Implementation handoff

Claude chooses the numeric parameters (prompt cadence, confidence, weights, costs), database persistence and API routing. This design does not require four model calls per turn. Initial vertical slice remains MATH 1920, website-only; existing Artifact stays on legacy experience. All visible instructions and audit output must avoid hidden story information.
