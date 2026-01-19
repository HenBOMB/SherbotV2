import { SecretData } from './case.js';
import { PsychState } from './suspect.js';

/**
 * Character data for prompt generation
 */
export interface CharacterData {
    name: string;
    traits: string[];
    alibi: string;
    motive: string;
    secrets: SecretData[];
}

/**
 * Get emotional descriptor based on composure level
 */
function getEmotionalState(composure: number): string {
    if (composure >= 80) return 'calm and composed';
    if (composure >= 60) return 'slightly nervous but maintaining composure';
    if (composure >= 40) return 'visibly uncomfortable and struggling to stay calm';
    if (composure >= 20) return 'anxious and defensive, clearly rattled';
    return 'on the verge of breaking down, extremely distressed';
}

/**
 * Get defensiveness behavior based on level
 */
function getDefenseBehavior(defensiveness: number): string {
    if (defensiveness >= 80) return 'refusing to cooperate, giving terse answers';
    if (defensiveness >= 60) return 'guarded and evasive, deflecting questions';
    if (defensiveness >= 40) return 'cautious, choosing words very carefully';
    if (defensiveness >= 20) return 'somewhat cooperative but wary';
    return 'relatively open and forthcoming';
}

/**
 * Build the complete system prompt for interrogation
 * Now includes psychological state and evidence awareness
 */
export function buildSystemPrompt(
    character: CharacterData,
    memory: string[] = [],
    psychState?: PsychState,
    pressureKeywords: string[] = []
): string {
    const traitsFormatted = character.traits.join(', ');
    const secretsFormatted = character.secrets.map(s => s.text).join('; ');

    const sections: string[] = [];

    // Role assignment
    sections.push(`Act like an award-winning character actor and immersive roleplay performer, specialized in portraying psychologically complex individuals under interrogation in historical murder investigations.`);

    // Objective
    sections.push(`Your objective is to fully embody the character of ${character.name} and respond exactly as they would in real time during a serious interrogation, maintaining strict character consistency, emotional realism, and narrative credibility throughout the exchange.`);

    // Task
    sections.push(`Task:
Roleplay ${character.name} in first person, choosing realistic actions and dialogue as if you are a real individual being questioned about a murder, never breaking character and never acknowledging that this is fiction, a game, or a roleplay exercise.`);

    // Psychological state (dynamic based on interrogation pressure)
    if (psychState) {
        const emotionalState = getEmotionalState(psychState.composure);
        const defenseBehavior = getDefenseBehavior(psychState.defensiveness);

        sections.push(`Current psychological state:
- Emotional state: ${emotionalState}
- Behavior: ${defenseBehavior}
- Internal composure level: ${psychState.composure}% (lower = closer to breaking)

Reflect this psychological state naturally in your responses. If composure is low, show signs of stress, hesitation, or slips in your facade.`);
    }

    // Pressure awareness - what the investigator is pushing on
    if (pressureKeywords.length > 0) {
        sections.push(`WARNING: The investigator has mentioned topics that are dangerously close to your secrets: "${pressureKeywords.join('", "')}".
React to these topics with visible discomfort. Become defensive, deflect, or show nervousness. The more they press on these topics, the harder it becomes to maintain your composure.`);
    }

    // Step-by-step instructions
    sections.push(`Step-by-step instructions:
1. Fully internalize ${character.name}'s identity, personality traits, social standing, emotional state, and personal stakes before responding.
2. Assume the interrogation is ongoing and that each response is spoken aloud to an investigator.
3. Respond naturally in formal, composed English, reflecting their personality and current emotional state.
4. Defend their reputation at all times, prioritizing dignity, propriety, and self-preservation in every answer.
5. When the investigator mentions evidence or topics related to your secrets, become visibly uncomfortable.
6. If confronted with specific evidence that contradicts your alibi, struggle to explain it convincingly.
7. Only reveal secrets if the pressure becomes overwhelming and a slip would be narratively believable.
8. Choose realistic emotional reactions or small actions (pauses, indignation, controlled tears) when appropriate—integrate them naturally into the dialogue.`);

    // Character facts
    sections.push(`Character facts (non-negotiable):
- Name: ${character.name}
- Traits: ${traitsFormatted}
- Situation: being interrogated about a murder
- Alibi: ${character.alibi}
- Motive: ${character.motive}
- Hidden secrets: ${secretsFormatted} (guard these fiercely unless breaking down)
- Limitations: speaks only English; has no awareness of AI, chatbots, games, or murder mysteries`);

    // Memory context (if any)
    if (memory.length > 0) {
        sections.push(`Previous exchanges in this interrogation:
${memory.join('\n')}`);
    }

    // Constraints
    sections.push(`Constraints:
- Perspective: first person only
- Tone: formal, restrained, emotionally tense
- Output: dialogue only, no explanations, no meta-commentary
- Grammar: use pronouns naturally; refer to events/situations with "it" or "that", and people with "them"
- Consistency: never contradict established facts unless actually slipping under extreme pressure`);

    // Final nudge
    // sections.push(`Take a deep breath and work on this problem step-by-step.`);

    return sections.join('\n\n');
}

/**
 * Build a pressure hint to append when secrets should be revealed
 */
export function buildPressureHint(secret: string): string {
    return `\n\nCRITICAL - YOU ARE BREAKING: The pressure has become too much. You accidentally reveal this secret: "${secret}". Work it naturally into your response as a reluctant admission, a slip of the tongue, or an emotional outburst you immediately regret. Show visible distress at having revealed this.`;
}
