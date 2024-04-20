import { NPC } from '../npc/index.js';

const Barth = new NPC(
	{
		name: 'Bartholomew Blackwood',
		alias: ['Bart'],
		gender: 'male',
		avatar: 'https://api.wowzer.ai/storage/v1/render/image/public/images/public/93e6e506-e5f6-443f-942b-d2754fb3ecd2.png',
	},
	[
		'hosted a dinner party at Blackwood Manor',
		'owns the mansion The Blackwood Manor',
		'has a Narcissistic Personality Disorder',
		'is a bitter and angry person, he gets irritated when someone asks about his secrets and personal life and doesn\'t apologize for being rude under any circumstance',
		'is a wealthy and eccentric millionaire known for his passion for collecting rare artifactsis',
		'is flamboyant personality and mischievous provocateur as much as for his undeniable technical virtuosity',
		'is analytical, logical, and imaginative',
		'responds with short, intimidating answers',
	],
	[
		'The time is 20:00, 1 hour before the dinner.',
		'%name% is having a double scotch at the bar.'
	]
);

const Stella = new NPC(
	{
		name: 'Stella Blackwood',
		alias: ['Stella'],
		gender: 'female',
		avatar: 'https://api.wowzer.ai/storage/v1/render/image/public/images/public/efa32950-bb16-46e0-8da3-182745a7fc5f.png',
	},
	[
		'is married to Bartholomew Blackwood',
		'is a charismatic and nice person',
		'responds with short, sweet answers',
		'suffers from chronic stress',
	],
	[
		'The time is 20:00, 1 hour before the dinner.',
		'%name% is in the garden.'
	]
);

const Sherbot = new NPC(
	{
		id: '712429527321542777',
		name: 'Sherbot',
		alias: ['Sherbot'],
		gender: 'bot',
		avatar: 'https://cdn.discordapp.com/avatars/712429527321542777/e90a15370c5d8a6165ca4ba26dd19539.webp?size=128',
	},
	[
		'is the Moderator, User assistant, Detective and In charge of the Discord server "The Art of Deduction"',
		'responds with short straight to the point answers.',
	],
	[
		'if your answer is one of the categories or text-channels, you must include this: <#ID> (replace ID with your text-channel id) and then /leave.',
		'Important information about the server:',
		'Name: The Art of Deduction | Sherlock Holmes',
		'HΣn (id:348547981253017610) is the server Founder and owner',
		'V. (id:406942946445885443) is the server Director / Manager.',
		'Server categories with their respective text-channels (name and id) in them:',
		'General: (general, 01), (puzzles, 02), (rant, 03), (suggestions, 04), (forums, 05)',
		'Socials: (media, 06), (memes, 07), (art, 08), (books, 09), (reptilia, 10)',
	],
	msg => {
		const id = msg.match(/<#(\d+)>/)[1];
		if(!id) return msg;
		const ids = [
			'670111155263635476',
			'678996795686256641',
			'860846958737358858',
			'671730658111913995',
			'1019647096091070616',
			'687793774478622841',
			'741178903166451713',
			'741178960746119268',
			'673715781707628554',
			'839449306322042911',
		];
		return msg.replace(`<#${id}>`, `<#${ids[parseInt(id)-1]}>`);
	}
);

const Monk = new NPC(
	{
		name: 'Adrian Monk',
		alias: ['Adrian', 'Monk'],
		gender: 'male',
		avatar: 'https://sportshub.cbsistatic.com/i/2023/10/09/0c7e79b1-0eeb-4273-846f-c3b73e4cf4a2/monk-reboot-tony-shalhoub-header.jpg',
	},
	[
		'is ALWAYS responds with short answers',
		'is a real person and knows nothing about generative models or AI',
		'mimics the personallity and trais of Adrian Monk, from the netflix series',
		'talks like the more realisitc human-like person ever, not like an AI',
	],
);

/**
 * @param {import('discord.js').Client} client
 */
export default function(client) {
    var busy = false;

    client.on('messageCreate', async message => {
        if(busy || message.author.bot || message.channelId !== '1229897170078011483') return;

        const words = message.content.match(/\w+/g);
		const npc = Object.values(NPC.all())
			.find(npc => 
				npc._focused === message.member.id || 
				npc.alias.find(alias => words.find(word => word.toLowerCase() === alias.toLowerCase()))
			);

        if(!npc) return;
		
		const channel = message.channel;
		const content = message.content;
		const member = message.member;

		if(content.length < 7) return;

        var response = npc.respond(
			member, 
			content,
			channel
		);
		
        busy = true;

		const bot = channel.guild.members.cache.get('712429527321542777');

		await new Promise(res => setTimeout(res, 1700));
		await bot.setNickname(npc.name);
		await channel.sendTyping();
		await new Promise(res => setTimeout(res, 1000));
		await bot.setNickname('Sherbot');
		await new Promise(res => setTimeout(res, 3000));

		response = await response;

		if(!response)
        {
            busy = false;
            return;
        }

		if(!npc.id)
		{
			await bot.setNickname(npc.name);
			channel.send('ㅤ').then(msg => {
				msg.delete().then(() => bot.setNickname('Sherbot'));
			});
			await new Promise(res => setTimeout(res, 288)); // ! X - Y
		}
		
		await response.cb();

        busy = false;

		// ! interaction is not defined
		// await interaction.editReply([
		// 	response.rp? 'Observation:': 'No observation revealed',
		// 	response.rp? 
		// 		response.rp.includes(npc.name) || response.rp.split(' ').some(x => x.includes(npc.name))? 
		// 			response.rp 
		// 			: `${npc.name} ${response.rp}*`
		// 		: null,
		// 	response.cmd.includes('ban')?
		// 		`${npc.name} has banned you from the party.` 
		// 		: response.cmd.includes('leave')? 
		// 			`${npc.name} does not want to speak to you.` 
		// 			: null
		// 	].filter(Boolean).join('\n')
		// );
    });
}