/**
 * @param {import('discord.js').Client} client
 */
export default function(client) {
    client.on('messageCreate', async message => {
        const content = message.content;

        if(!message.member || message.member.user.bot) return;

        // ? No filtering if you can kick.
        if(message.member.roles.cache.find(role => role.permissions.has('KickMembers'))) return;

        if(content.includes('https://discord.gg'))
        {
            const kicked = await message.member.kick().catch(() => null);

            await message.delete();

            if(kicked)
            {
                return await client.channels.fetch('1026319776630456421').then(channel => {
                    channel.send(`Kicked ${kicked.displayName}, sent a discord invite link. <@348547981253017610>`);
                });
            }
            else
            {
                console.log('Failed to kick.');
            }
        }

        // ? 🔑┃verification
        if(message.channelId === '906149558801813605')
        {
            if(
                content.match(/(\d[-) .]+.+)/mg || 
                content.includes('Have you read the rules?') || 
                content.includes('Why are you interested in deduction?') || 
                content.includes('What is your favorite field of study?')) && content.includes('deduct')
            )
            {
                await message.react(['✅','👍'][Math.floor(Math.random()*2)]);
                await message.member.roles.add('906128248193306635');
            }
        }
        // ? 🙋┃introductions
        else if(message.channelId === '670108903224377354')
        {
            if(
                content.match(/Name:/) || 
                content.match(/Contact:/)
            )
            {
                await message.react('�');
            }
        }
    })
}