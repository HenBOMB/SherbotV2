import { NPC } from './commands/ask.js';

/**
 * @param {import('discord.js').Client} client
 */
export default function(client) {

    var busy = false;

    client.on('messageCreate', async message => {
        if(message.author.bot) return;
        if(message.channelId !== '1229897170078011483') return;

        if(busy) return;

        // await message.channel.setRateLimitPerUser(21600);

        const matches = message.content.match(/\w+/g);
        const choice = Object.keys(NPC.SUSPECTS).find(key => matches.find(match => key.includes(match)));

        if(!choice) return;

		const npc = NPC.SUSPECTS[choice];

		if(!npc) return;

		const channel = message.channel;
		const content = message.content;
		const ourName = message.member.displayName;

		if(content.length < 10) return;

        var response = npc.respond(
			ourName, 
			content,
			channel
		);
		
        busy = true;

		const bot = channel.guild.members.cache.get('712429527321542777');
		bot.setNickname(npc.name);
		await new Promise(res => setTimeout(res, 2000));
		await channel.sendTyping();
		await new Promise(res => setTimeout(res, 2000));
		await bot.setNickname('Sherbot');
		await new Promise(res => setTimeout(res, 2000));

		response = await response;

		if(!response)
        {
            busy = false;
            return;
        }

		channel.send('ㅤ').then(msg => msg.delete());
		await new Promise(res => setTimeout(res, 288)); // ! X - Y
		await response.cb();

        busy = false;
    });
}