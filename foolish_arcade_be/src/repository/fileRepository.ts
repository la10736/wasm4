import { promises as fs } from 'fs';
import path from 'path';
import { IRepository, User, LeaderboardEntry } from './types';

const DB_PATH = path.join(__dirname, '../../db.json');

interface DbData {
    users: { [key: string]: User };
    leaderboard: LeaderboardEntry[];
}

export class FileRepository implements IRepository {
    private data: DbData = { users: {}, leaderboard: [] };
    private initialization: Promise<void>;

    constructor() {
        this.initialization = this.loadData();
    }

    private async loadData(): Promise<void> {
        try {
            const fileContent = await fs.readFile(DB_PATH, 'utf-8');
            this.data = JSON.parse(fileContent);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, initialize with empty data and save it.
                await this.saveData();
            } else {
                // For any other error, re-throw it to be caught by the caller.
                console.error('Error loading database:', error);
                throw error;
            }
        }
    }

    private async saveData(): Promise<void> {
        await fs.writeFile(DB_PATH, JSON.stringify(this.data, null, 2));
    }

    async getUser(address: string): Promise<User | undefined> {
        await this.initialization;
        return this.data.users[address];
    }

    async getOrCreateUser(address: string): Promise<User> {
        await this.initialization;
        let user = this.data.users[address];
        if (!user) {
            user = { address, nonce: Math.floor(Math.random() * 1000000) };
            this.data.users[address] = user;
            await this.saveData();
        }
        return user;
    }

    async addLeaderboardEntry(entry: LeaderboardEntry): Promise<void> {
        await this.initialization;
        this.data.leaderboard.push(entry);
        this.data.leaderboard.sort((a, b) => b.score - a.score);
        await this.saveData();
    }

    async getLeaderboard(page: number, limit: number): Promise<{ total: number; data: LeaderboardEntry[]; }> {
        await this.initialization;
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const data = this.data.leaderboard.slice(startIndex, endIndex);
        return { total: this.data.leaderboard.length, data };
    }
}
