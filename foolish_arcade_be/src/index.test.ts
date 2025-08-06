import request from 'supertest';
import { Application } from 'express';
import { createApp } from '../src/index';
import { InMemoryRepository } from '../src/repository/inMemoryRepository';
import { IRepository, LeaderboardEntry, User, GameSubmissionData } from '../src/repository/types';
import { ethers } from 'ethers';
import { assert, error } from 'console';

describe('Leaderboard API', () => {
    let app: Application;
    let repository: InMemoryRepository;
    let wallet: any; // Use 'any' to bypass strict type checking for the wallet object
    let token: string;

    beforeEach(async () => {
        repository = new InMemoryRepository();
        app = createApp(repository);
        wallet = ethers.Wallet.createRandom();

        // Perform a full login flow to get a valid token
        const user = await repository.getOrCreateUser(wallet.address);
        const message = `Please sign this message to log in. Nonce: ${user.nonce}`;
        const signature = await wallet.signMessage(message);

        const response = await request(app)
            .post('/login')
            .send({ address: wallet.address, signature });

        token = response.body.token;
    });


    describe('Authentication', () => {
        it('GET /challenge should return a challenge message', async () => {
            const response = await request(app).get(`/challenge?address=${wallet.address}`);
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message');
            const user = await repository.getUser(wallet.address);
            expect(response.body.message).toContain(`${user!.nonce}`);
        });

        it('POST /login should return a JWT for a valid signature', async () => {
            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
        });

        it('POST /login should return 401 for an invalid signature', async () => {
            const user = await repository.getUser(wallet.address);
            const message = `Please sign this message to log in. Nonce: ${user!.nonce}`;
            // Sign with a different wallet
            const invalidSignature = await ethers.Wallet.createRandom().signMessage(message);

            const response = await request(app)
                .post('/login')
                .send({ address: wallet.address, signature: invalidSignature });

            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty('error', 'Invalid signature');
        });

        it('POST /login should fail if the same signature is used twice (replay attack)', async () => {
            // The first login in beforeEach used the signature and invalidated the nonce.
            // Now, we try to log in again with the same signature.
            const user = await repository.getUser(wallet.address);
            const message = `Please sign this message to log in. Nonce: ${user!.nonce - 1}`; // Use the old nonce
            const signature = await wallet.signMessage(message);

            const response = await request(app)
                .post('/login')
                .send({ address: wallet.address, signature });

            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty('error', 'Invalid signature');
        });
    });

    describe('POST /submit_game', () => {
        it('should return a 200 success message for a valid submission', async () => {
            const submissionData = { score: 9999, frames: 1234, health: 100, seed: 123, max_frames: 123, game_mode: 1, serialized_events: 'some events' };
            const response = await request(app)
                .post('/submit_game')
                .set('Authorization', `Bearer ${token}`)
                .send(submissionData);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message', 'Game data submitted successfully');
            expect(response.body).toHaveProperty('entryId');
        });
    });

    describe('GET /leaderboard', () => {
        it('should return the leaderboard with the submitted score', async () => {
            const submissionData = { score: 9999, frames: 1234, health: 100, seed: 123, max_frames: 123, game_mode: 1, serialized_events: 'some events' }; // time is in frames
            await request(app)
                .post('/submit_game')
                .set('Authorization', `Bearer ${token}`)
                .send(submissionData);

            const response = await request(app).get('/leaderboard');

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBe(1);
            const entry = response.body.data[0].entry;
            expect(entry.user).toBe(wallet.address);
            expect(entry.score).toBe(9999);
            expect(entry.duration).toBe(123.4); // 1234 frames / 10 fps
        });
    });

    describe('GET /leaderboard/neighbors', () => {
        beforeEach(async () => {
            for (let i = 0; i < 10; i++) {
                const submission: GameSubmissionData = {
                    user: `test-user-${i}`,
                    score: 1000 - i * 10,
                    frames: (100 + i) * 10, // Store as frames
                    health: 100 - i,
                    seed: 10000 - i * 10,
                    max_frames: 10000 + i * 10,
                    game_mode: 1,
                    serialized_events: 'some events'
                };
                await repository.addLeaderboardEntry(submission);
            }
        });

        it('should return top N entries when no ID is provided', async () => {
            const response = await request(app).get('/leaderboard/neighbors?after=5');
            expect(response.status).toBe(200);
            expect(response.body.length).toBe(5);
            expect(response.body[0].entry.score).toBe(1000);
        });

        it('should return neighbors for a given ID', async () => {
            const allEntries = (await repository.getLeaderboard(1, 10)).data;
            const targetEntryId = allEntries[4].entry.id;

            const response = await request(app).get(`/leaderboard/neighbors/${targetEntryId}?before=2&after=2`);
            expect(response.status).toBe(200);
            expect(response.body.length).toBe(5);
            expect(response.body[2].entry.id).toBe(targetEntryId);
        });

        it('should return 404 if the entry ID is not found', async () => {
            const response = await request(app).get('/leaderboard/neighbors/non-existent-id');
            expect(response.status).toBe(404);
            expect(response.body.error).toBe('Leaderboard entry not found');
        });
    });
});

describe('Leaderboard SSE API', () => {
    let repository: InMemoryRepository;
    let app: Application;
    let server: ReturnType<typeof app.listen>;
    let controller = new AbortController();
    let signal = controller.signal;

    beforeEach(async () => {
        repository = new InMemoryRepository();
        app = createApp(repository);
        server = await app.listen(34565);
    });

    afterEach(async () => {
        controller.abort();
        await server.close();
    });

    it('should stream updates when an entry changes', async () => {
        let entryToUpdate = await repository.addLeaderboardEntry({
            user: 'sse-user',
            score: 123,
            frames: 45,
            health: 67,
            seed: 123,
            max_frames: 123,
            game_mode: 1,
            serialized_events: 'some events'
        });
        const res = await fetch(`http://localhost:34565/leaderboard/subscribe/${entryToUpdate.id}`, { signal });
        console.info(`Subscribed: send change`);
        // Trigger an update now that we are listening
        await repository.updateLeaderboardEntry(entryToUpdate.id, { proofState: 'proved' });
        let found = await processChunkedResponse(res, (text) => {
                    console.info(`Received text: ${text}`);
                    return text.includes('proved');
                });
        console.info(`Found: ${found}`);
        expect(found).toBe(true);
    });
});

function processChunkedResponse(response: Response, checkData: (text: string) => boolean) : any {
    var found = false;
    var reader = response.body?.getReader()
    var decoder = new TextDecoder();

    return readChunk(checkData);

    function readChunk(checkData: (text: string) => boolean) {
        return reader?.read().then(r => checkChunk(r, checkData));
    }

    function checkChunk(result: any, checkData: (text: string) => boolean) : any {
        var chunk = decoder.decode(result.value || new Uint8Array, { stream: !result.done });
        console.info(`got chunk of ${chunk.length} bytes`)
        found = checkData(chunk);
        if (found || result.done) {
            console.info('returning')
            return found;
        } 
        console.info('recursing')
        return readChunk(checkData);
    }
}