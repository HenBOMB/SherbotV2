import fs from 'fs';
import { Collection, REST, Routes, Events, InteractionType } from 'discord.js';
(await import('dotenv')).config();

/**
 * @param {import('discord.js').Client} client
 */
export default async function(client) {
    client.commands = new Collection();
    const guilds = { };
    
    for (const file of fs.readdirSync('src/features/commands').filter(file => file.endsWith('.js'))) 
    {
        try {
            const command = (await import(`./commands/${file}`)).default;
            if(!command)
            {
                throw 'Command has no export.';
            }
            const guild = command.guild? await client.fetchGuildPreview(command.guild).catch(() => null) : null;
            if(command.data) 
            {
                client.commands.set(command.data.name, command);
                if(guild) guilds[guild.id] = [...(guilds[guild.id]||[]), command.data];
            }
            console.log('   ✓', `/${file.slice(0,-3)} (${guild?.name || 'any'})`);
        } catch (error) {
            console.log('   ✗', `/${file.slice(0,-3)}`);
            console.log(error);
        }
    }

    const rest = new REST().setToken(process.env.token);

    try {
        for(const key of Object.keys(guilds))
        {
            await rest.put(
                Routes.applicationGuildCommands(client.application.id, key),
                { body: guilds[key] },
            );
        }
        console.log(`   Sync ${client.commands.size} commands.`);
    } catch (error) {
        console.log(`   Failed to put ${client.commands.size} commands.`);
        console.error(error);
    }

    client.on(Events.InteractionCreate, async interaction => {
        try 
        {
            if(interaction.isStringSelectMenu() || interaction.isButton())
            {
                const command = client.commands.get(interaction.customId.split('-')[0]);
        
                if (!command) 
                {
                    throw 'Error: Interaction is not tied to any command.';
                }

                await (interaction.isButton()? command.click(interaction) : command.select(interaction)).catch(err => { throw err });
            }
            else if (interaction.isChatInputCommand())
            {
                const command = client.commands.get(interaction.commandName);
            
                if (!command) 
                {
                    throw `No command matching ${interaction.commandName} was found.`;
                }
            
                await command.execute(interaction).catch(err => { throw err });
            }
            else
            {
                return;
            }

            if(!interaction.replied)
            {
                throw 'Error: Interaction did not reply.';
            }
        } 
        catch (error) 
        {
            console.error(error);

            if (interaction.replied || interaction.deferred) 
            {
                await interaction.followUp({ content: 'Sorry, an error occurred. Please try again!', ephemeral: true });
            } 
            else 
            {
                await interaction.reply({ content: 'Sorry, an error occurred. Please try again!', ephemeral: true });
            }
        }
    });
}