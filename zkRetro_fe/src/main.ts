import './style.css';
import './wasm4.css';
import { ethers } from 'ethers';
import Onboard from '@web3-onboard/core';
import injectedModule from '@web3-onboard/injected-wallets';

// UI Elements
const connectButton = document.getElementById('connect-button') as HTMLButtonElement;
const disconnectButton = document.getElementById('disconnect-button') as HTMLButtonElement;
const startButton = document.getElementById('start-button')!;
const gameContainer = document.getElementById('game-container')!;
const gameView = document.getElementById('game-view')!;
const leaderboardContainer = document.getElementById('leaderboard-container')!;
const leaderboardBody = document.getElementById('leaderboard-body')! as HTMLTableSectionElement;
const playAgainButton = document.getElementById('play-again-button')! as HTMLButtonElement;
const leaderboardControls = document.getElementById('leaderboard-controls')!;

const shortenAddress = (address: string) => `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
const walletStatusDiv = document.getElementById('wallet-status') as HTMLDivElement;

// Web3-Onboard Initialization
const injected = injectedModule();
const onboard = Onboard({
    wallets: [injected],
    chains: [
        {
            id: '0x1',
            token: 'ETH',
            label: 'Ethereum Mainnet',
            rpcUrl: 'https://cloudflare-eth.com' // Public RPC
        },
        {
            id: '0xaa36a7',
            token: 'ETH',
            label: 'Sepolia Testnet',
            rpcUrl: 'https://rpc2.sepolia.org' // Public RPC
        }
    ],
    appMetadata: {
        name: 'zkvRetro Arcade',
        icon: '<svg>...</svg>', // Add your app icon
        description: 'A retro arcade powered by modern web3 technology.'
    },
    accountCenter: {
        desktop: { enabled: true },
        mobile: { enabled: true }
    }
});

// App State
let jwtToken: string | null = null;
let loggedInAddress: string | null = null;
let isLoggingIn: boolean = false;
let activeSseConnections: EventSource[] = [];

// --- Functions ---

async function handleLogin(wallet: any) {
    if (isLoggingIn) return; // Prevent concurrent logins
    isLoggingIn = true;

    const address = wallet.accounts[0].address;
    try {
        const ethersProvider = new ethers.BrowserProvider(wallet.provider);
        const signer = await ethersProvider.getSigner();

        // 1. Get challenge from backend
        const challengeResponse = await fetch(`http://localhost:3000/challenge?address=${address}`);
        if (!challengeResponse.ok) throw new Error(`Failed to get challenge: ${await challengeResponse.text()}`);
        const { message } = await challengeResponse.json();

        // 2. Sign the message
        const signature = await signer.signMessage(message);

        // 3. Login to backend
        const loginResponse = await fetch('http://localhost:3000/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, signature }),
        });
        if (!loginResponse.ok) throw new Error(`Login failed: ${await loginResponse.text()}`);
        const { token } = await loginResponse.json();
        jwtToken = token;
        loggedInAddress = address;

        console.log('Successfully logged in!');
        updateUI(wallet);

    } catch (error) {
        console.error('Login process failed:', error);
        alert('Login failed. See console for details.');
        updateUI(null);
    } finally {
        isLoggingIn = false; // Release the lock
    }
}

async function updateUI(wallet: any | null) {
    if (wallet) {
        const account = wallet.accounts[0];
        const address = account.address;
        let name = account.ens?.name ?? wallet.label;

        // The ENS name might be a promise that resolves later or fails.
        // We don't await it here to keep the UI responsive.
        // Instead, we let web3-onboard update it in the background.
        // The main goal is to prevent the timeout from crashing the UI.

        walletStatusDiv.textContent = `Connected: ${name} - ${shortenAddress(address)}`;
        connectButton.style.display = 'none';
        disconnectButton.style.display = 'block';
        startButton.style.display = 'block';
        leaderboardContainer.style.display = 'none'; // Hide on connect

    } else {
        walletStatusDiv.textContent = 'Not connected';
        connectButton.style.display = 'block';
        disconnectButton.style.display = 'none';
        startButton.style.display = 'none';
        loggedInAddress = null;
        jwtToken = null;

        // Show leaderboard on the homepage
        leaderboardContainer.style.display = 'block';
        leaderboardControls.style.display = 'none'; // Hide controls on homepage
        showLeaderboard();
    }
}

// --- Event Listeners & Subscriptions ---

connectButton.addEventListener('click', async () => {
    await onboard.connectWallet();
});

disconnectButton.addEventListener('click', async () => {
    const [primaryWallet] = onboard.state.get().wallets;
    if (primaryWallet) {
        await onboard.disconnectWallet({ label: primaryWallet.label });
    }
});

startButton.addEventListener('click', async () => {
    if (!jwtToken) {
        alert('You are not logged in!');
        return;
    }
    console.log('Starting game with token:', jwtToken);

    // Hide controls and show the game
    walletStatusDiv.style.display = 'none';
    disconnectButton.style.display = 'none';
    startButton.style.display = 'none';

    await startGame();
});

