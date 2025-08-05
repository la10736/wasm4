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

    constructor() {
        this.loadData().catch(err => console.error('Failed to load database:', err));
    }

    private async loadData(): Promise<void> {
        try {
            const fileContent = await fs.readFile(DB_PATH, 'utf-8');
            this.data = JSON.parse(fileContent);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, initialize with empty data
                await this.saveData();
            } else {
                throw error;
            }
        }
    }

    private async saveData(): Promise<void> {
        await fs.writeFile(DB_PATH, JSON.stringify(this.data, null, 2));
    }

    async getUser(address: string): Promise<User | undefined> {
        return this.data.users[address];
    }

    async getOrCreateUser(address: string): Promise<User> {
        let user = await this.getUser(address);
        if (!user) {
            user = { address, nonce: Math.floor(Math.random() * 1000000) };
            this.data.users[address] = user;
            await this.saveData();
        }
        return user;
    }

    async addLeaderboardEntry(entry: LeaderboardEntry): Promise<void> {
        this.data.leaderboard.push(entry);
        this.data.leaderboard.sort((a, b) => b.score - a.score);
        await this.saveData();
    }

    async getLeaderboard(page: number, limit: number): Promise<{ total: number; data: LeaderboardEntry[]; }> {
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const data = this.data.leaderboard.slice(startIndex, endIndex);
        return { total: this.data.leaderboard.length, data };
    }
}
