import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    AttachmentBuilder,
    Colors,
    PermissionFlagsBits,
} from 'discord.js';
import path from 'path';
import fs from 'fs';
import type HintEngine from './hints.js';

function capitalize(str: string): string {
    return str.replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

// Authorized Admin User ID
export const AUTHORIZED_ADMIN_ID = '348547981253017610';

/**
 * Check if user has permission to use MM Admin commands
 */
export function hasPermission(interaction: ChatInputCommandInteraction): boolean {
    if (interaction.user.id === AUTHORIZED_ADMIN_ID) return true;

    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return true;
    }

    return false;
}

/**
 * Send permission denied message
 */
export async function denyPermission(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(Colors.Red)
                .setTitle('🚫 Access Denied')
                .setDescription('You do not have permission to use Murder Mystery commands.')
        ],
        ephemeral: true,
    });
}

import { Server } from '../../database.js';

/**
 * Check if the server has an active premium subscription.
 */
export async function hasServerPremium(guildId: string | null): Promise<boolean> {
    if (!guildId) return false;
    try {
        const server = await Server.findByPk(guildId);
        return server?.isPremium === true;
    } catch (e) {
        return false;
    }
}

/**
 * Send server premium denied message
 */
export async function denyServerPremium(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(Colors.Gold)
                .setTitle('⭐ Premium Server Feature')
                .setDescription(`This server requires a **Premium Subscription** to initiate and play Murder Mystery investigations.\n\nPlease DM <@${AUTHORIZED_ADMIN_ID}> to upgrade this server.`)
        ],
        ephemeral: true,
    });
}

/**
 * Gameplay commands - Visible to everyone
 */
