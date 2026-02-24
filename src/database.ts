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
    declare tips_enabled: CreationOptional<boolean>;
    declare language: CreationOptional<string | null>;
}

// Define TipTranslation model
export class TipTranslation extends Model<InferAttributes<TipTranslation>, InferCreationAttributes<TipTranslation>> {
    declare tipUrl: string;
    declare language: string;
    declare text: string;
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
    declare discoveredEvidence: CreationOptional<string>; // JSON stringified
    declare discoveredLocations: CreationOptional<string>; // JSON stringified
    declare playerStats: CreationOptional<string>; // JSON stringified
    declare accusations: CreationOptional<string>; // JSON stringified
    declare suspectState: CreationOptional<string>; // JSON stringified
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}

// Define UserProfile model
export class UserProfile extends Model<InferAttributes<UserProfile>, InferCreationAttributes<UserProfile>> {
    declare userId: string;
    declare guildId: string;
    declare profile: string;
    declare messageCount: number;
    declare lastUpdated: Date;
}

// Define BotState model for global metadata
export class BotState extends Model<InferAttributes<BotState>, InferCreationAttributes<BotState>> {
    declare key: string;
    declare value: string;
}

export class InterrogationCache extends Model<InferAttributes<InterrogationCache>, InferCreationAttributes<InterrogationCache>> {
    declare id: CreationOptional<string>;
    declare suspectId: string;
    declare question: string;
    declare embedding: string; // JSON string of number[]
    declare response: string; // JSON string of SuspectResponse
    declare createdAt: CreationOptional<Date>;
}

// Define InterrogationLog model for logging user messages and AI responses
export class InterrogationLog extends Model<InferAttributes<InterrogationLog>, InferCreationAttributes<InterrogationLog>> {
    declare id: CreationOptional<number>;
    declare caseId: string;
    declare suspectId: string;
    declare userId: string;
    declare question: string;
    declare response: string;
    declare composureLost: number;
    declare secretRevealed: string | null;
    declare createdAt: CreationOptional<Date>;
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
    },
    tips_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    language: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
    }
}, {
    sequelize,
    tableName: 'Servers',
    timestamps: false
});

TipTranslation.init({
    tipUrl: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
    },
    language: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
    },
    text: {
        type: DataTypes.TEXT,
        allowNull: false,
    }
}, {
    sequelize,
    tableName: 'TipTranslations',
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
        type: DataTypes.FLOAT,
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
    discoveredEvidence: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: '[]',
    },
    discoveredLocations: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: '[]',
    },
    playerStats: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: '{}',
    },
    accusations: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: '{}',
    },
    suspectState: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: '{}',
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE
}, {
    sequelize,
    tableName: 'MMGames',
    timestamps: true
});

UserProfile.init({
    userId: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
    },
    guildId: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
    },
    profile: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    messageCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    lastUpdated: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    }
}, {
    sequelize,
    tableName: 'UserProfiles',
    timestamps: false
});

BotState.init({
    key: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
    },
    value: {
        type: DataTypes.TEXT,
        allowNull: false,
    }
}, {
    sequelize,
    tableName: 'BotState',
    timestamps: false
});

InterrogationCache.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    suspectId: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    question: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    embedding: {
        type: DataTypes.TEXT, // Storing as JSON string
        allowNull: false,
    },
    response: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    createdAt: DataTypes.DATE
}, {
    sequelize,
    tableName: 'InterrogationCache',
    timestamps: true,
    indexes: [
        {
            fields: ['suspectId']
        }
    ]
});

InterrogationLog.init({
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    caseId: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    suspectId: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    question: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    response: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    composureLost: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0,
    },
    secretRevealed: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    createdAt: DataTypes.DATE
}, {
    sequelize,
    tableName: 'InterrogationLogs',
    timestamps: true,
    updatedAt: false,
    indexes: [
        { fields: ['caseId'] },
        { fields: ['suspectId'] },
        { fields: ['userId'] }
    ]
});

export async function initializeDatabase() {
    try {
        await sequelize.authenticate();
        logger.info('Connection to database has been established successfully.');

        // Sync models
        if (process.env.NODE_ENV !== 'production') {
            await sequelize.sync();
            // Manually add column if it doesn't exist (SQLite migration workaround)
            try {
                await sequelize.query('ALTER TABLE Servers ADD COLUMN tips_enabled BOOLEAN NOT NULL DEFAULT 0;');
                logger.info('Added tips_enabled column to Servers table.');
            } catch (e) { /* ignore */ }

            try {
                await sequelize.query('ALTER TABLE Servers ADD COLUMN language VARCHAR(255);');
                logger.info('Added language column to Servers table.');
            } catch (e) { /* ignore */ }

            // MMGames migration helper
            const mmColumns = [
                ['discoveredEvidence', "TEXT DEFAULT '[]'"],
                ['discoveredLocations', "TEXT DEFAULT '[]'"],
                ['playerStats', "TEXT DEFAULT '{}'"],
                ['accusations', "TEXT DEFAULT '{}'"],
                ['suspectState', "TEXT DEFAULT '{}'"]
            ];

            for (const [col, def] of mmColumns) {
                try {
                    await sequelize.query(`ALTER TABLE MMGames ADD COLUMN ${col} ${def};`);
                    logger.info(`Added ${col} column to MMGames table.`);
                } catch (e) { /* ignore */ }
            }

            logger.info('Database models synced.');

            // Ensure InterrogationCache and Logs tables exist (sync should handle it, but for safety in dev)
            await InterrogationCache.sync();
            await InterrogationLog.sync();
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
