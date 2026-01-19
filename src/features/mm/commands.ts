import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    Colors,
    PermissionFlagsBits,
} from 'discord.js';

// Role ID that can use MM commands
const ALLOWED_ROLE_ID = '1462572040367112438';

/**
 * Check if user has permission to use MM commands
 */
export function hasPermission(interaction: ChatInputCommandInteraction): boolean {
    if (!interaction.member || !('roles' in interaction.member)) return false;
    const roles = interaction.member.roles;
    if (Array.isArray(roles)) {
        return roles.includes(ALLOWED_ROLE_ID);
    }
    return roles.cache.has(ALLOWED_ROLE_ID);
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
 * Murder Mystery slash commands definition
 */
export const mmCommands = new SlashCommandBuilder()
    .setName('mm')
    .setDescription('Murder Mystery game commands')
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
                    .setDescription('Time limit in minutes (overrides case default)')
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName('status')
            .setDescription('View current game status')
    )
    .addSubcommand(sub =>
        sub.setName('join')
            .setDescription('Join the current investigation')
    )
    .addSubcommand(sub =>
        sub.setName('dna')
            .setDescription('Analyze DNA at a location')
            .addStringOption(opt =>
                opt.setName('location')
                    .setDescription('Location to analyze (e.g., study, garden)')
                    .setRequired(true)
            )
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
        sub.setName('locate')
            .setDescription('Track a suspect\'s phone location')
            .addStringOption(opt =>
                opt.setName('suspect')
                    .setDescription('Suspect ID to track')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addStringOption(opt =>
                opt.setName('time')
                    .setDescription('Time to check (e.g., 21:00, 21:30)')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('accuse')
            .setDescription('Make your final accusation')
            .addStringOption(opt =>
                opt.setName('suspect')
                    .setDescription('Suspect ID to accuse')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('end')
            .setDescription('End the current game (admin)')
    )
    .addSubcommand(sub =>
        sub.setName('suspects')
            .setDescription('List all suspects')
    )
    .addSubcommand(sub =>
        sub.setName('help')
            .setDescription('Show game rules and how to play')
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
    phase: string
): EmbedBuilder {
    const timeColor = remainingTime > 600 ? Colors.Green : remainingTime > 300 ? Colors.Orange : Colors.Red;
    const phaseEmoji = phase === 'investigating' ? '🔍' : phase === 'accused' ? '⚖️' : '🏁';

    return new EmbedBuilder()
        .setColor(phase === 'investigating' ? Colors.Gold : Colors.Grey)
        .setTitle(`${phaseEmoji} ${caseName}`)
        .setDescription(`**Investigation Status**`)
        .addFields(
            { name: '⏱️ Time Remaining', value: `\`${formatTime(remainingTime)}\``, inline: true },
            { name: '💎 Points Left', value: `\`${points}\``, inline: true },
            { name: '👥 Detectives', value: `\`${participants}\``, inline: true },
        )
        .addFields({
            name: 'Phase',
            value: `${phaseEmoji} **${phase.charAt(0).toUpperCase() + phase.slice(1)}**`,
            inline: false
        })
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
    error?: string
): EmbedBuilder {
    const icons: Record<string, string> = {
        dna: '🧬',
        footage: '📹',
        locate: '📍',
    };

    const embed = new EmbedBuilder()
        .setColor(success ? Colors.Green : Colors.Red)
        .setTitle(`${icons[tool] || '🔧'} ${tool.toUpperCase()} Analysis`)
        .addFields(
            { name: '🔎 Query', value: `\`${query}\``, inline: false },
            { name: '💰 Cost', value: `**-${cost}** points`, inline: true }
        );

    if (error) {
        embed.addFields({ name: '⚠️ Result', value: error });
    } else if (Array.isArray(result)) {
        const samples = result.length > 0 ? result.map(s => `• ${s}`).join('\n') : '• None found';
        embed.addFields({ name: '✅ DNA Samples', value: samples });
    } else if (result) {
        embed.addFields({ name: '✅ Result', value: `> ${result}` });
    } else {
        embed.addFields({ name: '❓ Result', value: '> No data available' });
    }

    embed.setFooter({ text: 'Use /mm status to check remaining points' })
        .setTimestamp();

    return embed;
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
            .setTitle('🎉 CASE SOLVED!')
            .setDescription(`**${accusedName}** was the killer!\n\nCongratulations, detective! Justice has been served.`)
            .setThumbnail('https://em-content.zobj.net/source/twitter/376/trophy_1f3c6.png');
    } else {
        return new EmbedBuilder()
            .setColor(Colors.Red)
            .setTitle('❌ WRONG ACCUSATION')
            .setDescription(`**${accusedName}** was innocent!\n\nThe real killer was **${actualKillerName}**.\n\nThe murderer escapes justice...`)
            .setThumbnail('https://em-content.zobj.net/source/twitter/376/skull_1f480.png');
    }
}

/**
 * Create help embed
 */
export function createHelpEmbed(): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('🔍 Murder Mystery - How to Play')
        .setDescription('Become a detective and solve the murder by interrogating suspects and using investigation tools!')
        .addFields(
            {
                name: '📋 Game Setup',
                value: '• Use `/mm start <case_id>` to begin a new game\n• Channels will be created automatically\n• Join with `/mm join` to participate',
                inline: false
            },
            {
                name: '💬 Interrogation',
                value: '• Go to the `💬┃interrogation` channel\n• Say `Hey <suspect_name>, <your question>`\n• Example: `Hey Victoria, where were you at 9:30 PM?`\n• Suspects will respond via AI and may reveal secrets under pressure!',
                inline: false
            },
            {
                name: '🔬 Detective Tools',
                value: '• `/mm dna <location>` - Analyze DNA samples (3 pts)\n• `/mm footage <time>` - View camera footage (2 pts)\n• `/mm locate <suspect> <time>` - Track phone location (2 pts)\n• Use tools wisely - you have limited points!',
                inline: false
            },
            {
                name: '❓ Pressure System',
                value: 'Interrogate suspects repeatedly to increase pressure:\n• **3 questions** → 1st secret revealed\n• **5 questions** → 2nd secret revealed\n• **7+ questions** → More secrets slip out',
                inline: false
            },
            {
                name: '🎯 Solving the Case',
                value: '• Gather evidence from tools and interrogations\n• Use `/mm status` to check remaining time and points\n• When ready, use `/mm accuse <suspect_id>` to make your final accusation\n• Get it right to win, wrong and the killer escapes!',
                inline: false
            },
            {
                name: '⚙️ Other Commands',
                value: '• `/mm suspects` - List all suspects and their IDs\n• `/mm end` - End the game early (admin only)',
                inline: false
            }
        )
        .setFooter({ text: 'Good luck, detective! 🕵️' })
        .setTimestamp();

    return embed;
}