async function startGame() {
    document.body.classList.add('game-active');
    gameContainer.innerHTML = ''; // Clear previous game instance
    const wasm4 = new (window as any).Wasm4({ container: gameContainer });
    console.log('Starting game...');
    try {
        const gameData = await wasm4.run('/cart.wasm');
        console.log('Game exited, received data:', gameData);

        // TODO: Hide game container, show results/leaderboard

        // Now, submit the data to the backend
        await submitGameData(gameData);

    } catch (err) {
        console.error('Error during game execution:', err);
    }
}

async function submitGameData(gameData: { persistentData: any, events_serialized: string }) {
    if (!jwtToken) {
        console.error('No JWT token, cannot submit game data.');
        return;
    }

    console.log('Submitting game data to backend...');
    try {
        // These offsets are defined in the WASM-4 runtime and must be kept in sync

        const score = gameData.persistentData.score;
        const frames = gameData.persistentData.frames;
        const health = gameData.persistentData.health;
        const seed = gameData.persistentData.game_seed;
        const max_frames = gameData.persistentData.max_frames;
        const game_mode = gameData.persistentData.game_mode;

        console.info(`Submitting game data to backend... score: ${score}, frames: ${frames}, health: ${health}, seed: ${seed}, max_frames: ${max_frames}, game_mode: ${game_mode}`);

        const submissionPayload = {
            score,
            frames,
            health,
            seed,
            max_frames,
            game_mode,
            serialized_events: gameData.events_serialized,
        };


        const response = await fetch('http://localhost:3000/submit_game', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwtToken}`,
            },
            body: JSON.stringify(submissionPayload),
        });

        if (response.ok) {
            const result = await response.json();
            console.log('Submission successful:', result);
            if (result.entryId) {
                console.log(`Submission successful, entry ID: ${result.entryId}`);
                document.body.classList.remove('game-active');
                gameView.style.display = 'none';
                leaderboardContainer.style.display = 'block';
                leaderboardControls.style.display = 'flex'; // Show controls after game
                await showLeaderboard(result.entryId, 5, 5);
            } else {
                const errorResult = await response.json();
                console.error(`Submission failed: ${response.status}`, errorResult);
            }
        } else {
            const errorResult = await response.json();
            console.error(`Submission failed: ${response.status}`, errorResult);
        }
    } catch (error) {
        console.error('Error submitting game data:', error);
        alert('An error occurred while submitting your game data.');
    }
}

// Subscribe to wallet changes
onboard.state.select('wallets').subscribe((wallets) => {
    const [primaryWallet] = wallets;

    if (primaryWallet) {
        const newAddress = primaryWallet.accounts[0].address;
        // Only trigger login if the address changes or if we aren't logged in yet
        if (newAddress !== loggedInAddress) {
            handleLogin(primaryWallet);
        } else {
            // If we are already logged in with this address, just ensure the UI is correct
            updateUI(primaryWallet);
        }
    } else {
        // Wallet disconnected
        updateUI(null);
    }
});



playAgainButton.addEventListener('click', () => {
    leaderboardContainer.style.display = 'none';
    leaderboardControls.style.display = 'none';
    gameView.style.display = 'block';
    document.body.classList.remove('game-active');
    // Close active SSE connections when leaving the leaderboard
    activeSseConnections.forEach(conn => conn.close());
    activeSseConnections = [];
});

async function showLeaderboard(entryId?: string, before?: number, after?: number) {
    const url = entryId 
        ? `http://localhost:3000/leaderboard/neighbors/${entryId}${before ? `?before=${before}` : ''}${after ? `&after=${after}` : ''}` 
        : 'http://localhost:3000/leaderboard/neighbors';

    console.info(`Fetching leaderboard from ${url}`)

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch leaderboard: ${response.statusText}`);
        }
        let data = await response.json();
        console.info(`Fetched leaderboard ${JSON.stringify(data)}`)

        const leaderboardData: { entry: any, position: number }[] = data;

        // Close any previous connections before creating new ones
        activeSseConnections.forEach(conn => conn.close());
        activeSseConnections = [];
        leaderboardBody.innerHTML = ''; // Clear previous entries

        leaderboardData.forEach(({ entry, position }) => {
            const row = leaderboardBody.insertRow();
            row.dataset.entryId = entry.id;
            if (entry.id === entryId) {
                row.classList.add('current-player');
            }
            row.innerHTML = `
                <td class="position">${position}</td>
                <td class="user">${shortenAddress(entry.user)}</td>
                <td class="score">${entry.score}</td>
                <td class="time">${(entry.time / 60).toFixed(2)}s</td>
                <td class="health">${entry.health}</td>
                <td class="proof-state">${entry.proofState}</td>
            `;

            // // Subscribe to real-time updates for this entry
            // const sse = new EventSource(`http://localhost:3000/leaderboard/subscribe/${entry.id}`);
            // sse.onmessage = (event) => {
            //     const data = JSON.parse(event.data);
            //     const targetRow = leaderboardBody.querySelector(`[data-entry-id="${entry.id}"]`);
            //     if (targetRow) {
            //         const proofStateCell = targetRow.querySelector('.proof-state');
            //         if (proofStateCell) proofStateCell.textContent = data.proofState;
                    
            //         const positionCell = targetRow.querySelector('.position');
            //         if (positionCell && data.position) positionCell.textContent = data.position;
            //     }
            // };
            // activeSseConnections.push(sse);
        });

    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        alert('An error occurred while fetching the leaderboard.');
    }
}

// Initial UI state
updateUI(null);
