import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { IRepository, LeaderboardEntry, User, GameSubmissionData, ProofState } from './repository/types';
import { InMemoryRepository } from './repository/inMemoryRepository';

const JWT_SECRET = 'your-super-secret-key'; // In a real app, use an environment variable

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
            const token = jwt.sign({ address: updatedUser.address }, JWT_SECRET, { expiresIn: '1h' });
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

        jwt.verify(token, JWT_SECRET, (err: any, payload: any) => {
            if (err) return res.sendStatus(403);
            (req as any).user = payload;
            next();
        });
    };

    // 2. Submit a game result
    app.post('/submit_game', authenticateToken, async (req: Request, res: Response) => {
        const { score, time, health } = req.body;
        const user = (req as any).user;

        if (score === undefined || time === undefined || health === undefined) {
            return res.status(400).json({ error: 'Game data must include score, time, and health' });
        }

        try {
            const entryData: GameSubmissionData = {
                user: user.address,
                score: score,
                time: time, // time is in frames
                health: health,
            };
            const newEntry = await repository.addLeaderboardEntry(entryData);
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
        const before = parseInt(req.query.before as string) || 0;
        const after = parseInt(req.query.after as string) || 0;

        try {
            // If no ID, return top N entries
            const limit = before + after;
            const leaderboard = await repository.getLeaderboard(1, limit);
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
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;

        try {
            const result = await repository.getLeaderboard(page, limit);
            res.json({
                page,
                limit,
                total: result.total,
                data: result.data
            });
        } catch (error) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return app;
}

if (require.main === module) {
    const port = process.env.PORT || 3000;
    const repository = new InMemoryRepository();
    const app = createApp(repository);
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}
