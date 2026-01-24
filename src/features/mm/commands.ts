import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    Colors,
    PermissionFlagsBits,
} from 'discord.js';

// Authorized Admin User ID
export const AUTHORIZED_ADMIN_ID = '348547981253017610';

/**
 * Check if user has permission to use MM Admin commands
 */
export function hasPermission(interaction: ChatInputCommandInteraction): boolean {
    return interaction.user.id === AUTHORIZED_ADMIN_ID;
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
        sub.setName('dna')
            .setDescription('Analyze DNA samples in the current room')
    )
    .addSubcommand(sub =>
        sub.setName('footage')
            .setDescription('View camera footage at a time')
            .addStringOption(opt =>
                opt.setName('time')
                    .setDescription('Time to check (e.g., 21:00, 21:30)')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('logs')
            .setDescription('View digital system logs at a time')
            .addStringOption(opt =>
                opt.setName('time')
                    .setDescription('Time to check (e.g., 21:00, 21:30)')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('explore')
            .setDescription('Explore your current location for hidden rooms')
    )
    .addSubcommand(sub =>
        sub.setName('examine')
            .setDescription('Examine physical evidence in detail')
            .addStringOption(opt =>
                opt.setName('item')
                    .setDescription('Evidence ID to examine (e.g., blood_splatter, safe)')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('present')
            .setDescription('Present evidence to a suspect (Phoenix Wright style!)')
            .addStringOption(opt =>
                opt.setName('evidence')
                    .setDescription('Evidence ID to present')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addStringOption(opt =>
                opt.setName('suspect')
                    .setDescription('Suspect to present to')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('accuse')
            .setDescription('Cast your vote for the killer')
            .addStringOption(opt =>
                opt.setName('suspect')
                    .setDescription('Suspect ID to accuse')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('suspects')
            .setDescription('List all suspects and their alibies')
    )
    .addSubcommand(sub =>
        sub.setName('secrets')
            .setDescription('View discovered secrets and rumors')
    )
    .addSubcommand(sub =>
        sub.setName('help')
            .setDescription('Show game rules and how to play')
    );

/**
 * Admin commands - Hidden from regular users in the UI
 */
export const mmaCommands = new SlashCommandBuilder()
    .setName('mma')
    .setDescription('Murder Mystery Admin controls')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) // Hidden by default from non-staff
    .addSubcommand(sub =>
        sub.setName('start')
            .setDescription('Start a new murder mystery game')
            .addStringOption(opt =>
                opt.setName('case')
                    .setDescription('Case ID to load')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addIntegerOption(opt =>
                opt.setName('time')
                    .setDescription('Time limit override in minutes')
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName('end')
            .setDescription('Force end the current investigation')
    )
    .addSubcommand(sub =>
        sub.setName('cleanup')
            .setDescription('Swiftly clear all murder mystery channels and categories')
    )
    .addSubcommand(sub =>
        sub.setName('shutdown')
            .setDescription('Safely power down the bot (Admin only)')
    );

/**
 * Format seconds into MM:SS
 */
export function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
): EmbedBuilder {
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
            { name: '⏱️ Time Remaining', value: `\`${formatTime(remainingTime)}\``, inline: true },
            { name: '💎 Points Left', value: `\`${Number(points).toFixed(2)}\``, inline: true },
            { name: '👥 Detectives', value: `\`${participants}\``, inline: true },
        );

    if (phase === 'investigating') {
        const totalVotes = playerStats ? Object.values(playerStats).reduce((acc, s) => acc + (s.accusedId ? 1 : 0), 0) : 0; // This is a bit indirect, let's use a new param or handle it via description
        embed.setDescription('**Investigation in Progress**');

        // If we have accusation data in state, show it
        if (accusation && 'currentVotes' in (accusation as any)) {
            const current = (accusation as any).currentVotes as number;
            const needed = (accusation as any).votesNeeded as number;
            embed.addFields({
                name: '⚖️ Collective Verdict',
                value: `\`${current}/${needed}\` detectives have voted to conclude.`,
                inline: false
            });
        }
    } else if (phase === 'accused') {
        if (accusation?.correct) {
            embed.setDescription(`**Case Solved!**\nJustice has been served. **${accusation.accusedName || accusation.accusedId}** was successfully apprehended.`);
        } else {
            embed.setDescription(`**Case Closed - Failed**\n**${accusation?.accusedName || accusation?.accusedId}** was innocent. The real killer, **${killerName || 'Unknown'}**, escaped.`);
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
                const scoreA = (a.evidenceFound * 3) + (a.secretsRevealed * 5) + (a.roomsDiscovered * 2) + (a.teamworkBonuses * 2);
                const scoreB = (b.evidenceFound * 3) + (b.secretsRevealed * 5) + (b.roomsDiscovered * 2) + (b.teamworkBonuses * 2);
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

    return embed
        .setFooter({ text: 'Use /mm help for game instructions' })
        .setTimestamp();
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
            .setTitle('� SYSTEM ERROR')
            .setDescription(`\`\`\`diff\n- OPERATION FAILED\n- ${error || 'Unknown Error'}\n\`\`\``)
            .setFooter({ text: `Cost: ${cost > 0 ? cost : 0} pts` });
    }

    // --- DNA SEQUENCER ---
    if (tool === 'dna') {
        const samples = Array.isArray(result) ? result : [];
        const location = query.toUpperCase().replace(/_/g, ' ');

        let visual = '```ansi\n';
        visual += `\u001b[1;34m[ SCANNING LOCATION: ${location} ]\u001b[0m\n`;
        visual += '----------------------------------------\n\n';

        if (samples.length > 0) {
            visual += '\u001b[1;32m✓ ORGANIC MATERIAL DETECTED\u001b[0m\n';
            visual += '\u001b[0;36m> ANALYZING SAMPLES...\u001b[0m\n\n';
            samples.forEach(s => {
                visual += `  • \u001b[1;37m${s.toUpperCase()}\u001b[0m\n`;
            });
        } else {
            visual += '\u001b[1;30m- NO MATCHES FOUND -\u001b[0m\n';
            visual += 'Sample integrity: 100%\n';
        }

        visual += '\n----------------------------------------\n';
        visual += `Cost: ${cost} pts | Credit: ANALYTICS_DEPT`;
        visual += '```';

        return embed
            .setColor(Colors.Blue)
            .setTitle('🧬 Genetic Sequencer v4.0')
            .setDescription(visual);
    }

    if (tool === 'footage') {
        const cleanResult = typeof result === 'string' ? result : 'No visual data.';
        const battery = metadata?.battery ?? 100;
        const isExpired = battery <= 0;

        let screen = '```arm\n';
        screen += `[ CAM_FEED: ${query.toUpperCase()} ] [ ARCHIVED ]\n`;
        screen += `==================================\n\n`;

        if (isExpired) {
            screen += '       [ TERMINAL EXPIRED ]\n';
            screen += '       [ RECHARGE REQUIRED ]\n';
            screen += '       [ PLEASE STAND BY... ]\n';
        } else {
            const lines = cleanResult.split('\n');
            lines.forEach(line => {
                screen += `${line}\n`;
            });
        }

        screen += `\n==================================\n`;
        screen += `BATTERY: ${battery}%  |  SIGNAL: ${isExpired ? 'LOST' : 'STRONG'}`;
        screen += '```';

        embed
            .setColor(isExpired ? Colors.Red : Colors.DarkGreen)
            .setTitle(isExpired ? '⚠️ Terminal Connection Lost' : '📹 Security Terminal')
            .setDescription(screen);

        if (cost > 0) {
            embed.setFooter({ text: `Archive Access Fee: -${cost} pts` });
        } else {
            embed.setFooter({ text: 'Playback Mode (Free)' });
        }

        return embed;
    }

    // --- DIGITAL LOGS ---
    if (tool === 'logs') {
        const cleanResult = typeof result === 'string' ? result : 'No entry found in system logs.';

        let visual = '```ansi\n';
        visual += `\u001b[1;32m[ SYSTEM_LOG: ${query} ] [ ENCRYPTED ]\u001b[0m\n`;
        visual += '----------------------------------------\n\n';

        // Green text for logs
        visual += `\u001b[0;32m${cleanResult}\u001b[0m\n`;

        visual += '\n----------------------------------------\n';
        visual += `\u001b[1;30mACCESS_LEVEL: ADMIN_READ_ONLY\u001b[0m`;
        visual += '```';

        embed
            .setColor(Colors.Green)
            .setTitle('🖥️ Digital Forensics')
            .setDescription(visual);

        if (cost > 0) {
            embed.setFooter({ text: `Decryption Fee: -${cost} pts` });
        } else {
            embed.setFooter({ text: 'Cached Result (Free)' });
        }

        return embed;
    }

    // --- EXPLORE ---
    if (tool === 'explore') {
        const location = query.toUpperCase().replace(/_/g, ' ');
        const discovered = Array.isArray(result) ? result : [];

        let visual = '```ansi\n';
        visual += `\u001b[1;33m[ EXPLORING: ${location} ]\u001b[0m\n`;
        visual += '----------------------------------------\n\n';

        if (discovered.length > 0) {
            const rooms = discovered.filter(d => d.startsWith('ROOM:')).map(d => d.replace('ROOM:', ''));
            const items = discovered.filter(d => d.startsWith('ITEM:')).map(d => d.replace('ITEM:', ''));

            if (rooms.length > 0) {
                visual += '\u001b[1;32m✓ NEW AREAS DISCOVERED\u001b[0m\n';
                rooms.forEach(room => {
                    const roomName = room.replace(/_/g, ' ').toUpperCase();
                    visual += `  🚪 \u001b[1;37m${roomName}\u001b[0m\n`;
                });
                visual += '\n';
            }

            if (items.length > 0) {
                visual += '\u001b[1;36m🔎 PHYSICAL EVIDENCE FOUND\u001b[0m\n';
                items.forEach(item => {
                    const itemName = item.replace(/_/g, ' ').toUpperCase();
                    visual += `  📦 \u001b[1;37m${itemName}\u001b[0m\n`;
                });
            }
        } else {
            visual += '\u001b[1;30m- NO NEW FINDINGS -\u001b[0m\n';
            visual += 'Area is fully mapped and searched.\n';
        }

        visual += '\n----------------------------------------\n';
        visual += `Cost: ${cost} pts | Mapper: AUTO_NAV`;
        visual += '```';

        return embed
            .setColor(Colors.Gold)
            .setTitle('🧭 Area Mapper')
            .setDescription(visual);
    }

    // --- EXAMINE ---
    if (tool === 'examine') {
        const itemName = query.toUpperCase().replace(/_/g, ' ');
        const description = typeof result === 'string' ? result : 'No details available.';

        let visual = '```ansi\n';
        visual += `\u001b[1;36m[ EXAMINING: ${itemName} ]\u001b[0m\n`;
        visual += '----------------------------------------\n\n';

        // Wrap text
        const lines = description.match(/.{1,40}(\s|$)/g) || [description];
        lines.forEach(line => {
            visual += `  ${line.trim()}\n`;
        });

        visual += '\n----------------------------------------\n';
        visual += 'Analysis type: MACRO_INSPECTION\n';
        visual += '```';

        return embed
            .setColor(Colors.Aqua)
            .setTitle('🔍 High-Resolution Inspection')
            .setDescription(visual);
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
): EmbedBuilder {
    if (correct) {
        return new EmbedBuilder()
            .setColor(Colors.Green)
            .setTitle('⚖️ VERDICT: GUILTY')
            .setDescription(`\`\`\`ansi\n\u001b[1;32mCASE CLOSED\u001b[0m | \u001b[1;36mSUSPECT APPREHENDED\u001b[0m\n\`\`\`\n**${accusedName}** has been found guilty of the charge. Justice has been served.\n\nCongratulations, detective. The department has been notified of your success.`)
            .setThumbnail('https://em-content.zobj.net/source/twitter/376/handcuffs_26d3.png');
    } else {
        return new EmbedBuilder()
            .setColor(Colors.Red)
            .setTitle('⚖️ VERDICT: INNOCENT')
            .setDescription(`\`\`\`ansi\n\u001b[1;31mINVESTIGATION FAILED\u001b[0m | \u001b[1;33mKILLER AT LARGE\u001b[0m\n\`\`\`\n**${accusedName}** was innocent. The real killer, **${actualKillerName}**, has escaped justice.\n\nThe case has been handed over to a higher authority. You are relieved of duty.`)
            .setThumbnail('https://em-content.zobj.net/source/twitter/376/person-running_1f3c3.png');
    }
}

/**
 * Create help embed
 */
export function createHelpEmbed(): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('🔍 Murder Mystery - How to Play')
        .setDescription('Become a detective and solve the murder! You must physically explore the scene, find clues, and interrogate suspects where they stand.')
        .addFields(
            {
                name: '🚪 Exploration',
                value: '• Use `/mm explore` in your current room to find adjacent areas.\n• New rooms will appear as channels (e.g., `#📍┃kitchen`).\n• Click these channels to move there.',
                inline: false
            },
            {
                name: '💬 Interrogation',
                value: '• Go to the room where a suspect is located.\n• Say `Hey <suspect_name>, <your question>` in that channel.\n• Example: `Hey Victoria, where were you at 9:30 PM?`\n• If they reveal their location, **new evidence** is automatically collected!',
                inline: false
            },
            {
                name: '🔬 Detective Tools',
                value: '• `/mm explore` - Search for hidden rooms (1 pt)\n• `/mm dna` - Analyze DNA in your current room (0.5 pts)\n• `/mm footage <time>` - View camera footage (0.25 pts)\n• `/mm examine <item>` - Inspect discovered items (Free)\n• `/mm present <evidence> <suspect>` - **Show evidence to a suspect!** (Free)',
                inline: false
            },
            {
                name: '📎 Present Evidence (NEW!)',
                value: '• Use `/mm present` to confront a suspect with evidence.\n• If the evidence is **relevant to their secrets**, they take MASSIVE pressure damage!\n• Watch for their reaction - stuttering and hesitation means you\'re on to something.',
                inline: false
            },
            {
                name: '🚔 Teamwork Bonus',
                value: '• When **multiple detectives** interrogate the same suspect within 60 seconds, pressure is increased by 50%!\n• Coordinate questions with your team for maximum effect.',
                inline: false
            },
            {
                name: '😰 Reading Tells',
                value: '• Watch the suspect\'s behavior as their composure drops:\n  • **High composure**: Calm, confident responses\n  • **Nervous**: Hesitation ("..."), slight stuttering\n  • **Breaking**: Frequent stuttering, CAPS, longer typing pauses\n• Use `/mm secrets` to see what you\'ve uncovered.',
                inline: false
            },
            {
                name: '🎯 Solving the Case',
                value: '• Use `/mm accuse <suspect>` when you **know** who did it.\n• You only get **one shot** at an accusation!',
                inline: false
            }
        )
        .setFooter({ text: 'Good luck, detective! 🕵️' })
        .setTimestamp();

    return embed;
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
    }
): EmbedBuilder[] {
    const embeds: EmbedBuilder[] = [];

    // 1. HEADER / TOP SECRET
    const headerEmbed = new EmbedBuilder()
        .setColor('#2F3136') // Dark grey for "classified" look
        .setTitle('📂 OFFICIAL CASE DOSSIER')
        .setDescription(`\`\`\`ansi\n\u001b[1;31mSTATUS: CONFIDENTIAL\u001b[0m\n\u001b[0;37mAUTHORIZATION: SHERLOCK_PROTOCOL_V4\u001b[0m\n\`\`\``)
        .setThumbnail('https://em-content.zobj.net/source/twitter/376/lock-with-ink-pen_1f50f.png');
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
                value: `\`${caseConfig.murderLocation.replace(/_/g, ' ').toUpperCase()}\``,
                inline: true
            }
        );

    // Add victim image if available in caseConfig.victim.avatar (this might be a new field we could use)
    if (victim.avatar) sceneEmbed.setThumbnail(victim.avatar);

    embeds.push(sceneEmbed);

    // 3. SUSPECT LINEUP (Summary)
    const suspects = caseConfig.suspects;
    const suspectSummaryEmbed = new EmbedBuilder()
        .setColor(Colors.DarkBlue)
        .setTitle('👥 THE SUSPECT POOL')
        .setDescription('Scanning biometric database for individuals with proximity to the scene at the time of incident...')
        .addFields(
            {
                name: '⚠️ POTENTIAL PERSONS OF INTEREST',
                value: suspects.map((s: any) => `• **${s.name}**`).join('\n'),
                inline: false
            }
        );

    embeds.push(suspectSummaryEmbed);

    // 4. INDIVIDUAL SUSPECT CARDS (Max 5 for space)
    suspects.slice(0, 5).forEach((s: any) => {
        const sEmbed = new EmbedBuilder()
            .setColor('#34495e')
            .setAuthor({ name: `SUSPECT DATA: ${s.name.toUpperCase()}`, iconURL: 'https://em-content.zobj.net/source/twitter/376/bust-in-silhouette_1f464.png' })
            .setDescription(`**Statement:** "${s.alibi}"`)
            .addFields(
                { name: 'IDENTIFIER', value: `\`${s.id}\``, inline: true },
                { name: 'STATUS', value: s.motive ? '\`KNOWN INTEREST\`' : '\`UNRESTRICTED\`', inline: true }
            );

        if (s.avatar) sEmbed.setThumbnail(s.avatar);
        embeds.push(sEmbed);
    });

    // 5. INVESTIGATION RESOURCES
    const resourceEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('🛠️ INVESTIGATION RESOURCES')
        .addFields(
            { name: '⏱️ REMAINING TIME', value: `\`${options.timeLimit} Minutes\``, inline: true },
            { name: '💎 ALLOCATED POINTS', value: `\`${options.points}\``, inline: true },
            { name: '👥 CURRENT AGENTS', value: `<@${options.players[0]}>`, inline: true }
        )
        .setDescription('```ansi\n\u001b[1;32mUNITS READY\u001b[0m | \u001b[1;36mLOGS INITIALIZED\u001b[0m | \u001b[1;33mSCANNING...\u001b[0m\n```\nUse your tools wisely. Every minute spent and every log accessed will deplete your department resources.')
        .setFooter({ text: 'Use /mm help for tactical instructions • /mm status to review progress' });

    embeds.push(resourceEmbed);

    return embeds;
}
