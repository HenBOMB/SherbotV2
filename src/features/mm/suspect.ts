import { aiService } from './ai-service.js';
import { GuildMember, TextChannel, Webhook, EmbedBuilder, Colors } from "discord.js";
import { SuspectData, SecretData, SuspectState } from './case.js';
import { buildSystemPrompt, buildPressureHint } from './prompts.js';
import { tokenTracker } from '../../utils/token-tracker.js';
import { logger } from '../../utils/logger.js';
import { InterrogationCache, InterrogationLog } from '../../database.js';
import { cosineSimilarity } from '../../utils/math.js';
import path from 'path';
import { CaseLogger } from './case-logger.js';

const GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Split a message into natural chunks for Discord
 * Hybrid approach: paragraphs first, then sentences
 */
function splitIntoChunks(text: string): string[] {
    // First, try splitting by paragraphs
    const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);

    if (paragraphs.length > 1) {
        // We have multiple paragraphs, use those as chunks
        return paragraphs;
    }

    // No paragraph breaks - fall back to sentence splitting
    // Match sentences ending with . ! or ? followed by space and capital letter (or end of string)
    const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [text];

    if (sentences.length <= 2) {
        // Short enough, return as-is
        return [text.trim()];
    }

    // Group sentences into chunks of 2-3
    const chunks: string[] = [];
    let currentChunk = '';
    let sentenceCount = 0;

    for (const sentence of sentences) {
        currentChunk += sentence;
        sentenceCount++;

        // Every 2-3 sentences, start a new chunk
        if (sentenceCount >= 2 && (sentenceCount >= 3 || Math.random() > 0.5)) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
            sentenceCount = 0;
        }
    }

    // Don't forget the last chunk
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks.length > 0 ? chunks : [text.trim()];
}

/**
 * Delay helper for typing simulation
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Psychological state of a suspect during interrogation
 */
export interface PsychState {
    /** Emotional composure: 100 = calm, 0 = breaking down */
    composure: number;
    /** How guarded/defensive they are: 0 = open, 100 = stonewalling */
    defensiveness: number;
}

/**
 * Result of evaluating an interrogation message
 */
export interface InterrogationResult {
    /** Secret that was triggered, if any */
    triggeredSecret: SecretData | null;
    /** Keywords matched from player message */
    matchedKeywords: string[];
    /** Composure lost this turn */
    composureLost: number;
}

/**
 * Response from suspect interrogation
 */
export interface SuspectResponse {
    message: string;
    roleplay: string | null;
    revealedSecret: SecretData | null;
    revealedEvidence: string[];
    messages: any[]; // Sent message objects
    teamworkBonusActive?: boolean;
}

/**
 * Suspect - an AI-powered NPC for interrogation with psychological state
 */
export default class Suspect {
    data: SuspectData;

    private _memory: Map<string, string[]> = new Map();
    private _state: PsychState = { composure: 100, defensiveness: 20 };
    private _revealedSecrets: Set<string> = new Set();
    private _busy: boolean = false;
    private _focused: string = '-1';
    private _webhook: Webhook | null = null;
    /** Track evidence IDs already presented to prevent composure hit stacking */
    private _presentedEvidence: Set<string> = new Set();

    /** Evidence IDs that have been discovered by players */
    private _knownEvidence: Set<string> = new Set();

    /** Track recent interrogators for Good Cop/Bad Cop bonus: Map<channelId, {userId, timestamp}[]> */
    private _recentInterrogators: Map<string, { userId: string; timestamp: number }[]> = new Map();

    /** Cooldown for multi-interrogator bonus (ms) */
    private static TEAM_BONUS_WINDOW = 60000; // 60 seconds

    constructor(data: SuspectData) {
        this.data = data;
    }

    /**
     * Check if suspect is busy responding
     */
    get isBusy(): boolean {
        return this._busy;
    }

    /**
     * Get current psychological state
     */
    get psychState(): PsychState {
        return { ...this._state };
    }

    /**
     * Get current state for persistence
     */
    getState(): SuspectState {
        const memoryRecord: Record<string, string[]> = {};
        for (const [channelId, messages] of this._memory.entries()) {
            memoryRecord[channelId] = messages;
        }

        return {
            id: this.data.id,
            composure: this._state.composure,
            defensiveness: this._state.defensiveness,
            revealedSecrets: Array.from(this._revealedSecrets),
            memory: memoryRecord,
            presentedEvidence: Array.from(this._presentedEvidence)
        };
    }

    /**
     * Load state from persistence
     */
    loadState(state: SuspectState): void {
        this._state.composure = state.composure;
        this._state.defensiveness = state.defensiveness;
        this._revealedSecrets = new Set(state.revealedSecrets);

        if (state.memory) {
            for (const [channelId, messages] of Object.entries(state.memory)) {
                this._memory.set(channelId, messages);
            }
        }

        if (state.presentedEvidence) {
            this._presentedEvidence = new Set(state.presentedEvidence);
        }
    }

    /**
     * Register that players have discovered evidence
     */
    addDiscoveredEvidence(evidenceId: string): void {
        this._knownEvidence.add(evidenceId.toLowerCase());
    }

