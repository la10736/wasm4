# ZkArcade Demo

## Come lanciare il servizio

Loggarsi su AWS con l'Account di _New Horizen_ Admin e andare nel datacenter di London `eu-west2`.
Li si trova l'istanza `zkArcade`, bisogna farla partire e guardare il suo indirizzo ip pubblico
(da ora in poi `ZK_ARCADE_IP`). Il costo del servizio e' di circa un dollaro all'ora.

Usando il tasto connect ci si puo' collegare con l'utente
`ubuntu`. Non ho creato altri utenti e io mi collego dal mio terminale dato che ho il certificato
SSH.

Comunque ora assumo che chi vuole lanciare il servizio possa collegarsi con tre console separate.

### Console 1: prover

Basta lanciare dalla shell della home dell'utente `ubuntu`:

```bash
./my_project/target/release/host
```

### Console 2: backend

Sempre dalla home dell'utente `ubuntu` andare nella directory `wasm4/foolish_arcade_be` e lanciare:

```bash
npm run dev
```

### Console 3: frontend

Sempre dalla home dell'utente `ubuntu` andare nella directory `wasm4/zkRetro_fe` editare il file 
`.env` e modificare la variabile d'ambiente `BACKEND_ADDRESS` con l'indirizzo ip pubblico di `ZK_ARCADE_IP`.

Successivamente lanciare:

```bash
npm run host
```

Ora sul browser aprire `http://ZK_ARCADE_IP:5173`.

## Cosa manca allo stato dell'arte

- [ ] Singole immagini docker per
  - [ ] Backend
  - [ ] Frontend
  - [ ] Prover (complicazione: l'immagine interna deve usare CUDA)
- [ ] Compose (con anche nginx per https)
- [ ] Update automatico nel frontend dello stato della prova: ho gia' implementato il 
backend, ma quando l'ho integrato con il frontend si sono creati un sacco di problemi. forse 
meglio rivederlo con un subscribe unico.
- [ ] Sostituire il db da json a sqllite
- [ ] Aggiungere un tabella per le prove disaccopiate da la partita per 
riprendere le pubblicazioni interrotte.

