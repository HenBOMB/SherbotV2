import {
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    Client,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ButtonInteraction,
    EmbedBuilder,
    Colors
} from 'discord.js';
import { mmaCommands, hasPermission, denyPermission, AUTHORIZED_ADMIN_ID } from '../mm/commands.js';
import GameManager from '../mm/game.js';
import { Command } from '../../types.js';
import { logger } from '../../utils/logger.js';
import { exec } from 'child_process';

const command: Command = {
    guild: '1462571184787947674', // Your server ID
    data: mmaCommands,

    async execute(interaction: ChatInputCommandInteraction) {
        if (!hasPermission(interaction)) {
            return denyPermission(interaction);
        }

        let gameManager = GameManager.getInstance(interaction.guildId || undefined);

        // Lazy init if first time
        if (!gameManager && interaction.guild) {
            gameManager = new GameManager(
                interaction.client,
                interaction.guild.id,
                'data'
            );
        }

        if (!gameManager) {
            await interaction.reply({
                content: 'Failed to initialize game manager.',
                ephemeral: true,
            });
            return;
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'start': {
                const caseId = interaction.options.getString('case', true);
                const time = interaction.options.getInteger('time') ?? undefined;
                await gameManager.startGame(interaction, caseId, time);
                break;
            }

            case 'end':
                await gameManager.handleEnd(interaction);
                break;

            case 'cleanup':
                await gameManager.handleCleanup(interaction);
                break;

            case 'shutdown': {
                const row = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('mma-shutdown-confirm')
                            .setLabel('Confirm SYSTEM Shutdown')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId('mma-shutdown-cancel')
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary)
                    );

                const embed = new EmbedBuilder()
                    .setColor(Colors.Red)
                    .setTitle('🚨 CRITICAL: System Power Off Request')
                    .setDescription('Are you sure you want to **SHUT DOWN THE SERVER COMPUTER**? This will literally power off the machine.')
                    .setFooter({ text: 'Ensure the bot has sudo permission for "shutdown now".' });

                await interaction.reply({
                    embeds: [embed],
                    components: [row],
                    ephemeral: true
                });
                break;
            }

            default:
                await interaction.reply({
                    content: `Unknown admin subcommand: ${subcommand}`,
                    ephemeral: true,
                });
        }
    },

    async click(interaction: ButtonInteraction) {
        if (interaction.user.id !== AUTHORIZED_ADMIN_ID) {
            await interaction.reply({ content: 'Unauthorized.', ephemeral: true });
            return;
        }

        if (interaction.customId === 'mma-shutdown-confirm') {
            await interaction.update({
                content: '🛑 **SYSTEM SHUTDOWN INITIATED.** Powering off hardware now...',
                embeds: [],
                components: []
            });

            logger.info(`🚨>>> HARDWARE SHUTDOWN command received from ${interaction.user.tag}. Executing 'sudo shutdown now'...`);

            // Execute the system shutdown command
            exec('sudo shutdown now', (error, stdout, stderr) => {
                if (error) {
                    logger.error(`Shutdown failed: ${error.message}`);
                    // Optionally, send a follow-up message to the user if the shutdown failed
                    // interaction.followUp({ content: `❌ Shutdown command failed: ${error.message}. Check bot permissions.`, ephemeral: true });
                    return;
                }
                if (stderr) {
                    logger.warn(`Shutdown stderr: ${stderr}`);
                }
            });

            // Fallback: kill the process regardless
            setTimeout(() => {
                process.exit(0);
            }, 3000);
        } else if (interaction.customId === 'mma-shutdown-cancel') {
            await interaction.update({
                content: '✅ Shutdown cancelled.',
                embeds: [],
                components: []
            });
        }
    },

    async autocomplete(interaction: AutocompleteInteraction) {
        const gameManager = GameManager.getInstance(interaction.guildId || undefined);
        if (gameManager) {
            await gameManager.handleAutocomplete(interaction);
        }
    }
};

export default command;
