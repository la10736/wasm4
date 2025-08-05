import { LitElement, html, css } from "lit";
import { customElement, state, query } from 'lit/decorators.js';

import * as constants from "../constants";
import * as configConstants from "../config-constants";
import * as devkit from "../devkit";
import * as utils from "./utils";
import * as z85 from "../z85";
import { Netplay, DEV_NETPLAY } from "../netplay";
import { Runtime } from "../runtime";
import { PersistentData } from "../persistent-data";
import { State } from "../state";

import { MenuOverlay } from "./menu-overlay";
import { Notifications } from "./notifications";

class InputState {
    gamepad = [0, 0, 0, 0];
    mouseX = 0;
    mouseY = 0;
    mouseButtons = 0;
}

// Gamepad event types
const enum GamepadEventType {
    PRESS = 0,
    RELEASE = 1
}

// Gamepad event structure
interface GamepadEvent {
    frame: number;
    playerIdx: number;
    button: number;
    eventType: GamepadEventType;
}

// Gamepad event recorder
class GamepadEventRecorder {
    private events: GamepadEvent[] = [];
    private previousGamepadState = [0, 0, 0, 0];
    private currentFrame = 0;
    private isRecording = false;
    private isPlaying = false;
    private playbackEvents: GamepadEvent[] = [];
    private playbackFrame = 0;

    startRecording() {
        this.isRecording = true;
        this.events = [];
        this.currentFrame = 0;
        this.previousGamepadState = [0, 0, 0, 0];
        console.log("Started gamepad event recording");
    }

    stopRecording() {
        this.isRecording = false;
        console.log(`Stopped gamepad event recording. Recorded ${this.events.length} events.`);
    }

    get isRecordingActive(): boolean {
        return this.isRecording;
    }

    get isPlayingActive(): boolean {
        return this.isPlaying;
    }

    startPlayback(events: GamepadEvent[]) {
        this.isPlaying = true;
        this.playbackEvents = [...events];
        this.playbackFrame = 0;
        console.log(`Started playback of ${events.length} events`);
    }

    stopPlayback() {
        this.isPlaying = false;
        this.playbackEvents = [];
        this.playbackFrame = 0;
        console.log("Stopped playback");
    }

    getPlaybackGamepadState(): number[] {
        if (!this.isPlaying) {
            return [0, 0, 0, 0];
        }

        const gamepadState = [0, 0, 0, 0];
        
        // Apply all events up to current frame
        for (const event of this.playbackEvents) {
            if (event.frame <= this.playbackFrame) {
                if (event.eventType === GamepadEventType.PRESS) {
                    gamepadState[event.playerIdx] |= event.button;
                } else if (event.eventType === GamepadEventType.RELEASE) {
                    gamepadState[event.playerIdx] &= ~event.button;
                }
            }
        }
        
        this.playbackFrame++;
        return gamepadState;
    }

