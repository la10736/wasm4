export interface User {
    address: string;
    nonce: number;
}

export interface LeaderboardEntry {
    user: string;
    score: number;
    time: number;
    health: number;
}

export interface IRepository {
    getUser(address: string): Promise<User | undefined>;
    getOrCreateUser(address: string): Promise<User>;
    addLeaderboardEntry(entry: LeaderboardEntry): Promise<void>;
    getLeaderboard(page: number, limit: number): Promise<{ total: number, data: LeaderboardEntry[] }>;
}