    /**
     * Get or create webhook for this suspect
     */
    private async getWebhook(channel: TextChannel): Promise<Webhook | null> {
        if (this._webhook) return this._webhook;

        try {
            const hooks = await channel.fetchWebhooks();
            let hook = hooks.find(h => h.name === this.data.name);

            if (!hook) {
                // Resolve avatar path — local paths need the public/ prefix
                let avatarPath: string | undefined;
                if (this.data.avatar) {
                    if (this.data.avatar.startsWith('http')) {
                        avatarPath = this.data.avatar;
                    } else {
                        const fullPath = path.isAbsolute(this.data.avatar)
                            ? this.data.avatar
                            : path.join(process.cwd(), 'public', this.data.avatar);
                        avatarPath = fullPath;
                    }
                }

                hook = await channel.createWebhook({
                    name: this.data.name,
                    avatar: avatarPath,
                    reason: `Murder Mystery suspect: ${this.data.name}`
                });
            }

            this._webhook = hook;
            return hook;
        } catch (error) {
            logger.error(`Failed to create webhook for ${this.data.name}:`, error);
            return null;
        }
    }

    /**
     * Get the avatar URL for webhook sending (only if it's a remote URL)
     */
    private getWebhookAvatar(): string | undefined {
        if (this.data.avatar && this.data.avatar.startsWith('http')) {
            return this.data.avatar;
        }
        return undefined; // Let the webhook use its pre-configured local avatar
    }

    /**
     * Get memory for a channel
     */
    private getMemory(channelId: string): string[] {
        return this._memory.get(channelId) || [];
    }

    /**
     * Add to memory
     */
    private addMemory(channelId: string, entry: string): void {
        const memory = this.getMemory(channelId);
        memory.unshift(entry);
        // Limit memory to last 10 exchanges
        if (memory.length > 10) memory.pop();
        this._memory.set(channelId, memory);
    }

