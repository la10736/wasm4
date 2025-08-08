import * as dotenv from 'dotenv';
dotenv.config();

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { IRepository, LeaderboardEntry, User, GameSubmissionData, ProofState, Settled } from './repository/types';
import { FileRepository } from './repository/fileRepository';
import { randomInt } from 'crypto';
import axios from 'axios';
import * as z85 from "./z85";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET is not defined in the .env file.");
    process.exit(1);
}

const RELAYER_API_KEY = process.env.RELAYER_API_KEY;
if (!RELAYER_API_KEY) {
    console.error("FATAL ERROR: RELAYER_API_KEY is not defined in the .env file.");
    process.exit(1);
}

const RELAYER_API_URL = process.env.RELAYER_API_URL || 'https://relayer-api.horizenlabs.io/api/v1';

const PROVER_JSON_RPC_URL = process.env.PROVER_JSON_RPC_URL || 'http://localhost:3030';

const VK = process.env.VK || '0xdceecd6f862080881919186844e86400f4c6772c0e21a9ebdf76c7ff947772af';

export function createApp(repository: IRepository) {
    const app: Application = express();
    app.use(cors()); // Allow all origins for local development
    app.use(express.json()); // Middleware to parse JSON bodies

    // 1a. Get challenge message
    app.get('/challenge', async (req: Request, res: Response) => {
        const { address } = req.query;
        if (!address || typeof address !== 'string') {
            return res.status(400).json({ error: 'Ethereum address is required' });
        }

        try {
            const user = await repository.getOrCreateUser(address);
            const message = `Please sign this message to log in. Nonce: ${user.nonce}`;
            res.json({ message });
        } catch (error) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // 1b. Login with signed message
    app.post('/login', async (req: Request, res: Response) => {
        const { address, signature } = req.body;
        if (!address || !signature) {
            return res.status(400).json({ error: 'Ethereum address and signature are required' });
        }

        try {
            const user = await repository.getUser(address);
            if (!user) {
                return res.status(401).json({ error: 'User not found. Please request a challenge first.' });
            }

            const message = `Please sign this message to log in. Nonce: ${user.nonce}`;
            const recoveredAddress = ethers.verifyMessage(message, signature);

            if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
                return res.status(401).json({ error: 'Invalid signature' });
            }

            // Signature is valid, update nonce and issue token
            const updatedUser = await repository.updateUserNonce(address);
            const token = jwt.sign({ address: updatedUser.address }, JWT_SECRET!, { expiresIn: '1h' });
            res.json({ token });

        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Middleware to verify JWT
    const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (token == null) return res.sendStatus(401);

        jwt.verify(token, JWT_SECRET!, (err: any, payload: any) => {
            if (err) return res.sendStatus(403);
            (req as any).user = payload;
            next();
        });
    };

    // 2. Submit a game result
    app.post('/submit_game', authenticateToken, async (req: Request, res: Response) => {
        const { score, frames, health, seed, max_frames, game_mode, serialized_events } = req.body;
        const user = (req as any).user;

        if (score === undefined || frames === undefined || health === undefined || seed === undefined || max_frames === undefined || game_mode === undefined || serialized_events === undefined) {
            return res.status(400).json({ error: 'Game data must include score, frames, health, seed, max_frames, game_mode, and serialized_events' });
        }

        try {
            const entryData: GameSubmissionData = {
                user: user.address,
                score: score,
                frames: frames,
                health: health,
                seed: seed,
                max_frames: max_frames,
                game_mode: game_mode,
                serialized_events: serialized_events,
            };
            const newEntry = await repository.addLeaderboardEntry(entryData);
            console.info(`Added leaderboard entry ${JSON.stringify(newEntry)}`)

            // Start the proof generation process asynchronously
            processGame(entryData, newEntry.id, repository);

            res.json({ message: 'Game data submitted successfully', entryId: newEntry.id });
        } catch (error) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // 3. Get leaderboard
    // 4. Get leaderboard entry neighbours
    app.get('/leaderboard/neighbors/:id', async (req: Request, res: Response) => {
        const { id } = req.params;
        const before = parseInt(req.query.before as string) || 0;
        const after = parseInt(req.query.after as string) || 0;

        try {
            const neighbors = await repository.getLeaderboardEntryNeighbors(id, before, after);
            if (!neighbors) {
                return res.status(404).json({ error: 'Leaderboard entry not found' });
            }
            res.json(neighbors);
        } catch (error) {
            console.error('Failed to get leaderboard neighbors:', error);
            res.status(500).json({ error: 'Failed to get leaderboard neighbors' });
        }
    });

    app.get('/leaderboard/neighbors', async (req: Request, res: Response) => {
        const limit = parseInt(req.query.after as string) || 10;

        try {
            // If no ID, return top N entries
            const leaderboard = await repository.getLeaderboard(0, limit);
            console.info(`Fetched leaderboard ${JSON.stringify(leaderboard)}`)
            res.json(leaderboard.data);
        } catch (error) {
            console.error('Failed to get leaderboard neighbors:', error);
            res.status(500).json({ error: 'Failed to get leaderboard neighbors' });
        }
    });

    // 5. Subscribe to leaderboard entry changes
    app.get('/leaderboard/subscribe/:id', async (req: Request, res: Response) => {
        const { id } = req.params;

        res.setHeader("Transfer-Encoding", "chunked")
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        await res.flushHeaders();

        const sendUpdate = (data: any) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        const onUpdate = (data: { id: string, state: ProofState }) => {
            if (data.id === id) {
                sendUpdate(data);
            }
        };

        // Immediately send the current state
        try {
            const initialState = await repository.getLeaderboardEntry(id);
            if (initialState) {
                sendUpdate(initialState);
            }
        } catch (error) {
            console.error('Failed to get initial state for subscription', error);
        }

        repository.emitter.on('update', onUpdate);

        req.on('close', () => {
            repository.emitter.off('update', onUpdate);
            res.end();
        });
    });

    app.get('/leaderboard', async (req: Request, res: Response) => {
        const startIndex = parseInt(req.query.startIndex as string) || 0;
        const endIndex = parseInt(req.query.endIndex as string) || 10;

        try {
            const result = await repository.getLeaderboard(startIndex, endIndex);
            res.json({
                startIndex,
                endIndex,
                total: result.total,
                data: result.data
            });
        } catch (error) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return app;
}

interface ProofData {
    bin_proof: Uint8Array,
    bin_pubs: Uint8Array,
    address: Uint8Array,
    frames: number,
    score: number,
    health: number,
}

async function processGame(game: GameSubmissionData, leaderboard_id: string, repository: IRepository) {
    console.info(`Processing game for entry: ${leaderboard_id}`);
    try {
        const proofData = await requestProof(game, leaderboard_id, repository);
        await submitProof(proofData, leaderboard_id, repository);
    } catch (error) {
        console.error(`Failed to get proof for entry ${leaderboard_id}:`, error);
        // Optionally, update the state to 'failed'
        await repository.updateLeaderboardEntry(leaderboard_id, { proofState: 'failed' });
    }
}

async function submitProof(proofData: ProofData, leaderboard_id: string, repository: IRepository) {
    console.info(`Submitting proof for entry: ${leaderboard_id}`);
    const params = {
        "proofType": "risc0",
        "vkRegistered": false,
        "proofOptions": {
            "version": "V2_2"
        },
        "proofData": {
            "proof": `0x${Buffer.from(proofData.bin_proof).toString('hex')}`,
            "publicSignals": `0x${Buffer.from(proofData.bin_pubs).toString('hex')}`,
            "vk": VK
        }
    }
    const requestResponse = await axios.post(`${RELAYER_API_URL}/submit-proof/${RELAYER_API_KEY}`, params)
    console.info(`Proof submitted for entry: ${leaderboard_id}, response: ${JSON.stringify(requestResponse.data)}`)

    if (requestResponse.data.optimisticVerify != "success") {
        console.error("Proof verification, check proof artifacts");
        return;
    }

    while (true) {
        const jobStatusResponse = await axios.get(`${RELAYER_API_URL}/job-status/${RELAYER_API_KEY}/${requestResponse.data.jobId}`);
        if (jobStatusResponse.data.status === "Finalized") {
            console.info(`Job finalized successfully for entry: ${leaderboard_id} response: ${JSON.stringify(jobStatusResponse.data)}`);
            await repository.updateLeaderboardEntry(leaderboard_id, { proofState: {
                blockHash: jobStatusResponse.data.blockHash,
                txHash: jobStatusResponse.data.txHash
            } as Settled });
            break;
        } else {
            console.info(`Job status: ${jobStatusResponse.data.status} for entry: ${leaderboard_id}`);
            console.info("Waiting for job to finalize...");
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds before checking again
        }
    }
}

async function requestProof(game: GameSubmissionData, leaderboard_id: string, repository: IRepository): Promise<ProofData> {
    // The address is already a string, which is fine for JSON
    // The events_serialized is also a string.
    // The user address is a hex string (e.g., "0x..."). It needs to be converted to a byte array.
    const addressBytes = Buffer.from(game.user.slice(2), 'hex');

    // The events_serialized is stored as a z58 string: we should decode it to a byte array.
    const buffer = new Uint8Array(game.serialized_events.length/5*4);
    z85.decode(game.serialized_events, buffer);
    const eventsArray = Array.from(buffer);

    const params = [
        Array.from(addressBytes), // Convert Buffer to a plain array
        game.seed,
        eventsArray,
        game.max_frames
    ];

    const id = randomInt(1, 1000000);

    const response = await fetch(PROVER_JSON_RPC_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'prove',
            params: params,
            id,
        }),
    });

    if (!response.ok) {
        throw new Error(`Prover service responded with status: ${response.status}`);
    }

    await repository.updateLeaderboardEntry(leaderboard_id, { proofState: 'proving' });
    const result = await response.json();
    if (result.error) {
        throw new Error(`Prover service error: ${result.error.message}`);
    } else if (result.id !== id) {
        throw new Error(`Prover service error: ODD ID ${result.id} != ${id}`);
    } else if (result.result) {
        const proofData: ProofData = result.result;
        console.info(`Proof received for entry: ${leaderboard_id}, updating state.`);
        await repository.updateLeaderboardEntry(leaderboard_id, { proofState: 'proved' });
        return proofData;
    } else {
        throw new Error(`Prover service error: Malformed response neither error nor result`);
    }

}

if (require.main === module) {
    const port = process.env.PORT || 3000;
    const repository = new FileRepository();
    const app = createApp(repository);
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}
