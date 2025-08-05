import { EventEmitter } from 'events';

export interface User {
    address: string;
    nonce: number;
}

export type ProofState = 'inserted' | 'proving' | 'proved' | 'failed';

export interface LeaderboardEntry {
    id: string;
    user: string;
    score: number;
    time: number;
    health: number;
    createdAt: string; // ISO 8601 format
    proofState: ProofState;
}

export interface IRepository {
    emitter: EventEmitter;
    getUser(address: string): Promise<User | undefined>;
    getOrCreateUser(address: string): Promise<User>;
    updateUserNonce(address: string): Promise<User>;
    addLeaderboardEntry(entry: Omit<LeaderboardEntry, 'id' | 'createdAt' | 'proofState'>): Promise<LeaderboardEntry>;
    getLeaderboard(page: number, limit: number): Promise<{ total: number; data: LeaderboardEntry[] }>;
    getLeaderboardEntry(id: string): Promise<{ entry: LeaderboardEntry; position: number } | undefined>;
    updateLeaderboardEntry(id: string, updates: Partial<Omit<LeaderboardEntry, 'id'>>): Promise<LeaderboardEntry | undefined>;
}
