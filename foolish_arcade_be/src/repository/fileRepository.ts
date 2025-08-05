import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { IRepository, User, LeaderboardEntry } from './types';

const DB_PATH = path.join(__dirname, '../../db.json');

interface DbData {
    users: { [key: string]: User };
    leaderboard: LeaderboardEntry[];
}

export class FileRepository implements IRepository {
    public emitter = new EventEmitter();
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

    async updateUserNonce(address: string): Promise<User> {
        await this.initialization;
        const user = this.data.users[address];
        if (!user) {
            throw new Error('User not found');
        }
        user.nonce = Math.floor(Math.random() * 1000000);
        this.data.users[address] = user;
        await this.saveData();
        return user;
    }

    async addLeaderboardEntry(entry: Omit<LeaderboardEntry, 'id' | 'createdAt' | 'proofState'>): Promise<LeaderboardEntry> {
        await this.initialization;
        const newEntry: LeaderboardEntry = {
            id: randomUUID(),
            ...entry,
            createdAt: new Date().toISOString(),
            proofState: 'inserted',
        };
        this.data.leaderboard.push(newEntry);
        this.data.leaderboard.sort((a, b) => b.score - a.score);
        await this.saveData();

        const position = this.data.leaderboard.findIndex(e => e.id === newEntry.id) + 1;
        this.emitter.emit('update', { entry: newEntry, position });

        return newEntry;
    }

    async getLeaderboard(page: number, limit: number): Promise<{ total: number; data: LeaderboardEntry[]; }> {
        await this.initialization;
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const data = this.data.leaderboard.slice(startIndex, endIndex);
        return { total: this.data.leaderboard.length, data };
    }

    async getLeaderboardEntry(id: string): Promise<{ entry: LeaderboardEntry; position: number } | undefined> {
        await this.initialization;
        const entry = this.data.leaderboard.find(e => e.id === id);
        if (!entry) {
            return undefined;
        }
        const position = this.data.leaderboard.findIndex(e => e.id === id) + 1;
        return { entry, position };
    }

    async updateLeaderboardEntry(id: string, updates: Partial<Omit<LeaderboardEntry, 'id'>>): Promise<LeaderboardEntry | undefined> {
        await this.initialization;
        const entryIndex = this.data.leaderboard.findIndex(e => e.id === id);
        if (entryIndex === -1) {
            return undefined;
        }

        const updatedEntry = { ...this.data.leaderboard[entryIndex], ...updates };
        this.data.leaderboard[entryIndex] = updatedEntry;

        if (updates.score !== undefined) {
            this.data.leaderboard.sort((a, b) => b.score - a.score);
        }

        await this.saveData();

        const newPosition = this.data.leaderboard.findIndex(e => e.id === id) + 1;
        this.emitter.emit('update', { entry: updatedEntry, position: newPosition });

        return updatedEntry;
    }
}
