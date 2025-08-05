import './style.css';
import { ethers } from 'ethers';
import Onboard from '@web3-onboard/core';
import injectedModule from '@web3-onboard/injected-wallets';

// UI Elements
const connectButton = document.getElementById('connect-button') as HTMLButtonElement;
const disconnectButton = document.getElementById('disconnect-button') as HTMLButtonElement;
const startButton = document.getElementById('start-button') as HTMLButtonElement;
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

function updateUI(wallet: any | null) {
    if (wallet) {
        const address = wallet.accounts[0].address;
        const ensName = wallet.accounts[0].ens?.name;
        const name = ensName || wallet.label;
        const displayName = `${name} - ${address.substring(0, 6)}...${address.substring(address.length - 4)}`;

        walletStatusDiv.textContent = `Connected: ${displayName}`;
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

startButton.addEventListener('click', () => {
    if (!jwtToken) {
        alert('You are not logged in!');
        return;
    }
    console.log('Starting game with token:', jwtToken);
    // Game start logic will go here
});

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

// Initial UI state
updateUI(null);