    /**
     * Extract keywords from a message (normalized to lowercase)
     */
    private extractKeywords(message: string): string[] {
        return message
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 1); // Allow 2-char words like "ai"
    }

    /**
     * Check if a secret's evidence requirements are met
     */
    private hasRequiredEvidence(secret: SecretData): boolean {
        if (!secret.trigger.requiresEvidence || secret.trigger.requiresEvidence.length === 0) {
            return true; // No evidence required
        }
        // Need at least one of the required evidence items
        return secret.trigger.requiresEvidence.some(req => {
            for (const known of this._knownEvidence) {
                if (this.isEvidenceMatch(req, known)) return true;
            }
            return false;
        });
    }

    /**
     * Helper to match evidence IDs against requirements, handling prefixes.
     */
    private isEvidenceMatch(requiredId: string, providedId: string): boolean {
        const r = requiredId.toLowerCase();
        const p = providedId.toLowerCase();
        if (r === p) return true;

        const prefixes = ['physical', 'secret', 'dna', 'footage', 'logs', 'locations'];
        for (const pref of prefixes) {
            if (`${pref}_${r}` === p) return true;
            if (r === `${pref}_${p}`) return true;
        }
        return false;
    }

    /**
     * Clean an evidence ID for user-facing display or mention detection.
     */
    private cleanEvidenceId(id: string): string {
        return id.replace(/^(physical|secret|dna|footage|logs|locations)_/i, '')
            .replace(/_/g, ' ')
            .toLowerCase()
            .trim();
    }

    /**
     * Get resistance multiplier based on suspect's resistance_level.
     * Higher resistance = less composure lost per hit.
     */
    private getResistanceMultiplier(): number {
        switch (this.data.resistance_level) {
            case 'expert': return 0.35;
            case 'high': return 0.5;
            case 'moderate': return 0.75;
            case 'low': return 1.0;
            default: return 0.75;
        }
    }

    /**
     * Calculate keyword match score for a secret
     * Uses exact word matching — no substring tricks.
     * Multi-word keywords (e.g. "your work") match if ALL words appear in the message.
     */
    private calculateKeywordMatch(secret: SecretData, messageKeywords: string[]): string[] {
        if (!secret.trigger.keywords || secret.trigger.keywords.length === 0) {
            return [];
        }

        const matches: string[] = [];
        for (const keyword of secret.trigger.keywords) {
            const kwParts = keyword.toLowerCase().split(/\s+/);

            if (kwParts.length > 1) {
                // Multi-word keyword: ALL words must appear in the message
                if (kwParts.every(part => messageKeywords.includes(part))) {
                    matches.push(keyword);
                }
            } else {
                // Single-word keyword: exact match only
                if (messageKeywords.includes(kwParts[0])) {
                    matches.push(keyword);
                }
            }
        }
        return matches;
    }

    /**
     * Evaluate an interrogation message for secret triggers.
     * 
     * KEY DESIGN DECISIONS (anti-cheese):
     *  - Only the CURRENT message drives composure loss (history no longer re-triggers).
     *  - Only the BEST-matching secret costs composure (no stacking across secrets).
     *  - Diminishing returns: first keyword = 5, second = 4, third = 3, etc.
     *  - Resistance multiplier scales loss by suspect difficulty.
     *  - Composure recovers slightly on "miss" messages (suspect catches their breath).
     *  - History keywords are still checked for pressure-warning context in the prompt.
     */
    private evaluateInterrogation(
        currentMessage: string,
        recentHistory: string[] = [],
        knownEvidence: Set<string> = new Set()
    ): InterrogationResult {
        // Keywords from the CURRENT message only (for composure damage)
        const currentKeywords = this.extractKeywords(currentMessage);

        // Keywords from recent history (for pressure-warning context, NOT composure)
        const historyText = recentHistory.join(' ');
        const historyKeywords = this.extractKeywords(historyText);

        // Union for "what topics are being discussed" (used for pressure warning in prompt)
        const allTopicKeywords = [...new Set([...currentKeywords, ...historyKeywords])];

        // Match against CURRENT message only for scoring
        let evidenceHit = false;
        const currentLower = currentMessage.toLowerCase();
        for (const ev of knownEvidence) {
            const cleanEv = this.cleanEvidenceId(ev);
            if (cleanEv.length > 4 && currentLower.includes(cleanEv)) {
                evidenceHit = true;
                break;
            }
        }

        let bestMatch: { secret: SecretData; keywords: string[]; currentHits: number } | null = null;

        // Check each unrevealed secret for keyword matches
        for (const secret of this.data.secrets) {
            if (this._revealedSecrets.has(secret.id)) continue;
            if (!this.hasRequiredEvidence(secret)) continue;

            // Match against CURRENT message only for scoring
            const currentMatches = this.calculateKeywordMatch(secret, currentKeywords);
            // Also check history for topic awareness (not scored)
            const historyMatches = this.calculateKeywordMatch(secret, allTopicKeywords);

            // Use current hits for composure, but track full topic hits for best-match ranking
            if (currentMatches.length > 0 || historyMatches.length > 0) {
                const totalRelevance = currentMatches.length + (historyMatches.length * 0.3);
                if (!bestMatch || totalRelevance > (bestMatch.currentHits + bestMatch.keywords.length * 0.3)) {
                    bestMatch = {
                        secret,
                        keywords: [...new Set([...currentMatches, ...historyMatches])], // all matched for prompt context
                        currentHits: currentMatches.length  // only current message hits count for composure
                    };
                }
            }
        }

        // Calculate composure loss from the BEST match only (no stacking)
        let composureLost = 0;
        if (bestMatch && bestMatch.currentHits > 0) {
            // Diminishing returns: 8 + 7 + 6 + 5...
            for (let i = 0; i < bestMatch.currentHits; i++) {
                composureLost += Math.max(2, 8 - i);
            }

            // Apply resistance multiplier
            const resistanceMul = this.getResistanceMultiplier();
            composureLost = Math.round(composureLost * resistanceMul);

            // Evidence Bonus Hit: If they mention a discovered clue, it rattles them regardless of keywords
            if (evidenceHit) {
                const bonus = Math.round(20 * resistanceMul);
                composureLost += bonus;
                logger.info(`🔍 Evidence mention detected in chat! Bonus ${bonus}% composure loss.`);
            }
        } else if (evidenceHit) {
            // Even if no secret keywords matched, mentioning a clue rattles them
            const resistanceMul = this.getResistanceMultiplier();
            composureLost = Math.round(15 * resistanceMul);
            logger.info(`🔍 Evidence mention (no keyword) detected. ${composureLost}% composure loss.`);
        }

        // Apply composure change
        if (composureLost > 0) {
            this._state.composure = Math.max(0, this._state.composure - composureLost);
            this._state.defensiveness = Math.min(100, this._state.defensiveness + Math.floor(composureLost / 2));
            logger.info(`${this.data.name} composure decreased by ${composureLost} (resistance: ${this.data.resistance_level}). Current: ${this._state.composure}%`);
        } else {
            // No hit — suspect recovers slightly (catches breath)
            const recovery = 1;
            const prevComposure = this._state.composure;
            this._state.composure = Math.min(100, this._state.composure + recovery);
            if (this._state.composure !== prevComposure) {
                logger.debug(`${this.data.name} composure recovered by ${recovery}. Current: ${this._state.composure}%`);
            }
        }

        // Determine if a secret should be revealed
        let triggeredSecret: SecretData | null = null;
        if (bestMatch && bestMatch.currentHits >= 2) {
            const secret = bestMatch.secret;
            const minPressure = secret.trigger.minPressure ?? 30;
            const composureLoss = 100 - this._state.composure;

            if (composureLoss >= minPressure) {
                triggeredSecret = secret;
                this._revealedSecrets.add(secret.id);
                logger.info(`TRIGGERED SECRET for ${this.data.name}: ${secret.id}`);
            }
        }

        return {
            triggeredSecret,
            matchedKeywords: bestMatch?.keywords || [],
            composureLost,
        };
    }

    /**
     * Calculate team interrogation multiplier (Good Cop / Bad Cop bonus)
     * Returns a multiplier > 1 if multiple detectives interrogated recently
     */
    private getTeamMultiplier(channelId: string, currentUserId: string): number {
        const now = Date.now();
        const recent = this._recentInterrogators.get(channelId) || [];

        // Filter to entries within the time window
        const validEntries = recent.filter(e => now - e.timestamp < Suspect.TEAM_BONUS_WINDOW);

        // Check if there's a DIFFERENT user who interrogated recently
        const differentUsers = validEntries.filter(e => e.userId !== currentUserId);

        if (differentUsers.length > 0) {
            logger.info(`🚔 Good Cop/Bad Cop bonus activated! ${differentUsers.length + 1} detectives pressuring ${this.data.name}`);
            return 1.5; // 50% bonus pressure
        }

        return 1.0;
    }

    /**
     * Record an interrogation for team tracking
     */
    private recordInterrogator(channelId: string, userId: string): void {
        const now = Date.now();
        const recent = this._recentInterrogators.get(channelId) || [];

        // Add new entry
        recent.unshift({ userId, timestamp: now });

        // Keep only last 5 entries
        if (recent.length > 5) recent.pop();

        this._recentInterrogators.set(channelId, recent);
    }

    /**
     * Apply behavioral tells based on composure level
     * Modifies the response text to show stress indicators
     */
    private applyBehavioralTells(text: string): string {
        const composure = this._state.composure;

        // High composure (>70%): Clean, confident responses
        if (composure > 70) {
            return text;
        }

        // Nervous (30-70%): Add hesitation and stuttering
        if (composure > 30) {
            // Occasionally add "..." before sentences
            let modified = text.replace(/([.!?]\s+)([A-Z])/g, (match, p1, p2) => {
                return Math.random() > 0.6 ? `${p1}... ${p2}` : match;
            });

            // Sometimes stutter on emotional words
            const stutterWords = ['I', 'no', 'never', 'didn\'t', 'wasn\'t'];
            for (const word of stutterWords) {
                if (Math.random() > 0.7) {
                    const regex = new RegExp(`\\b${word}\\b`, 'i');
                    modified = modified.replace(regex, `${word.charAt(0)}-${word}`);
                }
            }

            return modified;
        }

        // Breaking down (<30%): More extreme effects
        if (composure > 10) {
            // Add more hesitation
            let modified = text.replace(/([.!?]\s+)/g, '$1... ');

            // Stutter more frequently
            modified = modified.replace(/\b(I|no|never|didn't|wasn't|please|stop)\b/gi, (match) => {
                return `${match.charAt(0)}-${match}`;
            });

            // Occasionally CAPS for emphasis
            const sentences = modified.split(/(?<=[.!?])\s+/);
            modified = sentences.map(s => {
                return Math.random() > 0.8 ? s.toUpperCase() : s;
            }).join(' ');

            return modified;
        }

        // Complete breakdown (<10%): Short, panicked responses
        // Add extreme stuttering and capitalize everything
        let modified = text.toUpperCase();
        modified = modified.replace(/\b(\w)/g, '$1-$1');
        return modified;
    }

    /**
     * Calculate extra typing delay based on stress (nervous = longer pauses)
     */
    private getStressTypingDelay(): number {
        const composure = this._state.composure;

        if (composure > 70) return 0; // Confident, no extra delay
        if (composure > 50) return 200; // Slightly hesitant
        if (composure > 30) return 400; // Nervous pause
        if (composure > 10) return 800; // Long, anxious pause
        return 1200; // Breaking down, very long pause
    }

    /**
     * Parse AI response to extract actual message, roleplay, and format location tags.
     */
    private parseAIResponse(text: string): { message: string, roleplay: string | null, revealedLocations: string[] } {
        // Match roleplay actions: *action*
        const rpMatch = /\*(.+?)\*/.exec(text);
        const roleplay = rpMatch ? rpMatch[1] : null;

        // If message is wrapped in quotes, strip them
        let actualMessage = text.trim();
        const quoteMatch = /^"(.+)"$/.exec(actualMessage);
        if (quoteMatch) {
            actualMessage = quoteMatch[1];
        }

        // Parse and format Location Tags: [[LOC:HH:MM]] -> (HH:MM)
        const locRegex = /\[\[LOC:(\d{1,2}:\d{2})\]\]/g;
        const revealedLocations: string[] = [];
        let m;
        while ((m = locRegex.exec(actualMessage)) !== null) {
            revealedLocations.push(m[1]);
        }
        actualMessage = actualMessage.replace(locRegex, ' ($1)');

        // Convert parenthetical actions to Discord italics: (action) -> *action*
        actualMessage = actualMessage.replace(/\(([^)]+)\)/g, '*$1*');

        // Clean up unclosed asterisks (common if AI is cut off)
        const asteriskCount = (actualMessage.match(/\*/g) || []).length;
        if (asteriskCount % 2 !== 0) {
            actualMessage += '*';
        }

        // Apply behavioral tells based on stress level
        actualMessage = this.applyBehavioralTells(actualMessage);

        return { message: actualMessage, roleplay, revealedLocations };

        // Apply behavioral tells based on stress level
        actualMessage = this.applyBehavioralTells(actualMessage);

        return { message: actualMessage, roleplay, revealedLocations };
    }

    /**
     * Smart delay helper that keeps the typing indicator active for long pauses
     */
    private async smartDelay(channel: TextChannel, ms: number): Promise<void> {
        if (ms <= 0) return;

        // precise delay for short durations
        if (ms < 8000) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        const startTime = Date.now();
        while (Date.now() - startTime < ms) {
            const remaining = ms - (Date.now() - startTime);
            // Wait in chunks, refreshing typing status every ~8 seconds
            const waitTime = Math.min(remaining, 8000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    /**
     * Present evidence to the suspect (Phoenix Wright style)
     * Deals massive pressure if evidence is relevant to their secrets
     */
    async presentEvidence(
        asker: GuildMember,
        evidenceId: string,
        channel: TextChannel,
        caseId: string,
        discoveredEvidence: Set<string> = new Set(),
        roomDescription?: string,
        roomInteractables?: { name: string; description: string }[],
        caseLogger?: CaseLogger | null
    ): Promise<{ wasRelevant: boolean; revealedSecret: SecretData | null; composureLost: number } | null> {
        if (this._busy) return null;
        this._busy = true;

        try {
            const hook = await this.getWebhook(channel);
            if (!hook) {
                this._busy = false;
                return null;
            }

            // Update known evidence
            for (const evidence of discoveredEvidence) {
                this.addDiscoveredEvidence(evidence);
            }

            // Check if this evidence is relevant to any of their secrets
            let wasRelevant = false;
            let targetSecret: SecretData | null = null;
            let composureLost = 0;

            for (const secret of this.data.secrets) {
                if (this._revealedSecrets.has(secret.id)) continue;

                const required = secret.trigger.requiresEvidence || [];
                if (required.some(e => this.isEvidenceMatch(e, evidenceId))) {
                    wasRelevant = true;
                    targetSecret = secret;
                    break;
                }
            }

            // Apply pressure based on relevance
            const alreadyPresented = this._presentedEvidence.has(evidenceId.toLowerCase());

            if (wasRelevant) {
                // MASSIVE pressure - 40% composure hit
                composureLost = alreadyPresented ? 0 : 40;

                if (!alreadyPresented) {
                    this._state.composure = Math.max(0, this._state.composure - composureLost);
                    this._state.defensiveness = Math.min(100, this._state.defensiveness + 20);
                    this._presentedEvidence.add(evidenceId.toLowerCase());
                    logger.info(`💥 EVIDENCE HIT! ${this.data.name} loses ${composureLost}% composure from "${evidenceId}"`);
                } else {
                    logger.info(`🔄 Repeated evidence presentation: "${evidenceId}". Skipping composure drop.`);
                }
            } else {
                // Minor pressure - 5% hit for wasting their time
                composureLost = alreadyPresented ? 0 : 5;
                if (!alreadyPresented) {
                    this._state.composure = Math.max(0, this._state.composure - composureLost);
                    this._presentedEvidence.add(evidenceId.toLowerCase());
                }
            }

            // Check if we should reveal a secret
            let revealedSecret: SecretData | null = null;
            if (targetSecret) {
                const minPressure = targetSecret.trigger.minPressure ?? 30;
                const composureLoss = 100 - this._state.composure;

                if (composureLoss >= minPressure) {
                    revealedSecret = targetSecret;
                    this._revealedSecrets.add(targetSecret.id);
                    logger.info(`🔓 SECRET REVEALED via evidence: ${targetSecret.id}`);
                    caseLogger?.logTrigger(this.data.name, targetSecret.id, {
                        method: 'EVIDENCE',
                        evidenceId,
                        text: targetSecret.text
                    });
                }
            }

            // Generate response via AI
            await channel.sendTyping();

            // Add stress delay
            const stressDelay = this.getStressTypingDelay();
            if (stressDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, stressDelay));
            }

            // Build prompt for reaction
            const evidenceName = this.cleanEvidenceId(evidenceId);

            let reactionPrompt = `${asker.displayName} has just presented you with evidence: "${evidenceName}".`;

            if (wasRelevant) {
                reactionPrompt += ` This evidence is DIRECTLY related to something you're hiding. You are SHOCKED and struggling to maintain composure.`;
                if (revealedSecret) {
                    reactionPrompt += ` You can no longer hide it. You must admit: "${revealedSecret.text}"`;
                }
            } else {
                reactionPrompt += ` This evidence doesn't particularly concern you. You can dismiss it calmly.`;
            }

            // --- EVIDENCE DESCRIPTION INJECTION ---
            // Let the AI know what the item actually is so it doesn't hallucinate a denial of its existence
            if (evidenceId) {
                const evidenceDesc = this.getPhysicalEvidenceDesc(evidenceId, roomInteractables);
                if (evidenceDesc) {
                    reactionPrompt += `\n\nFor context, here is the description of the evidence being shown to you: "${evidenceDesc}"`;
                }
            }

            const systemPrompt = buildSystemPrompt(
                {
                    name: this.data.name,
                    age: this.data.age,
                    role: this.data.role,
                    gender: this.data.gender,
                    traits: this.data.traits,
                    alibi: this.data.alibi,
                    motive: this.data.motive,
                    secrets: this.data.secrets,
                    tells: this.data.tells,
                    resistance_level: this.data.resistance_level,
                    revealedSecretIds: Array.from(this._revealedSecrets),
                    roomDescription,
                    roomInteractables
                },
                this.getMemory(channel.id),
                this._state,
                []
            );

            const startTime = Date.now();
            const aiPromise = aiService.chatCompletion([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: reactionPrompt }
            ], {
                max_tokens: 512,
                temperature: 0.9,
                model: GEMINI_MODEL,
                guildId: channel.guildId
            });

            // Keep typing indicator alive while waiting for AI
            const response = await aiPromise;

            if (!response) throw new Error('No response from AI');

            // Track token consumption
            if (response.usage) {
                tokenTracker.track(this.data.id, GEMINI_MODEL, response.usage, caseId, channel.guildId);
            }

            // Calculate AI latency
            const duration = Date.now() - startTime;

            let text = response.content || '*stares silently*';

            // Parse response formatting (strip roleplay, format tags, apply tells)
            const parsed = this.parseAIResponse(text);
            text = parsed.message;

            // Log AI response
            caseLogger?.logAIResponse(this.data.name, text);

            // Split message into natural chunks and send with typing delays
            const chunks = splitIntoChunks(text);
            const sentMessages: any[] = [];

            // Calculate typing delay
            // We want to "discount" the time we already waited for the AI to generate the response
            let latencyBalance = duration;
            const msPerChar = 15; // Speed of typing simulation

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];

                // Calculate how long this chunk *should* take to type
                const typeTime = (chunk.length * msPerChar) + (Math.random() * 50);

                // Calculate required delay after accounting for "banked" latency
                const delay = Math.max(0, typeTime - latencyBalance);

                // Update our balance
                latencyBalance = Math.max(0, latencyBalance - typeTime);

                if (delay > 0) {
                    await this.smartDelay(channel, delay);
                }

                const sent = await hook.send({
                    content: chunk,
                    username: this.data.name,
                    avatarURL: this.getWebhookAvatar(),
                    wait: true
                } as any);
                sentMessages.push(sent);
            }

            // Log AI response
            caseLogger?.logAIResponse(this.data.name, text);

            // Add to memory so they remember this interaction in follow-up chat
            this.addMemory(channel.id, `${asker.displayName}: [Shows ${evidenceName}]`);
            this.addMemory(channel.id, `${this.data.name}: ${text}`);

            this._busy = false;

            // Log interaction
            try {
                await InterrogationLog.create({
                    caseId: caseId,
                    suspectId: this.data.id,
                    userId: asker.id,
                    question: `[PRESENTED EVIDENCE]: ${evidenceId}`,
                    response: text,
                    composureLost,
                    secretRevealed: revealedSecret ? revealedSecret.id : null
                });
            } catch (e) {
                logger.error('Failed to log evidence presentation to DB:', e);
            }

            return { wasRelevant, revealedSecret, composureLost };
        } catch (error) {
            this._busy = false;
            logger.error(`Suspect ${this.data.name} failed to react to evidence:`, error);
            return null;
        }
    }

    /**
     * Respond to an interrogation
     */
    async respond(
        asker: GuildMember,
        message: string,
        channel: TextChannel,
        caseId: string,
        discoveredEvidence: Set<string> = new Set(),
        roomDescription?: string,
        roomInteractables?: { name: string; description: string }[],
        caseLogger?: CaseLogger | null
    ): Promise<SuspectResponse | null> {
        if (this._busy) return null;
        this._busy = true;

        try {
            const hook = await this.getWebhook(channel);
            if (!hook) {
                this._busy = false;
                return null;
            }

            // Update known evidence
            for (const evidence of discoveredEvidence) {
                this.addDiscoveredEvidence(evidence);
            }

            // Get recent history for context-aware pressure
            // We want the current message + last 10 messages from players
            const memory = this.getMemory(channel.id);
            const playerHistory = memory
                .filter(m => !m.startsWith(this.data.name + ':')) // Filter out suspect's own lines
                .slice(0, 10) // Take last 10
                .map(m => m.replace(/^[^:]+:\s*/, '')); // Strip "Name: " prefix to get raw content

            // Record this interrogator for team bonus tracking
            this.recordInterrogator(channel.id, asker.id);

            // Calculate team multiplier (Good Cop / Bad Cop)
            const teamMultiplier = this.getTeamMultiplier(channel.id, asker.id);

            // Evaluate the interrogation — only current message drives composure loss,
            // history is used for topic context / pressure warnings only
            const evaluation = this.evaluateInterrogation(message, playerHistory, this._knownEvidence);

            // Apply team multiplier to composure loss
            const teamworkBonusActive = teamMultiplier > 1 && evaluation.composureLost > 0;
            if (teamworkBonusActive) {
                const bonusLoss = Math.floor(evaluation.composureLost * (teamMultiplier - 1));
                this._state.composure = Math.max(0, this._state.composure - bonusLoss);
                logger.info(`Team bonus applied: extra ${bonusLoss}% composure loss`);
            }

            logger.info(`Suspect Interrogation: ${this.data.name} by ${asker.displayName}`);
            logger.debug(`Interrogation Details:`, {
                suspect: this.data.id,
                message,
                keywords: this.extractKeywords(message),
                psychState: this._state,
                evaluation
            });

            // --- SMART CACHING START ---
            let cachedResponse: SuspectResponse | null = null;
            let queryEmbedding: number[] | null = null;

            try {
                // 1. Generate embedding for current question
                queryEmbedding = await aiService.getEmbedding(message);

                // 2. Query cache for this suspect
                const cachedEntries = await InterrogationCache.findAll({
                    where: { suspectId: this.data.id }
                });

                // 3. Check for similarity
                let bestSimilarity = 0;
                let bestMatch: InterrogationCache | null = null;

                for (const entry of cachedEntries) {
                    try {
                        const cachedEmbedding = JSON.parse(entry.embedding);
                        const similarity = cosineSimilarity(queryEmbedding, cachedEmbedding);

                        if (similarity > bestSimilarity) {
                            bestSimilarity = similarity;
                            bestMatch = entry;
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }

                logger.debug(`Cache similarity check: Best match ${bestSimilarity.toFixed(4)}`);

                // 4. Use cache if similarity > 0.88 (Tunable threshold)
                if (bestSimilarity > 0.80 && bestMatch) {
                    logger.info(`✨ CACHE HIT! Serving cached response for ${this.data.id} (Sim: ${bestSimilarity.toFixed(2)})`);
                    const cachedData = JSON.parse(bestMatch.response) as SuspectResponse;

                    // We need to re-process the cached response to match current context somewhat?
                    // For now, we return it as is, but we might want to update the 'messages' part if we were storing full objects.
                    // Actually, let's just use the text and re-chunk it to simulate "live" typing again, 
                    // OR just return the whole object if it fits. 
                    // The cache stores the result of `respond`? No, it stores the data needed to reconstruction.
                    // Let's assume we stored the *result* object.

                    // IMPORTANT: We need to ensure we don't return stale "revealedSecrets" if they are already known?
                    // Actually, if the user asks the same thing, they get the same answer.
                    // But we should probably strip "messages" array and re-generate it for the new channel/hook?
                    // The `respond` method returns `SuspectResponse`.

                    // Let's reconstruct the flow for a cache hit

                    // Update memory
                    this.addMemory(channel.id, `${asker.displayName}: ${message}`);
                    this.addMemory(channel.id, `${this.data.name}: ${cachedData.message}`);

                    // Split and send
                    const chunks = splitIntoChunks(cachedData.message);
                    const sentMessages: any[] = [];

                    let latencyBalance = 0; // Cache is instant, so we simulate full typing time
                    const msPerChar = 15;

                    for (let i = 0; i < chunks.length; i++) {
                        const chunk = chunks[i];
                        const typeTime = (chunk.length * msPerChar) + (Math.random() * 50);
                        const delay = Math.max(0, typeTime - latencyBalance);
                        latencyBalance = Math.max(0, latencyBalance - typeTime);

                        if (delay > 0) {
                            await this.smartDelay(channel, delay);
                        }

                        const sent = await hook.send({
                            content: chunk,
                            username: this.data.name,
                            avatarURL: this.getWebhookAvatar(),
                            wait: true
                        } as any);
                        sentMessages.push(sent);
                    }

                    this._focused = asker.id;
                    this._busy = false; // RELEASE LOCK

                    // Log cached interaction
                    try {
                        await InterrogationLog.create({
                            caseId: caseId,
                            suspectId: this.data.id,
                            userId: asker.id,
                            question: message,
                            response: cachedData.message,
                            composureLost: evaluation.composureLost,
                            secretRevealed: evaluation.triggeredSecret ? evaluation.triggeredSecret.id : null
                        });
                    } catch (e) {
                        logger.error('Failed to log cached interrogation to DB:', e);
                    }

                    return {
                        ...cachedData,
                        messages: sentMessages, // Update with new message objects
                        teamworkBonusActive // Keep current bonus status
                    };
                }

            } catch (err) {
                logger.warn(`Smart cache lookup failed:`, err);
                // Continue to generation on error
            }
            // --- SMART CACHING END ---

            // Build the prompt
            // memory is already declared above

            // Build complete system prompt with character data
            let systemPrompt = buildSystemPrompt(
                {
                    name: this.data.name,
                    age: this.data.age,
                    role: this.data.role,
                    gender: this.data.gender,
                    traits: this.data.traits,
                    alibi: this.data.alibi,
                    motive: this.data.motive,
                    secrets: this.data.secrets,
                    tells: this.data.tells,
                    resistance_level: this.data.resistance_level,
                    revealedSecretIds: Array.from(this._revealedSecrets),
                    roomDescription,
                    roomInteractables
                },
                memory,
                this._state,
                evaluation.matchedKeywords
            );

            // If a secret was triggered, add the character-aware reveal hint
            if (evaluation.triggeredSecret) {
                logger.info(`!!! SECRET TRIGGERED: ${evaluation.triggeredSecret.id} !!!`);
                systemPrompt += buildPressureHint(
                    evaluation.triggeredSecret.text,
                    this.data.name,
                    this.data.tells
                );
            }

            // Show typing
            // Just send once to not overstep
            await channel.sendTyping();

            // Add stress-based delay (nervous suspects pause longer)
            const stressDelay = this.getStressTypingDelay();
            if (stressDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, stressDelay));
            }

            const startTime = Date.now();
            // Call AI API
            const aiPromise = aiService.chatCompletion([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message }
            ], {
                model: GEMINI_MODEL,
                guildId: channel.guildId
            });

            // Keep typing indicator alive
            const response = await aiPromise;

            if (!response) throw new Error('AI Service Timeout or Failure');

            // Track token consumption
            if (response.usage) {
                tokenTracker.track(this.data.id, GEMINI_MODEL, response.usage, caseId, channel.guildId);
            }

            const duration = Date.now() - startTime;

            const text = response.content || '';
            logger.debug(`AI Response for ${this.data.name} (${duration}ms): "${text}"`);

            // Parse response formatting (strip roleplay, format tags, apply tells)
            const parsed = this.parseAIResponse(text);
            const actualMessage = parsed.message;
            const roleplay = parsed.roleplay;
            const revealedLocations = parsed.revealedLocations;

            // Convert to unique evidence IDs
            const revealedEvidence = revealedLocations.map(time => `locations_${this.data.id}_${time}`);

            // Add to memory
            this.addMemory(channel.id, `${asker.displayName}: ${message}`);
            this.addMemory(channel.id, `${this.data.name}: ${actualMessage}`);

            // Split message into natural chunks and send with typing delays
            const chunks = splitIntoChunks(actualMessage);
            const sentMessages: any[] = [];

            // We want to "discount" the time we already waited for the AI to generate the response
            // So if the AI took 3s, and the first chunk takes 1s to type, we send it immediately (0s wait)
            // If the AI took 3s, and the first chunk takes 5s to type, we wait 2s
            let latencyBalance = duration;
            const msPerChar = 15; // Speed of typing simulation

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];

                // Calculate how long this chunk *should* take to type
                // Add some randomness for organic feel
                const typeTime = (chunk.length * msPerChar) + (Math.random() * 50);

                // Calculate required delay after accounting for "banked" latency
                const delay = Math.max(0, typeTime - latencyBalance);

                // Update our balance - we've "used up" the wait time equivalent to the typing time
                latencyBalance = Math.max(0, latencyBalance - typeTime);

                // Show typing before message
                // Iif the calculated delay is significant, smartDelay will refresh it.

                if (delay > 0) {
                    await this.smartDelay(channel, delay);
                }

                const sent = await hook.send({
                    content: chunk,
                    username: this.data.name,
                    avatarURL: this.getWebhookAvatar(),
                    wait: true
                } as any);
                sentMessages.push(sent);
            }

            // Log AI response to case file
            caseLogger?.logAIResponse(this.data.name, actualMessage);

            // Update focus
            this._focused = asker.id;

            this._busy = false;

            const responseData: SuspectResponse = {
                message: actualMessage,
                roleplay,
                revealedSecret: evaluation.triggeredSecret,
                revealedEvidence: revealedEvidence,
                messages: sentMessages,
                teamworkBonusActive
            };

            // --- SAVE TO CACHE START ---
            if (queryEmbedding && actualMessage.length > 5) {
                // Don't cache very short responses or failed ones
                try {
                    await InterrogationCache.create({
                        suspectId: this.data.id,
                        question: message,
                        embedding: JSON.stringify(queryEmbedding),
                        response: JSON.stringify(responseData)
                    });
                    logger.debug(`Saved response to smart cache for ${this.data.id}`);
                } catch (e) {
                    logger.error(`Failed to save to smart cache:`, e);
                }
            }
            // --- SAVE TO CACHE END ---

            // Log secret trigger if any
            if (evaluation.triggeredSecret) {
                caseLogger?.logTrigger(this.data.name, evaluation.triggeredSecret.id, {
                    method: 'INTERROGATION',
                    message,
                    text: evaluation.triggeredSecret.text
                });
            }

            // Log interaction
            try {
                await InterrogationLog.create({
                    caseId: caseId,
                    suspectId: this.data.id,
                    userId: asker.id,
                    question: message,
                    response: actualMessage,
                    composureLost: evaluation.composureLost,
                    secretRevealed: evaluation.triggeredSecret ? evaluation.triggeredSecret.id : null
                });
            } catch (e) {
                logger.error('Failed to log interrogation to DB:', e);
            }

            return responseData;
        } catch (error) {
            this._busy = false;
            logger.error(`Suspect ${this.data.name} failed to respond:`, error);
            return null;
        }
    }

    /**
     * Get info embed for this suspect (public info only)
     */
    getInfoEmbed(): EmbedBuilder {
        return new EmbedBuilder()
            .setColor(Colors.Blurple)
            .setTitle(this.data.name)
            .setThumbnail(this.data.avatar)
            .addFields(
                { name: 'Aliases', value: this.data.alias.join(', '), inline: true },
                { name: 'Gender', value: this.data.gender || 'Unknown', inline: true },
            )
            .setFooter({ text: `ID: ${this.data.id}` });
    }

    /**
     * Get serializable state for dashboard
     */
    getDashboardState() {
        return {
            id: this.data.id,
            name: this.data.name,
            avatar: this.data.avatar,
            isGuilty: this.data.isGuilty,
            composure: this._state.composure,
            defensiveness: this._state.defensiveness,
            revealedSecrets: Array.from(this._revealedSecrets),
            totalSecrets: this.data.secrets.length,
            isBusy: this._busy,
            // Secret triggers info for dev dashboard
            secrets: this.data.secrets.map(s => ({
                id: s.id,
                text: s.text,
                revealed: this._revealedSecrets.has(s.id),
                trigger: {
                    keywords: s.trigger.keywords || [],
                    requiresEvidence: s.trigger.requiresEvidence || [],
                    minPressure: s.trigger.minPressure ?? 30,
                    hasRequiredEvidence: this.hasRequiredEvidence(s),
                }
            })),
        };
    }

    /**
     * Get full conversational history across all channels
     */
    public getFullHistory(): Map<string, string[]> {
        return new Map(this._memory);
    }

    /**
     * Fully reset the suspect's state (clear memory, reset composure, forget evidence)
     */
    public fullReset(): void {
        this._memory.clear();
        this._state = { composure: 100, defensiveness: 20 };
        this._revealedSecrets.clear();
        this._presentedEvidence.clear();
        logger.info(`🔄 Full state reset for suspect: ${this.data.id}`);
    }

    /**
     * Clear all conversational memory for this suspect
     */
    public clearMemory(): void {
        this._memory.clear();
    }

    /**
     * Helper to get evidence description for prompt injection
     */
    private getPhysicalEvidenceDesc(evidenceId: string, interactables: { name: string; description: string }[] = []): string | null {
        // 1. Check if it matches an interactable in the current room
        const cleanId = this.cleanEvidenceId(evidenceId).replace(/\s+/g, '');
        for (const item of interactables) {
            const cleanName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanName.includes(cleanId) || cleanId.includes(cleanName)) {
                return item.description;
            }
        }
        return null;
    }

}
