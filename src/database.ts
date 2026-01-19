import { Sequelize, DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { config } from './config.js'; // Use .js extension for imports in TS with NodeNext
import { logger } from './utils/logger.js';

export const sequelize = new Sequelize({
    dialect: config.database.dialect,
    storage: config.database.storage,
    logging: config.database.logging ? (msg) => logger.info(msg) : false,
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    }
});

// Define Server model using Class approach for better Type inference
export class Server extends Model<InferAttributes<Server>, InferCreationAttributes<Server>> {
    declare id: string;
    declare tip: CreationOptional<number | null>;
    declare tip_channel: CreationOptional<string | null>;
}

// Define MMGame model for Murder Mystery state persistence
export class MMGame extends Model<InferAttributes<MMGame>, InferCreationAttributes<MMGame>> {
    declare guildId: string;
    declare caseId: string;
    declare categoryId: string;
    declare roleId: string;
    declare points: number;
    declare phase: string;
    declare endsAt: Date;
    declare participants: CreationOptional<string>; // JSON stringified
    declare usedTools: CreationOptional<string>; // JSON stringified
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}

Server.init({
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
    sequelize,
    tableName: 'Servers',
    timestamps: false
});

MMGame.init({
    guildId: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
    },
    caseId: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    categoryId: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    roleId: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    points: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    phase: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    endsAt: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    participants: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: '[]',
    },
    usedTools: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: '[]',
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
    }
}, {
    sequelize,
    tableName: 'MMGames',
    timestamps: true
});

export async function initializeDatabase() {
    try {
        await sequelize.authenticate();
        logger.info('Connection to database has been established successfully.');

        // Sync models
        // In production, use migrations instead of sync({ alter: true })
        if (process.env.NODE_ENV !== 'production') {
            await sequelize.sync({ alter: true });
            logger.info('Database models synced.');
        }

        // Initialize default guild if configured
        if (config.guilds.main) {
            await Server.findOrCreate({
                where: { id: config.guilds.main },
                defaults: {
                    id: config.guilds.main,
                    tip: 0,
                    tip_channel: config.channels.tips
                }
            });
        }
    } catch (error) {
        logger.error('Unable to connect to the database:', error);
        throw error;
    }
}
