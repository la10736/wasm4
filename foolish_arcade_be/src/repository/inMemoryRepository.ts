import { IRepository, User, LeaderboardEntry } from './types';

export class InMemoryRepository implements IRepository {
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

    async addLeaderboardEntry(entry: LeaderboardEntry): Promise<void> {
        this.leaderboard.push(entry);
        this.leaderboard.sort((a, b) => b.score - a.score);
    }

    async getLeaderboard(page: number, limit: number): Promise<{ total: number; data: LeaderboardEntry[]; }> {
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const data = this.leaderboard.slice(startIndex, endIndex);
        return { total: this.leaderboard.length, data };
    }

    // Helper method for tests to clear data
    public clear(): void {
        this.users = {};
        this.leaderboard = [];
    }
}
