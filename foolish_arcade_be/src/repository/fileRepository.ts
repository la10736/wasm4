import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { IRepository, User, LeaderboardEntry, ProofState, GameSubmissionData } from './types';

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
        console.info(`Saving data to ${DB_PATH}`)
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

    async addLeaderboardEntry(entryData: GameSubmissionData): Promise<LeaderboardEntry> {
        await this.initialization;
        console.info(`Adding leaderboard entry ${JSON.stringify(entryData)}`)
        const newEntry: LeaderboardEntry = {
            id: randomUUID(),
            user: entryData.user,
            score: entryData.score,
            duration: entryData.frames / 10.0, // Game is 10fps, so this is seconds
            health: entryData.health,
            createdAt: new Date().toISOString(),
            proofState: 'inserted',
            game_seed: entryData.seed,
            events_serialized: entryData.serialized_events,
            max_frames: entryData.max_frames,
        };
        this.data.leaderboard.push(newEntry);
        this.data.leaderboard.sort((a, b) => b.score - a.score);
        await this.saveData();

        return newEntry;
    }

    async getLeaderboard(startIndex: number, endIndex: number): Promise<{ total: number; data: { entry: LeaderboardEntry, position: number }[] }> {
        await this.initialization;
        const slicedData = this.data.leaderboard.slice(startIndex, endIndex);
        const dataWithPosition = slicedData.map((entry, index) => ({
            entry,
            position: startIndex + index + 1,
        }));
        return { total: this.data.leaderboard.length, data: dataWithPosition };
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

    async updateLeaderboardEntry(id: string, updates: { proofState: ProofState }): Promise<LeaderboardEntry | undefined> {
        await this.initialization;

        const entry = this.data.leaderboard.find(e => e.id === id);
        if (!entry) {
            return undefined;
        }
        entry.proofState = updates.proofState;

        await this.saveData();
        this.emitter.emit('update', { id, proofState: entry.proofState });

        return entry;
    }

    async getLeaderboardEntryNeighbors(id: string, before: number, after: number): Promise<{ entry: LeaderboardEntry, position: number }[] | undefined> {
        await this.initialization;
        const targetIndex = this.data.leaderboard.findIndex(e => e.id === id);

        if (targetIndex === -1) {
            return undefined;
        }

        const totalEntries = this.data.leaderboard.length;
        let startIndex = Math.max(0, targetIndex - before);
        let endIndex = Math.min(totalEntries, targetIndex + after + 1);

        const missingBefore = before - (targetIndex - startIndex);
        if (missingBefore > 0) {
            endIndex = Math.min(totalEntries, endIndex + missingBefore);
        }

        const missingAfter = after - (endIndex - (targetIndex + 1));
        if (missingAfter > 0) {
            startIndex = Math.max(0, startIndex - missingAfter);
        }

        const slicedData = this.data.leaderboard.slice(startIndex, endIndex);
        return slicedData.map((entry, index) => ({
            entry,
            position: startIndex + index + 1,
        }));
    }
}
