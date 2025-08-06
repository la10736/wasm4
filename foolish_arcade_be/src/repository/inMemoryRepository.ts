import { IRepository, User, LeaderboardEntry, ProofState, GameSubmissionData } from './types';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export class InMemoryRepository implements IRepository {
    public emitter = new EventEmitter();
    private users: { [key: string]: User } = {};
    private leaderboard: LeaderboardEntry[] = [];

    async getUser(address: string): Promise<User | undefined> {
        return this.users[address];
    }

    async getOrCreateUser(address: string): Promise<User> {
        let user = await this.getUser(address);
        if (!user) {
            user = { address, nonce: Math.floor(Math.random() * 1000000) };
            this.users[address] = user;
        }
        return user;
    }

    async updateUserNonce(address: string): Promise<User> {
        const user = this.users[address];
        if (!user) {
            throw new Error('User not found');
        }
        user.nonce = Math.floor(Math.random() * 1000000);
        this.users[address] = user;
        return user;
    }

    async addLeaderboardEntry(entryData: GameSubmissionData): Promise<LeaderboardEntry> {
        const newEntry: LeaderboardEntry = {
            id: randomUUID(),
            user: entryData.user,
            score: entryData.score,
            duration: entryData.time / 10, // Game is 10fps
            health: entryData.health,
            createdAt: new Date().toISOString(),
            proofState: 'inserted',
        };
        this.leaderboard.push(newEntry);
        this.leaderboard.sort((a, b) => b.score - a.score); // Sort by score descending
        return newEntry;
    }

    async getLeaderboard(page: number, limit: number): Promise<{ total: number; data: { entry: LeaderboardEntry, position: number }[] }> {
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const slicedData = this.leaderboard.slice(startIndex, endIndex);
        const dataWithPosition = slicedData.map((entry, index) => ({
            entry,
            position: startIndex + index + 1,
        }));
        return { total: this.leaderboard.length, data: dataWithPosition };
    }

    async getLeaderboardEntry(id: string): Promise<{ entry: LeaderboardEntry; position: number } | undefined> {
        const position = this.leaderboard.findIndex(e => e.id === id);
        if (position === -1) {
            return undefined;
        }
        return { entry: this.leaderboard[position], position: position + 1 };
    }

    async updateLeaderboardEntry(id: string, updates: { proofState: ProofState }): Promise<LeaderboardEntry | undefined> {
        console.info(`Updating entry ${id} to proofState ${updates.proofState}}`);
        const entry = this.leaderboard.find(e => e.id === id);
        if (!entry) {
            return undefined;
        }
        entry.proofState = updates.proofState;
        this.emitter.emit('leaderboardUpdate', { id, proofState: entry.proofState });
        console.info(`Updated entry ${id} to proofState ${entry.proofState}`);
        return entry;
    }

    async getLeaderboardEntryNeighbors(id: string, before: number, after: number): Promise<{ entry: LeaderboardEntry, position: number }[] | undefined> {
        const targetIndex = this.leaderboard.findIndex(e => e.id === id);
        if (targetIndex === -1) {
            return undefined;
        }

        const totalEntries = this.leaderboard.length;
        let startIndex = Math.max(0, targetIndex - before);
        let endIndex = Math.min(totalEntries, targetIndex + after + 1);

        // Adjust window if it's near the start or end
        const missingBefore = before - (targetIndex - startIndex);
        if (missingBefore > 0) {
            endIndex = Math.min(totalEntries, endIndex + missingBefore);
        }

        const missingAfter = after - (endIndex - (targetIndex + 1));
        if (missingAfter > 0) {
            startIndex = Math.max(0, startIndex - missingAfter);
        }

        const slicedData = this.leaderboard.slice(startIndex, endIndex);
        return slicedData.map((entry, index) => ({
            entry,
            position: startIndex + index + 1,
        }));
    }

    // Helper method for tests to clear data
    public clear(): void {
        this.users = {};
        this.leaderboard = [];
    }
}
