import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    Colors
} from 'discord.js';
import GameManager from '../../game.js';

/**
 * Handle /mm evidence command
 */
export async function handleEvidence(
    manager: GameManager,
    interaction: ChatInputCommandInteraction
): Promise<void> {
    if (!manager.isParticipant(interaction.user.id)) {
        await interaction.reply({
            content: 'You must join the investigation with `/mm join` before you can view evidence.',
            ephemeral: true
        });
        return;
    }

    const activeGame = manager.getActiveGame();
    if (!activeGame || !activeGame.isActive()) {
        await interaction.reply({ content: 'No active game.', ephemeral: true });
        return;
    }

    const discovered = manager.getDiscoveredEvidence();
    if (discovered.size === 0) {
        await interaction.reply({
            content: 'No evidence has been discovered yet. Try using investigation tools!',
            ephemeral: true
        });
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle('📂 The Case File')
        .setDescription('All clues and findings gathered during the investigation.')
        .setTimestamp();

    const sections: Record<string, string[]> = {
        '🧬 DNA Samples': [],
        '📹 Security Footage': [],
        '📜 Private Letters': [],
        '📦 Physical Evidence': [],
        '🤫 Discovered Secrets': [],
        '📍 Suspect Movements': [],
        '🗺️ Discovered Locations': []
    };

    for (const evId of discovered) {
        if (evId.startsWith('dna_')) {
            const loc = evId.replace('dna_', '').replace(/_/g, ' ').toUpperCase();
            const dna = activeGame.getDNA(evId.replace('dna_', ''));
            sections['🧬 DNA Samples'].push(`**${loc}**: ${dna?.join(', ') || 'Trace detected'}`);
        } else if (evId.startsWith('footage_')) {
            const time = evId.replace('footage_', '');
            const footage = activeGame.getFootage(time);
            sections['📹 Security Footage'].push(`**${time}**: ${footage}`);
        } else if (evId.startsWith('logs_')) {
            const time = evId.replace('logs_', '');
            const log = activeGame.getLogs(time);
            sections['📜 Private Letters'].push(`**${time}**: ${log}`);
        } else if (evId.startsWith('physical_')) {
            const itemId = evId.replace('physical_', '');
            const desc = activeGame.getPhysicalEvidence(itemId);
            sections['📦 Physical Evidence'].push(`**${itemId.replace(/_/g, ' ').toUpperCase()}**: ${desc}`);
        } else if (evId.startsWith('secret_')) {
            // Format: secret_SUSPECTID_SECRETID
            const parts = evId.split('_');
            if (parts.length >= 3) {
                const suspectId = parts[1];
                const secretId = parts.slice(2).join('_');
                const suspect = activeGame.getSuspect(suspectId);
                const secret = suspect?.secrets.find(s => s.id === secretId);
                if (secret) {
                    sections['🤫 Discovered Secrets'].push(`**${suspect?.name || suspectId}**: ${secret.text}`);
                }
            }
        } else if (evId.startsWith('locations_')) {
            // Format: locations_SUSPECTID_TIME
            const parts = evId.split('_');
            if (parts.length >= 3) {
                const suspectId = parts[1];
                const time = parts[2];
                const loc = activeGame.getLocation(suspectId, time);
                const suspect = activeGame.getSuspect(suspectId);
                if (loc) {
                    sections['📍 Suspect Movements'].push(`**${suspect?.name || suspectId}** was at **${loc.replace(/_/g, ' ').toUpperCase()}** at **${time}**`);
                }
            }
        }
    }

    for (const [title, items] of Object.entries(sections)) {
        if (items.length > 0) {
            // Trim if too many items for Discord limits
            let value = items.join('\n');
            if (value.length > 1024) {
                value = value.substring(0, 1021) + '...';
            }
            embed.addFields({ name: title, value });
        }
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
}
