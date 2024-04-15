import fs from 'fs';

/**
 * @param {import('discord.js').Client} client
 */
export default function(client) {
    const WELCOMES = fs.readFileSync('src/assets/welcome.no', 'utf8').split('\n');

    client.on('guildMemberAdd', async member => {
        if(member.user.bot) return;
        if(member.guild.id !== '670107546480017409') return;

        await member.roles.add('670108333834764288');

        const welcomeChannel = await client.channels.fetch('670108784307470337');

        await welcomeChannel.send({ embeds: [
            new EmbedBuilder()
                .setColor(client.botcolor)
                .setTitle(WELCOMES[Math.floor(Math.random() * WELCOMES.length)].replace(/%user%/g, member.user.globalName))
                .setDescription(`Welcome ${member} to ${member.guild.name.replace('|','—')} 🎉`)
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp()
                .setFooter({
                    text: `${member.user.globalName}`, 
                    icon_url : member.guild.iconURL()
                })
            ]
        });

        await member.user.send({ embeds: [
            new EmbedBuilder()
                .setColor(client.botcolor)
                .setTitle(`Verification Required`)
                .setThumbnail('https://cdn-icons-png.flaticon.com/512/1779/1779281.png')
                .setDescription(`
    🗝️ Head over to <#906149558801813605> to verify yourself.
    
    **You must answer the following questions:**
    
    > 1. Have you read the <#714956060427026533>?
    > 2. Why are you interested in deduction? 
    > 3. How long have you been practicing deduction? 
    > 4. What is your favorite field of study?
    > 5. What is your purpose of joining this server?
    
    [Click here for more info](https://discord.com/channels/670107546480017409/906149558801813605/906150446966648882)
    ㅤ
    `)
                .setFooter({ text: member.guild.name })
                .setTimestamp()
        ]});
    })
}