    loadFromFile(): Promise<void> {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.bin';
            
            input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) {
                    reject(new Error('No file selected'));
                    return;
                }
                
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const data = new Uint8Array(reader.result as ArrayBuffer);
                        const events = this.deserializeFromByteStream(data);
                        this.startPlayback(events);
                        console.log(`Loaded ${events.length} events from file`);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsArrayBuffer(file);
            };
            
            input.oncancel = () => reject(new Error('File selection cancelled'));
            
            document.body.appendChild(input);
            input.click();
            document.body.removeChild(input);
        });
    }

    recordFrame(gamepadState: number[]) {
        if (!this.isRecording) return;

        // Check each player's gamepad for changes
        for (let playerIdx = 0; playerIdx < 4; playerIdx++) {
            const prevState = this.previousGamepadState[playerIdx];
            const currState = gamepadState[playerIdx];
            
            // Check each button bit
            for (let buttonBit = 0; buttonBit < 8; buttonBit++) {
                const buttonMask = 1 << buttonBit;
                const wasPressed = (prevState & buttonMask) !== 0;
                const isPressed = (currState & buttonMask) !== 0;
                
                // Record press event
                if (!wasPressed && isPressed) {
                    this.events.push({
                        frame: this.currentFrame,
                        playerIdx,
                        button: buttonMask,
                        eventType: GamepadEventType.PRESS
                    });
                }
                
                // Record release event
                if (wasPressed && !isPressed) {
                    this.events.push({
                        frame: this.currentFrame,
                        playerIdx,
                        button: buttonMask,
                        eventType: GamepadEventType.RELEASE
                    });
                }
            }
        }
        
        // Update previous state and increment frame
        this.previousGamepadState = [...gamepadState];
        this.currentFrame++;
    }

    getEvents(): GamepadEvent[] {
        return [...this.events];
    }

    serializeToByteStream(): Uint8Array {
        // Calculate buffer size: 4 bytes header + 8 bytes per event
        const headerSize = 4; // 4 bytes for event count
        const eventSize = 8; // 4 bytes frame + 1 byte player + 1 byte button + 1 byte type + 1 byte padding
        const bufferSize = headerSize + (this.events.length * eventSize);
        
        const buffer = new ArrayBuffer(bufferSize);
        const view = new DataView(buffer);
        
        // Write header: event count (4 bytes)
        view.setUint32(0, this.events.length, true); // little endian
        
        // Write events
        let offset = headerSize;
        for (const event of this.events) {
            view.setUint32(offset, event.frame, true);     // Frame number (4 bytes)
            view.setUint8(offset + 4, event.playerIdx);    // Player index (1 byte)
            view.setUint8(offset + 5, event.button);       // Button mask (1 byte)
            view.setUint8(offset + 6, event.eventType);    // Event type (1 byte)
            view.setUint8(offset + 7, 0);                  // Padding (1 byte)
            offset += eventSize;
        }
        
        return new Uint8Array(buffer);
    }

    deserializeFromByteStream(data: Uint8Array): GamepadEvent[] {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        
        // Read header: event count
        const eventCount = view.getUint32(0, true);
        const events: GamepadEvent[] = [];
        
        // Read events
        const headerSize = 4;
        const eventSize = 8;
        let offset = headerSize;
        
        for (let i = 0; i < eventCount; i++) {
            events.push({
                frame: view.getUint32(offset, true),
                playerIdx: view.getUint8(offset + 4),
                button: view.getUint8(offset + 5),
                eventType: view.getUint8(offset + 6)
            });
            offset += eventSize;
        }
        
        return events;
    }

    exportToFile(persistentData: PersistentData) {
        const byteStream = this.serializeToByteStream();
        const encodedEvents = z85.encode(byteStream);

        const exportData = {
            persistentData: {
                game_mode: persistentData.game_mode,
                max_frames: persistentData.max_frames,
                game_seed: persistentData.game_seed,
                frames: persistentData.frames,
                score: persistentData.score,
                health: persistentData.health,
            },
            gamepadEvents: encodedEvents,
        };

        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `game-recording-${persistentData.game_seed}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log(`Exported persistent data and ${this.events.length} events to ${a.download}`);
    }

    getRecordingSummary(): string {
        if (!this.isRecording && this.events.length === 0) {
            return "No recording available";
        }
        
        const status = this.isRecording ? "Recording" : "Stopped";
        const frameCount = this.currentFrame;
        const eventCount = this.events.length;
        const byteSize = this.serializeToByteStream().length;
        
        return `${status} | Frame: ${frameCount} | Events: ${eventCount} | Size: ${byteSize} bytes`;
    }
}

@customElement("wasm4-app")
export class App extends LitElement {
    static styles = css`
        canvas {
            display: block;
            width: 100%;
            height: 100%;
            image-rendering: auto; /* or crisp-edges */
            transform: translateZ(0);
        }

        :host {
            /* CSS Reset to isolate component from parent page styles */
            animation: none !important;
            border: none !important;
            box-shadow: none !important;
            text-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;

            /* Standard layout for the component */
            background: #202020;
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            position: relative;

            /* Prevent touch/selection issues */
            touch-action: none;
            user-select: none;
            -webkit-user-select: none;
            -webkit-tap-highlight-color: transparent;
        }

        .content {
            width: 100vmin;
            height: 100vmin;
            overflow: hidden;
        }

        /** Nudge the game upwards a bit in portrait to make space for the virtual gamepad. */
        @media (pointer: coarse) and (max-aspect-ratio: 2/3) {
            .content {
                position: absolute;
                top: calc((100% - 220px - 100vmin)/2)
            }
        }

        .content canvas {
            width: 100%;
            height: 100%;
            image-rendering: auto;
            image-rendering: auto;
        }
    `;

    private readonly runtime: Runtime;

    @state() private hideGamepadOverlay = false;
    @state() private showMenu = false;

    @query("wasm4-menu-overlay") private menuOverlay?: MenuOverlay;

    private requestAnimationFrameId: number | null = null;
    @query("wasm4-notifications") private notifications!: Notifications;

    private savedGameState?: State;

    readonly inputState = new InputState();
    private readonly gamepadUnavailableWarned = new Set<string>();
    private readonly gamepadRecorder = new GamepadEventRecorder();

    private netplay?: Netplay;

    private readonly diskPrefix: string;

    @state() private onExit!: (data: { persistentData: PersistentData, events: GamepadEvent[] }) => void;
    private resolveRunPromise?: (value: { persistentData: PersistentData, events: GamepadEvent[] }) => void;

    readonly onPointerUp = (event: PointerEvent) => {
        if (event.pointerType == "touch") {
            // Try to go fullscreen on mobile
            utils.requestFullscreen();
        }

        // Try to begin playing audio
        this.runtime.unlockAudio();
    }

    constructor (options?: { container?: HTMLElement }) {
        super();

        if (options?.container) {
            options.container.appendChild(this);
        }

        this.diskPrefix = document.getElementById("wasm4-disk-prefix")?.textContent ?? utils.getUrlParam("disk-prefix") as string;
        this.runtime = new Runtime(`${this.diskPrefix}-disk`);


    }

    run = (cartUrl: string) => new Promise(async (resolve) => {
        this.resolveRunPromise = resolve;
        await this.init(cartUrl);
    });

    async init (cartUrl: string) {
        this.runtime.persistentData.game_mode = 1;
        this.runtime.persistentData.max_frames = 60 * 60 * 2; // 2 minutes
        this.runtime.persistentData.game_seed = Date.now();

        async function loadCartWasm (): Promise<Uint8Array> {
            const cartJson = document.getElementById("wasm4-cart-json");

            // Is cart inlined?
            if (cartJson) {
                const { WASM4_CART, WASM4_CART_SIZE } = JSON.parse(cartJson.textContent ?? '');

                // The cart was bundled in the html, decode it
                const buffer = new Uint8Array(WASM4_CART_SIZE);
                z85.decode(WASM4_CART, buffer);
                return buffer;

            } else {
                // Load the cart from a url
                // const cartUrl = utils.getUrlParam("url") ?? "cart.wasm";
                const res = await fetch(cartUrl);
                if (res.ok) {
                    return new Uint8Array(await res.arrayBuffer());
                } else {
                    throw new Error(`Could not load cart at url: ${cartUrl}`);
                }
            }
        }

        const runtime = this.runtime;
        await runtime.init();

        const canvas = runtime.canvas;

        const hostPeerId = utils.getUrlParam("netplay");
        if (hostPeerId) {
            this.netplay = this.createNetplay();
            this.netplay.join(hostPeerId);
        } else {
            await runtime.load(await loadCartWasm());
        }

        let devtoolsManager = {
            toggleDevtools () {
                // Nothing
            },
            updateCompleted (...args: unknown[]) {
                // Nothing
            },
        };
        if (configConstants.GAMEDEV_MODE) {
            devtoolsManager = await import('@wasm4/web-devtools').then(({ DevtoolsManager}) => new DevtoolsManager());
        }

        if (!this.netplay) {
            runtime.start();
        }

        // Initialize persistent data for recording mode
        runtime.persistentData.game_mode = 1;
        runtime.persistentData.max_frames = 600;
        runtime.persistentData.game_seed = Date.now() & 0xFFFFFFFF; // Use current time as seed
        
        // Start recording automatically
        this.gamepadRecorder.startRecording();
        console.log(`Starting in recording mode with seed: ${runtime.persistentData.game_seed}`);

        if (DEV_NETPLAY) {
            this.copyNetplayLink();
        }

        if (configConstants.GAMEDEV_MODE) {
            devkit.cli_websocket?.addEventListener("message", async event => {
                switch (event.data) {
                case "reload":
                    this.resetCart(await loadCartWasm());
                    break;
                case "hotswap":
                    this.resetCart(await loadCartWasm(), true);
                    break;
                }
            });
        }

        function takeScreenshot () {
            // We need to render a frame first
            runtime.composite();

            canvas.toBlob(blob => {
                const url = URL.createObjectURL(blob!);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = "wasm4-screenshot.png";
                anchor.click();
                URL.revokeObjectURL(url);
            });
        }

        let videoRecorder: MediaRecorder | null = null;
        function recordVideo () {
            if (videoRecorder != null) {
                return; // Still recording, ignore
            }

            const mimeType = "video/webm";
            const videoStream = canvas.captureStream();
            videoRecorder = new MediaRecorder(videoStream, {
                mimeType,
                videoBitsPerSecond: 25000000,
            });

            const chunks: Blob[] = [];
            videoRecorder.ondataavailable = event => {
                chunks.push(event.data);
            };

            videoRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = "wasm4-animation.webm";
                anchor.click();
                URL.revokeObjectURL(url);
            };

            videoRecorder.start();
            setTimeout(() => {
                if(videoRecorder) {
                    videoRecorder.requestData();
                    videoRecorder.stop();
                    videoRecorder = null;
                }
            }, 4000);
        }

        const onMouseEvent = (event: PointerEvent) => {
            // Unhide the cursor if it was hidden by the keyboard handler
            document.body.style.cursor = "";

            if (event.isPrimary) {
                const bounds = canvas.getBoundingClientRect();
                const input = this.inputState;
                input.mouseX = Math.fround(constants.WIDTH * (event.clientX - bounds.left) / bounds.width);
                input.mouseY = Math.fround(constants.HEIGHT * (event.clientY - bounds.top) / bounds.height);
                input.mouseButtons = event.buttons & 0b111;
            }
        };
        window.addEventListener("pointerdown", onMouseEvent);
        window.addEventListener("pointerup", onMouseEvent);
        window.addEventListener("pointermove", onMouseEvent);

        canvas.addEventListener("contextmenu", event => {
            event.preventDefault();
        });

        const HOTKEYS: Record<string, () => void> = {
            "F1": () => this.onMenuButtonPressed(),
            "F2": () => takeScreenshot(),
            "F3": () => recordVideo(),

            "F5": () => {
                if (this.gamepadRecorder.getEvents().length > 0) {
                    this.gamepadRecorder.exportToFile(this.runtime.persistentData);
                    this.notifications.show("Gamepad events exported");
                } else {
                    this.notifications.show("No gamepad events to export");
                }
            },
            "F6": () => {
                const summary = this.gamepadRecorder.getRecordingSummary();
                this.notifications.show(summary);
                console.log("Gamepad Recording Status:", summary);
            },
            "F7": () => {
                if (this.gamepadRecorder.isPlayingActive) {
                    this.gamepadRecorder.stopPlayback();
                    this.notifications.show("Gamepad playback stopped");
                } else {
                    // Load file and restart runtime for playback
                    this.gamepadRecorder.loadFromFile().then(() => {
                        return this.resetCart(undefined, false);
                    }).then(() => {
                        this.notifications.show("Runtime restarted - Gamepad playback started");
                    }).catch((error) => {
                        console.error("Failed to load gamepad events:", error);
                        this.notifications.show("Failed to load gamepad events");
                    });
                }
            },
            "F8": () => {
                this.showHotkeyHelp();
            },
            "F9": () => this.resetCart(),
            "r": () => this.resetCart(),
            "R": () => this.resetCart(),
        };

        const onKeyboardEvent = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.altKey) {
                return; // Ignore ctrl/alt modified key presses because they may be the user trying to navigate
            }

            if (event.srcElement instanceof HTMLElement && event.srcElement.tagName == "INPUT") {
                return; // Ignore if we have an input element focused
            }

            const down = (event.type == "keydown");

            // Poke WebAudio
            runtime.unlockAudio();

            // We're using the keyboard now, hide the mouse cursor for extra immersion
            document.body.style.cursor = "none";

            if (down) {
                const hotkeyFn = HOTKEYS[event.key];
                if (hotkeyFn) {
                    hotkeyFn();
                    event.preventDefault();
                    return;
                }
            }

            let playerIdx = 0;
            let mask = 0;
            switch (event.code) {
            // Player 1
            case "KeyX": case "KeyV": case "Space": case "Period":
                mask = constants.BUTTON_X;
                break;
            case "KeyZ": case "KeyC": case "Comma":
                mask = constants.BUTTON_Z;
                break;
            case "ArrowUp":
                mask = constants.BUTTON_UP;
                break;
            case "ArrowDown":
                mask = constants.BUTTON_DOWN;
                break;
            case "ArrowLeft":
                mask = constants.BUTTON_LEFT;
                break;
            case "ArrowRight":
                mask = constants.BUTTON_RIGHT;
                break;

            // Player 2
            case "KeyA": case "KeyQ":
                playerIdx = 1;
                mask = constants.BUTTON_X;
                break;
            case "ShiftLeft": case "Tab":
                playerIdx = 1;
                mask = constants.BUTTON_Z;
                break;
            case "KeyE":
                playerIdx = 1;
                mask = constants.BUTTON_UP;
                break;
            case "KeyD":
                playerIdx = 1;
                mask = constants.BUTTON_DOWN;
                break;
            case "KeyS":
                playerIdx = 1;
                mask = constants.BUTTON_LEFT;
                break;
            case "KeyF":
                playerIdx = 1;
                mask = constants.BUTTON_RIGHT;
                break;

            // Player 3
            case "NumpadMultiply": case "NumpadDecimal":
                playerIdx = 2;
                mask = constants.BUTTON_X;
                break;
            case "NumpadSubtract": case "NumpadEnter":
                playerIdx = 2;
                mask = constants.BUTTON_Z;
                break;
            case "Numpad8":
                playerIdx = 2;
                mask = constants.BUTTON_UP;
                break;
            case "Numpad5":
                playerIdx = 2;
                mask = constants.BUTTON_DOWN;
                break;
            case "Numpad4":
                playerIdx = 2;
                mask = constants.BUTTON_LEFT;
                break;
            case "Numpad6":
                playerIdx = 2;
                mask = constants.BUTTON_RIGHT;
                break;
            }

            if (mask != 0) {
                event.preventDefault();

                // Set or clear the button bit from the next input state
                const gamepad = this.inputState.gamepad;
                if (down) {
                    gamepad[playerIdx] |= mask;
                } else {
                    gamepad[playerIdx] &= ~mask;
                }
            }
        };
        window.addEventListener("keydown", onKeyboardEvent);
        window.addEventListener("keyup", onKeyboardEvent);

        // Also listen to the top frame when we're embedded in an iframe
        if (top && top != window) {
            try {
                top.addEventListener("keydown", onKeyboardEvent);
                top.addEventListener("keyup", onKeyboardEvent);
            } catch {
                // Ignore iframe security errors
            }
        }

        const pollPhysicalGamepads = () => {
            if (!navigator.getGamepads) {
                return; // Browser doesn't support gamepads
            }

            for (const gamepad of navigator.getGamepads()) {
                if (gamepad == null) {
                    continue; // Disconnected gamepad
                } else if (gamepad.mapping != "standard") {
                    // The gamepad is available, but nonstandard, so we don't actually know how to read it.
                    // Let's warn once, and not use this gamepad afterwards.
                    if (!this.gamepadUnavailableWarned.has(gamepad.id)) {
                        this.gamepadUnavailableWarned.add(gamepad.id);
                        this.notifications.show("Unsupported gamepad: " + gamepad.id);
                    }
                    continue;
                }

                // https://www.w3.org/TR/gamepad/#remapping
                const buttons = gamepad.buttons;
                const axes = gamepad.axes;

                let mask = 0;
                if (buttons[12].pressed || axes[1] < -0.5) {
                    mask |= constants.BUTTON_UP;
                }
                if (buttons[13].pressed || axes[1] > 0.5) {
                    mask |= constants.BUTTON_DOWN;
                }
                if (buttons[14].pressed || axes[0] < -0.5) {
                    mask |= constants.BUTTON_LEFT;
                }
                if (buttons[15].pressed || axes[0] > 0.5) {
                    mask |= constants.BUTTON_RIGHT;
                }
                if (buttons[0].pressed || buttons[3].pressed || buttons[5].pressed || buttons[7].pressed) {
                    mask |= constants.BUTTON_X;
                }
                if (buttons[1].pressed || buttons[2].pressed || buttons[4].pressed || buttons[6].pressed) {
                    mask |= constants.BUTTON_Z;
                }

                if (buttons[9].pressed) {
                    this.showMenu = true;
                }

                this.inputState.gamepad[gamepad.index % 4] = mask;
            }
        }

        // When we should perform the next update
        let timeNextUpdate = performance.now();
        // Track the timestamp of the last frame
        let lastTimeFrameStart = timeNextUpdate;

        const onFrame = (timeFrameStart: number) => {
            this.requestAnimationFrameId = requestAnimationFrame(onFrame);

            pollPhysicalGamepads();
            let input = this.inputState;

            if (this.menuOverlay != null) {
                this.menuOverlay.applyInput();

                // Pause while the menu is open, unless netplay is active
                if (this.netplay) {
                    // Prevent inputs on the menu from being passed through to the game
                    input = new InputState();
                } else {
                    return; // Pause updates and rendering
                }
            }

            let calledUpdate = false;

            // Prevent timeFrameStart from getting too far ahead and death spiralling
            if (timeFrameStart - timeNextUpdate >= 200) {
                timeNextUpdate = timeFrameStart;
            }

            while (timeFrameStart >= timeNextUpdate) {
                timeNextUpdate += 1000/10;

                // Use playback events if playing, otherwise use real input
                let gamepadToUse = input.gamepad;
                if (this.gamepadRecorder.isPlayingActive) {
                    gamepadToUse = this.gamepadRecorder.getPlaybackGamepadState();
                } else {
                    // Record gamepad events for this frame only when not playing back
                    this.gamepadRecorder.recordFrame(input.gamepad);
                }

                if (this.netplay) {
                    if (this.netplay.update(gamepadToUse[0])) {
                        calledUpdate = true;
                    }

                } else {
                    // Pass inputs into runtime memory
                    for (let playerIdx = 0; playerIdx < 4; ++playerIdx) {
                        runtime.setGamepad(playerIdx, gamepadToUse[playerIdx]);
                    }
                    runtime.setMouse(input.mouseX, input.mouseY, input.mouseButtons);
                    const continueRunning = runtime.update();
                    if (!continueRunning) {
                        if (this.requestAnimationFrameId) {
                            cancelAnimationFrame(this.requestAnimationFrameId);
                        }

                        const exitData = {
                            persistentData: this.runtime.persistentData,
                            events: this.gamepadRecorder.getEvents(),
                        };

                        // Resolve the promise returned by run()
                        if (this.resolveRunPromise) {
                            this.resolveRunPromise(exitData);
                        }

                        // Also call the onExit callback for external listeners
                        if (this.onExit) {
                            this.onExit(exitData);
                        }

                        this.notifications.show("Cart exited.");
                        return;
                    }
                    calledUpdate = true;
                }
            }

            if (calledUpdate) {
                this.hideGamepadOverlay = !!runtime.getSystemFlag(constants.SYSTEM_HIDE_GAMEPAD_OVERLAY);

                runtime.composite();

                if (configConstants.GAMEDEV_MODE) {              
                    devtoolsManager.updateCompleted(runtime, timeFrameStart - lastTimeFrameStart);
                    lastTimeFrameStart = timeFrameStart;
                }
            }
        }
        requestAnimationFrame(onFrame);
    }

    onMenuButtonPressed () {
        if (this.showMenu) {
            // If the pause menu is already open, treat it as an X button
            this.inputState.gamepad[0] |= constants.BUTTON_X;
        } else {
            this.showMenu = true;
        }
    }

    showHotkeyHelp() {
        const helpText = [
            "🎮 WASM-4 Hotkeys:",
            "F1 - Open Menu",
            "F2 - Take Screenshot", 
            "F3 - Record Video",
            "F4 - Start/Stop Gamepad Recording",
            "F5 - Export Gamepad Events",
            "F6 - Show Recording Status",
            "F7 - Load & Replay Events",
            "F8 - Show This Help",
            "F9/R - Reset Cart"
        ].join(" | ");
        
        this.notifications.show(helpText);
        console.log("WASM-4 Hotkeys:\n" + [
            "F1 - Open Menu",
            "F2 - Take Screenshot", 
            "F3 - Record Video",
            "F4 - Start/Stop Gamepad Recording (restarts runtime)",
            "F5 - Export Gamepad Events to file",
            "F6 - Show Recording Status",
            "F7 - Load & Replay Events from file (restarts runtime)",
            "F8 - Show This Help",
            "F9/R - Reset Cart"
        ].join("\n"));
    }

    closeMenu () {
        if (this.showMenu) {
            this.showMenu = false;

            // Kind of a hack to prevent the button press to close the menu from being passed
            // through to the game
            for (let playerIdx = 0; playerIdx < 4; ++playerIdx) {
                this.inputState.gamepad[playerIdx] = 0;
            }
        }
    }

    saveGameState () {
        let state = this.savedGameState;
        if (state == null) {
            state = this.savedGameState = new State();
        }
        state.read(this.runtime);

        this.notifications.show("State saved");
    }

    loadGameState () {
        if (this.netplay) {
            this.notifications.show("State loading disabled during netplay");
            return;
        }

        const state = this.savedGameState;
        if (state != null) {
            state.write(this.runtime);
            this.notifications.show("State loaded");
        } else {
            this.notifications.show("Need to save a state first");
        }
    }

    exportGameDisk () {
        if(this.runtime.diskSize <= 0) {
            this.notifications.show("Disk is empty");
            return;
        }

        const disk = new Uint8Array(this.runtime.diskBuffer).slice(0, this.runtime.diskSize);
        const blob = new Blob([disk], { type: "application/octet-stream" });
        const link = document.createElement("a");

        link.style.display = "none";
        link.href = URL.createObjectURL(blob);
        link.download = `${this.diskPrefix}.disk`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    importGameDisk () {
        if (this.netplay) {
            this.notifications.show("Disk importing disabled during netplay");
            return;
        }

        const app = this;
        const input = document.createElement("input");

        input.style.display = "none";
        input.type = "file";
        input.accept = ".disk";
        input.multiple = false;

        input.addEventListener("change", () => {
            const files = input.files as FileList;
            let reader = new FileReader();
            
            reader.addEventListener("load", () => {
                let result = new Uint8Array(reader.result as ArrayBuffer).slice(0, constants.STORAGE_SIZE);
                let disk = new Uint8Array(constants.STORAGE_SIZE);

                disk.set(result);
                app.runtime.diskBuffer = disk.buffer;
                this.runtime.diskSize = result.length;
                
                const str = z85.encode(result);
                try {
                    localStorage.setItem(this.runtime.diskName, str);
                    app.notifications.show("Disk imported");
                } catch (error) {
                    app.notifications.show("Error importing disk");
                    console.error("Error importing disk", error);
                }

                app.closeMenu();
            });

            reader.readAsArrayBuffer(files[0]);
        });

        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }

    clearGameDisk () {
        if (this.netplay) {
            this.notifications.show("Disk clearing disabled during netplay");
            return;
        }

        this.runtime.diskBuffer = new ArrayBuffer(constants.STORAGE_SIZE);
        this.runtime.diskSize = 0;
        
        try {
            localStorage.removeItem(this.runtime.diskName);
        } catch (error) {
            this.notifications.show("Error clearing disk");
            console.error("Error clearing disk", error);
        }

        this.notifications.show("Disk cleared");
    }

    async copyNetplayLink () {
        if (!this.netplay) {
            this.netplay = this.createNetplay();
            this.netplay.host();
        }

        utils.copyToClipboard(await this.netplay.getInviteLink());
        this.notifications.show("Netplay link copied to clipboard");
    }

    async resetCart (wasmBuffer?: Uint8Array, preserveState: boolean = false) {
        if (this.netplay) {
            this.notifications.show("Reset disabled during netplay");
            return;
        }

        if (!wasmBuffer) {
            wasmBuffer = this.runtime.wasmBuffer!;
        }

        let state;
        if (preserveState) {
            // Take a snapshot
            state = new State();
            state.read(this.runtime);
        }
        this.runtime.reset(true);


        this.runtime.pauseState |= constants.PAUSE_REBOOTING;
        await this.runtime.load(wasmBuffer);
        this.runtime.pauseState &= ~constants.PAUSE_REBOOTING;

        if (state) {
            // Restore the previous snapshot
            state.write(this.runtime);
        } else {
            this.runtime.start();
        }
    }

    private createNetplay (): Netplay {
        const netplay = new Netplay(this.runtime);
        netplay.onstart = playerIdx => this.notifications.show(`Joined as player ${playerIdx+1}`);
        netplay.onjoin = playerIdx => this.notifications.show(`Player ${playerIdx+1} joined`);
        netplay.onleave = playerIdx => this.notifications.show(`Player ${playerIdx+1} left`);
        return netplay;
    }

    getNetplaySummary () {
        return this.netplay ? this.netplay.getSummary() : [];
    }

    connectedCallback () {
        super.connectedCallback();

        window.addEventListener("pointerup", this.onPointerUp);
    }

    disconnectedCallback () {
        window.removeEventListener("pointerup", this.onPointerUp);

        super.disconnectedCallback();
    }

    setOnExit(callback: (data: { persistentData: PersistentData, events: GamepadEvent[] }) => void) {
        this.onExit = callback;
    }

    render () {
        return html`
            <div class="content">
                ${this.showMenu ? html`<wasm4-menu-overlay .app=${this} />`: ""}
                <wasm4-notifications></wasm4-notifications>
                ${this.runtime.canvas}
            </div>
            ${!this.hideGamepadOverlay ? html`<wasm4-virtual-gamepad .app=${this} />` : ""}
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "wasm4-app": App;
    }
}

(window as any).Wasm4 = App;
