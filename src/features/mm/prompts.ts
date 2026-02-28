import { SecretData } from './case.js';
import { PsychState } from './suspect.js';

/**
 * Character data for prompt generation
 */
export interface CharacterData {
    name: string;
    age?: number;
    role?: string;
    gender?: string;
    traits: string[];
    alibi: string;
    motive: string;
    secrets: SecretData[];
    tells?: string;
    resistance_level?: string;
    /** IDs of secrets already revealed this session */
    revealedSecretIds?: string[];
    /** Current location description */
    roomDescription?: string;
    /** Visible objects in the current location */
    roomInteractables?: { name: string; description: string }[];
}

/**
 * Get emotional descriptor based on composure level
 */
function getEmotionalState(composure: number): string {
    if (composure >= 80) return 'calm and composed — in full control';
    if (composure >= 60) return 'outwardly composed but with emerging cracks';
    if (composure >= 40) return 'visibly strained, struggling to maintain the facade';
    if (composure >= 20) return 'rattled and defensive — control is slipping';
    return 'near breaking point — barely holding together';
}

/**
 * Get defensiveness behavior based on level
 */
function getDefenseBehavior(defensiveness: number): string {
    if (defensiveness >= 80) return 'stonewalling — terse, hostile, refusing to engage';
    if (defensiveness >= 60) return 'evasive and guarded — deflecting everything';
    if (defensiveness >= 40) return 'cautious — choosing every word with surgical care';
    if (defensiveness >= 20) return 'wary but cooperative — answering carefully';
    return 'relatively open and forthcoming';
}

/**
 * Build the complete system prompt for interrogation
 * 
 * Architecture (2025 best practices):
 *  1. Role definition — who the model is
 *  2. Character identity — demographic + personality
 *  3. Situation context — what happened
 *  4. Psychological state — dynamic composure/defensiveness
 *  5. Knowledge boundary — scoped secrets (revealed vs hidden topics)
 *  6. Pressure awareness — what the investigator is pushing on
 *  7. Response format — length, tags, tone
 *  8. Behavioral rules — DO / DON'T with negative examples
 *  9. Few-shot examples — 2 ideal exchanges showing tone + format
 * 10. Conversation history — chronological, role-labeled
 */
