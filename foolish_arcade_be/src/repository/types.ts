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
    duration: number; // game duration in seconds
    health: number;
    createdAt: string; // ISO 8601 format
    proofState: ProofState;
}

export interface GameSubmissionData {
    user: string;
    score: number;
    frames: number; // from game, in frames
    health: number;
    seed: number;
    max_frames: number;
    game_mode: number;
    serialized_events: string;
}

export interface IRepository {
    emitter: EventEmitter;
    getUser(address: string): Promise<User | undefined>;
    getOrCreateUser(address: string): Promise<User>;
    updateUserNonce(address: string): Promise<User>;
    addLeaderboardEntry(entryData: GameSubmissionData): Promise<LeaderboardEntry>;
    getLeaderboard(page: number, limit: number): Promise<{ total: number; data: { entry: LeaderboardEntry, position: number }[] }>;
    getLeaderboardEntry(id: string): Promise<{ entry: LeaderboardEntry; position: number } | undefined>;
    updateLeaderboardEntry(id: string, updates: { proofState: ProofState }): Promise<LeaderboardEntry | undefined>;
    getLeaderboardEntryNeighbors(id: string, before: number, after: number): Promise<{ entry: LeaderboardEntry, position: number }[] | undefined>;
}
