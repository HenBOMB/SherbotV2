import OpenAI from "openai";
import { GuildMember, TextChannel, Webhook, EmbedBuilder, Colors } from "discord.js";
import { SuspectData, SecretData, SuspectState } from './case.js';
import { buildSystemPrompt, buildPressureHint } from './prompts.js';
import { logger } from '../../utils/logger.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = 'gpt-4o-mini';

// Initialize OpenAI SDK
const ai = new OpenAI({ apiKey: OPENAI_API_KEY });

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
        return {
            id: this.data.id,
            composure: this._state.composure,
            defensiveness: this._state.defensiveness,
            revealedSecrets: Array.from(this._revealedSecrets)
        };
    }

    /**
     * Load state from persistence
     */
    loadState(state: SuspectState): void {
        this._state.composure = state.composure;
        this._state.defensiveness = state.defensiveness;
        this._revealedSecrets = new Set(state.revealedSecrets);
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
                hook = await channel.createWebhook({
                    name: this.data.name,
                    avatar: this.data.avatar,
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
            .filter(w => w.length > 2);
    }

    /**
     * Check if a secret's evidence requirements are met
     */
    private hasRequiredEvidence(secret: SecretData): boolean {
        if (!secret.trigger.requiresEvidence || secret.trigger.requiresEvidence.length === 0) {
            return true; // No evidence required
        }
        // Need at least one of the required evidence items
        return secret.trigger.requiresEvidence.some(e =>
            this._knownEvidence.has(e.toLowerCase())
        );
    }

    /**
     * Calculate keyword match score for a secret
     */
    private calculateKeywordMatch(secret: SecretData, messageKeywords: string[]): string[] {
        if (!secret.trigger.keywords || secret.trigger.keywords.length === 0) {
            return [];
        }

        const matches: string[] = [];
        for (const keyword of secret.trigger.keywords) {
            const kw = keyword.toLowerCase();
            if (messageKeywords.some(mk => mk.includes(kw) || kw.includes(mk))) {
                matches.push(keyword);
            }
        }
        return matches;
    }

    /**
     * Evaluate an interrogation message history for secret triggers
     * Matches keywords across the current message + recent history
     */
    private evaluateInterrogation(messageHistory: string[]): InterrogationResult {
        // Combine history for keyword extraction
        const combinedText = messageHistory.join(' ');
        const messageKeywords = this.extractKeywords(combinedText);

        let bestMatch: { secret: SecretData; keywords: string[] } | null = null;
        let composureLost = 0;

        // Check each unrevealed secret
        for (const secret of this.data.secrets) {
            if (this._revealedSecrets.has(secret.id)) continue;

            // Check evidence requirements
            if (!this.hasRequiredEvidence(secret)) continue;

            // Check keyword matches
            const matchedKeywords = this.calculateKeywordMatch(secret, messageKeywords);

            if (matchedKeywords.length > 0) {
                // Each matched keyword reduces composure
                // We dampen repeated matches slightly if we wanted, but for now linear accumulation
                composureLost += matchedKeywords.length * 8;

                // Track best match (most keywords)
                if (!bestMatch || matchedKeywords.length > bestMatch.keywords.length) {
                    bestMatch = { secret, keywords: matchedKeywords };
                }
            }
        }

        // Apply composure loss
        this._state.composure = Math.max(0, this._state.composure - composureLost);

        // Increase defensiveness when pressured
        if (composureLost > 0) {
            this._state.defensiveness = Math.min(100, this._state.defensiveness + composureLost / 2);
        }

        if (composureLost > 0) {
            logger.info(`${this.data.name} composure decreased by ${composureLost}. Current: ${this._state.composure}%`);
        }

        // Determine if a secret should be revealed
        let triggeredSecret: SecretData | null = null;
        if (bestMatch) {
            const secret = bestMatch.secret;
            const minPressure = secret.trigger.minPressure ?? 30;

            // Reveal if: composure is low enough AND keywords were matched
            const composureLoss = 100 - this._state.composure;
            if (composureLoss >= minPressure && bestMatch.keywords.length >= 2) {
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
        if (composure > 50) return 500; // Slightly hesitant
        if (composure > 30) return 1000; // Nervous pause
        if (composure > 10) return 2000; // Long, anxious pause
        return 3000; // Breaking down, very long pause
    }

    /**
     * Present evidence to the suspect (Phoenix Wright style)
     * Deals massive pressure if evidence is relevant to their secrets
     */
    async presentEvidence(
        asker: GuildMember,
        evidenceId: string,
        channel: TextChannel,
        discoveredEvidence: Set<string> = new Set()
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
                if (required.some(e => e.toLowerCase() === evidenceId.toLowerCase())) {
                    wasRelevant = true;
                    targetSecret = secret;
                    break;
                }
            }

            // Apply pressure based on relevance
            if (wasRelevant) {
                // MASSIVE pressure - 40% composure hit
                composureLost = 40;
                this._state.composure = Math.max(0, this._state.composure - composureLost);
                this._state.defensiveness = Math.min(100, this._state.defensiveness + 20);

                logger.info(`💥 EVIDENCE HIT! ${this.data.name} loses ${composureLost}% composure from "${evidenceId}"`);
            } else {
                // Minor pressure - 5% hit for wasting their time
                composureLost = 5;
                this._state.composure = Math.max(0, this._state.composure - composureLost);
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
                }
            }

            // Generate response via AI
            await channel.sendTyping();

            // Add stress delay
            const stressDelay = this.getStressTypingDelay();
            if (stressDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, stressDelay));
                await channel.sendTyping();
            }

            // Build prompt for reaction
            let reactionPrompt = `${asker.displayName} has just presented you with evidence: "${evidenceId.replace(/_/g, ' ')}".`;

            if (wasRelevant) {
                reactionPrompt += ` This evidence is DIRECTLY related to something you're hiding. You are SHOCKED and struggling to maintain composure.`;
                if (revealedSecret) {
                    reactionPrompt += ` You can no longer hide it. You must admit: "${revealedSecret.text}"`;
                }
            } else {
                reactionPrompt += ` This evidence doesn't particularly concern you. You can dismiss it calmly.`;
            }

            const systemPrompt = buildSystemPrompt(
                {
                    name: this.data.name,
                    traits: this.data.traits,
                    alibi: this.data.alibi,
                    motive: this.data.motive,
                    secrets: this.data.secrets,
                },
                this.getMemory(channel.id),
                this._state,
                []
            );

            const response = await ai.chat.completions.create({
                model: OPENAI_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: reactionPrompt }
                ],
                max_tokens: 150,
                temperature: 0.9,
            });

            let text = response.choices[0].message.content || '*stares silently*';

            // Apply behavioral tells
            text = this.applyBehavioralTells(text);

            // Send via webhook
            await hook.send({
                content: text,
                username: this.data.name,
                avatarURL: this.data.avatar,
            });

            this._busy = false;

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
        discoveredEvidence: Set<string> = new Set()
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
            // We want the current message + last 2 messages from players
            const memory = this.getMemory(channel.id);
            const playerHistory = memory
                .filter(m => !m.startsWith(this.data.name + ':')) // Filter out suspect's own lines
                .slice(0, 2) // Take last 2
                .map(m => m.replace(/^[^:]+:\s*/, '')); // Strip "Name: " prefix to get raw content

            const contextMessages = [...playerHistory, message];

            // Record this interrogator for team bonus tracking
            this.recordInterrogator(channel.id, asker.id);

            // Calculate team multiplier (Good Cop / Bad Cop)
            const teamMultiplier = this.getTeamMultiplier(channel.id, asker.id);

            // Evaluate the interrogation for secret triggers
            const evaluation = this.evaluateInterrogation(contextMessages);

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

            // Build the prompt
            // memory is already declared above

            // Build complete system prompt with character data
            let systemPrompt = buildSystemPrompt(
                {
                    name: this.data.name,
                    traits: this.data.traits,
                    alibi: this.data.alibi,
                    motive: this.data.motive,
                    secrets: this.data.secrets,
                },
                memory,
                this._state,
                evaluation.matchedKeywords
            );

            // Add LOCATION instruction
            systemPrompt += `\nIf you answer truthfully about where you were at a specific time, you MUST append the tag [[LOC:HH:MM]] to the end of that specific sentence. Example: "I was in the kitchen.[[LOC:03:30]]"`;

            // If a secret was triggered, add the reveal hint
            if (evaluation.triggeredSecret) {
                console.log(`!!! SECRET TRIGGERED: ${evaluation.triggeredSecret.id} !!!`);
                systemPrompt += buildPressureHint(evaluation.triggeredSecret.text);
            }

            // Show typing
            await channel.sendTyping();

            // Add stress-based delay (nervous suspects pause longer)
            const stressDelay = this.getStressTypingDelay();
            if (stressDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, stressDelay));
                await channel.sendTyping();
            }

            const startTime = Date.now();
            // Call OpenAI API
            const response = await ai.chat.completions.create({
                model: OPENAI_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: message }
                ],
                max_tokens: 200,
                temperature: 0.8,
            });
            const duration = Date.now() - startTime;

            const text = response.choices[0].message.content || '';
            logger.debug(`AI Response for ${this.data.name} (${duration}ms): "${text}"`);

            // Parse response
            const rpMatch = /\*(.+?)\*/.exec(text);
            const roleplay = rpMatch ? rpMatch[1] : null;

            // Extract the actual message
            // We strip out roleplay (*action*) to get the spoken text
            let actualMessage = text
                .replace(/\/\w+/g, '')
                .replace(/\*(.+?)\*/g, '')
                .trim();

            // If the message is wrapped in quotes, strip them
            const quoteMatch = /^"(.+)"$/.exec(actualMessage);
            if (quoteMatch) {
                actualMessage = quoteMatch[1];
            }

            // Convert parenthetical actions to Discord italics: (action) -> *action*
            actualMessage = actualMessage.replace(/\(([^)]+)\)/g, '*$1*');

            // Parse and remove Location Tags: [[LOC:HH:MM]]
            const locRegex = /\[\[LOC:(\d{1,2}:\d{2})\]\]/g;
            const revealedLocations: string[] = [];
            let locMatch;
            while ((locMatch = locRegex.exec(actualMessage)) !== null) {
                revealedLocations.push(locMatch[1]);
            }
            actualMessage = actualMessage.replace(locRegex, '');

            // Apply behavioral tells based on stress level
            actualMessage = this.applyBehavioralTells(actualMessage);

            // Convert to unique evidence IDs
            const revealedEvidence = revealedLocations.map(time => `locations_${this.data.id}_${time}`);

            // Add to memory
            this.addMemory(channel.id, `${asker.displayName}: ${message}`);
            this.addMemory(channel.id, `${this.data.name}: ${actualMessage}`);

            // Split message into natural chunks and send with typing delays
            const chunks = splitIntoChunks(actualMessage);
            const sentMessages: any[] = [];

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];

                // Show typing before each message (except the first, we already did that)
                if (i > 0) {
                    await channel.sendTyping();
                    // Random delay between 800-1500ms to simulate typing
                    const msPerChar = 60; // Based on average typing speed
                    const typingDelay = chunk.length * msPerChar;
                    await new Promise(resolve => setTimeout(resolve, typingDelay + Math.random() * 500));
                }

                const sent = await hook.send({
                    content: chunk,
                    username: this.data.name,
                    avatarURL: this.data.avatar,
                    wait: true
                } as any);
                sentMessages.push(sent);
            }

            // Update focus
            this._focused = asker.id;

            this._busy = false;

            return {
                message: actualMessage,
                roleplay,
                revealedSecret: evaluation.triggeredSecret,
                revealedEvidence: revealedEvidence,
                messages: sentMessages,
                teamworkBonusActive
            };
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
     * Restore state from database
     */
    restoreState(state: { composure: number; defensiveness: number; revealedSecrets: string[] }): void {
        this._state.composure = state.composure;
        this._state.defensiveness = state.defensiveness;
        this._revealedSecrets = new Set(state.revealedSecrets);
    }
}
