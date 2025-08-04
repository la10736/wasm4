

export class PersistentData {
    constructor(private view: DataView, private baseAddr: number) {}

    get game_mode(): number {
        return this.view.getUint32(this.baseAddr + 0, true);
    }

    set game_mode(value: number) {
        this.view.setUint32(this.baseAddr + 0, value, true);
    }

    get max_frames(): number {
        return this.view.getUint32(this.baseAddr + 4, true);
    }

    set max_frames(value: number) {
        this.view.setUint32(this.baseAddr + 4, value, true);
    }

    get game_seed(): number {
        return this.view.getUint32(this.baseAddr + 8, true);
    }

    set game_seed(value: number) {
        this.view.setUint32(this.baseAddr + 8, value, true);
    }

    get frames(): number {
        return this.view.getUint32(this.baseAddr + 12, true);
    }

    set frames(value: number) {
        this.view.setUint32(this.baseAddr + 12, value, true);
    }

    get score(): number {
        return this.view.getUint32(this.baseAddr + 16, true);
    }

    set score(value: number) {
        this.view.setUint32(this.baseAddr + 16, value, true);
    }

    get health(): number {
        return this.view.getUint32(this.baseAddr + 20, true);
    }

    set health(value: number) {
        this.view.setUint32(this.baseAddr + 20, value, true);
    }
}
