export class PersistentData {
    private view: DataView;

    constructor(buffer: ArrayBuffer) {
        if (buffer.byteLength < 24) {
            throw new Error("Buffer for PersistentData must be at least 24 bytes.");
        }
        this.view = new DataView(buffer);
    }

    get game_mode(): number {
        return this.view.getUint32(0, true);
    }

    set game_mode(value: number) {
        this.view.setUint32(0, value, true);
    }

    get max_frames(): number {
        return this.view.getUint32(4, true);
    }

    set max_frames(value: number) {
        this.view.setUint32(4, value, true);
    }

    get game_seed(): number {
        return this.view.getUint32(8, true);
    }

    set game_seed(value: number) {
        this.view.setUint32(8, value, true);
    }

    get frames(): number {
        return this.view.getUint32(12, true);
    }

    set frames(value: number) {
        this.view.setUint32(12, value, true);
    }

    get score(): number {
        return this.view.getUint32(16, true);
    }

    set score(value: number) {
        this.view.setUint32(16, value, true);
    }

    get health(): number {
        return this.view.getUint32(20, true);
    }

    set health(value: number) {
        this.view.setUint32(20, value, true);
    }
}