export const mmCommands = new SlashCommandBuilder()
    .setName('mm')
    .setDescription('Murder Mystery game commands')
    .addSubcommand(sub =>
        sub.setName('status')
            .setDescription('View current game status balance and voting progress')
    )
    .addSubcommand(sub =>
        sub.setName('join')
            .setDescription('Join the current investigation')
    )
    .addSubcommand(sub =>
        sub.setName('leave')
            .setDescription('Leave the current investigation team')
    )
    .addSubcommand(sub =>
        sub.setName('dna')
            .setDescription('Analyze DNA samples in the current room')
    )
    .addSubcommand(sub =>
        sub.setName('footage')
            .setDescription('View camera footage at a time')
            .addStringOption(opt =>
                opt.setName('time')
                    .setDescription('Time to check (e.g., 21:00). Leave empty to pick from history.')
                    .setRequired(false)
                    .setAutocomplete(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('logs')
            .setDescription('View digital system logs at a time')
            .addStringOption(opt =>
                opt.setName('time')
                    .setDescription('Time to check (e.g., 21:00, 21:30)')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('search')
            .setDescription('Search your current location for physical evidence')
    )
    .addSubcommand(sub =>
        sub.setName('look')
            .setDescription('Look around your current room — read its description and inspect notable objects')
    )
    .addSubcommand(sub =>
        sub.setName('examine')
            .setDescription('Examine physical evidence in detail')
            .addStringOption(opt =>
                opt.setName('item')
                    .setDescription('Item name to examine (e.g. "blood", "safe"). Leave empty to see all.')
                    .setRequired(false)
                    .setAutocomplete(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('present')
            .setDescription('Present evidence to a suspect (Phoenix Wright style!)')
            .addStringOption(opt =>
                opt.setName('evidence')
                    .setDescription('Evidence name to present (e.g. "blood")')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addStringOption(opt =>
                opt.setName('suspect')
                    .setDescription('Suspect name to present to (e.g. "victoria")')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('accuse')
            .setDescription('Accuse a suspect of the murder! (Ends the game if threshold reached)')
            .addStringOption(opt =>
                opt.setName('suspect')
                    .setDescription('The suspect to accuse (e.g. "victoria")')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('suspects')
            .setDescription('List all suspects and their alibies')
    )
    .addSubcommand(sub =>
        sub.setName('evidence')
            .setDescription('List and show all collected evidence')
    )
    .addSubcommand(sub =>
        sub.setName('secrets')
            .setDescription('View discovered secrets and rumors')
    )
    .addSubcommand(sub =>
        sub.setName('help')
            .setDescription('Show game rules and how to play')
    )
    ;

/**
 * Admin commands - Hidden from regular users in the UI
 */
export const mmaCommands = new SlashCommandBuilder()
    .setName('mma')
    .setDescription('Murder Mystery Admin controls')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
        sub.setName('start')
            .setDescription('Start a new murder mystery game')
            .addStringOption(opt =>
                opt.setName('case')
                    .setDescription('Case ID to load')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addStringOption(opt =>
                opt.setName('time')
                    .setDescription('Time limit override (e.g., 2d, 4h, 30m)')
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName('terminate')
            .setDescription('Forcefully terminate the investigation abruptly (Destructive)')
    )
    .addSubcommand(sub =>
        sub.setName('finalize')
            .setDescription('Gracefully stop the game (like time expiring)')
    )
    .addSubcommand(sub =>
        sub.setName('cleanup')
            .setDescription('Forcefully remove all murder mystery channels and categories (Destructive)')
    )
    .addSubcommand(sub =>
        sub.setName('generate')
            .setDescription('Run the case generator to create a new mystery')
            .addStringOption(opt =>
                opt.setName('theme')
                    .setDescription('Theme of the mystery (noir, modern, mansion)')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Noir', value: 'noir' },
                        { name: 'Modern', value: 'modern' },
                        { name: 'Mansion', value: 'mansion' }
                    )
            )
            .addStringOption(opt =>
                opt.setName('difficulty')
                    .setDescription('Difficulty of the case')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Easy', value: 'easy' },
                        { name: 'Medium', value: 'medium' },
                        { name: 'Hard', value: 'hard' }
                    )
            )
    )
    .addSubcommand(sub =>
        sub.setName('hints')
            .setDescription('Toggle detective hints on/off for the current investigation')
    )
    .addSubcommand(sub =>
        sub.setName('sync')
            .setDescription('Force sync all investigation channel permissions and topics')
    )
    .addSubcommand(sub =>
        sub.setName('points')
            .setDescription('Set investigation points for the current game')
            .addNumberOption(opt =>
                opt.setName('amount')
                    .setDescription('Total points to set')
                    .setRequired(true)
                    .setMinValue(0)
            )
    );
// .addSubcommand(sub =>
//     sub.setName('shutdown')
//         .setDescription('Safely power down the bot (Admin only)')
// );

/**
 * Format seconds into a hunter-style string (e.g., 2d 4h 30m or 10:45)
 */
export function formatTime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    const m = minutes % 60;

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || (d === 0 && h === 0)) parts.push(`${m}m`);
    return parts.join(' ');
}

/**
 * Parse a time string (e.g., "2d", "4h", "30m") into total minutes.
 * Returns null if the format is invalid.
 */
export function parseTime(timeStr: string): number | null {
    if (!timeStr) return null;

    // Direct number support (assumed as minutes)
    if (/^\d+$/.test(timeStr)) {
        return parseInt(timeStr, 10);
    }

    const regex = /(\d+)\s*([dhms])/gi;
    let totalMinutes = 0;
    let match;
    let hasMatch = false;

    while ((match = regex.exec(timeStr)) !== null) {
        hasMatch = true;
        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();

        switch (unit) {
            case 'd': totalMinutes += value * 1440; break;
            case 'h': totalMinutes += value * 60; break;
            case 'm': totalMinutes += value; break;
            case 's': totalMinutes += Math.ceil(value / 60); break;
        }
    }

    return hasMatch ? totalMinutes : null;
}

/**
 * Create status embed
 */
export function createStatusEmbed(
    caseName: string,
    remainingTime: number,
    points: number,
    participants: number,
    phase: string,
    playerStats?: Record<string, any>,
    accusation?: { accusedId: string; correct: boolean; accusedName?: string },
    killerName?: string
): { embed: EmbedBuilder; files: AttachmentBuilder[] } {
    const files: AttachmentBuilder[] = [];
    const timeColor = remainingTime > 600 ? Colors.Green : remainingTime > 300 ? Colors.Orange : Colors.Red;
    const phaseEmoji = phase === 'investigating' ? '🔍' : phase === 'accused' ? '⚖️' : '🏁';

    let color: any = Colors.Gold;
    if (phase === 'accused') {
        color = accusation?.correct ? Colors.Green : Colors.Red;
    } else if (phase === 'ended') {
        color = Colors.Grey;
    }

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${phaseEmoji} ${caseName}`)
        .addFields(
            { name: '⏳ INVESTIGATION CLOCK', value: `\`${formatTime(remainingTime)}\``, inline: true },
            { name: '💰 INVESTIGATION FUNDS', value: `\`${Number(points).toFixed(2)}\``, inline: true },
            { name: '🕵️ DETECTIVES ON THE CASE', value: `\`${participants}\``, inline: true },
        );

    if (phase === 'investigating') {
        const totalVotes = playerStats ? Object.values(playerStats).reduce((acc, s) => acc + (s.accusedId ? 1 : 0), 0) : 0;
        embed.setDescription('**Observation and Deduction in Progress**');

        // If we have accusation data in state, show it
        if (accusation && 'currentVotes' in (accusation as any)) {
            const current = (accusation as any).currentVotes as number;
            const needed = (accusation as any).votesNeeded as number;
            embed.addFields({
                name: '⚖️ COLLECTIVE VERDICT',
                value: `\`${current}/${needed}\` investigators have signed the warrant to conclude.`,
                inline: false
            });
        }
    } else if (phase === 'accused') {
        if (accusation?.correct) {
            embed.setDescription(`**THE TRUTH REVEALED**\nJustice has been served. **${accusation.accusedName || accusation.accusedId}** has been brought to light and apprehended.`);

            const thumbPath = path.join(process.cwd(), 'public', 'thumbnails', 'guilty.png');
            if (fs.existsSync(thumbPath)) {
                files.push(new AttachmentBuilder(thumbPath, { name: 'guilty.png' }));
                embed.setImage('attachment://guilty.png');
            }
        } else {
            embed.setDescription(`**A MISCARRIAGE OF JUSTICE**\n**${accusation?.accusedName || accusation?.accusedId}** was innocent. The true culprit, **${killerName || 'Unknown'}**, has vanished into the shadows.`);

            const thumbPath = path.join(process.cwd(), 'public', 'thumbnails', 'innocent.png');
            if (fs.existsSync(thumbPath)) {
                files.push(new AttachmentBuilder(thumbPath, { name: 'innocent.png' }));
                embed.setImage('attachment://innocent.png');
            }
        }
    } else {
        embed.setDescription('**Investigation Terminated**');
    }

    embed.addFields({
        name: 'Phase',
        value: `${phaseEmoji} **${phase.charAt(0).toUpperCase() + phase.slice(1)}**`,
        inline: false
    });

    // Add MVP Leaderboard if stats exist
    if (playerStats) {
        const stats = Object.values(playerStats);
        if (stats.length > 0) {
            // Sort by contribution score (heuristic)
            stats.sort((a, b) => {
                const scoreA = (a.evidenceFound * 3) + (a.secretsRevealed * 5) + (a.teamworkBonuses * 2);
                const scoreB = (b.evidenceFound * 3) + (b.secretsRevealed * 5) + (b.teamworkBonuses * 2);
                return scoreB - scoreA;
            });

            const top = stats.slice(0, 3);
            const leaderboard = top.map((s, i) => {
                const medals = ['🥇', '🥈', '🥉'];
                let text = `${medals[i] || '•'} **${s.username}**: ${s.evidenceFound} clues, ${s.secretsRevealed} secrets`;
                if (s.teamworkBonuses > 0) text += `, 🚔 ${s.teamworkBonuses} team combos`;
                return text;
            }).join('\n');

            embed.addFields({
                name: '🏆 Top Investigators',
                value: leaderboard || 'No contributions yet',
                inline: false
            });
        }
    }

    return {
        embed: embed
            .setFooter({ text: 'Use /mm help for game instructions' })
            .setTimestamp(), files
    };
}

/**
 * Create tool result embed
 */
export function createToolEmbed(
    tool: string,
    query: string,
    result: string | string[] | null,
    cost: number,
    success: boolean,
    error?: string,
    metadata?: any
): EmbedBuilder {
    const embed = new EmbedBuilder();

    // --- ERROR STATE ---
    if (!success || error) {
        return embed
            .setColor(Colors.Red)
            .setTitle('❌ Investigation Setback')
            .setDescription(`\`\`\`diff\n- THE TRAIL GROWS COLD\n- ${error || 'Unknown Error'}\n\`\`\``)
            .setFooter({ text: `Cost: ${cost > 0 ? cost : 0} pts` });
    }

    // --- CHEMICAL ANALYSIS ---
    if (tool === 'dna') {
        const samples = Array.isArray(result) ? result : [];
        const location = capitalize(query);

        let visual = '```ansi\n';
        visual += `\u001b[1;34m[ ANALYSING LOCATION: ${location} ]\u001b[0m\n`;
        visual += '----------------------------------------\n\n';

        if (samples.length > 0) {
            visual += '\u001b[1;32m✓ TRACES IDENTIFIED\u001b[0m\n';
            visual += '\u001b[0;36m> APPLYING REAGENTS...\u001b[0m\n\n';
            samples.forEach(s => {
                visual += `  • \u001b[1;37m${s.toUpperCase()}\u001b[0m\n`;
            });
        } else {
            visual += '\u001b[1;30m- NO TRACES FOUND -\u001b[0m\n';
            visual += 'The sample is clean.\n';
        }

        visual += '\n----------------------------------------\n';
        visual += `Cost: ${cost} pts | Laboratory: 221B BAKER ST`;
        visual += '```';

        // HINT SYSTEM: evaluate from case hints file
        const hintEngine: HintEngine | undefined = metadata?.hintEngine;
        const dnaHint = hintEngine ? hintEngine.evaluate('dna', query) : '';

        return embed
            .setColor(dnaHint ? Colors.Orange : Colors.Blue)
            .setTitle('🧪 Chemical Analysis')
            .setDescription(visual + dnaHint);
    }

    if (tool === 'footage') {
        const cleanResult = typeof result === 'string' ? result : 'No account available.';
        const battery = metadata?.battery ?? 100;
        const isExpired = battery <= 0;

        let screen = '```arm\n';
        screen += `[ WITNESS ACCOUNT: ${query.toUpperCase()} ] [ ARCHIVED ]\n`;
        screen += `==================================\n\n`;

        if (isExpired) {
            screen += '       [ TESTIMONY CONCLUDED ]\n';
            screen += '       [ NO FURTHER ACCOUNTS ]\n';
            screen += '       [ PLEASE STAND BY... ]\n';
        } else {
            const lines = cleanResult.split('\n');
            lines.forEach(line => {
                screen += `${line}\n`;
            });
        }

        screen += `\n==================================\n`;
        screen += `INK: ${battery}%  |  CLARITY: ${isExpired ? 'FADED' : 'LEGIBLE'}`;
        screen += '```';

        // HINT SYSTEM: evaluate from case hints file
        const hintEngine: HintEngine | undefined = metadata?.hintEngine;
        const hintText = hintEngine ? hintEngine.evaluate('footage', query) : '';

        embed
            .setColor(isExpired ? Colors.Red : (hintText ? Colors.Orange : Colors.DarkGreen))
            .setTitle(isExpired ? '⚠️ Testimony Exhausted' : '📜 Witness Testimony Archive')
            .setDescription(screen + hintText);

        if (cost > 0) {
            embed.setFooter({ text: `Information Fee: -${cost} pts` });
        } else {
            embed.setFooter({ text: 'Courtesy of the Witness (Free)' });
        }

        return embed;
    }

    // --- PRIVATE CORRESPONDENCE ---
    if (tool === 'logs') {
        const cleanResult = typeof result === 'string' ? result : 'No correspondence found for this date.';

        let visual = '```ansi\n';
        visual += `\u001b[1;32m[ LETTER DATED: ${query} ] [ SEALED ]\u001b[0m\n`;
        visual += '----------------------------------------\n\n';

        // Green text for logs
        visual += `\u001b[0;32m${cleanResult}\u001b[0m\n`;

        visual += '\n----------------------------------------\n';
        visual += `\u001b[1;30mCLEARANCE: SCOTLAND YARD\u001b[0m`;
        visual += '```';

        // HINT SYSTEM: evaluate from case hints file
        const hintEngine: HintEngine | undefined = metadata?.hintEngine;
        const logsHint = hintEngine ? hintEngine.evaluate('logs', query) : '';

        embed
            .setColor(logsHint ? Colors.Orange : Colors.Green)
            .setTitle('✉️ Private Correspondence')
            .setDescription(visual + logsHint);

        if (cost > 0) {
            embed.setFooter({ text: `Unsealing Fee: -${cost} pts` });
        } else {
            embed.setFooter({ text: 'Previously Unsealed (Free)' });
        }

        return embed;
    }

    // --- SCENE INVESTIGATION ---
    if (tool === 'search') {
        const location = capitalize(query);
        const discovered = Array.isArray(result) ? result : [];

        let visual = '```ansi\n';
        visual += `\u001b[1;33m[ SURVEYING: ${location} ]\u001b[0m\n`;
        visual += '----------------------------------------\n\n';

        if (discovered.length > 0) {
            const items = discovered.filter(d => d.startsWith('ITEM:')).map(d => d.replace('ITEM:', ''));

            if (items.length > 0) {
                visual += '\u001b[1;36m🔎 CLUES UNCOVERED\u001b[0m\n';
                items.forEach(item => {
                    const itemName = capitalize(item);
                    visual += `  📦 \u001b[1;37m${itemName}\u001b[0m\n`;
                });
            }
        } else {
            visual += '\u001b[1;30m- NOTHING FURTHER OF NOTE -\u001b[0m\n';
            visual += 'Every corner has been thoroughly examined.\n';
        }

        visual += '\n----------------------------------------\n';
        visual += `Cost: ${cost} pts | Method: OBSERVATION`;
        visual += '```';

        // HINT SYSTEM: evaluate from case hints file
        const hintEngine: HintEngine | undefined = metadata?.hintEngine;
        const searchHint = hintEngine ? hintEngine.evaluate('search', query) : '';

        return embed
            .setColor(searchHint ? Colors.Orange : Colors.Gold)
            .setTitle('🔍 Scene Investigation')
            .setDescription(visual + searchHint);
    }

    // --- DEDUCTIVE ANALYSIS ---
    if (tool === 'examine') {
        const itemName = capitalize(query);
        const description = typeof result === 'string' ? result : 'No details available.';

        let visual = '```ansi\n';
        visual += `\u001b[1;36m[ OBSERVING: ${itemName} ]\u001b[0m\n`;
        visual += '----------------------------------------\n\n';

        // Wrap text
        const lines = description.match(/.{1,40}(\s|$)/g) || [description];
        lines.forEach(line => {
            visual += `  ${line.trim()}\n`;
        });

        visual += '\n----------------------------------------\n';
        visual += 'Method: DEDUCTION\n';
        visual += '```';

        // HINT SYSTEM: evaluate from case hints file
        const hintEngine: HintEngine | undefined = metadata?.hintEngine;
        const hintText = hintEngine ? hintEngine.evaluate('examine', query) : '';

        return embed
            .setColor(hintText ? Colors.Orange : Colors.Aqua)
            .setTitle('🧠 Deductive Analysis')
            .setDescription(visual + hintText);
    }

    // Fallback
    return embed
        .setColor(Colors.Grey)
        .setDescription(`**Result:** ${result}`)
        .setFooter({ text: `Cost: ${cost}` });

}

/**
 * Create accusation result embed
 */
export function createAccusationEmbed(
    correct: boolean,
    accusedName: string,
    actualKillerName: string
): { embed: EmbedBuilder; files: AttachmentBuilder[] } {
    const files: AttachmentBuilder[] = [];
    const embed = new EmbedBuilder();

    if (correct) {
        const thumbPath = path.join(process.cwd(), 'public', 'thumbnails', 'guilty.png');
        if (fs.existsSync(thumbPath)) {
            const attachment = new AttachmentBuilder(thumbPath, { name: 'guilty.png' });
            files.push(attachment);
            embed.setThumbnail('attachment://guilty.png');
        } else {
            embed.setThumbnail('https://em-content.zobj.net/source/twitter/376/handcuffs_26d3.png');
        }

        embed
            .setColor(Colors.Green)
            .setTitle('⚖️ VERDICT: GUILTY')
            .setDescription(`\`\`\`ansi\n\u001b[1;32mEVIDENCE SECURED\u001b[0m | \u001b[1;36mCRIMINAL IN CUSTODY\u001b[0m\n\`\`\`\n**${accusedName}** has been found guilty of the charge. The web of deceit has been unraveled.\n\nExcellent work, detective. The yard has been notified of your triumph.`);
    } else {
        const thumbPath = path.join(process.cwd(), 'public', 'thumbnails', 'innocent.png');
        if (fs.existsSync(thumbPath)) {
            const attachment = new AttachmentBuilder(thumbPath, { name: 'innocent.png' });
            files.push(attachment);
            embed.setThumbnail('attachment://innocent.png');
        } else {
            embed.setThumbnail('https://em-content.zobj.net/source/twitter/376/person-running_1f3c3.png');
        }

        embed
            .setColor(Colors.Red)
            .setTitle('⚖️ VERDICT: INNOCENT')
            .setDescription(`\`\`\`ansi\n\u001b[1;31mTHE TRAIL GOES COLD\u001b[0m | \u001b[1;33mA CRIMINAL ESCAPES\u001b[0m\n\`\`\`\n**${accusedName}** was innocent of this crime. The real killer, **${actualKillerName}**, has escaped into the fog.\n\nThe investigation has reached a dead end. You are relieved of duty.`);
    }

    return { embed, files };
}

/**
 * Create help embed
 */
export function createHelpEmbed(): { embed: EmbedBuilder; files: AttachmentBuilder[] } {
    const files: AttachmentBuilder[] = [];
    const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('🔍 Murder Mystery - How to Play')
        .setDescription('Become a detective and solve the murder! You must interrogate suspects where they stand.')
        .addFields(
            {
                name: '🧭 MOVEMENT & NAVIGATION',
                value: '• All accessible rooms are visible as channels in the sidebar.\n• Click a channel (e.g., `#📍┃kitchen`) to move there instantly.\n• 👥 Suspects are always found at their specific room locations.',
                inline: false
            },
            {
                name: '💬 INTERROGATION',
                value: '• Go to the room where a suspect is located.\n• You must mention their name to interrogate them.\n• Example: `Hey Victoria, where were you at 9:30 PM?`\n• If they reveal their location, **new evidence** is automatically collected!\n• ✨ ** breakthroughs**: If Sherbot reacts with sparkles, it means you\'ve uncovered a clue or forced a breakthrough.',
                inline: false
            },
            {
                name: '🔬 DETECTIVE TOOLS',
                value: '• `/mm search` - Search current room for physical evidence (1 pt)\n• `/mm dna` - Analyze DNA in your current room (0.5 pts)\n• `/mm footage <time>` - View camera footage (0.25 pts)\n• `/mm examine <item>` - Inspect discovered items (Free)\n• `/mm present <evidence> <suspect>` - **Show evidence to a suspect!** (Free)',
                inline: false
            },
            {
                name: '📎 PRESENT EVIDENCE',
                value: '• Use `/mm present` to confront a suspect with evidence.\n• If the evidence is **relevant to their secrets**, they take pressure damage!\n• Stuttering and hesitation means you\'re close to the truth.',
                inline: false
            },
            {
                name: '🎯 SOLVING THE CASE',
                value: '• Use `/mm accuse <suspect>` when you **know** who did it.\n• You only get **one shot** at an accusation!',
                inline: false
            }
        )
        .setFooter({ text: 'Good luck, detective! 🕵️' })
        .setTimestamp();

    const thumbPath = path.join(process.cwd(), 'public', 'thumbnails', 'help_handbook.png');
    if (fs.existsSync(thumbPath)) {
        files.push(new AttachmentBuilder(thumbPath, { name: 'help_handbook.png' }));
        embed.setThumbnail('attachment://help_handbook.png');
    }

    return { embed, files };
}



/**
 * Create a single suspect card embed
 */
export function createSuspectCard(
    s: any,
    roomChannels?: Map<string, any>
): { embed: EmbedBuilder; file?: AttachmentBuilder } {
    const sEmbed = new EmbedBuilder()
        .setColor('#2c3e50') // Slightly darker, more premium blue-grey
        .setAuthor({ name: s.name.toUpperCase(), iconURL: 'https://em-content.zobj.net/source/twitter/376/bust-in-silhouette_1f464.png' })
        .setDescription(`**Statement:** "${s.alibi}"`)
        .addFields(
            { name: '👤 ROLE', value: s.role || 'Unknown', inline: true },
            { name: '🎂 AGE', value: s.age?.toString() || 'Unknown', inline: true }
        );

    // Add traits if available
    if (s.traits && s.traits.length > 0) {
        sEmbed.addFields({
            name: '✨ TRAITS',
            value: s.traits.slice(0, 3).map((t: string) => `• ${t}`).join('\n'),
            inline: false
        });
    }

    let file: AttachmentBuilder | undefined;
    if (s.avatar) {
        if (s.avatar.startsWith('http')) {
            sEmbed.setImage(s.avatar);
        } else {
            // Local file
            const filename = `suspect_${s.id}.png`;
            try {
                const fullPath = path.isAbsolute(s.avatar) ? s.avatar : path.join(process.cwd(), 'public', s.avatar);
                file = new AttachmentBuilder(fullPath, { name: filename });
                sEmbed.setImage(`attachment://${filename}`);
            } catch (e) {
                console.error(`Failed to attach avatar for ${s.name}`, e);
            }
        }
    }

    return { embed: sEmbed, file };
}

/**
 * Create an atmospheric briefing for a specific room/location
 */
export function createRoomBriefingEmbed(
    locId: string,
    locConfig: any,
    roomChannels: Map<string, any>
): { embed: EmbedBuilder; file: AttachmentBuilder | null } {
    let file: AttachmentBuilder | null = null;
    const rEmbed = new EmbedBuilder()
        .setColor('#2F3136')
        .setTitle(`📍 SCENE: ${capitalize(locId.replace(/_/g, ' '))}`)
        .setDescription(locConfig.description || 'No detailed description available.');

    // Add connect to info
    if (locConfig.connects_to && locConfig.connects_to.length > 0) {
        const connects = locConfig.connects_to
            .map((id: string) => {
                const ch = roomChannels.get(id);
                return ch ? `<#${ch.id}>` : `\`${capitalize(id.replace(/_/g, ' '))}\``;
            })
            .join(' • ');
        rEmbed.addFields({ name: '🚪 CONNECTS TO', value: connects });
    }

    // Add interactables summary
    if (locConfig.interactables && locConfig.interactables.length > 0) {
        const items = locConfig.interactables.map((i: any) => `• **${i.name}**`).join('\n');
        rEmbed.addFields({ name: '📦 POINTS OF INTEREST', value: items });
    }

    // Add environmental image if available
    if (locConfig.image) {
        if (locConfig.image.startsWith('http')) {
            rEmbed.setImage(locConfig.image);
        } else {
            // Local file
            const filename = `room_${locId}.png`;
            try {
                const fullPath = path.isAbsolute(locConfig.image) ? locConfig.image : path.join(process.cwd(), 'public', locConfig.image);
                file = new AttachmentBuilder(fullPath, { name: filename });
                rEmbed.setImage(`attachment://${filename}`);
            } catch (e) {
                console.error(`Failed to attach room image for ${locId}`, e);
            }
        }
    }

    return { embed: rEmbed, file };
}

/**
 * Create a creative multi-embed briefing for a new case
 */
export function createCaseBriefingEmbeds(
    caseConfig: any,
    options: {
        timeLimit: number;
        points: number;
        players: string[];
        roomChannels?: Map<string, any>;
        hintsEnabled?: boolean;
        hintsAvailable?: boolean;
    }
): { embeds: EmbedBuilder[]; files: AttachmentBuilder[] } { // Changed return type
    const embeds: EmbedBuilder[] = [];
    const files: AttachmentBuilder[] = [];

    // 1. HEADER / TOP SECRET
    const headerEmbed = new EmbedBuilder()
        .setColor('#2F3136') // Dark grey for "classified" look
        .setTitle('📂 OFFICIAL CASE DOSSIER')
        .setDescription(`\`\`\`ansi\n\u001b[1;31mSTATUS: CONFIDENTIAL\u001b[0m\n\u001b[0;37mAUTHORIZATION: SHERLOCK_PROTOCOL_V4\u001b[0m\n\`\`\``);

    const headerPath = path.join(process.cwd(), 'public', 'thumbnails', 'case_briefing.png');
    if (fs.existsSync(headerPath)) {
        files.push(new AttachmentBuilder(headerPath, { name: 'case_briefing.png' }));
        headerEmbed.setImage('attachment://case_briefing.png');
    } else {
        headerEmbed.setThumbnail('https://em-content.zobj.net/source/twitter/376/lock-with-ink-pen_1f50f.png');
    }
    embeds.push(headerEmbed);

    // 2. THE INCIDENT (Main Body)
    const victim = caseConfig.victim;
    const sceneEmbed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle(`📌 INCIDENT: ${caseConfig.name.toUpperCase()}`)
        .setDescription(`${caseConfig.description}\n\n**"The truth is rarely pure and never simple."**`)
        .addFields(
            {
                name: '💀 THE VICTIM',
                value: `**${victim.name}**\n*${victim.description || 'No further details available.'}*`,
                inline: false
            },
            {
                name: '🩸 CAUSE OF DEATH',
                value: `\`${victim.cause}\``,
                inline: true
            },
            {
                name: '🕐 TIME OF DEATH',
                value: `\`${caseConfig.murderTime}\``,
                inline: true
            },
            {
                name: '📍 PRIMARY SCENE',
                value: options.roomChannels?.has(caseConfig.murderLocation)
                    ? `<#${options.roomChannels.get(caseConfig.murderLocation).id}>`
                    : `\`${capitalize(caseConfig.murderLocation)}\``,
                inline: true
            }
        );

    // Add victim image if available
    if (victim.avatar) {
        if (victim.avatar.startsWith('http')) {
            sceneEmbed.setThumbnail(victim.avatar);
        } else {
            // Local file
            const filename = `victim_${path.basename(victim.avatar)}`;
            try {
                const fullPath = path.isAbsolute(victim.avatar) ? victim.avatar : path.join(process.cwd(), 'public', victim.avatar);
                const attachment = new AttachmentBuilder(fullPath, { name: filename });
                files.push(attachment);
                sceneEmbed.setThumbnail(`attachment://${filename}`);
            } catch (e) {
                console.error("Failed to attach victim avatar", e);
            }
        }
    }

    embeds.push(sceneEmbed);

    // 3. SUSPECT LINEUP (Summary)
    const suspects = caseConfig.suspects;
    const suspectSummaryEmbed = new EmbedBuilder()
        .setColor(Colors.DarkBlue)
        .setTitle('👥 THE SUSPECT POOL')
        .setDescription('Persons of interest identified through witness accounts and proximity to the scene at the time of the incident...')
        .addFields(
            {
                name: '⚠️ POTENTIAL SUSPECTS OF INTEREST',
                value: suspects.map((s: any) => {
                    const channel = options.roomChannels?.get(s.currentLocation);
                    const locationStr = channel ? `<#${channel.id}>` : `\`${capitalize(s.currentLocation)}\``;
                    return `• **${s.name}** — ${locationStr}`;
                }).join('\n'),
                inline: false
            }
        );

    embeds.push(suspectSummaryEmbed);

    // 5. INVESTIGATION LOGISTICS
    const resourceEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('🕯️ INVESTIGATION LOGISTICS')
        .addFields(
            { name: '⏳ TIME ALLOTTED', value: `\`${formatDuration(options.timeLimit)}\``, inline: true },
            { name: '🔎 INVESTIGATION FUNDS', value: `\`${options.points}\``, inline: true },
            { name: '🕵️ LEAD INVESTIGATOR', value: `<@${options.players[0]}>`, inline: true }
        )
        .setDescription('```ansi\n\u001b[1;32mTHE GAME IS AFOOT\u001b[0m | \u001b[1;36mLOGISTICS SECURED\u001b[0m | \u001b[1;33mSEEKING THE TRUTH...\u001b[0m\n```\nEvery second counts, and every lead followed has its price. Tread carefully, for the department\'s patience and resources are finite.')
        .setFooter({ text: 'Use /mm help for tactical instructions • /mm status to review progress' });

    embeds.push(resourceEmbed);

    // 6. HINTS STATUS
    if (options.hintsAvailable) {
        const hintsOn = options.hintsEnabled !== false;
        const hintsEmbed = new EmbedBuilder()
            .setColor(hintsOn ? '#5865F2' : '#99AAB5')
            .setTitle(hintsOn ? '💡 SCOTLAND YARD ADVISORY' : '🔇 SCOTLAND YARD ADVISORY')
            .setDescription(hintsOn
                ? '*"When you have eliminated the impossible, whatever remains, however improbable, must be the truth."*\n\n📎 **Analytical guidance is active.** Subtle deductions will appear as spoiler text when reviewing key evidence. Reveal them at your discretion.\n\nAn admin may disable this with `/mma hints`.'
                : '*"I am not the law, but I represent justice so far as my feeble powers go."*\n\n🚫 **Analytical guidance is disabled.** You are on your own, detective. Trust your instincts.\n\nAn admin may re-enable this with `/mma hints`.'
            );
        embeds.push(hintsEmbed);
    }

    return { embeds, files };
}
