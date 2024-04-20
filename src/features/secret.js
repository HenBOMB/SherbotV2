/**
 * @param {import('discord.js').Client} client
 */
export default function(client) {
    var prev = '';

    client.on('messageCreate', async message => {
        console.log(
            (prev === message.guildId? `` : `-> ${message.guild.name}\n`)
            + `[${message.channel.name}] ${message.author.displayName}: ${message.content}`
        );

        prev = message.guildId;

        if(!message.member || message.author.bot) return;

        if(
            message.author.id !== '348547981253017610' &&
            message.author.id !== '406942946445885443'
        ) return;
        
        const channel = message.channel;

        if(message.content.startsWith('sudo'))
        {
            // ? sudo <#id> <content>
            const id        = /<#(\d+)>/g.exec(message.content.slice(5))?.at(1) || message.channelId;
            const content   = message.content.slice(5).replace(`<#${id}>`, '').trim();
            
            /**
             * @type {import('discord.js').TextChannel}
             */
            const target   = message.guild.channels.cache.get(id);

            if(!target)
            {
                await message.delete().then(msg => {
                    msg.channel.send({ content: 'That channel does not exist.', ephemeral: true });
                });
                return;
            }

            if(!content || content.length < 5)
            {
                await message.delete().then(msg => {
                    msg.channel.send({ content: 'Content too short or missing.', ephemeral: true });
                });
                return;
            }

            target.send(content).then(msg => {
                if(target.id === channel.id)
                {
                    message.delete();
                }
                else
                {
                    message.reply({ content: `Sudo'd at: ${msg.url}`, ephemeral: true });
                }
            });
        }
    })
}