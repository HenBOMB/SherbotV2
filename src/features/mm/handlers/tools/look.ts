import { ChatInputCommandInteraction, EmbedBuilder, Colors, TextChannel } from 'discord.js';
import GameManager from '../../game.js';
import { normalizeLocationId } from '../../discord-utils.js';

/**
 * Handle /mm look — display room description and interactables
 */
export async function handleLook(
    manager: GameManager,
    interaction: ChatInputCommandInteraction
): Promise<void> {
    if (!manager.isParticipant(interaction.user.id)) {
        await interaction.reply({
            content: 'You must join the investigation with `/mm join` before you can look around.',
            ephemeral: true
        });
        return;
    }

    const activeGame = manager.getActiveGame();
    if (!activeGame?.isActive()) {
        await interaction.reply({ content: 'No active game.', ephemeral: true });
        return;
    }

    // Determine current room from channel name
    const channel = interaction.channel;
    let rawLocationId: string | null = null;
    if (channel instanceof TextChannel) {
        rawLocationId = manager.getLocationFromChannel(channel);
    }

    if (!rawLocationId) {
        await interaction.reply({
            content: 'You must be in an investigation room channel to look around.',
            ephemeral: true
        });
        return;
    }

    const locationId = normalizeLocationId(rawLocationId);

    const roomInfo = activeGame.getRoomInfo(locationId);
    const roomName = locationId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    if (!roomInfo) {
        // Room exists but has no rich info — give a minimal response
        await interaction.reply({
            content: `📍 **${roomName}** — No detailed description available for this room.`,
            ephemeral: true
        });
        return;
    }

    // Build the ANSI-styled embed
    let visual = '```ansi\n';
    visual += `\u001b[1;33m[ ${roomName.toUpperCase()} ]\u001b[0m\n`;
    visual += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    // Room description — word-wrap at ~55 chars
    const words = roomInfo.description.split(' ');
    let line = '';
    const descLines: string[] = [];
    for (const word of words) {
        if ((line + word).length > 55) {
            descLines.push(line.trim());
            line = '';
        }
        line += word + ' ';
    }
    if (line.trim()) descLines.push(line.trim());
    descLines.forEach(l => { visual += `  ${l}\n`; });

    // Connecting rooms
    const connections = activeGame.getMapConnections(locationId);
    if (connections.length > 0) {
        visual += '\n\u001b[1;34m[ EXITS ]\u001b[0m\n';
        connections.forEach(c => {
            const connected = c.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
            visual += `  ↗ ${connected}\n`;
        });
    }

    // Interactables
    if (roomInfo.interactables && roomInfo.interactables.length > 0) {
        visual += '\n\u001b[1;35m[ NOTABLE OBJECTS ]\u001b[0m\n';
        roomInfo.interactables.forEach(obj => {
            const isNpc = !!obj.dialogue;
            const icon = isNpc ? '👤' : '▸';
            const hint = isNpc ? ' (examine to talk)' : '';
            visual += `\n  \u001b[1;37m${icon} ${obj.name}${hint}\u001b[0m\n`;
            // Wrap description
            const objWords = obj.description.split(' ');
            let objLine = '';
            const objLines: string[] = [];
            for (const w of objWords) {
                if ((objLine + w).length > 50) {
                    objLines.push(objLine.trim());
                    objLine = '';
                }
                objLine += w + ' ';
            }
            if (objLine.trim()) objLines.push(objLine.trim());
            objLines.forEach(l => { visual += `    ${l}\n`; });
        });
    }

    visual += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    visual += '```';

    const embed = new EmbedBuilder()
        .setColor(Colors.DarkButNotBlack)
        .setTitle(`📍 ${roomName}`)
        .setDescription(visual)
        .setFooter({ text: 'Use /mm search to find physical evidence in this room.' });

    await interaction.reply({ embeds: [embed] });
}
