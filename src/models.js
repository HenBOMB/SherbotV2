(await import('dotenv')).config();
import { Sequelize as Seq, DataTypes } from 'sequelize';

export const Sequelize = new Seq({ 
	dialect: 'sqlite',  
	storage: './database.sqlite',
	logging: false,
});

export const Server = Sequelize.define('Server', {
	id: {
		type: DataTypes.STRING,
		primaryKey: true,
		allowNull: false,
	},
	tip: {
		type: DataTypes.INTEGER,
		allowNull: true,
		defaultValue: null,
	},
	tip_channel: {
		type: DataTypes.STRING,
		allowNull: true,
		defaultValue: null,
	}
}, {
	timestamps: false
});

await Sequelize.sync({ alter: true });

await Server.findOrCreate({
	where: { id: '1129016938996187168' },
	defaults: {
		id: '1129016938996187168', 
		tip: 0,
		tip_channel: '1174494459812134983'
	}
});