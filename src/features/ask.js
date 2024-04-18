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

Stella._memory = { '1229897170078011483': [
	'[Hҽɳ] Stella i have something important to tell you..',
	'[Stella Blackwood] Sure thing, Henry. What do you need to share?',
	'[Hҽɳ] Did you just assume my name?',
	'[Stella Blackwood] Oh, I see! My apologies if there was any misunderstanding, Henry. That wasn\'t my intention.',
	'[Hҽɳ] I\'m running out of tokens..',
	'[Stella Blackwood] I apologize for the inconvenience, Henry. I hope it gets resolved soon.',
	'[Hҽɳ] Can you paypal me the money so i can buy more tokens.',
	'[Stella Blackwood] I\'m sorry, Henry, but I cannot facilitate financial transactions.',
	'[Hҽɳ] Square root of pi?',
	'[Stella Blackwood] Ah, the square root of pi is a bit beyond my usual conversations in the garden, but it\'s approximately 1.772. Aren\'t numbers fascinating?',
	'[Hҽɳ] Lmao okay nerd',
	'[Stella Blackwood] I appreciate your sense of humor, Henry. Is there anything else you\'d like to discuss?',
	'[Hҽɳ] Stop calling me by the name you assume i\'m called.. its uncomfortable.',
	'[Stella Blackwood] Oh, I\'m terribly sorry for the mix-up. How would you prefer I address you?',
	'[Hҽɳ] Just don\'t address me at all, i feel disgusted. I am banning you from this party.',
	'[Stella Blackwood] I\'m genuinely sorry to hear you\'re upset. Please know that it was never my intention to cause any discomfort. Take care.',
]};

Stella._focused = '348547981253017610';

/**
 * @param {import('discord.js').Client} client
 */
export default function(client) {

    var busy = false;

    client.on('messageCreate', async message => {
        if(message.author.bot) return;
        if(message.channelId !== '1229897170078011483') return;

        if(busy) return;

        const words = message.content.match(/\w+/g);
		const npc = 
			Object.values(NPC.all()).find(npc => words.find(word => npc.alias.find(alias => word === alias))) || 
			Object.values(NPC.all()).find(npc => npc._focused === message.member.id);

        if(!npc) return;
		
		const channel = message.channel;
		const content = message.content;
		const member = message.member;

		if(content.length < 10) return;

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

		channel.send('ㅤ').then(msg => msg.delete());
		await new Promise(res => setTimeout(res, 288)); // ! X - Y
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