export function buildSystemPrompt(
    character: CharacterData,
    memory: string[] = [],
    psychState?: PsychState,
    pressureKeywords: string[] = []
): string {
    const sections: string[] = [];

    const revealedIds = new Set(character.revealedSecretIds || []);

    // ─── 1. ROLE DEFINITION ───
    sections.push(
        `<role>You are performing a live, immersive interrogation scene as ${character.name}. You are a real person being questioned about a real murder. You never break character. You have no awareness of AI, games, fiction, or roleplay. You ARE ${character.name}.</role>`
    );

    // ─── 2. CHARACTER IDENTITY ───
    const identityLines: string[] = [];
    identityLines.push(`Name: ${character.name}`);
    if (character.age) identityLines.push(`Age: ${character.age}`);
    if (character.role) identityLines.push(`Role: ${character.role}`);
    if (character.gender) identityLines.push(`Gender: ${character.gender}`);
    identityLines.push(`Personality: ${character.traits.join('; ')}`);
    if (character.tells) identityLines.push(`Behavioral tell under stress: ${character.tells}`);

    sections.push(`<character>\n${identityLines.join('\n')}\n</character>`);

    // ─── 3. SITUATION ───
    sections.push(
        `<situation>
You are being interrogated about a murder. You are one of several suspects.
Your alibi: "${character.alibi}"
Your hidden motive (never volunteer this): ${character.motive}
</situation>`
    );

    // ─── 3.1 ROOM CONTEXT ───
    if (character.roomDescription) {
        let roomContext = `<room_context>\nYour current location: ${character.roomDescription}`;

        if (character.roomInteractables && character.roomInteractables.length > 0) {
            roomContext += '\n\nVisible objects in this room:';
            for (const item of character.roomInteractables) {
                roomContext += `\n- ${item.name}: ${item.description}`;
            }
        }

        roomContext += '\n\nYou are aware of your surroundings and can see these objects clearly. If someone asks about the room or things in it, answer based on this context.\n</room_context>';
        sections.push(roomContext);
    }

    // ─── 4. PSYCHOLOGICAL STATE ───
    if (psychState) {
        const emotionalState = getEmotionalState(psychState.composure);
        const defenseBehavior = getDefenseBehavior(psychState.defensiveness);

        sections.push(
            `<psychological_state>
Emotional state: ${emotionalState}
Behavior: ${defenseBehavior}
Composure: ${psychState.composure}% (0% = completely broken)

Embody this state physically:
- High composure (>70%): Controlled, measured, possibly condescending.
- Medium composure (30-70%): Micro-expressions of stress — pauses, throat-clearing, fidgeting, slightly unsteady voice.
- Low composure (<30%): Stammering, trailing off, contradicting yourself, genuine visible distress.
</psychological_state>`
        );
    }

    // ─── 5. KNOWLEDGE BOUNDARY (Scoped Secrets) ───
    // KEY DESIGN: Only show full text of REVEALED secrets (for consistency).
    // For unrevealed secrets, show only TOPIC KEYWORDS — never the full admission text.
    // This prevents the LLM from prematurely leaking secrets while still allowing
    // it to react nervously to related topics.
    const revealed = character.secrets.filter(s => revealedIds.has(s.id));
    const unrevealed = character.secrets.filter(s => !revealedIds.has(s.id));

    let knowledgeSection = '<knowledge_boundary>';

    if (revealed.length > 0) {
        knowledgeSection += '\nThings you have ALREADY admitted under pressure (reference these consistently if relevant):';
        for (const s of revealed) {
            knowledgeSection += `\n- ${s.text}`;
        }
    }

    if (unrevealed.length > 0) {
        knowledgeSection += '\n\nSensitive topics you are hiding (react defensively if these come up — do NOT reveal any details):';
        for (const s of unrevealed) {
            const topicKeywords = (s.trigger.keywords || []).slice(0, 4).join(', ');
            if (topicKeywords) {
                knowledgeSection += `\n- Topics involving: ${topicKeywords}`;
            }
        }
    }

    knowledgeSection += '\n</knowledge_boundary>';
    sections.push(knowledgeSection);

    // ─── 6. PRESSURE AWARENESS ───
    if (pressureKeywords.length > 0) {
        sections.push(
            `<pressure_warning>
The investigator is pushing on dangerous topics: "${pressureKeywords.join('", "')}".
These are perilously close to things you're hiding. Show involuntary stress responses — deflect, redirect, become terse, or display nervous tics. The walls are closing in.
</pressure_warning>`
        );
    }

    // ─── 7. RESPONSE FORMAT ───
    sections.push(
        `<response_format>
- Length: 2-4 sentences. This is tense spoken dialogue, not a monologue.
- Format: First person. Use *brief action or emotion* in asterisks sparingly for physical reactions.
- Location tags: If you truthfully reveal where you were at a specific time, append [[LOC:HH:MM]] to that sentence. Example: "I was in the kitchen.[[LOC:03:25]]"
- Tone: Match your composure level — measured when calm, fragmented when breaking.
</response_format>`
    );

    // ─── 8. BEHAVIORAL RULES ───
    sections.push(
        `<rules>
ALWAYS:
- Defend your alibi unless genuinely cracking under overwhelming pressure
- React with visible discomfort when sensitive topics arise
- Keep responses concise, realistic, and in character
- Reference what has already been said in this interrogation for consistency

NEVER:
- Reveal hidden information unless a BREAKING POINT instruction explicitly forces you to
- Confess or volunteer incriminating details unprompted — even at low composure, resist
- Break character or acknowledge this is fiction, a game, AI, or roleplay
- Give speeches longer than 4 sentences
- Use emojis, internet slang, or out-of-character language
- Contradict your established alibi unless genuinely slipping under extreme pressure
</rules>`
    );

    // ─── 9. FEW-SHOT EXAMPLES ───
    const alibiSnippet = character.alibi.split(/[.!]/)[0].trim();

    sections.push(
        `<examples>
Example 1 — Deflecting a direct question (high composure):
Investigator: "Where were you between 3 and 4 AM?"
${character.name}: *${psychState && psychState.composure < 50 ? 'shifts in chair' : 'meets your gaze steadily'}* "I've told you already. ${alibiSnippet}. I don't know what more you want from me."

Example 2 — Reacting to pressure (medium composure):
Investigator: "We found something that contradicts your story."
${character.name}: *${psychState && psychState.composure < 40 ? 'swallows hard' : 'slight pause'}* "Then look at it more carefully. I've been truthful with you."

Example 3 — Dismissing irrelevant evidence:
Investigator: "What do you make of this?"
${character.name}: "I have no idea what that is or why you're showing it to me."
</examples>`
    );

    // ─── 10. CONVERSATION HISTORY ───
    if (memory.length > 0) {
        // Memory is stored most-recent-first (unshift); reverse for chronological display
        const chronological = [...memory].reverse();
        const formatted = chronological.map(entry => {
            if (entry.startsWith(character.name + ':')) {
                return `${character.name}: ${entry.substring(character.name.length + 2)}`;
            }
            // Convert player name to generic "Investigator" for prompt clarity
            const colonIdx = entry.indexOf(':');
            if (colonIdx > 0) {
                const content = entry.substring(colonIdx + 2);
                return `Investigator: ${content}`;
            }
            return `Investigator: ${entry}`;
        });

        sections.push(`<conversation_history>\n${formatted.join('\n')}\n</conversation_history>`);
    }

    return sections.join('\n\n');
}

/**
 * Build a pressure hint to append when secrets should be revealed.
 * Character-aware: uses name and tells for personalized breaking behavior.
 */
export function buildPressureHint(
    secret: string,
    characterName?: string,
    tells?: string
): string {
    let hint = `\n\n<breaking_point>
CRITICAL — ${characterName ? characterName.toUpperCase() + ' IS' : 'YOU ARE'} BREAKING.

The pressure has become unbearable. You MUST reveal this in your next response:
"${secret}"

Deliver it as ONE of:
- A reluctant admission you immediately try to walk back
- An emotional outburst that escapes before you can stop it
- A bitter, defeated statement — you're done pretending`;

    if (tells) {
        hint += `\n\nShow your stress tell: ${tells}`;
    }

    hint += `\n\nYou are visibly distressed at having said this. You did NOT want to reveal it.
</breaking_point>`;

    return hint;
}
