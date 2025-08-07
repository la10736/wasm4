import { defineConfig, loadEnv } from 'vite';

export default ({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

  return defineConfig({
    define: {
      'import.meta.env.ETH_RPC_URL': JSON.stringify(env.ETH_RPC_URL),
      'import.meta.env.BACKEND_ADDRESS': JSON.stringify(env.BACKEND_ADDRESS),
    },
  });
}
