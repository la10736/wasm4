import './style.css';
import { ethers } from 'ethers';

const connectButton = document.getElementById('connect-button') as HTMLButtonElement;
const startButton = document.getElementById('start-button') as HTMLButtonElement;

let jwtToken: string | null = null;

async function connectWallet() {
    if (typeof window.ethereum === 'undefined') {
        alert('Please install MetaMask!');
        return;
    }

    try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();

        // 1. Get challenge from backend
        const challengeResponse = await fetch(`http://localhost:3000/challenge?address=${address}`);
        if (!challengeResponse.ok) {
            throw new Error('Failed to get challenge');
        }
        const { message } = await challengeResponse.json();

        // 2. Sign the message
        const signature = await signer.signMessage(message);

        // 3. Login to backend
        const loginResponse = await fetch('http://localhost:3000/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ address, signature }),
        });

        if (!loginResponse.ok) {
            throw new Error('Login failed');
        }

        const { token } = await loginResponse.json();
        jwtToken = token;

        // Update UI
        connectButton.style.display = 'none';
        startButton.style.display = 'block';
        console.log('Successfully logged in!');

    } catch (error) {
        console.error('Connection failed:', error);
        alert('Failed to connect wallet. See console for details.');
    }
}

connectButton.addEventListener('click', connectWallet);

startButton.addEventListener('click', () => {
    if (!jwtToken) {
        alert('You are not logged in!');
        return;
    }
    console.log('Starting game with token:', jwtToken);
    // Game start logic will go here
});
