import request from 'supertest';
import { Application } from 'express';
import { createApp } from '../src/index';
import { InMemoryRepository } from '../src/repository/inMemoryRepository';

describe('Leaderboard API', () => {
    let app: Application;
    let repository: InMemoryRepository;
    const testAddress = '0x1234567890123456789012345678901234567890';
    let token: string;

    beforeEach(async () => {
        repository = new InMemoryRepository();
        app = createApp(repository);

        // Get a token before running tests that need it
        const response = await request(app)
            .post('/login')
            .send({ address: testAddress });
        token = response.body.token;
    });

    // Test the /login endpoint
    describe('POST /login', () => {
        it('should return a JWT token for a valid address', async () => {
            const response = await request(app)
                .post('/login')
                .send({ address: '0x0987654321098765432109876543210987654321' });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('token');
        });

        it('should return a 400 error if address is not provided', async () => {
            const response = await request(app)
                .post('/login')
                .send({});

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Ethereum address is required');
        });
    });

    // Test the /submit_game endpoint
    describe('POST /submit_game', () => {
        it('should return a 401 error if no token is provided', async () => {
            const response = await request(app)
                .post('/submit_game')
                .send({ gameData: { score: 100, time: 10, health: 100 } });

            expect(response.status).toBe(401);
        });

        it('should return a 400 error if gameData is incomplete', async () => {
            const response = await request(app)
                .post('/submit_game')
                .set('Authorization', `Bearer ${token}`)
                .send({ gameData: { score: 100 } });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Game data must include score, time, and health');
        });

        it('should return a 200 success message for a valid submission', async () => {
            const gameData = { score: 9999, time: 1234, health: 100 };
            const response = await request(app)
                .post('/submit_game')
                .set('Authorization', `Bearer ${token}`)
                .send({ gameData });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message', 'Game data submitted successfully');
        });
    });

    // Test the /leaderboard endpoint
    describe('GET /leaderboard', () => {
        beforeEach(async () => {
            // Submit a score to have data in the leaderboard
            const gameData = { score: 9999, time: 1234, health: 100 };
            await request(app)
                .post('/submit_game')
                .set('Authorization', `Bearer ${token}`)
                .send({ gameData });
        });

        it('should return the leaderboard with the submitted score', async () => {
            const response = await request(app).get('/leaderboard');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].user).toBe(testAddress);
            expect(response.body.data[0].score).toBe(9999);
            expect(response.body.data[0].time).toBe(1234);
            expect(response.body.data[0].health).toBe(100);
        });

        it('should handle pagination correctly', async () => {
            // Add a few more scores
            await request(app).post('/submit_game').set('Authorization', `Bearer ${token}`).send({ gameData: { score: 100, time: 50, health: 80 } });
            await request(app).post('/submit_game').set('Authorization', `Bearer ${token}`).send({ gameData: { score: 200, time: 60, health: 90 } });

            const response = await request(app).get('/leaderboard?page=1&limit=2');

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(2);
            expect(response.body.total).toBe(3);
            expect(response.body.data[0].score).toBe(9999); // Check sorting
        });
    });
});
