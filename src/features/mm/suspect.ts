import OpenAI from "openai";
import { GuildMember, TextChannel, Webhook, EmbedBuilder, Colors } from "discord.js";
import { SuspectData, SecretData } from './case.js';
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
    action: string | null;
    roleplay: string | null;
    revealedSecret: SecretData | null;
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
     * Evaluate an interrogation message for secret triggers
     * This is the core "smart" interrogation logic
     */
    private evaluateInterrogation(message: string): InterrogationResult {
        const messageKeywords = this.extractKeywords(message);
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
            }
        }

        return {
            triggeredSecret,
            matchedKeywords: bestMatch?.keywords || [],
            composureLost,
        };
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

            // Evaluate the interrogation for secret triggers
            const evaluation = this.evaluateInterrogation(message);

            // Build the prompt
            const memory = this.getMemory(channel.id);

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

            // If a secret was triggered, add the reveal hint
            if (evaluation.triggeredSecret) {
                systemPrompt += buildPressureHint(evaluation.triggeredSecret.text);
            }

            console.log('System Prompt');
            console.log(systemPrompt);
            console.log('Evaluation:', JSON.stringify(evaluation, null, 2));
            console.log('User Prompt');
            console.log(message);

            // Show typing
            await channel.sendTyping();

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

            const text = response.choices[0].message.content || '';

            console.log('Response Text:', text);

            // Parse response
            const actionMatch = /\/(\w+)/.exec(text);
            const action = actionMatch ? actionMatch[1] : null;

            const rpMatch = /\*(.+?)\*/.exec(text);
            const roleplay = rpMatch ? rpMatch[1] : null;

            // Extract the actual message
            // We strip out commands (/action) and roleplay (*action*) to get the spoken text
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

            // Add to memory
            this.addMemory(channel.id, `${asker.displayName}: ${message}`);
            this.addMemory(channel.id, `${this.data.name}: ${actualMessage}`);

            // Split message into natural chunks and send with typing delays
            const chunks = splitIntoChunks(actualMessage);

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];

                // Show typing before each message (except the first, we already did that)
                if (i > 0) {
                    await channel.sendTyping();
                    // Random delay between 800-1500ms to simulate typing
                    await delay(2000 + Math.random() * 700);
                }

                await hook.send({
                    content: chunk,
                    username: this.data.name,
                    avatarURL: this.data.avatar,
                });
            }

            // Update focus
            this._focused = asker.id;

            this._busy = false;

            return {
                message: actualMessage,
                action,
                roleplay,
                revealedSecret: evaluation.triggeredSecret
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
}
