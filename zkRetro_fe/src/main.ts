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
    } else {
        walletStatusDiv.textContent = 'Not Connected';
        jwtToken = null;
        loggedInAddress = null;
        connectButton.style.display = 'block';
        disconnectButton.style.display = 'none';
        startButton.style.display = 'none';
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

async function submitGameData(gameData: { persistentData: { view: DataView }, events: any[] }) {
    if (!jwtToken) {
        console.error('No JWT token, cannot submit game data.');
        return;
    }

    console.log('Submitting game data to backend...');
    try {
        // These offsets are defined in the WASM-4 runtime and must be kept in sync
        const ADDR_PERSISTENT = 0xa0;
        const OFFSET_SCORE = 4; // u32
        const OFFSET_TIME = 8; // u32
        const OFFSET_HEALTH = 12; // u32

        const score = gameData.persistentData.view.getUint32(ADDR_PERSISTENT + OFFSET_SCORE, true);
        const time = gameData.persistentData.view.getUint32(ADDR_PERSISTENT + OFFSET_TIME, true);
        const health = gameData.persistentData.view.getUint32(ADDR_PERSISTENT + OFFSET_HEALTH, true);

        const submissionPayload = {
            score,
            time,
            health,
            events: gameData.events,
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
            // Hide game, show leaderboard
            document.body.classList.remove('game-active');
            gameView.style.display = 'none';
            leaderboardContainer.style.display = 'block';
            await showLeaderboard();
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
    gameView.style.display = 'block';
    document.body.classList.remove('game-active');
});

async function showLeaderboard() {
    console.log('Fetching leaderboard...');
    try {
        const response = await fetch('http://localhost:3000/get_leaderboard');
        if (response.ok) {
            const leaderboardData = await response.json();
            leaderboardBody.innerHTML = ''; // Clear previous entries

            leaderboardData.forEach((entry: any, index: number) => {
                const row = leaderboardBody.insertRow();
                row.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${entry.user.substring(0, 6)}...${entry.user.substring(entry.user.length - 4)}</td>
                    <td>${entry.score}</td>
                    <td>${(entry.time / 60).toFixed(2)}s</td>
                    <td>${entry.health}</td>
                `;
            });

        } else {
            console.error('Failed to fetch leaderboard');
            alert('Could not load leaderboard data.');
        }
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        alert('An error occurred while fetching the leaderboard.');
    }
}

// Initial UI state
updateUI(null);
