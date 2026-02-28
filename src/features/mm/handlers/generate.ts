import { ChatInputCommandInteraction, EmbedBuilder, Colors } from 'discord.js';
import { hasPermission, denyPermission } from '../commands.js';
import { CaseBuilder } from '../procedural/CaseBuilder.js';
import { GeneratorConfig } from '../procedural/types.js';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from '../../../utils/logger.js';
import GameManager from '../game.js';

export async function handleGenerate(manager: GameManager, interaction: ChatInputCommandInteraction) {
    if (!hasPermission(interaction)) {
        await denyPermission(interaction);
        return;
    }

    const theme = interaction.options.getString('theme');
    const difficulty = interaction.options.getString('difficulty');

    // SECURITY: Validate inputs even if they are from slash command choices
    if (theme && (theme.length > 20 || !/^[a-z0-9_-]+$/i.test(theme))) {
        await interaction.reply({ content: '❌ Invalid theme format.', ephemeral: true });
        return;
    }
    if (difficulty && (difficulty.length > 20 || !/^[a-z]+$/i.test(difficulty))) {
        await interaction.reply({ content: '❌ Invalid difficulty format.', ephemeral: true });
        return;
    }

    const finalTheme = theme as 'noir' | 'modern' | 'mansion' | null;
    const finalDifficulty = difficulty as 'easy' | 'medium' | 'hard' | null;

    // Check Daily Limit
    if (interaction.guildId) {
        try {
            const { Server } = await import('../../../database.js');
            const server = await Server.findByPk(interaction.guildId);
            if (server) {
                if (server.lastGeneratedAt) {
                    const now = new Date();
                    const diffHours = Math.abs(now.getTime() - new Date(server.lastGeneratedAt).getTime()) / 36e5;
                    if (diffHours < 24) {
                        const nextAvailable = new Date(new Date(server.lastGeneratedAt).getTime() + 24 * 60 * 60 * 1000);
                        const timeString = `<t:${Math.floor(nextAvailable.getTime() / 1000)}:R>`;
                        await interaction.reply({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(Colors.Red)
                                    .setTitle('⏳ Generation Limit Reached')
                                    .setDescription(`This server has already generated a mystery today!\n\nYou can generate another case **${timeString}**.\nLimit: 1 case per server per day.`)
                            ],
                            ephemeral: true
                        });
                        return;
                    }
                }

                // Update timestamp for successful generation
                server.lastGeneratedAt = new Date();
                await server.save();
            }
        } catch (e) {
            logger.error('Failed to check generation limit', e);
        }
    }

    await interaction.deferReply();

    const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle('⚙️ Generating New Case File')
        .setDescription('```ansi\n\u001b[1;36m[ BUILDER INITIALIZING ]\u001b[0m\n```')
        .setFooter({ text: 'Preparing..' });

    await interaction.editReply({ embeds: [embed] });

    const stages = [
        { id: 'logic', emoji: '🦴', name: 'Skeleton Case', status: 'pending' },
        { id: 'narrative', emoji: '✨', name: 'Weaving Narrative', status: 'pending' },
        { id: 'suspects', emoji: '🔍', name: 'Scripting Suspects', status: 'pending' },
        { id: 'evidence', emoji: '🔪', name: 'Placing Evidence', status: 'pending' },
        { id: 'final', emoji: '📁', name: 'Final Assembly', status: 'pending' },
    ];

    let lastUpdate = 0;

    // Create an object to track mutable state to avoid closure issues
    const state = {
        lastEmbedUpdate: 0
    };

    const updateEmbed = async (stageId: string, detail: string) => {
        const now = Date.now();

        let foundCurrent = false;
        let visual = '```ansi\n';
        for (const stage of stages) {
            if (stage.id === stageId) {
                stage.status = 'active';
                foundCurrent = true;
            } else if (!foundCurrent) {
                stage.status = 'done';
            } else {
                stage.status = 'pending';
            }

            if (stage.status === 'pending') {
                visual += `\u001b[0;30m[ ] ${stage.emoji} ${stage.name}\u001b[0m\n`;
            } else if (stage.status === 'active') {
                visual += `\u001b[1;36m[⏳] ${stage.emoji} ${stage.name}\u001b[0m\n    ↳ \u001b[0;36m${detail}\u001b[0m\n`;
            } else if (stage.status === 'done') {
                visual += `\u001b[1;32m[🗸] ${stage.emoji} ${stage.name}\u001b[0m\n`;
            }
        }
        visual += '```';

        embed.setDescription(visual);

        // Throttle to 1 update per second
        if (now - state.lastEmbedUpdate > 1000) {
            try {
                await interaction.editReply({ embeds: [embed] });
                state.lastEmbedUpdate = now;
            } catch (error) {
                logger.error('Failed to update progress embed', error);
            }
        }
    };

    const config: GeneratorConfig = {
        theme: finalTheme || 'noir',
        difficulty: finalDifficulty || 'medium',
        seed: Date.now().toString(),
        useLLM: true, // Need LLM for good stories
        guildId: interaction.guildId || undefined,
        onProgress: updateEmbed
    };

    try {
        const builder = new CaseBuilder();
        const caseConfig = await builder.build(config);

        // Mark all as done
        let finalVisual = '```ansi\n';
        for (const stage of stages) {
            finalVisual += `\u001b[1;32m[✓] ${stage.emoji} ${stage.name}\u001b[0m\n`;
        }
        finalVisual += '```';

        // Save to file
        const outputDir = path.join(process.cwd(), 'data', 'cases', caseConfig.id);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(
            path.join(outputDir, 'case.yaml'),
            yaml.dump(caseConfig, { indent: 2, lineWidth: -1 })
        );

        const successEmbed = new EmbedBuilder()
            .setColor(Colors.Green)
            .setTitle('✅ Case Generated Successfully')
            .setDescription(finalVisual + `\n**ID:** \`${caseConfig.id}\`\n**Title:** ${caseConfig.name}\n**Difficulty:** ${caseConfig.settings.difficulty}`)
            .addFields(
                { name: 'To Play', value: `\`/mma start ${caseConfig.id}\`` }
            )
            .setFooter({ text: 'Please wait while the case is being generated.' });

        const files = [];
        if (caseConfig.victim.avatar && !caseConfig.victim.avatar.startsWith('http')) {
            const absolutePath = path.isAbsolute(caseConfig.victim.avatar) ? caseConfig.victim.avatar : path.join(process.cwd(), 'public', caseConfig.victim.avatar);
            if (fs.existsSync(absolutePath)) {
                files.push({ attachment: absolutePath, name: 'victim.png' });
                successEmbed.setThumbnail(`attachment://victim.png`);
            }
        }

        await interaction.editReply({ embeds: [successEmbed], files });
        logger.info(`Generated new case: ${caseConfig.id}`);

    } catch (error) {
        logger.error("Generation Failed:", error);

        embed.setColor(Colors.Red)
            .setTitle('❌ Generation Failed')
            .setDescription(`\`\`\`ansi\n\u001b[1;31m[!] CRITICAL ERROR\u001b[0m\n\`\`\`\n${error instanceof Error ? error.message : 'Unknown error occurred.'}`)
            .setFooter(null);
        await interaction.editReply({ embeds: [embed] });
    }
}
