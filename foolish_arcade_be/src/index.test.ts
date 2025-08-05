import request from 'supertest';
import { Application } from 'express';
import { createApp } from '../src/index';
import { InMemoryRepository } from '../src/repository/inMemoryRepository';
import { ethers } from 'ethers';

describe('Leaderboard API', () => {
    let app: Application;
    let repository: InMemoryRepository;
    let wallet: any; // Use 'any' to bypass strict type checking for the wallet object
    let token: string;

    beforeEach(async () => {
        repository = new InMemoryRepository();
        app = createApp(repository);
        wallet = ethers.Wallet.createRandom();

        // Perform secure login to get a token for other tests
        const challengeResponse = await request(app).get(`/challenge?address=${wallet.address}`);
        const message = challengeResponse.body.message;
        const signature = await wallet.signMessage(message);

        const loginResponse = await request(app)
            .post('/login')
            .send({ address: wallet.address, signature });
        token = loginResponse.body.token;
    });

    describe('Authentication', () => {
        it('GET /challenge should return a challenge message', async () => {
            const testWallet = ethers.Wallet.createRandom();
            const response = await request(app).get(`/challenge?address=${testWallet.address}`);
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message');
            expect(response.body.message).toContain('Please sign this message to log in. Nonce:');
        });

        it('POST /login should return a JWT for a valid signature', async () => {
            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
        });

        it('POST /login should return 401 for an invalid signature', async () => {
            const challengeResponse = await request(app).get(`/challenge?address=${wallet.address}`);
            const message = challengeResponse.body.message;
            const signature = await wallet.signMessage(message + 'tampering'); // Invalid signature

            const response = await request(app)
                .post('/login')
                .send({ address: wallet.address, signature });

            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty('error', 'Invalid signature');
        });

        it('POST /login should fail if the same signature is used twice (replay attack)', async () => {
            // The first login in `beforeEach` was successful and updated the nonce.
            // Now, we'll try to log in again with the *same* signature.

            // To do this, we need to re-create the original challenge message and signature.
            const user = await repository.getUser(wallet.address);
            // The current nonce in the DB is the *new* one. The one used for the first signature was one less.
            const originalNonce = user!.nonce - 1; 
            const originalMessage = `Please sign this message to log in. Nonce: ${originalNonce}`;
            const originalSignature = await wallet.signMessage(originalMessage);

            // Attempt to log in again with the original signature.
            const response = await request(app)
                .post('/login')
                .send({ address: wallet.address, signature: originalSignature });

            // The server will try to verify `originalSignature` against a message containing the *new* nonce,
            // so the verification will fail.
            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty('error', 'Invalid signature');
        });
    });

    describe('POST /submit_game', () => {
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

    describe('GET /leaderboard', () => {
        it('should return the leaderboard with the submitted score', async () => {
            // Submit a score first
            const gameData = { score: 9999, time: 1234, health: 100 };
            await request(app).post('/submit_game').set('Authorization', `Bearer ${token}`).send({ gameData });

            const response = await request(app).get('/leaderboard');

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].user).toBe(wallet.address);
            expect(response.body.data[0].score).toBe(9999);
        });
    });
});
