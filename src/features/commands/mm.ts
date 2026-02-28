import { ChatInputCommandInteraction, AutocompleteInteraction, Client, ButtonInteraction } from 'discord.js';
import { mmCommands, hasServerPremium, denyServerPremium } from '../mm/commands.js';
import GameManager from '../mm/game.js';
import { Command } from '../../types.js';
import { MMGame } from '../../database.js';
import { logger } from '../../utils/logger.js';

const command: Command = {
    // guild: '1462571184787947674', // Your server ID
    data: mmCommands,
    async init(client: Client) {
        try {
            // Find all games that aren't ended
            const activeGames = await MMGame.findAll({
                where: {
                    phase: ['investigating', 'voting', 'accused']
                }
            });

            if (activeGames.length > 0) {
                logger.info(`🔍 [MM] Proactively restoring ${activeGames.length} active investigations...`);
            }

            for (const game of activeGames) {
                const gm = new GameManager(client, game.guildId, 'data');
                // Restore purely in background
                gm.restoreGames().catch(err =>
                    logger.error(`   ✗ [MM] Failed to restore game for guild ${game.guildId}:`, err)
                );
            }
        } catch (err) {
            logger.error('🔍 [MM] Failed to proactively restore games:', err);
        }
    },

    async execute(interaction: ChatInputCommandInteraction) {
        if (!await hasServerPremium(interaction.guildId)) {
            return denyServerPremium(interaction);
        }

        let gameManager = GameManager.getInstance(interaction.guildId || undefined);

        // If no manager exists (likely starting a new game), create one
        if (!gameManager && interaction.guild) {
            gameManager = new GameManager(interaction.client, interaction.guild.id, 'data');
            // We don't call restoreGames here because if it was active, init() would have caught it
        }

        if (!gameManager) {
            await interaction.reply({ content: 'Failed to initialize game manager.', ephemeral: true });
            return;
        }

        // Inform user if background restoration is taking place
        if (gameManager.getInitializing()) {
            await interaction.reply({
                content: '⏳ **Investigation files are currently being restored...** Please stand by.',
                ephemeral: true,
            });
            return;
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'status':
                await gameManager.handleStatus(interaction);
                break;

            case 'join':
                await gameManager.handleJoin(interaction);
                break;

            case 'leave':
                await gameManager.handleLeave(interaction);
                break;

            case 'dna':
                await gameManager.handleDNA(interaction);
                break;

            case 'footage':
                await gameManager.handleFootage(interaction);
                break;

            case 'logs':
                await gameManager.handleLogs(interaction);
                break;

            case 'search':
                await gameManager.handleSearch(interaction);
                break;

            case 'look':
                await gameManager.handleLook(interaction);
                break;

            // case 'explore':
            //     await gameManager.handleExplore(interaction);
            //     break;

            case 'evidence':
                await gameManager.handleEvidence(interaction);
                break;

            case 'examine':
                await gameManager.handleExamine(interaction);
                break;

            case 'present':
                await gameManager.handlePresent(interaction);
                break;

            case 'accuse':
                await gameManager.handleAccuse(interaction);
                break;

            case 'suspects':
                await gameManager.handleSuspects(interaction);
                break;

            case 'secrets':
                await gameManager.handleSecrets(interaction);
                break;

            case 'help':
                await gameManager.handleHelp(interaction);
                break;


            default:
                await interaction.reply({
                    content: `Unknown subcommand: ${subcommand}`,
                    ephemeral: true,
                });
        }
    },

    async click(interaction: ButtonInteraction) {
        if (interaction.customId === 'mm-join') {
            const gameManager = GameManager.getInstance(interaction.guildId || undefined);
            if (gameManager) {
                if (gameManager.getInitializing()) {
                    await interaction.reply({ content: '⏳ Investigation is initializing...', ephemeral: true });
                    return;
                }
                await gameManager.handleJoin(interaction);
            } else {
                await interaction.reply({ content: 'Failed to initialize game manager.', ephemeral: true });
            }
        }
    },

    async autocomplete(interaction: AutocompleteInteraction) {
        let gameManager = GameManager.getInstance(interaction.guildId || undefined);
        if (!gameManager && interaction.guild) {
            gameManager = new GameManager(interaction.client, interaction.guild.id, 'data');
        }

        if (gameManager) {
            const focused = interaction.options.getFocused(true);
            // 'case' autocomplete doesn't need a fully loaded game
            if (focused.name === 'case' || !gameManager.getInitializing()) {
                await gameManager.handleAutocomplete(interaction);
            }
        }
    }

};

export default command;
