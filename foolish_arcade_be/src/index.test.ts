import request from 'supertest';
import { Application } from 'express';
import { createApp } from '../src/index';
import { InMemoryRepository } from '../src/repository/inMemoryRepository';
import { LeaderboardEntry } from '../src/repository/types';
import { ethers } from 'ethers';

describe('Leaderboard API', () => {
    let app: Application;
    let repository: InMemoryRepository;
    let wallet: any; // Use 'any' to bypass strict type checking for the wallet object
    let token: string;

    beforeEach(async () => {
        repository = new InMemoryRepository();
        // Clear the repository before each test to ensure isolation
        repository.clear(); 
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
            const submissionData = { score: 9999, time: 1234, health: 100 };
            const response = await request(app)
                .post('/submit_game')
                .set('Authorization', `Bearer ${token}`)
                .send(submissionData);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message', 'Game data submitted successfully');
        });
    });

    describe('GET /leaderboard', () => {
        it('should return the leaderboard with the submitted score', async () => {
            // Submit a score first
            const submissionData = { score: 9999, time: 1234, health: 100 };
            await request(app).post('/submit_game').set('Authorization', `Bearer ${token}`).send(submissionData);

            const response = await request(app).get('/leaderboard');

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            expect(response.body.data[0].entry.user).toBe(wallet.address);
            expect(response.body.data[0].entry.score).toBe(9999);
        });
    });

    describe('GET /leaderboard/neighbors/:id?', () => {
        const mockEntriesData: Omit<LeaderboardEntry, 'id' | 'createdAt' | 'proofState'>[] = Array.from({ length: 20 }, (_, i) => ({
            user: `user-${i + 1}`,
            score: 1000 - i * 10,
            time: 120 + i,
            health: 100 - i,
        }));
        let createdEntries: LeaderboardEntry[] = [];

        beforeEach(async () => {
            // Populate the repository with mock data
            createdEntries = [];
            for (const entryData of mockEntriesData) {
                const newEntry = await repository.addLeaderboardEntry(entryData);
                createdEntries.push(newEntry);
            }
        });

        it('should return top N entries when no ID is provided', async () => {
            const limit = 10;
            const response = await request(app).get(`/leaderboard/neighbors?before=5&after=4`); // before+after+1 = 10

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(limit);
            expect(response.body[0].entry.score).toBe(1000); // Highest score
            expect(response.body[9].entry.score).toBe(1000 - 9 * 10); // 10th highest score
        });

        it('should return neighbors for a given ID', async () => {
            const targetEntry = createdEntries[9]; // 10th entry, score 910
            const response = await request(app).get(`/leaderboard/neighbors/${targetEntry.id}?before=5&after=5`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(11);
            // The 10th entry should be the 6th item in the response (5 before, 1 self, 5 after)
            expect(response.body[5].entry.id).toBe(targetEntry.id);
            expect(response.body[0].entry.score).toBe(1000 - 4 * 10); // 5th entry's score
        });

        it('should return 404 if the entry ID is not found', async () => {
            const nonExistentId = 'id-999';
            const response = await request(app).get(`/leaderboard/neighbors/${nonExistentId}`);

            expect(response.status).toBe(404);
            expect(response.body.error).toBe('Leaderboard entry not found');
        });
    });

    describe('GET /leaderboard/subscribe', () => {
        it('should stream updates when a leaderboard entry proofState changes', (done) => {
            // Use a live instance of the app for SSE testing
            const liveApp = createApp(repository);
            const server = liveApp.listen(0); // Listen on a random free port
            const address = server.address();
            const port = typeof address === 'string' ? 0 : address?.port;

            let entryToUpdate: LeaderboardEntry;

            // 1. Add an entry to have something to update
            repository.addLeaderboardEntry({
                user: 'sse-user',
                score: 123,
                time: 45,
                health: 67
            }).then(newEntry => {
                entryToUpdate = newEntry;

                // 2. Connect to the SSE endpoint
                const req = request(server).get('/leaderboard/subscribe');

                req.on('response', (res) => {
                    res.on('data', (chunk: Buffer) => {
                        const data = chunk.toString();
                        if (data.includes('event: leaderboardUpdate')) {
                            const jsonData = data.split('\n')[1].replace('data: ', '');
                            const parsedData = JSON.parse(jsonData);
                            
                            // 4. Assert the received data is correct
                            expect(parsedData.id).toBe(entryToUpdate.id);
                            expect(parsedData.proofState).toBe('proved');
                            
                            server.close(); // Clean up the server
                            done(); // Finish the test
                        }
                    });
                });

                req.end();

                // 3. Trigger an update after a short delay
                setTimeout(() => {
                    repository.updateLeaderboardEntry(entryToUpdate.id, { proofState: 'proved' });
                }, 100);
            });
        }, 1000); // Increase timeout for async SSE test
    });
});
