import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import jwt from 'jsonwebtoken';
import { IRepository, LeaderboardEntry } from './repository/types';
import { FileRepository } from './repository/fileRepository';

const JWT_SECRET = 'your-super-secret-key'; // In a real app, use an environment variable

export function createApp(repository: IRepository) {
    const app = express();
    app.use(bodyParser.json());

    // 1. Login with Ethereum address
    app.post('/login', async (req: Request, res: Response) => {
        const { address } = req.body;
        if (!address) {
            return res.status(400).json({ error: 'Ethereum address is required' });
        }

        try {
            const user = await repository.getOrCreateUser(address);
            const token = jwt.sign({ address: user.address, nonce: user.nonce }, JWT_SECRET, { expiresIn: '1h' });
            res.json({ token });
        } catch (error) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Middleware to verify JWT
    const authenticateToken = (req: Request, res: Response, next: Function) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (token == null) return res.sendStatus(401);

        jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
            if (err) return res.sendStatus(403);
            (req as any).user = user;
            next();
        });
    };

    // 2. Submit a game result
    app.post('/submit_game', authenticateToken, async (req: Request, res: Response) => {
        const { gameData } = req.body;
        const user = (req as any).user;

        if (!gameData || gameData.score === undefined || gameData.time === undefined || gameData.health === undefined) {
            return res.status(400).json({ error: 'Game data must include score, time, and health' });
        }

        try {
            const newEntry: LeaderboardEntry = {
                user: user.address,
                score: gameData.score,
                time: gameData.time,
                health: gameData.health,
            };
            await repository.addLeaderboardEntry(newEntry);
            res.json({ message: 'Game data submitted successfully' });
        } catch (error) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // 3. Get leaderboard
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
    const port = 3000;
    const app = createApp(new FileRepository());
    app.listen(port, () => {
        console.log(`Leaderboard backend listening at http://localhost:${port}`);
    });
}
